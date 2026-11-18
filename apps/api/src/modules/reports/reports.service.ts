import { Injectable } from '@nestjs/common';
import {
  agingBucket,
  AGING_BUCKETS,
  dateToIsoDate,
  diffDays,
  isoDateToDate,
  periodOf,
  todayIn,
  type AgingBucket,
  type ReportRange,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedRange {
  from: string;
  to: string;
  today: string;
  timezone: string;
  currency: string;
  organizationName: string;
}

type Money = { currency: string; amount: number }[];
const OPEN = ['OPEN', 'PARTIALLY_PAID'] as const;

const sumBy = <T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Money => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount }));
};

/**
 * Relatórios do período para o senhorio e para o contabilista. Tudo calculado na base de
 * dados a partir de faturas e pagamentos (não há tabelas de agregados para manter).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sem datas: o mês corrente, até hoje. */
  async resolveRange(organizationId: string, r: ReportRange): Promise<ResolvedRange> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const today = todayIn(org.timezone);
    const from = r.from ?? `${periodOf(today)}-01`;
    const to = r.to ?? today;
    return { from, to, today, timezone: org.timezone, currency: org.defaultCurrency, organizationName: org.name };
  }

  async summary(organizationId: string, range: ReportRange) {
    const r = await this.resolveRange(organizationId, range);
    const from = isoDateToDate(r.from);
    const to = isoDateToDate(r.to);
    const [billed, collected, due, outstanding] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['currency', 'kind'],
        where: { organizationId, status: { not: 'VOID' }, issueDate: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['currency', 'method'],
        where: { organizationId, status: 'CONFIRMED', paidAt: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.invoice.groupBy({
        by: ['currency'],
        where: { organizationId, status: { not: 'VOID' }, dueDate: { gte: from, lte: to } },
        _sum: { amount: true, paidAmount: true },
      }),
      this.prisma.invoice.findMany({
        where: { organizationId, status: { in: [...OPEN] } },
        select: { amount: true, paidAmount: true, currency: true, dueDate: true },
      }),
    ]);

    const today = isoDateToDate(r.today);
    return {
      range: { from: r.from, to: r.to },
      currency: r.currency,
      billed: {
        total: sumBy(billed, (b) => b.currency, (b) => b._sum.amount ?? 0),
        byKind: billed.map((b) => ({ kind: b.kind, currency: b.currency, amount: b._sum.amount ?? 0, count: b._count })),
      },
      collected: {
        total: sumBy(collected, (c) => c.currency, (c) => c._sum.amount ?? 0),
        byMethod: collected
          .map((c) => ({ method: c.method, currency: c.currency, amount: c._sum.amount ?? 0, count: c._count }))
          .sort((a, b) => b.amount - a.amount),
      },
      /** Das faturas que venceram no período, quanto já foi pago (até hoje). */
      collectionRate: due.map((d) => ({
        currency: d.currency,
        due: d._sum.amount ?? 0,
        paid: d._sum.paidAmount ?? 0,
        rate: d._sum.amount ? Math.round(((d._sum.paidAmount ?? 0) / d._sum.amount) * 1000) / 10 : null,
      })),
      outstanding: {
        total: sumBy(outstanding, (o) => o.currency, (o) => o.amount - o.paidAmount),
        overdue: sumBy(
          outstanding.filter((o) => o.dueDate < today),
          (o) => o.currency,
          (o) => o.amount - o.paidAmount,
        ),
      },
      monthly: await this.monthly(organizationId, r),
      byProperty: await this.byProperty(organizationId, r),
    };
  }

  /** Faturado e cobrado por mês, nos 12 meses que acabam no fim do intervalo (moeda principal). */
  private async monthly(organizationId: string, r: ResolvedRange) {
    const endPeriod = periodOf(r.to);
    const [y, m] = endPeriod.split('-').map(Number) as [number, number];
    const periods = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    const start = isoDateToDate(`${periods[0]}-01`);
    const end = isoDateToDate(r.to);
    const [billed, collected] = await Promise.all([
      this.prisma.$queryRaw<{ p: string; total: bigint }[]>`
        SELECT to_char("issueDate", 'YYYY-MM') AS p, SUM(amount)::bigint AS total FROM invoices
        WHERE "organizationId" = ${organizationId}::uuid AND status <> 'VOID' AND currency::text = ${r.currency}
          AND "issueDate" BETWEEN ${start} AND ${end}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ p: string; total: bigint }[]>`
        SELECT to_char("paidAt", 'YYYY-MM') AS p, SUM(amount)::bigint AS total FROM payments
        WHERE "organizationId" = ${organizationId}::uuid AND status = 'CONFIRMED' AND currency::text = ${r.currency}
          AND "paidAt" BETWEEN ${start} AND ${end}
        GROUP BY 1`,
    ]);
    const b = new Map(billed.map((x) => [x.p, Number(x.total)]));
    const c = new Map(collected.map((x) => [x.p, Number(x.total)]));
    return periods.map((p) => ({ period: p, billed: b.get(p) ?? 0, collected: c.get(p) ?? 0 }));
  }

  /** Por imóvel: unidades, ocupação, faturado e cobrado no período (moeda principal). */
  private async byProperty(organizationId: string, r: ResolvedRange) {
    const from = isoDateToDate(r.from);
    const to = isoDateToDate(r.to);
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string; units: bigint; occupied: bigint; billed: bigint | null; collected: bigint | null; outstanding: bigint | null }[]
    >`
      SELECT p.id, p.name,
        (SELECT COUNT(*) FROM units u WHERE u."propertyId" = p.id AND u."archivedAt" IS NULL) AS units,
        (SELECT COUNT(*) FROM units u WHERE u."propertyId" = p.id AND u."archivedAt" IS NULL AND u.status = 'OCCUPIED') AS occupied,
        (SELECT SUM(i.amount) FROM invoices i JOIN leases l ON l.id = i."leaseId" JOIN units u ON u.id = l."unitId"
          WHERE u."propertyId" = p.id AND i.status <> 'VOID' AND i.currency::text = ${r.currency}
            AND i."issueDate" BETWEEN ${from} AND ${to})::bigint AS billed,
        (SELECT SUM(pay.amount) FROM payments pay JOIN invoices i ON i.id = pay."invoiceId" JOIN leases l ON l.id = i."leaseId" JOIN units u ON u.id = l."unitId"
          WHERE u."propertyId" = p.id AND pay.status = 'CONFIRMED' AND pay.currency::text = ${r.currency}
            AND pay."paidAt" BETWEEN ${from} AND ${to})::bigint AS collected,
        (SELECT SUM(i.amount - i."paidAmount") FROM invoices i JOIN leases l ON l.id = i."leaseId" JOIN units u ON u.id = l."unitId"
          WHERE u."propertyId" = p.id AND i.status IN ('OPEN', 'PARTIALLY_PAID') AND i.currency::text = ${r.currency})::bigint AS outstanding
      FROM properties p
      WHERE p."organizationId" = ${organizationId}::uuid AND p."archivedAt" IS NULL
      ORDER BY p.name`;
    return rows.map((x) => ({
      id: x.id,
      name: x.name,
      units: Number(x.units),
      occupied: Number(x.occupied),
      billed: Number(x.billed ?? 0),
      collected: Number(x.collected ?? 0),
      outstanding: Number(x.outstanding ?? 0),
    }));
  }

  /** Dívidas em aberto por inquilino e antiguidade (dias depois do vencimento), à data de hoje. */
  async aging(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const today = todayIn(org.timezone);
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId, status: { in: [...OPEN] } },
      select: {
        number: true,
        amount: true,
        paidAmount: true,
        currency: true,
        dueDate: true,
        tenant: { select: { id: true, fullName: true, phone: true } },
        lease: { select: { unit: { select: { label: true, property: { select: { name: true } } } } } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const empty = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
    const byTenant = new Map<
      string,
      { tenant: { id: string; fullName: string; phone: string }; units: Set<string>; currency: string; buckets: Record<AgingBucket, number>; total: number; oldestDueDate: string; invoices: number }
    >();
    const totals = new Map<string, Record<AgingBucket, number>>();
    for (const i of invoices) {
      const due = i.amount - i.paidAmount;
      const dueDate = dateToIsoDate(i.dueDate);
      const bucket = agingBucket(diffDays(dueDate, today));
      const key = `${i.tenant.id}:${i.currency}`;
      const row =
        byTenant.get(key) ??
        { tenant: i.tenant, units: new Set<string>(), currency: i.currency, buckets: empty(), total: 0, oldestDueDate: dueDate, invoices: 0 };
      row.units.add(`${i.lease.unit.property.name}, ${i.lease.unit.label}`);
      row.buckets[bucket] += due;
      row.total += due;
      row.invoices++;
      byTenant.set(key, row);
      const t = totals.get(i.currency) ?? empty();
      t[bucket] += due;
      totals.set(i.currency, t);
    }
    return {
      today,
      rows: [...byTenant.values()]
        .map((r) => ({ ...r, units: [...r.units] }))
        .sort((a, b) => b.total - b.buckets.current - (a.total - a.buckets.current) || b.total - a.total),
      totals: [...totals.entries()].map(([currency, buckets]) => ({ currency, buckets, total: Object.values(buckets).reduce((s, v) => s + v, 0) })),
    };
  }

  // ---------- Dados para as exportações ----------

  invoicesFor(organizationId: string, r: ResolvedRange) {
    return this.prisma.invoice.findMany({
      where: { organizationId, issueDate: { gte: isoDateToDate(r.from), lte: isoDateToDate(r.to) } },
      include: {
        tenant: { select: { fullName: true, nuit: true } },
        lease: { select: { unit: { select: { label: true, property: { select: { name: true } } } } } },
      },
      orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
    });
  }

  paymentsFor(organizationId: string, r: ResolvedRange) {
    return this.prisma.payment.findMany({
      where: { organizationId, status: { in: ['CONFIRMED', 'REVERSED'] }, paidAt: { gte: isoDateToDate(r.from), lte: isoDateToDate(r.to) } },
      include: {
        tenant: { select: { fullName: true, nuit: true } },
        invoice: { select: { number: true, lease: { select: { unit: { select: { label: true, property: { select: { name: true } } } } } } } },
      },
      orderBy: [{ paidAt: 'asc' }, { receiptNumber: 'asc' }],
    });
  }

  async tenantsFor(organizationId: string) {
    const tenants = await this.prisma.tenant.findMany({
      where: { organizationId, archivedAt: null },
      include: {
        leases: {
          where: { status: 'ACTIVE' },
          select: { rentAmount: true, currency: true, startDate: true, endDate: true, unit: { select: { label: true, property: { select: { name: true } } } } },
        },
        invoices: { where: { status: { in: [...OPEN] } }, select: { amount: true, paidAmount: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return tenants;
  }

}
