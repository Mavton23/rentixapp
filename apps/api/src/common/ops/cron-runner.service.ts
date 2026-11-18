import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { sentryEnabled } from '../../instrument';
import { CRON_JOBS, type CronJobName } from './cron-jobs';
import type { Prisma } from '../../generated/prisma/client';

/** Resultado pequeno para guardar (números, não listas). */
function summarize(result: unknown): Prisma.InputJsonValue | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'string') return result;
  if (Array.isArray(result)) return { items: result.length };
  if (typeof result === 'object') {
    return Object.fromEntries(Object.entries(result).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')) as Prisma.InputJsonObject;
  }
  return undefined;
}

/**
 * Executa as tarefas agendadas de forma vigiada:
 * - regista início, fim, duração, resultado e falhas seguidas em cron_jobs (página Saúde);
 * - envia check-ins ao Sentry Crons, que alerta se uma tarefa falhar ou não correr a horas;
 * - uma falha nunca derruba o processo.
 * Com CRON_ENABLED=false não corre nada (várias réplicas: só uma com crons).
 */
@Injectable()
export class CronRunner {
  private readonly logger = new Logger(CronRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async run<T>(name: CronJobName, fn: () => Promise<T>): Promise<T | undefined> {
    if (!this.config.get('CRON_ENABLED')) return undefined;
    return this.execute(name, fn);
  }

  /** Executa sempre (usado também pelos testes e por execuções manuais). */
  async execute<T>(name: CronJobName, fn: () => Promise<T>): Promise<T | undefined> {
    const job = CRON_JOBS[name];
    const started = new Date();
    await this.prisma.cronJob
      .upsert({
        where: { name },
        create: { name, lastStartedAt: started, lastStatus: 'RUNNING' },
        update: { lastStartedAt: started, lastStatus: 'RUNNING' },
      })
      .catch(() => undefined);

    const body = async () => fn();
    try {
      const result = sentryEnabled
        ? await Sentry.withMonitor(`rentix-${name}`, body, {
            schedule: { type: 'crontab', value: job.schedule },
            timezone: job.timezone,
            checkinMargin: 5,
            maxRuntime: job.maxRuntimeMinutes,
            // Tarefas de minuto a minuto só alertam ao fim de 3 falhas seguidas.
            failureIssueThreshold: job.schedule === '* * * * *' ? 3 : 1,
            recoveryThreshold: 1,
          })
        : await body();
      await this.finish(name, started, 'OK', summarize(result), null);
      return result;
    } catch (err) {
      this.logger.error({ err, job: name }, 'Tarefa agendada falhou');
      if (sentryEnabled) Sentry.captureException(err, { tags: { cron: name } });
      await this.finish(name, started, 'FAILED', undefined, err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  private async finish(name: string, started: Date, status: 'OK' | 'FAILED', result: Prisma.InputJsonValue | undefined, error: string | null) {
    const finished = new Date();
    await this.prisma.cronJob
      .update({
        where: { name },
        data: {
          lastFinishedAt: finished,
          lastStatus: status,
          lastDurationMs: finished.getTime() - started.getTime(),
          lastResult: result ?? undefined,
          lastError: error?.slice(0, 1000) ?? null,
          consecutiveFailures: status === 'OK' ? 0 : { increment: 1 },
          runs: { increment: 1 },
        },
      })
      .catch((err: unknown) => this.logger.warn({ err, job: name }, 'Não foi possível registar a execução'));
  }
}
