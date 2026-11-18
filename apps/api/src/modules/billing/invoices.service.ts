import { Injectable } from '@nestjs/common';
import { dateToIsoDate, isoDateToDate, todayIn } from '@rentix/shared';
import type { CreateInvoiceInput, InvoiceKind, InvoiceStatus, PaginationInput, VoidInvoiceInput } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from './billing.service';
import type { OrgContext } from '../../common/auth-context';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import type { Invoice, Prisma } from '../../generated/prisma/client';

type InvoiceQuery = PaginationInput & {
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  leaseId?: string;
  tenantId?: string;
  period?: string;
  overdue?: boolean;
  unpaid?: boolean;
};

/** Acrescenta campos calculados úteis para o frontend. */
export function presentInvoice<T extends Invoice>(inv: T, today: string) {
  const outstanding = inv.status === 'VOID' ? 0 : inv.amount - inv.paidAmount;
  return {
    ...inv,
    issueDate: dateToIsoDate(inv.issueDate),
    dueDate: dateToIsoDate(inv.dueDate),
    outstanding,
    isOverdue: outstanding > 0 && dateToIsoDate(inv.dueDate) < today,
  };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async list(ctx: OrgContext, q: InvoiceQuery) {
    const today = await this.today(ctx.organizationId);
    const where: Prisma.InvoiceWhereInput = {
      organizationId: ctx.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.leaseId ? { leaseId: q.leaseId } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.unpaid ? { status: { in: ['OPEN', 'PARTIALLY_PAID'] } } : {}),
      ...(q.overdue
        ? { status: { in: ['OPEN', 'PARTIALLY_PAID'] }, dueDate: { lt: isoDateToDate(today) } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: 'insensitive' } },
              { tenant: { fullName: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        ...pageArgs(q),
        orderBy: [{ dueDate: 'desc' }, { number: 'desc' }],
        include: {
          tenant: { select: { id: true, fullName: true, phone: true } },
          lease: { select: { id: true, unit: { select: { label: true, property: { select: { name: true } } } } } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginated(
      rows.map((r) => presentInvoice(r, today)),
      total,
      q,
    );
  }

  async get(ctx: OrgContext, id: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        tenant: { select: { id: true, fullName: true, phone: true, email: true } },
        lease: { select: { id: true, unit: { select: { label: true, property: { select: { name: true } } } } } },
        payments: { orderBy: { paidAt: 'desc' } },
        lateFee: { select: { id: true, number: true, amount: true, status: true } },
        parentInvoice: { select: { id: true, number: true } },
      },
    });
    if (!inv) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    const today = await this.today(ctx.organizationId);
    return {
      ...presentInvoice(inv, today),
      payments: inv.payments.map((p) => ({ ...p, paidAt: dateToIsoDate(p.paidAt) })),
    };
  }

  /** Fatura avulsa: caução, reparações, água, etc. */
  async create(ctx: OrgContext, input: CreateInvoiceInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.billing.lockOrganization(tx, ctx.organizationId);
      const lease = await tx.lease.findFirst({
        where: { id: input.leaseId, organizationId: ctx.organizationId },
        include: { tenant: true },
      });
      if (!lease) throw notFound('Contrato', 'LEASE_NOT_FOUND');
      if (lease.status !== 'ACTIVE' && lease.status !== 'DRAFT') {
        throw badRequest('LEASE_NOT_ACTIVE', 'O contrato já terminou');
      }
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      const invoice = await this.billing.issueInvoice(tx, org, lease, {
        kind: input.kind,
        description: input.description,
        issueDate: todayIn(org.timezone),
        dueDate: input.dueDate,
        amount: input.amount,
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'invoice.created',
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: { number: invoice.number, amount: invoice.amount, kind: invoice.kind },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return invoice;
    });
  }

  /** Anular uma fatura (só sem pagamentos confirmados). O número não é reutilizado. */
  async void(ctx: OrgContext, id: string, input: VoidInvoiceInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findFirst({ where: { id, organizationId: ctx.organizationId } });
      if (!inv) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
      if (inv.status === 'VOID') throw conflict('INVOICE_ALREADY_VOID', 'A fatura já está anulada');
      if (inv.paidAmount > 0) {
        throw conflict('INVOICE_HAS_PAYMENTS', 'Estorne os pagamentos antes de anular a fatura');
      }
      const updated = await tx.invoice.update({
        where: { id },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: input.reason },
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'invoice.voided',
          entityType: 'invoice',
          entityId: id,
          metadata: { number: inv.number, reason: input.reason },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return updated;
    });
  }

  private async today(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return todayIn(org.timezone);
  }
}
