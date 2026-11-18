import type { BillingCycle } from '@rentix/shared';

/**
 * Regras das subscrições, sem base de dados (fáceis de testar).
 *
 * - Teste gratuito: 30 dias num plano pago; no fim, se não pagar, passa para o Grátis.
 * - Subir de plano (ou passar de mensal para anual): imediato, com crédito pelo tempo não usado.
 * - Descer de plano: fica agendado para o fim do período já pago.
 * - Renovação: fatura emitida 7 dias antes do fim; depois do fim há 7 dias de tolerância
 *   (PAST_DUE, mantém o plano) e só então passa para o Grátis. Os dados nunca são apagados.
 */

export const TRIAL_DAYS = 30;
export const RENEWAL_NOTICE_DAYS = 7;
export const PAST_DUE_GRACE_DAYS = 7;
/** Prazo para pagar uma fatura de mudança de plano antes de ser anulada. */
export const CHANGE_INVOICE_DAYS = 3;

const DAY_MS = 86_400_000;

export interface PlanPrices {
  code: string;
  monthlyPrice: number;
  annualPrice: number;
}

export function priceFor(plan: PlanPrices, cycle: BillingCycle): number {
  return cycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
}

export function isFreePlan(plan: PlanPrices): boolean {
  return plan.monthlyPrice === 0 && plan.annualPrice === 0;
}

export function cycleMonths(cycle: BillingCycle): number {
  return cycle === 'ANNUAL' ? 12 : 1;
}

/** Soma meses em UTC; 31 de janeiro + 1 mês = 28/29 de fevereiro (nunca salta para março). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function addCycle(date: Date, cycle: BillingCycle): Date {
  return addMonths(date, cycleMonths(cycle));
}

export function addDaysMs(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface SubscriptionState {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  plan: PlanPrices;
  billingCycle: BillingCycle;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  periodValue: number;
}

/** Período pago e ainda a decorrer (não conta testes nem o Grátis). */
export function isPaidActive(sub: SubscriptionState, now: Date): boolean {
  return (
    sub.status === 'ACTIVE' &&
    sub.periodValue > 0 &&
    !!sub.currentPeriodStart &&
    !!sub.currentPeriodEnd &&
    sub.currentPeriodEnd > now
  );
}

/** Crédito pelo tempo não usado do período pago atual, arredondado para baixo ao metical. */
export function unusedCredit(sub: SubscriptionState, now: Date): number {
  if (!isPaidActive(sub, now)) return 0;
  const total = sub.currentPeriodEnd!.getTime() - sub.currentPeriodStart!.getTime();
  const remaining = Math.max(0, sub.currentPeriodEnd!.getTime() - now.getTime());
  if (total <= 0) return 0;
  const raw = (sub.periodValue * remaining) / total;
  return Math.floor(raw / 100) * 100;
}

export type ChangeQuote =
  | { kind: 'NOOP'; reason: 'ALREADY_ON_PLAN' }
  /** Passa já para o Grátis (estava em teste ou com pagamento em atraso). */
  | { kind: 'FREE_NOW' }
  /** Fica agendado para o fim do período pago. */
  | { kind: 'SCHEDULED'; effectiveAt: Date; toFree: boolean }
  /** O crédito do período anual é maior que um mês do novo plano: escolher o ciclo anual. */
  | { kind: 'CHOOSE_LONGER_CYCLE' }
  /** Fatura a pagar agora; o novo período começa quando for paga. */
  | { kind: 'IMMEDIATE'; planAmount: number; credit: number; amount: number };

