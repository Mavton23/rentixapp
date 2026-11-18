import { Body, Controller, Get, Headers, HttpCode, Injectable, Logger, Module, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { CronRunner } from '../../common/ops/cron-runner.service';
import { CRON_JOBS, type CronJobName } from '../../common/ops/cron-jobs';
import { sentryEnabled } from '../../instrument';
import { FilesModule } from '../files/files.module';
import { StorageService } from '../files/storage';
import { PlatformAdmin, Public } from '../../common/decorators/auth.decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';

const MIN = 60_000;

/** Limiares dos alertas de negócio. */
export const THRESHOLDS = {
  /** Pagamentos móveis pendentes há mais de 30 min depois do prazo (o sweep devia tê-los resolvido). */
  stuckPayments: 1,
  /** Notificações à espera há mais de 15 min (o envio corre a cada minuto). */
  queuedBacklog: 20,
  /** Mais de 25% das notificações da última hora falharam (com pelo menos 10 tentativas). */
  failureRate: 0.25,
  failureMinSample: 10,
  /** Dias sem cópia diária / teste de reposição bem-sucedido. */
  backupMaxAgeHours: 30,
  restoreTestMaxAgeDays: 35,
};

export type Check = { key: string; label: string; status: 'ok' | 'warning' | 'critical'; detail: string };

const opsEventSchema = z.object({
  kind: z.enum(['backup.dump', 'backup.restore_test', 'backup.files']),
  status: z.enum(['OK', 'FAILED']),
  details: z.record(z.string(), z.unknown()).optional(),
});

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);
  /** Último alerta enviado por chave (para não repetir o mesmo alerta de 15 em 15 min). */
  private readonly alerted = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cron: CronRunner,
  ) {}

  async ready() {
    const checks: Record<string, string> = {};
    let ok = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'unavailable';
      ok = false;
    }
    try {
      await this.storage.ping();
      checks.storage = 'ok';
    } catch {
      checks.storage = 'unavailable';
      ok = false;
    }
    if (!ok) throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Serviço indisponível', details: checks });
    return { status: 'ok', checks };
  }

  /** Estado completo para a página Saúde da administração. */
  async health(now = new Date()) {
    const hourAgo = new Date(now.getTime() - 60 * MIN);
    const [jobs, stuckMobile, stuckSubs, queued, sent, failed, events] = await Promise.all([
      this.prisma.cronJob.findMany(),
      this.prisma.payment.count({ where: { status: 'PENDING', expiresAt: { lt: new Date(now.getTime() - 30 * MIN) } } }),
      this.prisma.subscriptionPayment.count({ where: { status: 'PENDING', expiresAt: { lt: new Date(now.getTime() - 30 * MIN) } } }),
      this.prisma.notification.count({ where: { status: 'QUEUED', scheduledAt: { lt: new Date(now.getTime() - 15 * MIN) } } }),
      this.prisma.notification.count({ where: { status: 'SENT', sentAt: { gte: hourAgo } } }),
      this.prisma.notification.count({ where: { status: 'FAILED', createdAt: { gte: hourAgo } } }),
      this.prisma.opsEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);

    const byName = new Map(jobs.map((j) => [j.name, j]));
    const cronRows = (Object.keys(CRON_JOBS) as CronJobName[]).map((name) => {
      const def = CRON_JOBS[name];
      const j = byName.get(name);
      const last = j?.lastFinishedAt ?? null;
      const overdue = !last || now.getTime() - last.getTime() > def.maxGapMinutes * MIN;
      return {
        name,
        label: def.label,
        schedule: def.schedule,
        timezone: def.timezone,
        lastStartedAt: j?.lastStartedAt?.toISOString() ?? null,
        lastFinishedAt: last?.toISOString() ?? null,
        lastStatus: j?.lastStatus ?? null,
        lastDurationMs: j?.lastDurationMs ?? null,
        lastResult: j?.lastResult ?? null,
        lastError: j?.lastError ?? null,
        consecutiveFailures: j?.consecutiveFailures ?? 0,
        runs: j?.runs ?? 0,
        overdue,
      };
    });

    const lastOf = (kind: string) => events.find((e) => e.kind === kind) ?? null;
    const lastOkOf = (kind: string) => events.find((e) => e.kind === kind && e.status === 'OK') ?? null;
    const dump = lastOkOf('backup.dump');
    const restore = lastOkOf('backup.restore_test');

    const checks: Check[] = [];
    for (const c of cronRows) {
      if (c.consecutiveFailures > 0 && c.lastStatus === 'FAILED') {
        checks.push({ key: `cron:${c.name}:failed`, label: c.label, status: c.consecutiveFailures >= 3 || c.schedule.startsWith('0 ') ? 'critical' : 'warning', detail: `Falhou ${c.consecutiveFailures} vez(es) seguidas: ${c.lastError ?? ''}` });
      } else if (c.overdue && c.runs > 0) {
        checks.push({ key: `cron:${c.name}:overdue`, label: c.label, status: 'critical', detail: 'Não corre há mais tempo do que o esperado' });
      }
    }
    if (stuckMobile + stuckSubs >= THRESHOLDS.stuckPayments) {
      checks.push({ key: 'payments:stuck', label: 'Pagamentos móveis', status: 'warning', detail: `${stuckMobile + stuckSubs} pagamento(s) pendentes há mais de 30 min depois do prazo` });
    }
    if (queued >= THRESHOLDS.queuedBacklog) {
      checks.push({ key: 'notifications:backlog', label: 'Envio de mensagens', status: 'critical', detail: `${queued} mensagens à espera há mais de 15 min` });
    }
    if (sent + failed >= THRESHOLDS.failureMinSample && failed / (sent + failed) > THRESHOLDS.failureRate) {
      checks.push({ key: 'notifications:failures', label: 'Envio de mensagens', status: 'warning', detail: `${failed} de ${sent + failed} mensagens falharam na última hora` });
    }
    if (!dump || now.getTime() - dump.createdAt.getTime() > THRESHOLDS.backupMaxAgeHours * 60 * MIN) {
      checks.push({ key: 'backup:dump', label: 'Cópia diária da base de dados', status: 'warning', detail: dump ? `Última cópia bem-sucedida a ${dump.createdAt.toISOString()}` : 'Ainda sem cópias registadas' });
    }
    if (!restore || now.getTime() - restore.createdAt.getTime() > THRESHOLDS.restoreTestMaxAgeDays * 24 * 60 * MIN) {
      checks.push({ key: 'backup:restore', label: 'Teste de reposição', status: 'warning', detail: restore ? `Último teste bem-sucedido a ${restore.createdAt.toISOString()}` : 'Ainda sem testes de reposição registados' });
    }

    return {
      status: checks.some((c) => c.status === 'critical') ? 'critical' : checks.length ? 'warning' : 'ok',
      checks,
      crons: cronRows,
      payments: { stuckMobile, stuckSubscriptions: stuckSubs },
      notifications: { queuedOver15min: queued, lastHour: { sent, failed } },
      backups: {
        lastDump: lastOf('backup.dump'),
        lastRestoreTest: lastOf('backup.restore_test'),
        lastFiles: lastOf('backup.files'),
      },
      monitoring: { sentry: sentryEnabled },
    };
  }

  @Cron('*/15 * * * *', { name: 'ops-watch' })
  async scheduledWatch(): Promise<void> {
    await this.cron.run('ops-watch', () => this.watch());
  }

  /** Envia ao Sentry os problemas novos (cada um no máximo uma vez por hora). */
  async watch(now = new Date()) {
    const h = await this.health(now);
    const alerted: string[] = [];
    for (const c of h.checks) {
      // Crons em falha já geram alertas pelos check-ins do Sentry; aqui vão os restantes.
      if (c.key.startsWith('cron:') && c.key.endsWith(':failed')) continue;
      const last = this.alerted.get(c.key) ?? 0;
      if (now.getTime() - last < 60 * MIN) continue;
      this.alerted.set(c.key, now.getTime());
      alerted.push(c.key);
      this.logger.warn({ check: c.key, detail: c.detail }, 'Alerta de operações');
      if (sentryEnabled) {
        Sentry.captureMessage(`${c.label}: ${c.detail}`, {
          level: c.status === 'critical' ? 'error' : 'warning',
          fingerprint: ['ops-watch', c.key],
          tags: { check: c.key },
        });
      }
    }
    return { problems: h.checks.length, alerts: alerted.length, alerted };
  }

  async recordEvent(input: z.infer<typeof opsEventSchema>) {
    const e = await this.prisma.opsEvent.create({ data: { kind: input.kind, status: input.status, details: (input.details ?? {}) as object } });
    if (input.status === 'FAILED' && sentryEnabled) {
      Sentry.captureMessage(`Operação falhou: ${input.kind}`, { level: 'error', fingerprint: ['ops-event', input.kind], extra: { details: input.details } });
    }
    return { id: e.id };
  }
}

@ApiTags('Sistema')
@SkipThrottle()
@Controller()
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly config: AppConfig,
  ) {}

  /** Para o orquestrador: 200 só se a base de dados e o armazenamento respondem. */
  @Public()
  @Get('health/ready')
  ready() {
    return this.ops.ready();
  }

  @PlatformAdmin()
  @Get('admin/ops/health')
  health() {
    return this.ops.health();
  }

  /** Os scripts de backup registam aqui o resultado (cabeçalho x-ops-token). */
  @Public()
  @Post('internal/ops-events')
  @HttpCode(201)
  @ApiExcludeEndpoint()
  record(@Headers('x-ops-token') token: string | undefined, @Body(new ZodPipe(opsEventSchema)) body: z.infer<typeof opsEventSchema>) {
    const expected = this.config.get('OPS_TOKEN');
    const ok = !!expected && !!token && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_OPS_TOKEN', message: 'Token inválido' });
    return this.ops.recordEvent(body);
  }
}

@Module({ imports: [FilesModule], controllers: [OpsController], providers: [OpsService], exports: [OpsService] })
export class OpsModule {}
