import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  adminInvoicesQuerySchema,
  adminMarkPaidSchema,
  adminOrganizationsQuerySchema,
  adminSetSubscriptionSchema,
  adminSuspendSchema,
  adminUpdatePlanSchema,
  adminVoidInvoiceSchema,
  FREE_PLAN_CODE,
  isoDateToDate,
  type AdminInvoicesQuery,
  type AdminMarkPaidInput,
  type AdminOrganizationsQuery,
  type AdminSetSubscriptionInput,
  type AdminSuspendInput,
  type AdminUpdatePlanInput,
  type BillingCycle,
} from '@rentix/shared';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { cycleMonths } from '../subscriptions/subscription.logic';
import { OrgStatusCache } from '../../common/org-status.cache';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import { CurrentStaff, PlatformAdmin } from '../../common/decorators/auth.decorators';
import type { StaffAuth } from '../../common/auth-context';
import { badRequest, conflict, fieldError, notFound } from '../../common/utils/errors';
import { paginated } from '../../common/utils/pagination';
import type { Prisma } from '../../generated/prisma/client';

const DAY = 86_400_000;

/** Fim de um dia (inclusive) em Maputo, como instante: 00:00 do dia seguinte, UTC+2. */
const endOfDayMaputo = (isoDate: string) => new Date(isoDateToDate(isoDate).getTime() + DAY - 2 * 3_600_000);

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly subs: SubscriptionsService,
    private readonly orgStatus: OrgStatusCache,
  ) {}

  // ---------- Indicadores ----------

  async metrics(now = new Date()) {
    const since = new Date(now.getTime() - 30 * DAY);
    const [orgs, newOrgs, suspended, subs, revenue, open, trialsEnding] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { createdAt: { gte: since } } }),
      this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.subscription.findMany({ include: { plan: { select: { code: true, name: true } } } }),
      this.prisma.subscriptionInvoice.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { amount: true }, _count: true }),
      this.prisma.subscriptionInvoice.aggregate({ where: { status: 'OPEN' }, _sum: { amount: true }, _count: true }),
      this.prisma.subscription.findMany({
        where: { status: 'TRIALING', currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
        include: { organization: { select: { id: true, name: true } }, plan: { select: { name: true } } },
        orderBy: { currentPeriodEnd: 'asc' },
        take: 10,
      }),
    ]);

    let mrr = 0;
    const byStatus = { trialing: 0, paying: 0, pastDue: 0, free: 0 };
    const byPlan = new Map<string, { code: string; name: string; count: number }>();
    for (const s of subs) {
      const entry = byPlan.get(s.plan.code) ?? { code: s.plan.code, name: s.plan.name, count: 0 };
      entry.count++;
      byPlan.set(s.plan.code, entry);
      if (s.plan.code === FREE_PLAN_CODE) byStatus.free++;
      else if (s.status === 'TRIALING') byStatus.trialing++;
      else if (s.status === 'PAST_DUE') byStatus.pastDue++;
      else if (s.status === 'ACTIVE') {
        byStatus.paying++;
        mrr += Math.round(s.periodValue / cycleMonths(s.billingCycle as BillingCycle));
      }
    }
    return {
      organizations: { total: orgs, newLast30Days: newOrgs, suspended },
      subscriptions: byStatus,
      byPlan: [...byPlan.values()].sort((a, b) => b.count - a.count),
      mrr,
      revenueLast30Days: { amount: revenue._sum.amount ?? 0, invoices: revenue._count },
      openInvoices: { amount: open._sum.amount ?? 0, count: open._count },
      trialsEndingSoon: trialsEnding.map((t) => ({
        organizationId: t.organization.id,
        name: t.organization.name,
        plan: t.plan.name,
        endsAt: t.currentPeriodEnd!.toISOString(),
      })),
    };
  }

  // ---------- Organizações ----------

  async listOrganizations(q: AdminOrganizationsQuery) {
    const where: Prisma.OrganizationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.subscriptionStatus || q.planCode
        ? {
            subscription: {
              ...(q.subscriptionStatus ? { status: q.subscriptionStatus } : {}),
              ...(q.planCode ? { plan: { code: q.planCode } } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { nuit: { contains: q.search } },
              { memberships: { some: { user: { email: { contains: q.search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        include: {
          subscription: { include: { plan: { select: { code: true, name: true } } } },
          memberships: { where: { role: 'OWNER' }, take: 1, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, email: true, phone: true } } } },
          _count: { select: { units: { where: { archivedAt: null } }, tenants: { where: { archivedAt: null } }, memberships: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paginated(
      rows.map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status,
        city: o.city,
        createdAt: o.createdAt.toISOString(),
        owner: o.memberships[0]?.user ?? null,
        plan: o.subscription?.plan ?? null,
        subscriptionStatus: o.subscription?.status ?? null,
        currentPeriodEnd: o.subscription?.currentPeriodEnd?.toISOString() ?? null,
        counts: { units: o._count.units, tenants: o._count.tenants, members: o._count.memberships },
      })),
      total,
      q,
    );
  }

  async organization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        memberships: { include: { user: { select: { id: true, name: true, email: true, phone: true, lastLoginAt: true } } }, orderBy: { createdAt: 'asc' } },
        subscription: { include: { plan: true, scheduledPlan: true } },
      },
    });
    if (!org) throw notFound('Organização', 'ORGANIZATION_NOT_FOUND');
    const [usage, limits, invoices, activity] = await Promise.all([
      this.plans.usage(id),
      this.plans.limitsFor(id),
      this.prisma.subscriptionInvoice.findMany({
        where: { organizationId: id },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, action: true, actorType: true, createdAt: true },
      }),
    ]);
    return {
      id: org.id,
      name: org.name,
      status: org.status,
      suspendedAt: org.suspendedAt?.toISOString() ?? null,
      suspendedReason: org.suspendedReason,
      nuit: org.nuit,
      email: org.email,
      phone: org.phone,
      city: org.city,
      createdAt: org.createdAt.toISOString(),
      members: org.memberships.map((m) => ({ role: m.role, user: { ...m.user, lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null } })),
      subscription: org.subscription ? this.subs.presentSub(org.subscription) : null,
      usage,
      limits,
      invoices: invoices.map((i) => this.subs.presentInvoice(i)),
      activity: activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
  }

  /** Definir a subscrição à mão: oferecer um plano, prolongar um teste, corrigir um erro. */
  async setSubscription(admin: StaffAuth, organizationId: string, input: AdminSetSubscriptionInput) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertOrg(tx, organizationId);
      const sub = await this.subs.lockSub(tx, organizationId);
      const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
      if (!plan) throw notFound('Plano', 'PLAN_NOT_FOUND');

      if (plan.code === FREE_PLAN_CODE) {
        await this.subs.downgradeToFree(tx, sub, 'CHANGED', admin.userId);
      } else {
        if (!input.periodEnd) throw fieldError('periodEnd', 'Indique até quando vale o plano');
        const end = endOfDayMaputo(input.periodEnd);
        if (end <= new Date()) throw fieldError('periodEnd', 'A data tem de ser no futuro');
        const keepStart = sub.planId === plan.id && sub.currentPeriodStart ? sub.currentPeriodStart : new Date();
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            planId: plan.id,
            billingCycle: input.billingCycle,
            status: input.status,
            currentPeriodStart: keepStart,
            currentPeriodEnd: end,
            // Período oferecido: não gera crédito numa mudança de plano posterior.
            periodValue: 0,
            cancelAtPeriodEnd: false,
            scheduledPlanId: null,
            scheduledCycle: null,
            pastDueSince: null,
          },
        });
        await tx.subscriptionInvoice.updateMany({
          where: { organizationId, status: 'OPEN' },
          data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Subscrição alterada pela administração' },
        });
      }
      await this.log(tx, admin, organizationId, 'platform.subscription_set', 'subscription', sub.id, {
        plan: input.planCode,
        cycle: input.billingCycle,
        status: input.status,
        periodEnd: input.periodEnd ?? null,
        reason: input.reason,
      });
    });
    return this.organization(organizationId);
  }

  async suspend(admin: StaffAuth, organizationId: string, input: AdminSuspendInput) {
    await this.prisma.$transaction(async (tx) => {
      const org = await this.assertOrg(tx, organizationId);
      if (org.status === 'SUSPENDED') throw conflict('ALREADY_SUSPENDED', 'A organização já está suspensa');
      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: input.reason },
      });
      await this.log(tx, admin, organizationId, 'platform.organization_suspended', 'organization', organizationId, { reason: input.reason });
    });
    this.orgStatus.invalidate(organizationId);
    return this.organization(organizationId);
  }

  async reactivate(admin: StaffAuth, organizationId: string) {
    await this.prisma.$transaction(async (tx) => {
      const org = await this.assertOrg(tx, organizationId);
      if (org.status === 'ACTIVE') throw conflict('NOT_SUSPENDED', 'A organização não está suspensa');
      await tx.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null } });
      await this.log(tx, admin, organizationId, 'platform.organization_reactivated', 'organization', organizationId, {});
    });
    this.orgStatus.invalidate(organizationId);
    return this.organization(organizationId);
  }

  // ---------- Faturas da plataforma ----------

  async listInvoices(q: AdminInvoicesQuery) {
    const where: Prisma.SubscriptionInvoiceWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.search
        ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { organization: { name: { contains: q.search, mode: 'insensitive' } } }] }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.subscriptionInvoice.count({ where }),
      this.prisma.subscriptionInvoice.findMany({
        where,
        include: { plan: { select: { code: true, name: true } }, organization: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paginated(
      rows.map((i) => ({ ...this.subs.presentInvoice(i), organization: i.organization })),
      total,
      q,
    );
  }

  /** Registar um pagamento recebido fora do Rentix (transferência, numerário...). */
  async markPaid(admin: StaffAuth, invoiceId: string, input: AdminMarkPaidInput) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await this.subs.lockSub(tx, invoice.organizationId);
      const fresh = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (fresh.status !== 'OPEN') throw conflict('INVOICE_NOT_OPEN', 'A fatura já não está em aberto');
      // Data do pagamento (12:00 em Maputo), sem ir para o futuro.
      const paidAt = new Date(Math.min(isoDateToDate(input.paidOn).getTime() + 10 * 3_600_000, Date.now()));
      await this.subs.applyPaid(tx, fresh, { method: input.method, reference: input.reference, paidAt }, admin.userId);
      await this.log(tx, admin, invoice.organizationId, 'platform.invoice_marked_paid', 'subscription_invoice', invoiceId, {
        number: invoice.number,
        method: input.method,
        reference: input.reference,
      });
    });
    await this.subs.notifyPaid(invoiceId);
    return this.invoiceRow(invoiceId);
  }

  async voidInvoice(admin: StaffAuth, invoiceId: string, reason: string) {
    const res = await this.prisma.subscriptionInvoice.updateMany({
      where: { id: invoiceId, status: 'OPEN' },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
    });
    if (!res.count) throw conflict('INVOICE_NOT_OPEN', 'Só se podem anular faturas em aberto');
    const inv = await this.prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await this.log(this.prisma, admin, inv.organizationId, 'platform.invoice_voided', 'subscription_invoice', invoiceId, { number: inv.number, reason });
    return this.invoiceRow(invoiceId);
  }

  invoicePdf(id: string) {
    return this.subs.invoicePdf(id);
  }

  private async invoiceRow(id: string) {
    const i = await this.prisma.subscriptionInvoice.findUniqueOrThrow({
      where: { id },
      include: { plan: { select: { code: true, name: true } }, organization: { select: { id: true, name: true } } },
    });
    return { ...this.subs.presentInvoice(i), organization: i.organization };
  }

  // ---------- Planos ----------

  async listPlans() {
    const plans = await this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
    return plans.map(({ _count, ...p }) => ({ ...p, subscriptions: _count.subscriptions }));
  }

  /** Mudar preços e limites. Afeta novas faturas; períodos já pagos não mudam. */
  async updatePlan(admin: StaffAuth, id: string, input: AdminUpdatePlanInput) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw notFound('Plano', 'PLAN_NOT_FOUND');
    if (plan.code === FREE_PLAN_CODE && (input.monthlyPrice > 0 || input.annualPrice > 0 || !input.isActive)) {
      throw badRequest('FREE_PLAN_LOCKED', 'O plano Grátis tem de continuar gratuito e ativo');
    }
    if (plan.code !== FREE_PLAN_CODE && (input.monthlyPrice === 0 || input.annualPrice === 0)) {
      throw fieldError('monthlyPrice', 'Um plano pago precisa de preço mensal e anual');
    }
    const updated = await this.prisma.plan.update({ where: { id }, data: input });
    await this.audit.log({
      actorType: 'USER',
      actorId: admin.userId,
      action: 'platform.plan_updated',
      entityType: 'plan',
      entityId: id,
      metadata: { code: plan.code, before: { monthlyPrice: plan.monthlyPrice, annualPrice: plan.annualPrice, maxUnits: plan.maxUnits }, after: input },
    });
    return updated;
  }

  // ---------- auxiliares ----------

  private async assertOrg(tx: Tx, id: string) {
    const org = await tx.organization.findUnique({ where: { id } });
    if (!org) throw notFound('Organização', 'ORGANIZATION_NOT_FOUND');
    return org;
  }

  private async log(
    db: Tx | PrismaService,
    admin: StaffAuth,
    organizationId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await this.audit.log(
      { organizationId, actorType: 'USER', actorId: admin.userId, action, entityType, entityId, metadata: { ...metadata, platformAdmin: true } },
      db as Tx,
    );
  }
}

