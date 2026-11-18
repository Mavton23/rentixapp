import { pickLocale, translator } from '../../common/i18n';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import {
  FREE_PLAN_CODE,
  todayIn,
  walletForPhone,
  type BillingCycle,
  type CheckoutInput,
  type MobileMethod,
  type PaySubscriptionInput,
} from '@rentix/shared';
import { CronRunner } from '../../common/ops/cron-runner.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TemplateData, TemplateKey } from '../notifications/templates';
import { PlansService } from '../plans/plans.module';
import { GatewaysService } from '../mobile-payments/gateways.service';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import type { OrgContext } from '../../common/auth-context';
import type { Plan, Prisma, Subscription, SubscriptionInvoice, SubscriptionPayment } from '../../generated/prisma/client';
import {
  addCycle,
  addDaysMs,
  CHANGE_INVOICE_DAYS,
  isFreePlan,
  nextLifecycleAction,
  PAST_DUE_GRACE_DAYS,
  quoteChange,
  RENEWAL_NOTICE_DAYS,
  type ChangeQuote,
  type SubscriptionState,
} from './subscription.logic';
import { renderSubscriptionInvoicePdf } from './subscription-invoice-pdf';

const WALLET_HINT: Record<MobileMethod, string> = {
  MPESA: 'M-Pesa precisa de um número Vodacom (84 ou 85)',
  EMOLA: 'e-Mola precisa de um número Movitel (86 ou 87)',
  MKESH: 'mKesh precisa de um número Tmcel (82 ou 83)',
};
const QUERY_GRACE_MS = 30 * 60_000;
const TZ = 'Africa/Maputo';
const iso = (d: Date) => todayIn(TZ, d);

type SubWithPlans = Subscription & { plan: Plan; scheduledPlan: Plan | null };
type DowngradeReason = TemplateData['SUBSCRIPTION_DOWNGRADED']['reason'];

