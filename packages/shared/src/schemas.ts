import { LOCALES } from './i18n';
/**
 * Schemas Zod de entrada da API. São usados:
 *  - na API, para validar o corpo/query de cada pedido (ZodValidationPipe);
 *  - no frontend, nos formulários (react-hook-form + zodResolver).
 * Valores monetários viajam SEMPRE em centavos (inteiros).
 */
import { z } from 'zod';
import {
  CURRENCIES,
  ID_DOCUMENT_TYPES,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  LEASE_STATUSES,
  MARITAL_STATUSES,
  MEMBER_ROLES,
  PAYMENT_METHODS,
  PROPERTY_TYPES,
  UNIT_STATUSES,
} from './enums';
import { MAX_MINOR_AMOUNT } from './money';
import { normalizePhone } from './phone';
import { isIsoDate, isPeriod } from './dates';

// ---------- Primitivos ----------

const trimmed = (max = 200) => z.string().trim().min(1).max(max);
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Email inválido'));

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Número de telefone inválido' });
      return z.NEVER;
    }
    return n;
  });

export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'A senha deve ter letras e números');

export const isoDateSchema = z.string().refine(isIsoDate, 'Data inválida (use AAAA-MM-DD)');
export const periodSchema = z.string().refine(isPeriod, 'Período inválido (use AAAA-MM)');
export const moneySchema = z.number().int('Valor em centavos deve ser inteiro').min(0).max(MAX_MINOR_AMOUNT);
export const positiveMoneySchema = moneySchema.refine((v) => v > 0, 'O valor deve ser maior que zero');
export const bpsSchema = z.number().int().min(0).max(10_000);
/** NUIT moçambicano: 9 dígitos. */
export const nuitSchema = z.string().trim().regex(/^\d{9}$/, 'NUIT deve ter 9 dígitos');
export const countryCodeSchema = z.string().trim().length(2).toUpperCase();
export const uuidSchema = z.uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

// ---------- Autenticação ----------

