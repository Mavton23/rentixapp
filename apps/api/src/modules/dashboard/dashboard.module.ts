import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { addDays, dateToIsoDate, isoDateToDate, periodOf, todayIn } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Org } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

type ByCurrency = { currency: string; amount: number }[];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(ctx: OrgContext) {
    const orgId = ctx.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const today = todayIn(org.timezone);
    const period = periodOf(today);
    const monthStart = isoDateToDate(`${period}-01`);
    const todayDate = isoDateToDate(today);
    const openStatuses = ['OPEN', 'PARTIALLY_PAID'] as const;

    const [units, occupied, tenants, activeLeases, billed, collected, overdue, upcoming, recentPayments] =
      await Promise.all([
        this.prisma.unit.count({ where: { organizationId: orgId, archivedAt: null } }),
        this.prisma.unit.count({ where: { organizationId: orgId, archivedAt: null, status: 'OCCUPIED' } }),
        this.prisma.tenant.count({ where: { organizationId: orgId, archivedAt: null } }),
        this.prisma.lease.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
        this.prisma.invoice.groupBy({
          by: ['currency'],
          where: { organizationId: orgId, kind: 'RENT', period, status: { not: 'VOID' } },
          _sum: { amount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['currency'],
          where: { organizationId: orgId, status: 'CONFIRMED', paidAt: { gte: monthStart, lte: todayDate } },
          _sum: { amount: true },
        }),
        this.prisma.invoice.findMany({
          where: { organizationId: orgId, status: { in: [...openStatuses] }, dueDate: { lt: todayDate } },
          select: { amount: true, paidAmount: true, currency: true, tenantId: true },
        }),
        this.prisma.invoice.findMany({
          where: {
            organizationId: orgId,
            status: { in: [...openStatuses] },
            dueDate: { gte: todayDate, lte: isoDateToDate(addDays(today, 7)) },
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: {
            id: true,
            number: true,
            description: true,
            amount: true,
            paidAmount: true,
            currency: true,
            dueDate: true,
            tenant: { select: { id: true, fullName: true } },
          },
        }),
        this.prisma.payment.findMany({
          where: { organizationId: orgId, status: 'CONFIRMED' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            amount: true,
            currency: true,
            method: true,
            paidAt: true,
            receiptNumber: true,
            tenant: { select: { id: true, fullName: true } },
          },
        }),
      ]);

    const overdueByCurrency: Record<string, number> = {};
    for (const i of overdue) overdueByCurrency[i.currency] = (overdueByCurrency[i.currency] ?? 0) + i.amount - i.paidAmount;
    const toList = (rows: { currency: string; _sum: { amount: number | null } }[]): ByCurrency =>
      rows.map((r) => ({ currency: r.currency, amount: r._sum.amount ?? 0 }));

    return {
      today,
      period,
      defaultCurrency: org.defaultCurrency,
      occupancy: {
        units,
        occupied,
        rate: units ? Math.round((occupied / units) * 1000) / 10 : 0,
      },
      tenants,
      activeLeases,
      month: { billed: toList(billed), collected: toList(collected) },
      overdue: {
        invoices: overdue.length,
        tenants: new Set(overdue.map((o) => o.tenantId)).size,
        amount: Object.entries(overdueByCurrency).map(([currency, amount]) => ({ currency, amount })),
      },
      upcoming: upcoming.map((u) => ({ ...u, dueDate: dateToIsoDate(u.dueDate), outstanding: u.amount - u.paidAmount })),
      recentPayments: recentPayments.map((p) => ({ ...p, paidAt: dateToIsoDate(p.paidAt) })),
    };
  }
}

@ApiTags('Painel')
@ApiBearerAuth()
@Controller('dashboard')
class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Indicadores do painel: ocupação, faturado vs. cobrado no mês, dívidas, próximos vencimentos' })
  overview(@Org() ctx: OrgContext) {
    return this.dashboard.overview(ctx);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
