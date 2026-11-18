import {
  addMonths,
  nextLifecycleAction,
  quoteChange,
  unusedCredit,
  type LifecycleInput,
  type PlanPrices,
  type SubscriptionState,
} from './subscription.logic';

const FREE: PlanPrices = { code: 'FREE', monthlyPrice: 0, annualPrice: 0 };
const ESS: PlanPrices = { code: 'ESSENCIAL', monthlyPrice: 99_000, annualPrice: 990_000 };
const PRO: PlanPrices = { code: 'PROFISSIONAL', monthlyPrice: 349_000, annualPrice: 3_490_000 };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const paid = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  status: 'ACTIVE',
  plan: ESS,
  billingCycle: 'MONTHLY',
  currentPeriodStart: d('2026-11-01'),
  currentPeriodEnd: d('2026-12-01'),
  periodValue: 99_000,
  ...over,
});

describe('addMonths', () => {
  it('fixa o fim do mês em vez de saltar para o seguinte', () => {
    expect(addMonths(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(d('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(addMonths(d('2026-11-15'), 12).toISOString().slice(0, 10)).toBe('2027-11-15');
  });
});

describe('unusedCredit', () => {
  it('é proporcional ao tempo que falta, arredondado ao metical', () => {
    // 30 dias de período, faltam 15
    expect(unusedCredit(paid(), d('2026-11-16'))).toBe(49_500);
  });
  it('é zero em teste, no Grátis ou com o período acabado', () => {
    expect(unusedCredit(paid({ status: 'TRIALING' }), d('2026-11-16'))).toBe(0);
    expect(unusedCredit(paid({ periodValue: 0 }), d('2026-11-16'))).toBe(0);
    expect(unusedCredit(paid(), d('2026-12-02'))).toBe(0);
  });
});

describe('quoteChange', () => {
  const now = d('2026-11-16');

  it('subir de plano é imediato e desconta o tempo não usado', () => {
    expect(quoteChange(paid(), PRO, 'MONTHLY', now)).toEqual({ kind: 'IMMEDIATE', planAmount: 349_000, credit: 49_500, amount: 299_500 });
  });

  it('passar de mensal para anual no mesmo plano é imediato', () => {
    const q = quoteChange(paid(), ESS, 'ANNUAL', now);
    expect(q).toMatchObject({ kind: 'IMMEDIATE', planAmount: 990_000, credit: 49_500 });
  });

  it('descer de plano ou de anual para mensal fica para o fim do período', () => {
    expect(quoteChange(paid({ plan: PRO, periodValue: 349_000 }), ESS, 'MONTHLY', now)).toEqual({
      kind: 'SCHEDULED',
      effectiveAt: d('2026-12-01'),
      toFree: false,
    });
    const annual = paid({ billingCycle: 'ANNUAL', periodValue: 990_000, currentPeriodEnd: d('2027-11-01') });
    expect(quoteChange(annual, ESS, 'MONTHLY', now)).toMatchObject({ kind: 'SCHEDULED', toFree: false });
  });

  it('subir de nível a partir de um anual: imediato, ou pede o anual se o crédito sobrar', () => {
    const annual = paid({ billingCycle: 'ANNUAL', periodValue: 990_000, currentPeriodEnd: d('2027-11-01') });
    expect(quoteChange(annual, PRO, 'MONTHLY', now)).toEqual({ kind: 'CHOOSE_LONGER_CYCLE' });
    expect(quoteChange(annual, PRO, 'ANNUAL', now)).toMatchObject({ kind: 'IMMEDIATE', planAmount: 3_490_000 });
    const almostOver = paid({ billingCycle: 'ANNUAL', periodValue: 990_000, currentPeriodStart: d('2025-11-20'), currentPeriodEnd: d('2026-11-20') });
    expect(quoteChange(almostOver, PRO, 'MONTHLY', now)).toMatchObject({ kind: 'IMMEDIATE', planAmount: 349_000 });
  });

  it('passar para o Grátis com período pago fica agendado; em teste é imediato', () => {
    expect(quoteChange(paid(), FREE, 'MONTHLY', now)).toMatchObject({ kind: 'SCHEDULED', toFree: true });
    expect(quoteChange(paid({ status: 'TRIALING', plan: PRO, periodValue: 0 }), FREE, 'MONTHLY', now)).toEqual({ kind: 'FREE_NOW' });
    expect(quoteChange(paid({ plan: FREE, periodValue: 0, currentPeriodEnd: null, currentPeriodStart: null }), FREE, 'MONTHLY', now)).toEqual({
      kind: 'NOOP',
      reason: 'ALREADY_ON_PLAN',
    });
  });

  it('o mesmo plano e ciclo não faz nada; em teste ou em atraso cobra o preço inteiro', () => {
    expect(quoteChange(paid(), ESS, 'MONTHLY', now)).toEqual({ kind: 'NOOP', reason: 'ALREADY_ON_PLAN' });
    expect(quoteChange(paid({ status: 'TRIALING', plan: PRO, periodValue: 0 }), PRO, 'MONTHLY', now)).toEqual({
      kind: 'IMMEDIATE',
      planAmount: 349_000,
      credit: 0,
      amount: 349_000,
    });
    expect(quoteChange(paid({ status: 'PAST_DUE' }), ESS, 'MONTHLY', now)).toMatchObject({ kind: 'IMMEDIATE', credit: 0, amount: 99_000 });
  });

  it('do Grátis para um plano pago é imediato e sem crédito', () => {
    const free = paid({ plan: FREE, periodValue: 0, currentPeriodStart: null, currentPeriodEnd: null });
    expect(quoteChange(free, ESS, 'ANNUAL', now)).toEqual({ kind: 'IMMEDIATE', planAmount: 990_000, credit: 0, amount: 990_000 });
  });
});

describe('nextLifecycleAction', () => {
  const base = (over: Partial<LifecycleInput> = {}): LifecycleInput => ({
    ...paid(),
    cancelAtPeriodEnd: false,
    scheduledToFree: false,
    pastDueSince: null,
    hasRenewalInvoice: false,
    ...over,
  });

  it('emite a renovação 7 dias antes do fim, uma só vez', () => {
    expect(nextLifecycleAction(base(), d('2026-11-20'))).toEqual({ kind: 'NONE' });
    expect(nextLifecycleAction(base(), d('2026-11-24'))).toEqual({ kind: 'ISSUE_RENEWAL', periodStart: d('2026-12-01') });
    expect(nextLifecycleAction(base({ hasRenewalInvoice: true }), d('2026-11-24'))).toEqual({ kind: 'NONE' });
  });

  it('sem pagamento: atraso no fim do período e Grátis 7 dias depois', () => {
    expect(nextLifecycleAction(base({ hasRenewalInvoice: true }), d('2026-12-01'))).toEqual({ kind: 'PAST_DUE' });
    const late = base({ status: 'PAST_DUE', pastDueSince: d('2026-12-01'), hasRenewalInvoice: true });
    expect(nextLifecycleAction(late, d('2026-12-07'))).toEqual({ kind: 'NONE' });
    expect(nextLifecycleAction(late, d('2026-12-08'))).toEqual({ kind: 'DOWNGRADE_TO_FREE', reason: 'UNPAID' });
  });

  it('cancelamento e fim do teste passam para o Grátis sem fatura de renovação', () => {
    expect(nextLifecycleAction(base({ cancelAtPeriodEnd: true }), d('2026-11-28'))).toEqual({ kind: 'NONE' });
    expect(nextLifecycleAction(base({ cancelAtPeriodEnd: true }), d('2026-12-01'))).toEqual({ kind: 'DOWNGRADE_TO_FREE', reason: 'CANCELED' });
    const trial = base({ status: 'TRIALING', plan: PRO, periodValue: 0 });
    expect(nextLifecycleAction(trial, d('2026-11-30'))).toEqual({ kind: 'NONE' });
    expect(nextLifecycleAction(trial, d('2026-12-01'))).toEqual({ kind: 'DOWNGRADE_TO_FREE', reason: 'TRIAL_ENDED' });
  });

  it('o Grátis não tem ciclo de vida', () => {
    expect(nextLifecycleAction(base({ plan: FREE, currentPeriodEnd: null }), d('2030-01-01'))).toEqual({ kind: 'NONE' });
  });
});
