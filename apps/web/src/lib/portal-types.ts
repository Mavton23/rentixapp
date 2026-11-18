import type { Currency, LeaseStatus, PaymentMethod, PaymentStatus } from '@rentix/shared';
import type { Invoice, MoneyByCurrency } from './types';

export interface PortalInvoice extends Invoice {
  organization: { name: string; phone?: string | null; email?: string | null };
}

export interface PortalSummary {
  balances: MoneyByCurrency[];
  overdueCount: number;
  nextDue: PortalInvoice | null;
  openInvoices: number;
}

export interface PortalMe {
  id: string;
  email: string | null;
  phone: string | null;
  tenants: {
    id: string;
    fullName: string;
    organization: { id: string; name: string; phone: string | null; email: string | null };
  }[];
}

export interface PortalLease {
  id: string;
  status: LeaseStatus;
  startDate: string;
  endDate: string | null;
  rentAmount: number;
  currency: Currency;
  billingDay: number;
  depositAmount: number;
  organization: { name: string; phone: string | null; email: string | null };
  unit: { label: string; property: { name: string; street: string; neighbourhood: string | null; city: string } };
}

export interface PortalPayment {
  id: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
  receiptNumber: string | null;
  reference: string | null;
  invoice: { id: string; number: string; description: string };
  organization: { name: string };
}

export interface PortalInvoiceDetail extends PortalInvoice {
  payments: Pick<PortalPayment, 'id' | 'amount' | 'method' | 'paidAt' | 'receiptNumber' | 'status'>[];
  onlineMethods: ('MPESA' | 'EMOLA' | 'MKESH')[];
  pendingPaymentId: string | null;
}