export function quoteChange(sub: SubscriptionState, target: PlanPrices, cycle: BillingCycle, now: Date): ChangeQuote {
  const paidActive = isPaidActive(sub, now);
  const samePlan = sub.plan.code === target.code;

  if (isFreePlan(target)) {
    if (paidActive) return { kind: 'SCHEDULED', effectiveAt: sub.currentPeriodEnd!, toFree: true };
    if (isFreePlan(sub.plan) && sub.status === 'ACTIVE') return { kind: 'NOOP', reason: 'ALREADY_ON_PLAN' };
    return { kind: 'FREE_NOW' };
  }

  if (sub.status === 'ACTIVE' && samePlan && sub.billingCycle === cycle && !isFreePlan(sub.plan)) {
    return { kind: 'NOOP', reason: 'ALREADY_ON_PLAN' };
  }

  const planAmount = priceFor(target, cycle);
  if (paidActive) {
    // Compara o nível dos planos pelo preço mensal de tabela (o desconto anual não conta como descida).
    const lowerTier = target.monthlyPrice < sub.plan.monthlyPrice;
    const sameTier = target.monthlyPrice === sub.plan.monthlyPrice;
    const shorter = cycleMonths(cycle) < cycleMonths(sub.billingCycle);
    // Descer de nível, ou passar de anual a mensal no mesmo nível, espera pelo fim do período já pago.
    if (lowerTier || (sameTier && shorter)) return { kind: 'SCHEDULED', effectiveAt: sub.currentPeriodEnd!, toFree: false };
    // Subir de nível é sempre imediato; mas um crédito maior que a nova fatura perdia-se.
    if (unusedCredit(sub, now) > planAmount) return { kind: 'CHOOSE_LONGER_CYCLE' };
  }
  const credit = Math.min(unusedCredit(sub, now), planAmount);
  return { kind: 'IMMEDIATE', planAmount, credit, amount: planAmount - credit };
}

export type LifecycleAction =
  | { kind: 'NONE' }
  /** Emitir a fatura de renovação do próximo período. */
  | { kind: 'ISSUE_RENEWAL'; periodStart: Date }
  /** Fim do teste, cancelamento pedido ou descida agendada para o Grátis. */
  | { kind: 'DOWNGRADE_TO_FREE'; reason: 'TRIAL_ENDED' | 'CANCELED' | 'UNPAID' }
  /** O período acabou sem a renovação paga: entra na tolerância (mantém o plano). */
  | { kind: 'PAST_DUE' };

export interface LifecycleInput extends SubscriptionState {
  cancelAtPeriodEnd: boolean;
  scheduledToFree: boolean;
  pastDueSince: Date | null;
  /** Já existe fatura de renovação (paga ou em aberto) para o período seguinte. */
  hasRenewalInvoice: boolean;
}

/** O que o cron diário deve fazer a esta subscrição agora. */
export function nextLifecycleAction(sub: LifecycleInput, now: Date): LifecycleAction {
  if (isFreePlan(sub.plan) || sub.status === 'CANCELED') return { kind: 'NONE' };
  const end = sub.currentPeriodEnd;

  if (sub.status === 'TRIALING') {
    if (!end || end <= now) return { kind: 'DOWNGRADE_TO_FREE', reason: 'TRIAL_ENDED' };
    return { kind: 'NONE' };
  }

  if (sub.status === 'PAST_DUE') {
    const since = sub.pastDueSince ?? end ?? now;
    if (addDaysMs(since, PAST_DUE_GRACE_DAYS) <= now) return { kind: 'DOWNGRADE_TO_FREE', reason: 'UNPAID' };
    return { kind: 'NONE' };
  }

  // ACTIVE num plano pago
  if (!end) return { kind: 'NONE' };
  const leaving = sub.cancelAtPeriodEnd || sub.scheduledToFree;
  if (end <= now) {
    if (leaving) return { kind: 'DOWNGRADE_TO_FREE', reason: 'CANCELED' };
    return { kind: 'PAST_DUE' };
  }
  if (!leaving && !sub.hasRenewalInvoice && addDaysMs(now, RENEWAL_NOTICE_DAYS) >= end) {
    return { kind: 'ISSUE_RENEWAL', periodStart: end };
  }
  return { kind: 'NONE' };
}
