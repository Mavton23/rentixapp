import { Injectable } from '@nestjs/common';
import { dateToIsoDate, todayIn, type InvoiceStatus, type PaginationInput } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { presentInvoice } from '../billing/invoices.service';
import { GatewaysService } from '../mobile-payments/gateways.service';
import { notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Dados do portal do inquilino. Todas as consultas são filtradas pela conta autenticada:
 * o inquilino só vê o que pertence às suas fichas (tenant.accountId = conta).
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: GatewaysService,
  ) {}

  async me(accountId: string) {
    const account = await this.prisma.tenantAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: {
        id: true,
        email: true,
        phone: true,
        tenants: {
          where: { archivedAt: null },
          select: {
            id: true,
            fullName: true,
            organization: { select: { id: true, name: true, phone: true, email: true } },
          },
        },
      },
    });
    return account;
  }

  /** O idioma fica em todas as fichas de inquilino da conta (uma por senhorio). */
  async setLocale(accountId: string, locale: 'pt' | 'en') {
    await this.prisma.tenant.updateMany({ where: { accountId }, data: { locale } });
    return { locale };
  }

  /** Resumo para a página inicial do portal: dívida, próxima fatura, atrasos. */
  async summary(accountId: string) {
    const today = todayIn();
    const open = await this.prisma.invoice.findMany({
      where: { tenant: { accountId }, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
      orderBy: { dueDate: 'asc' },
      include: { organization: { select: { name: true } } },
    });
    const balances: Record<string, number> = {};
    for (const inv of open) {
      balances[inv.currency] = (balances[inv.currency] ?? 0) + inv.amount - inv.paidAmount;
    }
    const presented = open.map((i) => presentInvoice(i, today));
    return {
      balances: Object.entries(balances).map(([currency, amount]) => ({ currency, amount })),
      overdueCount: presented.filter((i) => i.isOverdue).length,
      nextDue: presented.find((i) => !i.isOverdue) ?? null,
      openInvoices: presented.length,
    };
  }

  async leases(accountId: string) {
    const leases = await this.prisma.lease.findMany({
      where: { tenant: { accountId }, status: { in: ['ACTIVE', 'ENDED', 'TERMINATED'] } },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        rentAmount: true,
        currency: true,
        billingDay: true,
        depositAmount: true,
        organization: { select: { name: true, phone: true, email: true } },
        unit: { select: { label: true, property: { select: { name: true, street: true, neighbourhood: true, city: true } } } },
      },
    });
    return leases.map((l) => ({
      ...l,
      startDate: dateToIsoDate(l.startDate),
      endDate: l.endDate ? dateToIsoDate(l.endDate) : null,
    }));
  }

  async invoices(accountId: string, q: PaginationInput & { status?: InvoiceStatus }) {
    const where: Prisma.InvoiceWhereInput = {
      tenant: { accountId },
      ...(q.status ? { status: q.status } : { status: { not: 'VOID' } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        ...pageArgs(q),
        orderBy: { dueDate: 'desc' },
        include: { organization: { select: { name: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const today = todayIn();
    return paginated(rows.map((r) => presentInvoice(r, today)), total, q);
  }

  async invoice(accountId: string, id: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, tenant: { accountId } },
      include: {
        organization: { select: { name: true, phone: true, email: true } },
        payments: {
          where: { status: { in: ['CONFIRMED', 'REVERSED'] } },
          select: { id: true, amount: true, method: true, paidAt: true, receiptNumber: true, status: true },
          orderBy: { paidAt: 'desc' },
        },
      },
    });
    if (!inv) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    const pending = await this.prisma.payment.findFirst({
      where: { invoiceId: id, status: 'PENDING', provider: { not: null }, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return {
      ...presentInvoice(inv, todayIn()),
      payments: inv.payments.map((p) => ({ ...p, paidAt: dateToIsoDate(p.paidAt) })),
      /** Métodos com que o inquilino pode pagar agora pelo portal. */
      onlineMethods: inv.currency === 'MZN' ? await this.gateways.availableMethods(inv.organizationId) : [],
      pendingPaymentId: pending?.id ?? null,
    };
  }

  async payments(accountId: string, q: PaginationInput) {
    const where: Prisma.PaymentWhereInput = {
      tenant: { accountId },
      status: { in: ['CONFIRMED', 'REVERSED'] },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        ...pageArgs(q),
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          paidAt: true,
          receiptNumber: true,
          reference: true,
          invoice: { select: { id: true, number: true, description: true } },
          organization: { select: { name: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginated(rows.map((p) => ({ ...p, paidAt: dateToIsoDate(p.paidAt) })), total, q);
  }
}
