import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { NotificationChannel } from '@rentix/shared';
import { CronRunner } from '../../common/ops/cron-runner.service';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { buildEmailChannel, buildMessagingChannels, MessageChannel } from './channels';
import { render, TemplateData, TemplateKey } from './templates';
import type { Notification } from '../../generated/prisma/client';

export interface EnqueueInput<K extends TemplateKey> {
  template: K;
  data: TemplateData[K];
  channel: NotificationChannel;
  recipient: string;
  organizationId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  locale?: string;
  /** Impede duplicados (ex.: "reminder:<invoiceId>"). */
  dedupeKey?: string;
  scheduledAt?: Date;
}

export interface RecipientContacts {
  email?: string | null;
  phone?: string | null;
}

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

/**
 * Notificações via "outbox": gravar primeiro, enviar depois.
 * - Se o envio falhar, tenta de novo com espera crescente (até 5 tentativas).
 * - Se a API reiniciar, nada se perde.
 * - Pode ser gravada na mesma transação da operação que a originou.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly channels: Record<NotificationChannel, MessageChannel>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronRunner,
    private readonly config: AppConfig,
  ) {
    const email = buildEmailChannel(config);
    const { sms, whatsapp } = buildMessagingChannels(config);
    this.channels = { EMAIL: email, SMS: sms, WHATSAPP: whatsapp };
  }

  /** Idioma de quem recebe: o do inquilino ou utilizador, senão o da organização. */
  private async recipientLocale(db: Tx | PrismaService, input: EnqueueInput<TemplateKey>): Promise<string> {
    if (input.tenantId) {
      const t = await db.tenant.findUnique({ where: { id: input.tenantId }, select: { locale: true, organization: { select: { locale: true } } } });
      if (t) return t.locale ?? t.organization.locale;
    }
    if (input.userId) {
      const u = await db.user.findUnique({ where: { id: input.userId }, select: { locale: true } });
      if (u?.locale) return u.locale;
    }
    if (input.organizationId) {
      const o = await db.organization.findUnique({ where: { id: input.organizationId }, select: { locale: true } });
      if (o) return o.locale;
    }
    return 'pt';
  }

  async enqueue<K extends TemplateKey>(input: EnqueueInput<K>, tx?: Tx): Promise<number> {
    const db = tx ?? this.prisma;
    const r = render(input.template, input.data, input.locale ?? (await this.recipientLocale(db, input)));
    const isEmail = input.channel === 'EMAIL';
    const res = await db.notification.createMany({
      data: [
        {
          organizationId: input.organizationId ?? null,
          tenantId: input.tenantId ?? null,
          userId: input.userId ?? null,
          channel: input.channel,
          template: input.template,
          recipient: input.recipient,
          subject: isEmail ? r.subject : null,
          body: isEmail ? r.body : r.sms,
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${input.channel}` : null,
          scheduledAt: input.scheduledAt ?? new Date(),
        },
      ],
      skipDuplicates: true,
    });
    return res.count;
  }

  /**
   * Envia por email (se houver) e por SMS (se houver telefone). Em Moçambique o SMS
   * chega a mais pessoas do que o email, por isso ambos são usados quando disponíveis.
   */
  async notifyContact<K extends TemplateKey>(
    contacts: RecipientContacts,
    base: Omit<EnqueueInput<K>, 'channel' | 'recipient'>,
    tx?: Tx,
  ): Promise<number> {
    let n = 0;
    if (contacts.email) n += await this.enqueue({ ...base, channel: 'EMAIL', recipient: contacts.email }, tx);
    if (contacts.phone) n += await this.enqueue({ ...base, channel: 'SMS', recipient: contacts.phone }, tx);
    return n;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notifications-dispatch' })
  async scheduledDispatch(): Promise<void> {
    await this.cron.run('notifications-dispatch', async () => ({ sent: await this.dispatchPending() }));
  }

  /** Processa a fila. Seguro com várias instâncias (FOR UPDATE SKIP LOCKED). */
  async dispatchPending(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      // "Reserva" um lote: incrementa tentativas e adia 5 min. Se o processo morrer a meio,
      // as mensagens voltam à fila sozinhas.
      const batch = await this.prisma.$queryRaw<Notification[]>`
        UPDATE notifications SET attempts = attempts + 1, "scheduledAt" = now() + interval '5 minutes'
        WHERE id IN (
          SELECT id FROM notifications
          WHERE status = 'QUEUED' AND "scheduledAt" <= now()
          ORDER BY "scheduledAt"
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *`;

      for (const n of batch) {
        try {
          const res = await this.channels[n.channel].send({
            to: n.recipient,
            subject: n.subject,
            body: n.body,
            idempotencyKey: n.id,
          });
          await this.prisma.notification.update({
            where: { id: n.id },
            data: { status: 'SENT', sentAt: new Date(), providerMessageId: res.providerMessageId, lastError: null },
          });
          sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const failed = n.attempts >= MAX_ATTEMPTS;
          const backoffMin = 2 ** n.attempts; // 2, 4, 8, 16 min
          await this.prisma.notification.update({
            where: { id: n.id },
            data: {
              status: failed ? 'FAILED' : 'QUEUED',
              lastError: message.slice(0, 1000),
              scheduledAt: new Date(Date.now() + backoffMin * 60_000),
            },
          });
          this.logger.warn(`Falha a enviar notificação ${n.id} (${n.channel}): ${message}`);
        }
      }
    } finally {
      this.running = false;
    }
    return sent;
  }
}
