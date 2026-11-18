import { pickLocale, translator } from '../../common/i18n';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays, dateToIsoDate, formatPeriod, isoDateToDate, todayIn } from '@rentix/shared';
import { CronRunner } from '../../common/ops/cron-runner.service';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentNumberService } from './document-number.service';
import { lateFeeFor, periodsDue, rentDates } from './billing.logic';
import type { Invoice, InvoiceKind, Lease, Organization, Tenant } from '../../generated/prisma/client';

export interface BillingRunSummary {
  organizationId: string;
  today: string;
  invoicesCreated: number;
  lateFeesApplied: number;
  /** Mensagens novas postas na fila (lembretes + avisos de atraso). */
  remindersQueued: number;
  leasesEnded: number;
}

type LeaseWithTenant = Lease & { tenant: Tenant };

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function periodLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS_PT[Number(m) - 1]} de ${y}`;
}

/**
 * Motor de faturação. Corre todos os dias (06:00 de Maputo) e pode ser chamado manualmente.
 * É idempotente: correr duas vezes no mesmo dia não duplica faturas, multas nem lembretes.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronRunner,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly numbers: DocumentNumberService,
  ) {}

  @Cron('0 6 * * *', { name: 'billing-daily', timeZone: 'Africa/Maputo' })
  async scheduledRun(): Promise<void> {
    await this.cron.run('billing-daily', async () => {
      const runs = await this.runAll();
      // Totais de todas as organizações (para a página Saúde).
      const totals: Record<string, number> = { organizations: runs.length };
      for (const r of runs) for (const [k, v] of Object.entries(r)) if (typeof v === 'number') totals[k] = (totals[k] ?? 0) + v;
      return totals;
    });
  }

  async runAll(now = new Date()): Promise<BillingRunSummary[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { leases: { some: { status: 'ACTIVE' } } },
      select: { id: true },
    });
    const results: BillingRunSummary[] = [];
    for (const { id } of orgs) {
      try {
        results.push(await this.runForOrganization(id, now));
      } catch (err) {
        // Uma organização com problemas não impede as outras.
        this.logger.error({ err, organizationId: id }, 'Falha na faturação da organização');
      }
    }
    this.logger.log(`Faturação diária concluída para ${results.length}/${orgs.length} organizações`);
    return results;
  }

  async runForOrganization(organizationId: string, now = new Date()): Promise<BillingRunSummary> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockOrganization(tx, organizationId);
        const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
        const today = todayIn(org.timezone, now);
        const summary: BillingRunSummary = {
          organizationId,
          today,
          invoicesCreated: 0,
          lateFeesApplied: 0,
          remindersQueued: 0,
          leasesEnded: 0,
        };

        const leases = await tx.lease.findMany({
          where: { organizationId, status: 'ACTIVE' },
          include: { tenant: true },
        });
        for (const lease of leases) {
          summary.invoicesCreated += await this.generateRentInvoices(tx, org, lease, today);
        }
        summary.leasesEnded = await this.endExpiredLeases(tx, org, today);
        summary.lateFeesApplied = await this.applyLateFees(tx, org, today);
        summary.remindersQueued = await this.queueReminders(tx, org, today);

        if (summary.invoicesCreated || summary.lateFeesApplied || summary.leasesEnded) {
          await this.audit.log(
            {
              organizationId,
              actorType: 'SYSTEM',
              action: 'billing.run',
              entityType: 'organization',
              entityId: organizationId,
              metadata: { ...summary },
            },
            tx,
          );
        }
        return summary;
      },
      { timeout: 60_000 },
    );
  }

  /** Serializa operações de faturação da mesma organização (cron vs. criação de contrato). */
  async lockOrganization(tx: Tx, organizationId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
  }

  /** Gera as faturas de renda em falta para um contrato. Devolve quantas criou. */
  async generateRentInvoices(tx: Tx, org: Organization, lease: LeaseWithTenant, today: string): Promise<number> {
    const info = {
      startDate: dateToIsoDate(lease.startDate),
      endDate: lease.endDate ? dateToIsoDate(lease.endDate) : null,
      billingDay: lease.billingDay,
      firstBillingPeriod: lease.firstBillingPeriod,
    };
    const due = periodsDue(info, today);
    if (!due.length) return 0;

    const existing = await tx.invoice.findMany({
      where: { leaseId: lease.id, kind: 'RENT', period: { in: due } },
      select: { period: true },
    });
    const have = new Set(existing.map((e) => e.period));

    // A descrição fica no idioma do inquilino (é o documento dele), senão no da organização.
    const loc = pickLocale(lease.tenant.locale, org.locale);
    let created = 0;
    for (const period of due) {
      if (have.has(period)) continue;
      const { issueDate, dueDate } = rentDates(info, period, today);
      await this.issueInvoice(tx, org, lease, {
        kind: 'RENT',
        period,
        description: translator(loc)('Renda de {periodo}', { periodo: formatPeriod(period, loc) }),
        issueDate,
        dueDate,
        amount: lease.rentAmount,
      });
      created++;
    }
    return created;
  }

  /** Cria uma fatura numerada e notifica o inquilino. */
  async issueInvoice(
    tx: Tx,
    org: Organization,
    lease: LeaseWithTenant,
    data: {
      kind: InvoiceKind;
      period?: string | null;
      description: string;
      issueDate: string;
      dueDate: string;
      amount: number;
      parentInvoiceId?: string;
      notify?: boolean;
    },
  ): Promise<Invoice> {
    const number = await this.numbers.next(tx, org.id, 'FT', Number(data.issueDate.slice(0, 4)));
    const invoice = await tx.invoice.create({
      data: {
        organizationId: org.id,
        leaseId: lease.id,
        tenantId: lease.tenantId,
        number,
        kind: data.kind,
        period: data.period ?? null,
        description: data.description,
        issueDate: isoDateToDate(data.issueDate),
        dueDate: isoDateToDate(data.dueDate),
        amount: data.amount,
        currency: lease.currency,
        parentInvoiceId: data.parentInvoiceId,
      },
    });

    if (data.notify !== false && data.kind !== 'LATE_FEE') {
      await this.notifications.notifyContact(
        { email: lease.tenant.email, phone: lease.tenant.phone },
        {
          template: 'INVOICE_ISSUED',
          organizationId: org.id,
          tenantId: lease.tenantId,
          dedupeKey: `issued:${invoice.id}`,
          data: {
            tenantName: lease.tenant.fullName,
            organizationName: org.name,
            number,
            description: data.description,
            due: { amount: data.amount, currency: lease.currency },
            dueDate: data.dueDate,
            portalUrl: this.portalUrl(),
          },
        },
        tx,
      );
    }
    return invoice;
  }

  /** Contratos cuja data de fim já passou passam a ENDED e libertam a unidade. */
  private async endExpiredLeases(tx: Tx, org: Organization, today: string): Promise<number> {
    const expired = await tx.lease.findMany({
      where: { organizationId: org.id, status: 'ACTIVE', endDate: { lt: isoDateToDate(today) } },
      select: { id: true, unitId: true },
    });
    for (const l of expired) {
      await tx.lease.update({ where: { id: l.id }, data: { status: 'ENDED' } });
      await tx.unit.update({ where: { id: l.unitId }, data: { status: 'AVAILABLE' } });
    }
    return expired.length;
  }

  /** Multa única por fatura de renda em atraso, depois da tolerância. */
  private async applyLateFees(tx: Tx, org: Organization, today: string): Promise<number> {
    const candidates = await tx.invoice.findMany({
      where: {
        organizationId: org.id,
        kind: 'RENT',
        status: { in: ['OPEN', 'PARTIALLY_PAID'] },
        dueDate: { lt: isoDateToDate(today) },
        lateFee: { is: null },
      },
      include: { lease: { include: { tenant: true } } },
    });

    let applied = 0;
    for (const inv of candidates) {
      const bps = inv.lease.lateFeeBps ?? org.lateFeeBps;
      const graceDays = inv.lease.gracePeriodDays ?? org.gracePeriodDays;
      const fee = lateFeeFor({
        outstanding: inv.amount - inv.paidAmount,
        dueDate: dateToIsoDate(inv.dueDate),
        today,
        graceDays,
        bps,
      });
      if (fee <= 0) continue;

      const feeInvoice = await this.issueInvoice(tx, org, inv.lease, {
        kind: 'LATE_FEE',
        description: translator(pickLocale(inv.lease.tenant.locale, org.locale))('Multa por atraso — {numero}', { numero: inv.number }),
        issueDate: today,
        dueDate: today,
        amount: fee,
        parentInvoiceId: inv.id,
      });
      await this.notifications.notifyContact(
        { email: inv.lease.tenant.email, phone: inv.lease.tenant.phone },
        {
          template: 'LATE_FEE_APPLIED',
          organizationId: org.id,
          tenantId: inv.tenantId,
          dedupeKey: `latefee:${inv.id}`,
          data: {
            tenantName: inv.lease.tenant.fullName,
            organizationName: org.name,
            number: feeInvoice.number,
            fee: { amount: fee, currency: inv.currency },
            parentNumber: inv.number,
          },
        },
        tx,
      );
      applied++;
    }
    return applied;
  }

  /** Lembrete N dias antes do vencimento e aviso de atraso (uma vez cada, por fatura). */
  private async queueReminders(tx: Tx, org: Organization, today: string): Promise<number> {
    let queued = 0;
    const reminderDate = addDays(today, org.reminderDaysBefore);

    const upcoming =
      org.reminderDaysBefore > 0
        ? await tx.invoice.findMany({
            where: {
              organizationId: org.id,
              status: { in: ['OPEN', 'PARTIALLY_PAID'] },
              dueDate: { gt: isoDateToDate(today), lte: isoDateToDate(reminderDate) },
            },
            include: { tenant: true },
          })
        : [];
    for (const inv of upcoming) {
      queued += await this.notifications.notifyContact(
        { email: inv.tenant.email, phone: inv.tenant.phone },
        {
          template: 'PAYMENT_REMINDER',
          organizationId: org.id,
          tenantId: inv.tenantId,
          dedupeKey: `reminder:${inv.id}`,
          data: {
            tenantName: inv.tenant.fullName,
            organizationName: org.name,
            number: inv.number,
            due: { amount: inv.amount - inv.paidAmount, currency: inv.currency },
            dueDate: dateToIsoDate(inv.dueDate),
            portalUrl: this.portalUrl(),
          },
        },
        tx,
      );
    }

    const overdue = await tx.invoice.findMany({
      where: {
        organizationId: org.id,
        status: { in: ['OPEN', 'PARTIALLY_PAID'] },
        dueDate: { lt: isoDateToDate(today) },
      },
      include: { tenant: true },
    });
    for (const inv of overdue) {
      queued += await this.notifications.notifyContact(
        { email: inv.tenant.email, phone: inv.tenant.phone },
        {
          template: 'INVOICE_OVERDUE',
          organizationId: org.id,
          tenantId: inv.tenantId,
          dedupeKey: `overdue:${inv.id}`,
          data: {
            tenantName: inv.tenant.fullName,
            organizationName: org.name,
            number: inv.number,
            due: { amount: inv.amount - inv.paidAmount, currency: inv.currency },
            dueDate: dateToIsoDate(inv.dueDate),
            portalUrl: this.portalUrl(),
          },
        },
        tx,
      );
    }
    return queued;
  }

  private portalUrl(): string {
    return `${this.config.get('WEB_URL')}/portal`;
  }
}