@ApiTags('Administração da plataforma')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin')
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Indicadores: organizações, subscrições, receita mensal recorrente' })
  metrics() {
    return this.admin.metrics();
  }

  @Get('organizations')
  organizations(@Query(new ZodPipe(adminOrganizationsQuerySchema)) q: AdminOrganizationsQuery) {
    return this.admin.listOrganizations(q);
  }

  @Get('organizations/:id')
  organization(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.organization(id);
  }

  @Put('organizations/:id/subscription')
  @ApiOperation({ summary: 'Definir a subscrição à mão (oferecer plano, prolongar teste)' })
  @ApiZodBody(adminSetSubscriptionSchema)
  setSubscription(
    @CurrentStaff() admin: StaffAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(adminSetSubscriptionSchema)) body: AdminSetSubscriptionInput,
  ) {
    return this.admin.setSubscription(admin, id, body);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  @ApiZodBody(adminSuspendSchema)
  suspend(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(adminSuspendSchema)) body: AdminSuspendInput) {
    return this.admin.suspend(admin, id, body);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reactivate(admin, id);
  }

  @Get('billing/invoices')
  invoices(@Query(new ZodPipe(adminInvoicesQuerySchema)) q: AdminInvoicesQuery) {
    return this.admin.listInvoices(q);
  }

  @Get('billing/invoices/:id/pdf')
  @Header('Cache-Control', 'private, no-store')
  async invoicePdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, pdf } = await this.admin.invoicePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(pdf);
  }

  @Post('billing/invoices/:id/mark-paid')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registar um pagamento recebido por transferência ou outro meio' })
  @ApiZodBody(adminMarkPaidSchema)
  markPaid(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(adminMarkPaidSchema)) body: AdminMarkPaidInput) {
    return this.admin.markPaid(admin, id, body);
  }

  @Post('billing/invoices/:id/void')
  @HttpCode(200)
  @ApiZodBody(adminVoidInvoiceSchema)
  voidInvoice(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(adminVoidInvoiceSchema)) body: { reason: string }) {
    return this.admin.voidInvoice(admin, id, body.reason);
  }

  @Get('plans')
  plans() {
    return this.admin.listPlans();
  }

  @Put('plans/:id')
  @ApiZodBody(adminUpdatePlanSchema)
  updatePlan(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(adminUpdatePlanSchema)) body: AdminUpdatePlanInput) {
    return this.admin.updatePlan(admin, id, body);
  }
}

@Module({
  imports: [SubscriptionsModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
