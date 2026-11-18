/**
 * Plataforma Rentix: subscrições, faturação às organizações, administração e convites de equipa.
 */
import { z } from 'zod';
import { MEMBER_ROLES } from './enums';
import {
  emailSchema,
  isoDateSchema,
  MOBILE_METHODS,
  moneySchema,
  paginationSchema,
  passwordSchema,
  phoneSchema,
} from './schemas';

export const BILLING_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_INVOICE_STATUSES = ['OPEN', 'PAID', 'VOID'] as const;
export type SubscriptionInvoiceStatus = (typeof SUBSCRIPTION_INVOICE_STATUSES)[number];

export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Código do plano gratuito, para onde as organizações voltam quando não pagam. */
export const FREE_PLAN_CODE = 'FREE';

const planCode = z.string().trim().min(1).max(40);
const reason = (max = 500) => z.string().trim().min(3, 'Indique o motivo').max(max);

// ---------- Proprietário ----------

export const checkoutSchema = z.object({
  planCode,
  billingCycle: z.enum(BILLING_CYCLES),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const quoteQuerySchema = checkoutSchema;

export const paySubscriptionSchema = z.object({
  method: z.enum(MOBILE_METHODS),
  phone: phoneSchema,
});
export type PaySubscriptionInput = z.infer<typeof paySubscriptionSchema>;

// ---------- Convites de equipa ----------

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(MEMBER_ROLES).exclude(['OWNER']),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptMemberInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
  /** Só para quem ainda não tem conta. */
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
});
export type AcceptMemberInviteInput = z.infer<typeof acceptMemberInviteSchema>;

// ---------- Administração ----------

export const adminOrganizationsQuerySchema = paginationSchema.extend({
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES).optional(),
  planCode: planCode.optional(),
});
export type AdminOrganizationsQuery = z.infer<typeof adminOrganizationsQuerySchema>;

/** Definir a subscrição à mão (oferecer um plano, prolongar um período de teste...). */
export const adminSetSubscriptionSchema = z
  .object({
    planCode,
    billingCycle: z.enum(BILLING_CYCLES),
    status: z.enum(['TRIALING', 'ACTIVE']),
    /** Fim do período (data, inclusive). Obrigatório para planos pagos e testes. */
    periodEnd: isoDateSchema.nullish(),
    reason: reason(),
  });
export type AdminSetSubscriptionInput = z.infer<typeof adminSetSubscriptionSchema>;

export const adminSuspendSchema = z.object({ reason: reason() });
export type AdminSuspendInput = z.infer<typeof adminSuspendSchema>;

export const adminInvoicesQuerySchema = paginationSchema.extend({
  status: z.enum(SUBSCRIPTION_INVOICE_STATUSES).optional(),
  organizationId: z.uuid().optional(),
});
export type AdminInvoicesQuery = z.infer<typeof adminInvoicesQuerySchema>;

export const adminMarkPaidSchema = z.object({
  method: z.enum(['BANK_TRANSFER', 'CASH', 'MPESA', 'EMOLA', 'OTHER']),
  reference: z.string().trim().min(2, 'Indique a referência do pagamento').max(120),
  paidOn: isoDateSchema,
});
export type AdminMarkPaidInput = z.infer<typeof adminMarkPaidSchema>;

export const adminVoidInvoiceSchema = z.object({ reason: reason() });

const limit = z.number().int().min(1).max(100_000).nullable();
export const adminUpdatePlanSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable(),
  monthlyPrice: moneySchema,
  annualPrice: moneySchema,
  maxUnits: limit,
  maxTenants: limit,
  maxMembers: limit,
  maxStorageMb: z.number().int().min(10).max(10_000_000).nullable().optional(),
  isActive: z.boolean(),
});
export type AdminUpdatePlanInput = z.infer<typeof adminUpdatePlanSchema>;
