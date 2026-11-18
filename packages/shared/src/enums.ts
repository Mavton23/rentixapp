/**
 * Enums do domínio. Os valores coincidem 1:1 com os enums do Prisma
 * (apps/api/prisma/schema.prisma), para que API e frontend falem a mesma língua.
 * Os rótulos em português ficam no frontend (i18n), não aqui.
 */

export const MEMBER_ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PROPERTY_TYPES = [
  'HOUSE',
  'APARTMENT_BUILDING',
  'APARTMENT',
  'COMMERCIAL',
  'OFFICE',
  'WAREHOUSE',
  'LAND',
  'OTHER',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const UNIT_STATUSES = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'UNAVAILABLE'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const ID_DOCUMENT_TYPES = ['BI', 'PASSPORT', 'DIRE', 'DRIVING_LICENSE', 'OTHER'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'UNION'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const LEASE_STATUSES = ['DRAFT', 'ACTIVE', 'ENDED', 'TERMINATED'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const INVOICE_KINDS = ['RENT', 'DEPOSIT', 'LATE_FEE', 'OTHER'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'MPESA',
  'EMOLA',
  'MKESH',
  'CARD',
  'CHEQUE',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Moedas suportadas. MZN é a moeda por omissão. */
export const CURRENCIES = ['MZN', 'USD', 'ZAR', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Funcionalidades que podem ser ligadas/desligadas por variável de ambiente. */
export const FEATURE_FLAGS = ['BLOG', 'CMS', 'MARKETPLACE', 'STATUS_PAGE', 'TESTIMONIALS'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