export const registerSchema = z.object({
  name: trimmed(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  organizationName: optionalText(120),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const switchOrganizationSchema = z.object({ organizationId: uuidSchema });

export const acceptTenantInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type AcceptTenantInviteInput = z.infer<typeof acceptTenantInviteSchema>;

// ---------- Organização ----------

export const updateOrganizationSchema = z
  .object({
    name: trimmed(120),
    nuit: nuitSchema.nullable(),
    email: emailSchema.nullable(),
    phone: phoneSchema.nullable(),
    address: optionalText(300).nullable(),
    city: optionalText(100).nullable(),
    province: optionalText(100).nullable(),
    defaultCurrency: z.enum(CURRENCIES),
    timezone: z
      .string()
      .min(3)
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Fuso horário inválido'),
    locale: z.enum(LOCALES),
    country: z.string().regex(/^[A-Z]{2}$/, 'País inválido'),
    defaultBillingDay: z.number().int().min(1).max(28),
    lateFeeBps: bpsSchema,
    gracePeriodDays: z.number().int().min(0).max(60),
    reminderDaysBefore: z.number().int().min(0).max(30),
  })
  .partial();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(MEMBER_ROLES).exclude(['OWNER']),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

// ---------- Imóveis e unidades ----------

export const unitInputSchema = z.object({
  label: trimmed(60),
  bedrooms: z.number().int().min(0).max(50).nullish(),
  bathrooms: z.number().int().min(0).max(50).nullish(),
  areaM2: z.number().int().min(0).max(1_000_000).nullish(),
  floor: z.string().trim().max(20).nullish(),
  rentAmount: moneySchema.nullish(),
  status: z.enum(UNIT_STATUSES).optional(),
  notes: optionalText(),
});
export type UnitInput = z.infer<typeof unitInputSchema>;

export const createPropertySchema = z.object({
  name: trimmed(120),
  type: z.enum(PROPERTY_TYPES),
  street: trimmed(200),
  neighbourhood: optionalText(120),
  city: trimmed(100),
  province: optionalText(100),
  country: countryCodeSchema.default('MZ'),
  description: optionalText(5000),
  /**
   * Unidades arrendáveis. Para uma casa ou loja basta uma; para um prédio, várias.
   * Se omitido, é criada automaticamente uma unidade "Principal".
   */
  units: z.array(unitInputSchema).max(500).optional(),
});
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema
  .omit({ units: true })
  .extend({ country: countryCodeSchema })
  .partial();
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

export const updateUnitSchema = unitInputSchema.partial();
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const propertyQuerySchema = paginationSchema.extend({
  type: z.enum(PROPERTY_TYPES).optional(),
  city: z.string().trim().max(100).optional(),
});

// ---------- Inquilinos ----------

export const createTenantSchema = z.object({
  fullName: trimmed(160),
  email: emailSchema.nullish(),
  phone: phoneSchema,
  idDocumentType: z.enum(ID_DOCUMENT_TYPES),
  idDocumentNumber: trimmed(40),
  nuit: nuitSchema.nullish(),
  birthDate: isoDateSchema.nullish(),
  maritalStatus: z.enum(MARITAL_STATUSES).nullish(),
  occupation: optionalText(120).nullable(),
  employer: optionalText(160).nullable(),
  emergencyContactName: optionalText(160).nullable(),
  emergencyContactPhone: phoneSchema.nullish(),
  notes: optionalText(5000).nullable(),
  /** Idioma do inquilino (SMS, emails, portal); vazio = idioma da organização. */
  locale: z.enum(LOCALES).nullish(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = createTenantSchema.partial();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const tenantQuerySchema = paginationSchema.extend({
  hasActiveLease: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ---------- Contratos ----------

export const createLeaseSchema = z
  .object({
    unitId: uuidSchema,
    tenantId: uuidSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullish(),
    rentAmount: positiveMoneySchema,
    currency: z.enum(CURRENCIES).optional(),
    billingDay: z.number().int().min(1).max(28).optional(),
    depositAmount: moneySchema.optional(),
    lateFeeBps: bpsSchema.nullish(),
    gracePeriodDays: z.number().int().min(0).max(60).nullish(),
    notes: optionalText(5000),
    /** Ativar logo o contrato (gera a primeira fatura e a caução, se houver). */
    activate: z.boolean().default(true),
  })
  .refine((v) => !v.endDate || v.endDate > v.startDate, {
    message: 'A data de fim deve ser posterior à data de início',
    path: ['endDate'],
  });
export type CreateLeaseInput = z.infer<typeof createLeaseSchema>;

export const terminateLeaseSchema = z.object({
  endDate: isoDateSchema,
  reason: optionalText(1000),
});
export type TerminateLeaseInput = z.infer<typeof terminateLeaseSchema>;

export const leaseQuerySchema = paginationSchema.extend({
  status: z.enum(LEASE_STATUSES).optional(),
  tenantId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
});

// ---------- Faturas e pagamentos ----------

export const createInvoiceSchema = z.object({
  leaseId: uuidSchema,
  kind: z.enum(INVOICE_KINDS).exclude(['RENT', 'LATE_FEE']),
  amount: positiveMoneySchema,
  dueDate: isoDateSchema,
  description: trimmed(300),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const voidInvoiceSchema = z.object({ reason: trimmed(500) });
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

export const invoiceQuerySchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  kind: z.enum(INVOICE_KINDS).optional(),
  leaseId: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
  period: periodSchema.optional(),
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Só faturas com valor em dívida (OPEN ou PARTIALLY_PAID). */
  unpaid: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const recordPaymentSchema = z.object({
  invoiceId: uuidSchema,
  amount: positiveMoneySchema,
  method: z.enum(PAYMENT_METHODS),
  paidAt: isoDateSchema,
  reference: z.string().trim().max(120).nullish(),
  notes: optionalText(1000),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const reversePaymentSchema = z.object({ reason: trimmed(500) });
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

export const paymentQuerySchema = paginationSchema.extend({
  method: z.enum(PAYMENT_METHODS).optional(),
  tenantId: uuidSchema.optional(),
  invoiceId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

// ---------- Portal do inquilino ----------

/** Email ou telefone. */
export const tenantIdentifierSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .transform((v, ctx) => {
    if (v.includes('@')) {
      const r = emailSchema.safeParse(v);
      if (r.success) return { email: r.data } as { email: string; phone?: undefined };
    } else {
      const phone = normalizePhone(v);
      if (phone) return { phone } as { phone: string; email?: undefined };
    }
    ctx.addIssue({ code: 'custom', message: 'Indique um email ou telefone válido' });
    return z.NEVER;
  });

export const tenantLoginSchema = z.object({
  identifier: tenantIdentifierSchema,
  password: z.string().min(1).max(128),
});
export type TenantLoginInput = z.infer<typeof tenantLoginSchema>;

export const tenantForgotPasswordSchema = z.object({ identifier: tenantIdentifierSchema });
export type TenantForgotPasswordInput = z.infer<typeof tenantForgotPasswordSchema>;

export const verifyInviteSchema = z.object({ token: z.string().min(20).max(200) });

export const portalInvoiceQuerySchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
});

// ---------- Pagamentos móveis ----------

export const MOBILE_METHODS = ['MPESA', 'EMOLA', 'MKESH'] as const;
export type MobileMethod = (typeof MOBILE_METHODS)[number];

/** Inquilino (portal) paga uma fatura: recebe no telemóvel o pedido para confirmar com o PIN. */
export const payInvoiceSchema = z.object({
  method: z.enum(MOBILE_METHODS),
  phone: phoneSchema,
  /** Em centavos. Se omitido, paga o valor total em dívida. */
  amount: positiveMoneySchema.optional(),
});
export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>;

/** Equipa pede o pagamento ao inquilino (por exemplo, durante uma chamada). */
export const requestMobilePaymentSchema = payInvoiceSchema.extend({ invoiceId: uuidSchema });
export type RequestMobilePaymentInput = z.infer<typeof requestMobilePaymentSchema>;

export const mpesaGatewaySchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(['sandbox', 'production']),
  serviceProviderCode: z.string().trim().regex(/^\d{5,7}$/, 'Código de serviço inválido (5 a 7 dígitos)'),
  /** Omitir para manter a chave já guardada. */
  apiKey: z.string().trim().min(10).max(200).optional(),
  publicKey: z.string().trim().min(100).max(2000).optional(),
});
export type MpesaGatewayInput = z.infer<typeof mpesaGatewaySchema>;

export const simulatorGatewaySchema = z.object({
  enabled: z.boolean(),
  methods: z.array(z.enum(MOBILE_METHODS)).min(1).default(['MPESA', 'EMOLA']),
});
export type SimulatorGatewayInput = z.infer<typeof simulatorGatewaySchema>;