/**
 * Subscrições das organizações ao Rentix e respetiva faturação.
 * As regras (créditos, períodos, renovação) estão em subscription.logic.ts; aqui fica a
 * persistência, os pagamentos para a conta da plataforma, as notificações e o cron.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronRunner,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly plans: PlansService,
    private readonly gateways: GatewaysService,
  ) {}

  // ---------- Leitura ----------

  async overview(organizationId: string) {
    const [sub, limits, usage, plans, invoices, pending] = await Promise.all([
      this.getSub(organizationId),
      this.plans.limitsFor(organizationId),
      this.plans.usage(organizationId),
      this.plans.listPublic(),
      this.prisma.subscriptionInvoice.findMany({
        where: { organizationId, status: 'OPEN' },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionPayment.findFirst({
        where: { organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const platform = this.gateways.platform();
    return {
      subscription: sub && this.presentSub(sub),
      limits,
      usage,
      plans,
      openInvoices: invoices.map((i) => this.presentInvoice(i)),
      pendingPaymentId: pending?.id ?? null,
      paymentOptions: {
        mobileMethods: platform?.methods ?? [],
        bankTransfer: this.config.get('PLATFORM_BANK_DETAILS'),
      },
      graceDays: PAST_DUE_GRACE_DAYS,
    };
  }

  async listInvoices(organizationId: string) {
    const rows = await this.prisma.subscriptionInvoice.findMany({
      where: { organizationId },
      include: { plan: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((i) => this.presentInvoice(i));
  }

  /** PDF da fatura (ou fatura-recibo, se paga). organizationId omitido = administração. */
  async invoicePdf(id: string, organizationId?: string): Promise<{ filename: string; pdf: Buffer }> {
    const inv = await this.prisma.subscriptionInvoice.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: { plan: true, organization: true },
    });
    if (!inv) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    const locale = pickLocale(inv.organization.locale);
    const t = translator(locale);
    const pdf = await renderSubscriptionInvoicePdf({
      issuer: {
        name: this.config.get('PLATFORM_COMPANY_NAME'),
        nuit: this.config.get('PLATFORM_COMPANY_NUIT') ?? null,
        address: this.config.get('PLATFORM_COMPANY_ADDRESS') ?? null,
        email: this.config.get('PLATFORM_BILLING_EMAIL') ?? null,
      },
      customer: {
        name: inv.organization.name,
        nuit: inv.organization.nuit,
        address: [inv.organization.address, inv.organization.city].filter(Boolean).join(', ') || null,
      },
      number: inv.number,
      status: inv.status,
      issueDate: iso(inv.createdAt),
      dueDate: iso(inv.dueDate),
      paidAt: inv.paidAt ? iso(inv.paidAt) : null,
      paymentMethod: inv.paymentMethod,
      paymentReference: inv.paymentReference,
      description:
        t('Subscrição Rentix, plano {plano} ({ciclo})', { plano: t(inv.plan.name), ciclo: inv.billingCycle === 'ANNUAL' ? t('anual') : t('mensal') }) +
        (inv.kind === 'RENEWAL' && inv.periodStart ? t(', a partir de {data}', { data: iso(inv.periodStart).split('-').reverse().join('/') }) : ''),
      planAmount: inv.planAmount,
      credit: inv.credit,
      amount: inv.amount,
      currency: inv.currency,
      bankDetails: inv.status === 'OPEN' ? this.config.get('PLATFORM_BANK_DETAILS') : [],
    }, locale);
    return { filename: `${inv.number.replace(/[ /]/g, '-')}.pdf`, pdf };
  }

  // ---------- Mudar de plano ----------

  async quote(organizationId: string, input: CheckoutInput) {
    const { sub, target } = await this.loadForChange(organizationId, input.planCode);
    const q = quoteChange(this.state(sub), target, input.billingCycle, new Date());
    return this.presentQuote(q, sub, target, input.billingCycle);
  }

  async checkout(ctx: OrgContext, input: CheckoutInput) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSub(tx, ctx.organizationId);
      const target = await this.findPlan(tx, input.planCode);
      const q = quoteChange(this.state(sub), target, input.billingCycle, now);

      switch (q.kind) {
        case 'NOOP':
          throw conflict('ALREADY_ON_PLAN', 'A organização já está neste plano');
        case 'CHOOSE_LONGER_CYCLE':
          throw badRequest(
            'CHOOSE_ANNUAL',
            'Ainda tem um crédito grande do plano anual. Escolha o ciclo anual para o aproveitar por inteiro.',
          );
        case 'FREE_NOW':
          await this.downgradeToFree(tx, sub, 'CHANGED', ctx.userId);
          return { mode: q.kind, invoice: null };
        case 'SCHEDULED':
          await tx.subscription.update({
            where: { id: sub.id },
            data: q.toFree
              ? { cancelAtPeriodEnd: true, scheduledPlanId: null, scheduledCycle: null }
              : { cancelAtPeriodEnd: false, scheduledPlanId: target.id, scheduledCycle: input.billingCycle },
          });
          // Uma renovação já emitida era do plano antigo: anula-se e o cron emite a nova (ou nenhuma).
          await this.voidOpen(tx, ctx.organizationId, 'RENEWAL', 'Substituída por mudança de plano');
          await this.log(tx, ctx, 'subscription.change_scheduled', sub.id, {
            to: target.code,
            cycle: input.billingCycle,
            effectiveAt: q.effectiveAt.toISOString(),
          });
          return { mode: q.kind, invoice: null };
        case 'IMMEDIATE': {
          await this.voidOpen(tx, ctx.organizationId, 'CHANGE', 'Substituída por outra escolha de plano');
          const invoice = await tx.subscriptionInvoice.create({
            data: {
              number: await this.nextNumber(tx, now),
              organizationId: ctx.organizationId,
              planId: target.id,
              billingCycle: input.billingCycle,
              kind: 'CHANGE',
              planAmount: q.planAmount,
              credit: q.credit,
              amount: q.amount,
              dueDate: addDaysMs(now, CHANGE_INVOICE_DAYS),
              createdById: ctx.userId,
            },
          });
          await this.log(tx, ctx, 'subscription.invoice_created', invoice.id, {
            number: invoice.number,
            plan: target.code,
            amount: q.amount,
            credit: q.credit,
          });
          if (invoice.amount === 0) {
            // O crédito cobre tudo: aplica-se já.
            await this.applyPaid(tx, invoice, { method: 'OTHER', reference: 'Crédito do plano anterior', paidAt: now }, ctx.userId);
          }
          return { mode: q.kind, invoice };
        }
      }
    });
    if (result.invoice?.amount === 0) await this.notifyPaid(result.invoice.id);
    // A renovação do novo plano agendado é emitida já, se o fim do período estiver próximo.
    if (result.mode === 'SCHEDULED') await this.processOne(ctx.organizationId, now);
    const invoice = result.invoice
      ? await this.prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: result.invoice.id }, include: { plan: { select: { code: true, name: true } } } })
      : null;
    return { mode: result.mode, invoice: invoice && this.presentInvoice(invoice) };
  }

  /** Desfaz uma mudança agendada ou o pedido para não renovar. */
  async keepCurrentPlan(ctx: OrgContext) {
    await this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSub(tx, ctx.organizationId);
      if (!sub.cancelAtPeriodEnd && !sub.scheduledPlanId) return;
      await tx.subscription.update({
        where: { id: sub.id },
        data: { cancelAtPeriodEnd: false, scheduledPlanId: null, scheduledCycle: null },
      });
      await this.voidOpen(tx, ctx.organizationId, 'RENEWAL', 'Mudança de plano desfeita');
      await this.log(tx, ctx, 'subscription.change_undone', sub.id, {});
    });
    // A renovação do plano atual volta a ser emitida já, se estiver dentro do prazo.
    await this.processOne(ctx.organizationId, new Date());
    return this.overview(ctx.organizationId);
  }

  // ---------- Pagamento móvel para a conta do Rentix ----------

  async pay(ctx: OrgContext, invoiceId: string, input: PaySubscriptionInput) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({ where: { id: invoiceId, organizationId: ctx.organizationId } });
    if (!invoice) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    if (invoice.status !== 'OPEN') throw conflict('INVOICE_NOT_OPEN', invoice.status === 'PAID' ? 'A fatura já está paga' : 'A fatura foi anulada');
    const platform = this.gateways.platform();
    if (!platform || !platform.methods.includes(input.method)) {
      throw badRequest('METHOD_NOT_AVAILABLE', 'Este método de pagamento não está disponível. Use a transferência bancária.');
    }
    if (walletForPhone(input.phone) !== input.method) throw badRequest('PHONE_WALLET_MISMATCH', WALLET_HINT[input.method]);

    const inProgress = await this.prisma.subscriptionPayment.findFirst({
      where: { invoiceId, status: 'PENDING', expiresAt: { gt: new Date() } },
    });
    if (inProgress) {
      throw conflict('PAYMENT_IN_PROGRESS', 'Já há um pagamento à espera de confirmação para esta fatura', { paymentId: inProgress.id });
    }
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        invoiceId,
        organizationId: ctx.organizationId,
        amount: invoice.amount,
        method: input.method,
        gateway: platform.gateway,
        providerReference: `RXS${randomBytes(6).toString('hex').toUpperCase()}`,
        payerPhone: input.phone,
        expiresAt: new Date(Date.now() + this.config.get('MOBILE_PAYMENT_TIMEOUT_SECONDS') * 1000),
        initiatedById: ctx.userId,
      },
    });
    await this.log(this.prisma, ctx, 'subscription.payment_initiated', payment.id, {
      invoice: invoice.number,
      method: input.method,
      amount: invoice.amount,
    });
    const job = this.execute(payment.id).finally(() => this.inflight.delete(job));
    this.inflight.add(job);
    return this.presentPayment(payment);
  }

  async paymentStatus(organizationId: string, paymentId: string) {
    const p = await this.prisma.subscriptionPayment.findFirst({ where: { id: paymentId, organizationId } });
    if (!p) throw notFound('Pagamento', 'PAYMENT_NOT_FOUND');
    return this.presentPayment(p);
  }

  /** Só para testes. */
  async drain(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  private async execute(paymentId: string): Promise<void> {
    try {
      const p = await this.prisma.subscriptionPayment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
      if (!p || p.status !== 'PENDING') return;
      const platform = this.gateways.platform();
      if (!platform || platform.gateway !== p.gateway) return this.failPayment(paymentId, 'Fornecedor de pagamento indisponível');
      const result = await platform.provider.collect({
        msisdn: p.payerPhone,
        amount: p.amount,
        reference: p.invoice.number,
        thirdPartyReference: p.providerReference,
      });
      if (result.status === 'SUCCESS') await this.confirmPayment(paymentId, result.transactionId);
      else if (result.status === 'FAILED') await this.failPayment(paymentId, result.message);
    } catch (err) {
      this.logger.error({ err, paymentId }, 'Erro ao processar pagamento de subscrição');
    }
  }

  private async confirmPayment(paymentId: string, transactionId?: string): Promise<void> {
    let paidInvoiceId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });
      await this.lockSub(tx, p.organizationId);
      const fresh = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { invoice: true } });
      if (fresh.status !== 'PENDING') return;
      await tx.subscriptionPayment.update({
        where: { id: paymentId },
        data: { status: 'CONFIRMED', providerTransactionId: transactionId, expiresAt: null },
      });
      if (fresh.invoice.status !== 'OPEN') {
        // Dinheiro recebido para uma fatura já paga ou anulada: fica para a administração resolver.
        await tx.subscriptionPayment.update({
          where: { id: paymentId },
          data: { failureReason: 'Requer revisão: valor recebido para uma fatura que já não estava em aberto' },
        });
        await this.audit.log(
          { organizationId: p.organizationId, actorType: 'SYSTEM', action: 'subscription.payment_needs_review', entityType: 'subscription_payment', entityId: paymentId },
          tx,
        );
        return;
      }
      await this.applyPaid(tx, fresh.invoice, { method: fresh.method, reference: transactionId ?? fresh.providerReference, paidAt: new Date() }, null);
      paidInvoiceId = fresh.invoice.id;
    });
    if (paidInvoiceId) await this.notifyPaid(paidInvoiceId);
  }

  private async failPayment(paymentId: string, reason: string): Promise<void> {
    await this.prisma.subscriptionPayment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 500), expiresAt: null },
    });
  }

  @Cron('*/1 * * * *', { name: 'subscription-payments-sweep' })
  async scheduledSweep(): Promise<void> {
    await this.cron.run('subscription-payments-sweep', () => this.sweepPayments());
  }

  async sweepPayments(now = new Date()): Promise<void> {
    const stale = await this.prisma.subscriptionPayment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      take: 50,
    });
    const platform = this.gateways.platform();
    for (const p of stale) {
      try {
        const provider = platform?.gateway === p.gateway ? platform.provider : null;
        const r = provider?.query ? await provider.query(p.providerReference) : { status: 'UNKNOWN' as const };
        if (r.status === 'SUCCESS') await this.confirmPayment(p.id, r.transactionId);
        else if (r.status === 'FAILED') await this.failPayment(p.id, r.message);
        else if (now.getTime() - p.expiresAt!.getTime() > QUERY_GRACE_MS) {
          await this.failPayment(p.id, `Não foi possível confirmar o pagamento. Se o valor foi debitado, contacte o Rentix com a referência ${p.providerReference}.`);
        }
      } catch (err) {
        this.logger.warn({ err, paymentId: p.id }, 'Falha ao verificar pagamento de subscrição');
      }
    }
  }

  // ---------- Aplicar faturas pagas (também usado pela administração) ----------

  /**
   * Marca a fatura como paga e atualiza a subscrição. Tem de correr com a subscrição bloqueada.
   * Mudança de plano: o período começa agora. Renovação: continua a partir do fim do anterior.
   */
  async applyPaid(
    tx: Tx,
    invoice: SubscriptionInvoice,
    payment: { method: Prisma.SubscriptionInvoiceUpdateInput['paymentMethod']; reference: string; paidAt: Date },
    actorId: string | null,
  ): Promise<void> {
    const updated = await tx.subscriptionInvoice.updateMany({
      where: { id: invoice.id, status: 'OPEN' },
      data: { status: 'PAID', paidAt: payment.paidAt, paymentMethod: payment.method as never, paymentReference: payment.reference },
    });
    if (!updated.count) throw conflict('INVOICE_NOT_OPEN', 'A fatura já não está em aberto');

    const now = new Date();
    let start = invoice.kind === 'RENEWAL' && invoice.periodStart ? invoice.periodStart : now;
    // Renovação paga tão tarde que o período já passou inteiro: começa agora.
    if (addCycle(start, invoice.billingCycle as BillingCycle) <= now) start = now;
    await tx.subscription.update({
      where: { organizationId: invoice.organizationId },
      data: {
        planId: invoice.planId,
        billingCycle: invoice.billingCycle,
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: addCycle(start, invoice.billingCycle as BillingCycle),
        periodValue: invoice.planAmount,
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
        scheduledCycle: null,
        pastDueSince: null,
      },
    });
    // Outras faturas em aberto ficaram sem sentido (ex.: renovação do plano antigo).
    await tx.subscriptionInvoice.updateMany({
      where: { organizationId: invoice.organizationId, status: 'OPEN', id: { not: invoice.id } },
      data: { status: 'VOID', voidedAt: now, voidReason: `Substituída pela fatura ${invoice.number}` },
    });
    await this.audit.log(
      {
        organizationId: invoice.organizationId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        action: 'subscription.invoice_paid',
        entityType: 'subscription_invoice',
        entityId: invoice.id,
        metadata: { number: invoice.number, method: payment.method as string, reference: payment.reference },
      },
      tx,
    );
  }

  async notifyPaid(invoiceId: string): Promise<void> {
    const inv = await this.prisma.subscriptionInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { plan: true, organization: { include: { subscription: true } } },
    });
    if (inv.amount === 0) return;
    await this.notifyOwners(inv.organizationId, 'SUBSCRIPTION_PAID', (name) => ({
      name,
      organizationName: inv.organization.name,
      number: inv.number,
      planName: inv.plan.name,
      paid: { amount: inv.amount, currency: inv.currency },
      periodEnd: iso(inv.organization.subscription!.currentPeriodEnd!),
      url: this.billingUrl(),
    }), `sub-paid:${inv.id}`, false);
  }

  // ---------- Ciclo de vida (cron diário) ----------

  @Cron('0 7 * * *', { name: 'subscriptions-lifecycle', timeZone: TZ })
  async scheduledLifecycle(): Promise<void> {
    await this.cron.run('subscriptions-lifecycle', async () => ({ changed: await this.runLifecycle() }));
  }

  /** Processa todas as subscrições pagas ou em teste. Idempotente: pode correr várias vezes. */
  async runLifecycle(now = new Date()): Promise<number> {
    // Faturas de mudança de plano não pagas no prazo (sem pagamento em curso).
    const expired = await this.prisma.subscriptionInvoice.findMany({
      where: { kind: 'CHANGE', status: 'OPEN', dueDate: { lt: now }, payments: { none: { status: 'PENDING' } } },
      select: { id: true },
    });
    if (expired.length) {
      await this.prisma.subscriptionInvoice.updateMany({
        where: { id: { in: expired.map((e) => e.id) }, status: 'OPEN' },
        data: { status: 'VOID', voidedAt: now, voidReason: 'Prazo de pagamento terminado' },
      });
    }

    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, plan: { code: { not: FREE_PLAN_CODE } } },
      select: { organizationId: true },
    });
    let changed = 0;
    for (const s of subs) {
      try {
        if (await this.processOne(s.organizationId, now)) changed++;
      } catch (err) {
        this.logger.error({ err, organizationId: s.organizationId }, 'Erro no ciclo de vida da subscrição');
      }
    }
    return changed;
  }

  /** Aplica a próxima ação a uma organização. Devolve true se mudou alguma coisa. */
  async processOne(organizationId: string, now: Date): Promise<boolean> {
    const after: (() => Promise<void>)[] = [];
    const changed = await this.prisma.$transaction(async (tx) => {
      const sub = await this.lockSub(tx, organizationId);
      const hasRenewal =
        !!sub.currentPeriodEnd &&
        (await tx.subscriptionInvoice.count({
          where: { organizationId, kind: 'RENEWAL', periodStart: sub.currentPeriodEnd, status: { not: 'VOID' } },
        })) > 0;
      const action = nextLifecycleAction(
        {
          ...this.state(sub),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          scheduledToFree: !!sub.scheduledPlan && isFreePlan(sub.scheduledPlan),
          pastDueSince: sub.pastDueSince,
          hasRenewalInvoice: hasRenewal,
        },
        now,
      );

      // Aviso de fim do teste (7 dias e 1 dia antes), independente da ação.
      if (sub.status === 'TRIALING' && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
        const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000);
        const mark = daysLeft <= 1 ? 1 : daysLeft <= RENEWAL_NOTICE_DAYS ? 7 : null;
        if (mark) {
          after.push(() =>
            this.notifyOwners(organizationId, 'TRIAL_ENDING', (name, org) => ({
              name,
              organizationName: org,
              planName: sub.plan.name,
              endDate: iso(sub.currentPeriodEnd!),
              url: this.billingUrl(),
            }), `trial-ending:${sub.id}:${mark}`, false),
          );
        }
      }

      switch (action.kind) {
        case 'NONE':
          return false;
        case 'ISSUE_RENEWAL': {
          const plan = sub.scheduledPlan ?? sub.plan;
          const cycle = (sub.scheduledCycle ?? sub.billingCycle) as BillingCycle;
          const amount = cycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
          const invoice = await tx.subscriptionInvoice.create({
            data: {
              number: await this.nextNumber(tx, now),
              organizationId,
              planId: plan.id,
              billingCycle: cycle,
              kind: 'RENEWAL',
              planAmount: amount,
              amount,
              periodStart: action.periodStart,
              dueDate: action.periodStart,
            },
          });
          await this.audit.log(
            { organizationId, actorType: 'SYSTEM', action: 'subscription.renewal_issued', entityType: 'subscription_invoice', entityId: invoice.id, metadata: { number: invoice.number, amount } },
            tx,
          );
          after.push(() =>
            this.notifyOwners(organizationId, 'SUBSCRIPTION_INVOICE', (name, org) => ({
              name,
              organizationName: org,
              number: invoice.number,
              planName: plan.name,
              due: { amount, currency: invoice.currency },
              dueDate: iso(action.periodStart),
              renewal: true,
              url: this.billingUrl(),
            }), `sub-invoice:${invoice.id}`, false),
          );
          return true;
        }
        case 'PAST_DUE': {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', pastDueSince: now } });
          await this.audit.log({ organizationId, actorType: 'SYSTEM', action: 'subscription.past_due', entityType: 'subscription', entityId: sub.id }, tx);
          after.push(() =>
            this.notifyOwners(organizationId, 'SUBSCRIPTION_PAST_DUE', (name, org) => ({
              name,
              organizationName: org,
              planName: sub.plan.name,
              downgradeDate: iso(addDaysMs(now, PAST_DUE_GRACE_DAYS)),
              url: this.billingUrl(),
            }), `sub-past-due:${sub.id}:${iso(now)}`, true),
          );
          return true;
        }
        case 'DOWNGRADE_TO_FREE': {
          await this.downgradeToFree(tx, sub, action.reason, null);
          after.push(() =>
            this.notifyOwners(organizationId, 'SUBSCRIPTION_DOWNGRADED', (name, org) => ({
              name,
              organizationName: org,
              fromPlan: sub.plan.name,
              reason: action.reason,
              url: this.billingUrl(),
            }), `sub-downgraded:${sub.id}:${iso(now)}`, true),
          );
          return true;
        }
      }
    });
    for (const fn of after) await fn();
    return changed;
  }

  // ---------- Auxiliares ----------

  /** Passa para o Grátis e anula faturas em aberto. Tem de correr com a subscrição bloqueada. */
  async downgradeToFree(tx: Tx, sub: Subscription, reason: DowngradeReason, actorId: string | null): Promise<void> {
    const free = await this.findPlan(tx, FREE_PLAN_CODE);
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        planId: free.id,
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        periodValue: 0,
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
        scheduledCycle: null,
        pastDueSince: null,
      },
    });
    await this.voidOpen(tx, sub.organizationId, undefined, 'A organização passou para o plano Grátis');
    await this.audit.log(
      {
        organizationId: sub.organizationId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId ?? undefined,
        action: 'subscription.downgraded',
        entityType: 'subscription',
        entityId: sub.id,
        metadata: { reason },
      },
      tx,
    );
  }

  /** Bloqueia a linha da subscrição até ao fim da transação (pagamentos e cron em paralelo). */
  async lockSub(tx: Tx, organizationId: string): Promise<SubWithPlans> {
    await tx.$queryRaw`SELECT id FROM subscriptions WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
    const sub = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true, scheduledPlan: true } });
    if (sub) return sub;
    // Organização antiga sem subscrição: cria-se a do Grátis.
    await this.plans.startSubscription(tx, organizationId, { trial: false });
    return tx.subscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true, scheduledPlan: true } });
  }

  async nextNumber(tx: Tx, now: Date): Promise<string> {
    const year = Number(iso(now).slice(0, 4));
    const key = `RTX:${year}`;
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO platform_counters (key, value) VALUES (${key}, 1)
      ON CONFLICT (key) DO UPDATE SET value = platform_counters.value + 1
      RETURNING value`;
    return `RTX ${year}/${String(rows[0]!.value).padStart(6, '0')}`;
  }

  private async voidOpen(tx: Tx, organizationId: string, kind: 'CHANGE' | 'RENEWAL' | undefined, reason: string) {
    await tx.subscriptionInvoice.updateMany({
      where: { organizationId, status: 'OPEN', ...(kind ? { kind } : {}) },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
    });
  }

  private async getSub(organizationId: string): Promise<SubWithPlans | null> {
    return this.prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true, scheduledPlan: true } });
  }

  private async loadForChange(organizationId: string, planCode: string) {
    let sub = await this.getSub(organizationId);
    if (!sub) sub = await this.prisma.$transaction((tx) => this.lockSub(tx, organizationId));
    const target = await this.findPlan(this.prisma, planCode);
    return { sub, target };
  }

  private async findPlan(db: Tx | PrismaService, code: string): Promise<Plan> {
    const plan = await db.plan.findUnique({ where: { code } });
    if (!plan || (!plan.isActive && code !== FREE_PLAN_CODE)) throw notFound('Plano', 'PLAN_NOT_FOUND');
    return plan;
  }

  private state(sub: SubWithPlans): SubscriptionState {
    return {
      status: sub.status,
      plan: sub.plan,
      billingCycle: sub.billingCycle as BillingCycle,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      periodValue: sub.periodValue,
    };
  }

  private billingUrl(): string {
    return `${this.config.get('WEB_URL')}/definicoes/plano`;
  }

  private async notifyOwners<K extends TemplateKey>(
    organizationId: string,
    template: K,
    data: (name: string, organizationName: string) => TemplateData[K],
    dedupeKey: string,
    sms: boolean,
  ): Promise<void> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { memberships: { where: { role: 'OWNER' }, include: { user: true } } },
    });
    for (const m of org.memberships) {
      const base = { organizationId, userId: m.user.id, template, data: data(m.user.name, org.name), dedupeKey: `${dedupeKey}:${m.user.id}` };
      await this.notifications.enqueue({ ...base, channel: 'EMAIL', recipient: m.user.email });
      if (sms && m.user.phone) await this.notifications.enqueue({ ...base, channel: 'SMS', recipient: m.user.phone });
    }
  }

  private async log(db: Tx | PrismaService, ctx: OrgContext, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
    await this.audit.log(
      {
        organizationId: ctx.organizationId,
        actorType: 'USER',
        actorId: ctx.userId,
        action,
        entityType: action.includes('payment') ? 'subscription_payment' : action.includes('invoice') ? 'subscription_invoice' : 'subscription',
        entityId,
        metadata,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      db as Tx,
    );
  }

  private presentQuote(q: ChangeQuote, sub: SubWithPlans, target: Plan, cycle: BillingCycle) {
    return {
      ...q,
      ...(q.kind === 'SCHEDULED' ? { effectiveAt: q.effectiveAt.toISOString() } : {}),
      from: { code: sub.plan.code, name: sub.plan.name, billingCycle: sub.billingCycle },
      to: { code: target.code, name: target.name, billingCycle: cycle },
    };
  }

  presentSub(sub: SubWithPlans) {
    return {
      status: sub.status,
      billingCycle: sub.billingCycle,
      plan: { code: sub.plan.code, name: sub.plan.name, monthlyPrice: sub.plan.monthlyPrice, annualPrice: sub.plan.annualPrice },
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      periodValue: sub.periodValue,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      scheduledPlan: sub.scheduledPlan ? { code: sub.scheduledPlan.code, name: sub.scheduledPlan.name } : null,
      scheduledCycle: sub.scheduledCycle,
      pastDueSince: sub.pastDueSince?.toISOString() ?? null,
      downgradeAt: sub.pastDueSince ? addDaysMs(sub.pastDueSince, PAST_DUE_GRACE_DAYS).toISOString() : null,
    };
  }

  presentInvoice(i: SubscriptionInvoice & { plan: { code: string; name: string } }) {
    return {
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: i.status,
      plan: i.plan,
      billingCycle: i.billingCycle,
      planAmount: i.planAmount,
      credit: i.credit,
      amount: i.amount,
      currency: i.currency,
      periodStart: i.periodStart?.toISOString() ?? null,
      dueDate: i.dueDate.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
      paymentMethod: i.paymentMethod,
      paymentReference: i.paymentReference,
      voidReason: i.voidReason,
      createdAt: i.createdAt.toISOString(),
    };
  }

  private async presentPayment(p: SubscriptionPayment) {
    const inv = await this.prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: p.invoiceId }, select: { number: true, currency: true } });
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      status: p.status,
      method: p.method,
      amount: p.amount,
      currency: inv.currency,
      /** Quando confirmado, a própria fatura passa a fatura-recibo. */
      receiptNumber: p.status === 'CONFIRMED' ? inv.number : null,
      payerPhone: p.payerPhone,
      failureReason: p.failureReason,
      expiresAt: p.expiresAt?.toISOString() ?? null,
    };
  }
}
