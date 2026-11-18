import type { BillingCycle, MemberRole, MobileMethod, SubscriptionInvoiceStatus, SubscriptionStatus } from '@rentix/shared';
import type { Paginated } from './types';

export interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  maxUnits: number | null;
  maxTenants: number | null;
  maxMembers: number | null;
  maxStorageMb: number | null;
  sortOrder: number;
}

export interface SubscriptionView {
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  plan: { code: string; name: string; monthlyPrice: number; annualPrice: number };
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  periodValue: number;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: { code: string; name: string } | null;
  scheduledCycle: BillingCycle | null;
  pastDueSince: string | null;
  downgradeAt: string | null;
}

export interface PlatformInvoice {
  id: string;
  number: string;
  kind: 'CHANGE' | 'RENEWAL';
  status: SubscriptionInvoiceStatus;
  plan: { code: string; name: string };
  billingCycle: BillingCycle;
  planAmount: number;
  credit: number;
  amount: number;
  currency: string;
  periodStart: string | null;
  dueDate: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface Limits {
  planCode: string | null;
  maxUnits: number | null;
  maxTenants: number | null;
  maxMembers: number | null;
  maxStorageMb: number | null;
}

export interface BillingOverview {
  subscription: SubscriptionView | null;
  limits: Limits;
  usage: { units: number; tenants: number; members: number; pendingInvites: number; storageBytes: number };
  plans: PublicPlan[];
  openInvoices: PlatformInvoice[];
  pendingPaymentId: string | null;
  paymentOptions: { mobileMethods: MobileMethod[]; bankTransfer: string[] };
  graceDays: number;
}

export type ChangeQuote = {
  from: { code: string; name: string; billingCycle: BillingCycle };
  to: { code: string; name: string; billingCycle: BillingCycle };
} & (
  | { kind: 'NOOP'; reason: string }
  | { kind: 'FREE_NOW' }
  | { kind: 'CHOOSE_LONGER_CYCLE' }
  | { kind: 'SCHEDULED'; effectiveAt: string; toFree: boolean }
  | { kind: 'IMMEDIATE'; planAmount: number; credit: number; amount: number }
);

export interface CheckoutResult {
  mode: ChangeQuote['kind'];
  invoice: PlatformInvoice | null;
}

export interface MemberInvite {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  createdAt: string;
}

export interface InvitePreview {
  organizationName: string;
  email: string;
  role: MemberRole;
  invitedBy: string | null;
  hasAccount: boolean;
}

// ---------- Administração ----------

export interface AdminMetrics {
  organizations: { total: number; newLast30Days: number; suspended: number };
  subscriptions: { trialing: number; paying: number; pastDue: number; free: number };
  byPlan: { code: string; name: string; count: number }[];
  mrr: number;
  revenueLast30Days: { amount: number; invoices: number };
  openInvoices: { amount: number; count: number };
  trialsEndingSoon: { organizationId: string; name: string; plan: string; endsAt: string }[];
}

export interface AdminOrgRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  city: string | null;
  createdAt: string;
  owner: { name: string; email: string; phone: string | null } | null;
  plan: { code: string; name: string } | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  counts: { units: number; tenants: number; members: number };
}

export interface AdminOrgDetail {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedAt: string | null;
  suspendedReason: string | null;
  nuit: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  createdAt: string;
  members: { role: MemberRole; user: { id: string; name: string; email: string; phone: string | null; lastLoginAt: string | null } }[];
  subscription: SubscriptionView | null;
  usage: BillingOverview['usage'];
  limits: Limits;
  invoices: PlatformInvoice[];
  activity: { id: string; action: string; actorType: string; createdAt: string }[];
}

export type AdminInvoice = PlatformInvoice & { organization: { id: string; name: string } };
export type AdminInvoicePage = Paginated<AdminInvoice>;

export interface AdminPlan extends PublicPlan {
  id: string;
  isActive: boolean;
  updatedAt: string;
  subscriptions: number;
}
