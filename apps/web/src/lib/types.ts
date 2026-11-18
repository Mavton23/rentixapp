/** Formas das respostas da API usadas pelo frontend. */
import type {
  Currency,
  IdDocumentType,
  InvoiceKind,
  InvoiceStatus,
  LeaseStatus,
  MaritalStatus,
  MemberRole,
  PaymentMethod,
  PaymentStatus,
  PropertyType,
  UnitStatus,
} from '@rentix/shared';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface StaffSession {
  accessToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string; phone: string | null; platformRole: string; locale: 'pt' | 'en' | null };
  organization: { id: string; name: string; role: MemberRole; status: 'ACTIVE' | 'SUSPENDED' } | null;
  memberships: { organizationId: string; name: string; role: MemberRole }[];
}

export interface TenantSession {
  accessToken: string;
  expiresIn: number;
  account: { id: string; email: string | null; phone: string | null; locale: 'pt' | 'en' | null };
}

export interface MoneyByCurrency {
  currency: Currency;
  amount: number;
}

export interface Unit {
  id: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  floor: string | null;
  rentAmount: number | null;
  status: UnitStatus;
  notes: string | null;
}

export interface PropertyListItem {
  id: string;
  name: string;
  type: PropertyType;
  street: string;
  neighbourhood: string | null;
  city: string;
  units: Pick<Unit, 'id' | 'label' | 'status' | 'rentAmount'>[];
  stats: { units: number; occupied: number };
}

export interface PropertyDetail {
  id: string;
  name: string;
  type: PropertyType;
  street: string;
  neighbourhood: string | null;
  city: string;
  province: string | null;
  country: string;
  description: string | null;
  units: (Unit & {
    leases: {
      id: string;
      rentAmount: number;
      currency: Currency;
      startDate: string;
      endDate: string | null;
      tenant: { id: string; fullName: string; phone: string };
    }[];
  })[];
}

export interface UnitRef {
  id: string;
  label: string;
  property: { id: string; name: string };
}

export interface TenantListItem {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  idDocumentType: IdDocumentType;
  idDocumentNumber: string;
  portalEnabled: boolean;
  leases: { id: string; rentAmount: number; currency: Currency; unit: UnitRef }[];
}

export interface TenantDetail {
  id: string;
  fullName: string;
  locale: 'pt' | 'en' | null;
  email: string | null;
  phone: string;
  idDocumentType: IdDocumentType;
  idDocumentNumber: string;
  nuit: string | null;
  birthDate: string | null;
  maritalStatus: MaritalStatus | null;
  occupation: string | null;
  employer: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  portalEnabled: boolean;
  balance: number;
  leases: (Lease & { unit: UnitRef })[];
}

export interface Lease {
  id: string;
  status: LeaseStatus;
  startDate: string;
  endDate: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  rentAmount: number;
  currency: Currency;
  billingDay: number;
  depositAmount: number;
  lateFeeBps: number | null;
  gracePeriodDays: number | null;
  notes: string | null;
  unitId: string;
  tenantId: string;
}

export interface LeaseListItem extends Lease {
  tenant: { id: string; fullName: string; phone: string };
  unit: UnitRef;
}

export interface Invoice {
  id: string;
  number: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  period: string | null;
  description: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  isOverdue: boolean;
  currency: Currency;
  leaseId: string;
  tenantId: string;
  voidReason: string | null;
}

export interface InvoiceListItem extends Invoice {
  tenant: { id: string; fullName: string; phone: string };
  lease: { id: string; unit: { label: string; property: { name: string } } };
}

export interface Payment {
  id: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
  reference: string | null;
  notes: string | null;
  receiptNumber: string | null;
  reversalReason: string | null;
  failureReason: string | null;
  invoiceId: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  payments: Payment[];
  lateFee: { id: string; number: string; amount: number; status: InvoiceStatus } | null;
  parentInvoice: { id: string; number: string } | null;
}

export interface PaymentListItem extends Payment {
  tenant: { id: string; fullName: string };
  invoice: { id: string; number: string; description: string };
}

export interface LeaseDetail extends Lease {
  tenant: TenantDetail;
  unit: Unit & { property: PropertyDetail };
  invoices: Omit<Invoice, 'outstanding' | 'isOverdue'>[];
}

export interface Dashboard {
  today: string;
  period: string;
  defaultCurrency: Currency;
  occupancy: { units: number; occupied: number; rate: number };
  tenants: number;
  activeLeases: number;
  month: { billed: MoneyByCurrency[]; collected: MoneyByCurrency[] };
  overdue: { invoices: number; tenants: number; amount: MoneyByCurrency[] };
  upcoming: {
    id: string;
    number: string;
    description: string;
    amount: number;
    outstanding: number;
    currency: Currency;
    dueDate: string;
    tenant: { id: string; fullName: string };
  }[];
  recentPayments: {
    id: string;
    amount: number;
    currency: Currency;
    method: PaymentMethod;
    paidAt: string;
    receiptNumber: string | null;
    tenant: { id: string; fullName: string };
  }[];
}

export interface Organization {
  id: string;
  name: string;
  nuit: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  defaultCurrency: Currency;
  timezone: string;
  locale: string;
  country: string;
  defaultBillingDay: number;
  lateFeeBps: number;
  gracePeriodDays: number;
  reminderDaysBefore: number;
  subscription: { status: string; currentPeriodEnd: string | null; plan: { code: string; name: string } } | null;
  limits: { planCode: string | null; maxUnits: number | null; maxTenants: number | null; maxMembers: number | null };
}

export interface Member {
  role: MemberRole;
  createdAt: string;
  user: { id: string; name: string; email: string; phone: string | null };
}

export interface AvailableUnit {
  id: string;
  label: string;
  rentAmount: number | null;
  property: { id: string; name: string; street: string; city: string };
}
