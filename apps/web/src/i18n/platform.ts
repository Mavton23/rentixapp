import type { BillingCycle, SubscriptionInvoiceStatus, SubscriptionStatus } from '@rentix/shared';

export const subscriptionStatusLabel: Record<SubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativo',
  PAST_DUE: 'Pagamento em atraso',
  CANCELED: 'Cancelado',
};

export const cycleLabel: Record<BillingCycle, string> = { MONTHLY: 'Mensal', ANNUAL: 'Anual' };
export const cycleUnit: Record<BillingCycle, string> = { MONTHLY: '/mês', ANNUAL: '/ano' };

export const platformInvoiceStatusLabel: Record<SubscriptionInvoiceStatus, string> = {
  OPEN: 'Por pagar',
  PAID: 'Paga',
  VOID: 'Anulada',
};

export const platformInvoiceKindLabel = { CHANGE: 'Mudança de plano', RENEWAL: 'Renovação' } as const;

/** Ações registadas na auditoria, para a administração ler o histórico de uma organização. */
export const auditActionLabel: Record<string, string> = {
  'auth.registered': 'Conta criada',
  'auth.login': 'Entrada',
  'organization.updated': 'Definições alteradas',
  'member.added': 'Membro adicionado',
  'member.invited': 'Convite enviado',
  'member.invite_accepted': 'Convite aceite',
  'member.removed': 'Membro removido',
  'subscription.invoice_created': 'Fatura do plano criada',
  'subscription.invoice_paid': 'Fatura do plano paga',
  'subscription.change_scheduled': 'Mudança de plano agendada',
  'subscription.downgraded': 'Passou para o Grátis',
  'subscription.past_due': 'Renovação em atraso',
  'subscription.renewal_issued': 'Renovação emitida',
  'subscription.payment_initiated': 'Pagamento do plano iniciado',
  'platform.subscription_set': 'Subscrição alterada pela administração',
  'platform.organization_suspended': 'Organização suspensa',
  'platform.organization_reactivated': 'Organização reativada',
  'platform.invoice_marked_paid': 'Pagamento registado pela administração',
  'platform.invoice_voided': 'Fatura anulada pela administração',
  'payment.recorded': 'Pagamento de renda registado',
  'payment.mobile_confirmed': 'Pagamento móvel confirmado',
  'lease.created': 'Contrato criado',
};
