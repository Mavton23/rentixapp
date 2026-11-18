import { pickLocale } from '../../common/i18n';
import { Injectable } from '@nestjs/common';
import {
  dateToIsoDate,
  isoDateToDate,
  todayIn,
  type PaginationInput,
  type PaymentMethod,
  type RecordPaymentInput,
  type ReversePaymentInput,
} from '@rentix/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentNumberService } from '../billing/document-number.service';
import { invoiceStatusFor } from '../billing/billing.logic';
import { renderReceiptPdf } from './receipt-pdf';
import type { OrgContext } from '../../common/auth-context';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import type { Invoice, Organization, Payment, Prisma } from '../../generated/prisma/client';

type PaymentQuery = PaginationInput & {
  method?: PaymentMethod;
  tenantId?: string;
  invoiceId?: string;
  from?: string;
  to?: string;
};

function presentPayment<T extends Payment>(p: T) {
  return { ...p, paidAt: dateToIsoDate(p.paidAt) };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly numbers: DocumentNumberService,
  ) {}

  async list(ctx: OrgContext, q: PaymentQuery) {
    const where: Prisma.PaymentWhereInput = {
      organizationId: ctx.organizationId,
      ...(q.method ? { method: q.method } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
      ...(q.from || q.to
        ? {
            paidAt: {
              ...(q.from ? { gte: isoDateToDate(q.from) } : {}),
              ...(q.to ? { lte: isoDateToDate(q.to) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { receiptNumber: { contains: q.search, mode: 'insensitive' } },
              { reference: { contains: q.search, mode: 'insensitive' } },
              { tenant: { fullName: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        ...pageArgs(q),
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          tenant: { select: { id: true, fullName: true } },
          invoice: { select: { id: true, number: true, description: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginated(rows.map(presentPayment), total, q);
  }

  async get(ctx: OrgContext, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        tenant: { select: { id: true, fullName: true, phone: true, email: true, nuit: true } },
        invoice: true,
        recordedBy: { select: { id: true, name: true } },
      },
    });
    if (!p) throw notFound('Pagamento', 'PAYMENT_NOT_FOUND');
    return presentPayment(p);
  }

  /** Dados do recibo, restritos à organização (equipa) ou à conta do inquilino (portal). */
  async receipt(scope: { organizationId?: string; tenantAccountId?: string }, id: string) {
    const p = await this.prisma.payment.findFirst({
      where: {
        id,
        status: { in: ['CONFIRMED', 'REVERSED'] },
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
        ...(scope.tenantAccountId ? { tenant: { accountId: scope.tenantAccountId } } : {}),
      },
      include: {
        organization: { select: { name: true, nuit: true, address: true, city: true, phone: true, email: true, logoUrl: true, locale: true } },
        tenant: { select: { fullName: true, nuit: true, idDocumentType: true, idDocumentNumber: true, phone: true, locale: true } },
        invoice: {
          select: {
            number: true,
            description: true,
            amount: true,
            paidAmount: true,
            period: true,
            lease: { select: { unit: { select: { label: true, property: { select: { name: true, street: true, city: true } } } } } },
          },
        },
      },
    });
    if (!p) throw notFound('Recibo', 'RECEIPT_NOT_FOUND');
    // "Total pago até à data" refere-se à data deste recibo, não ao estado atual da fatura.
    const paidToDate = await this.prisma.payment.aggregate({
      where: { invoiceId: p.invoiceId, status: 'CONFIRMED', createdAt: { lte: p.createdAt } },
      _sum: { amount: true },
    });
    const paid = p.status === 'REVERSED' ? p.amount : (paidToDate._sum.amount ?? 0);
    return presentPayment({ ...p, invoice: { ...p.invoice, paidAmount: Math.min(paid, p.invoice.amount) } });
  }

  async receiptPdf(scope: { organizationId?: string; tenantAccountId?: string }, id: string) {
    const data = await this.receipt(scope, id);
    // O recibo é do inquilino: sai no idioma dele, senão no da organização.
    const locale = pickLocale(data.tenant.locale, data.organization.locale);
    const name = locale === 'en' ? 'receipt' : 'recibo';
    return { filename: `${name}-${(data.receiptNumber ?? id).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`, buffer: await renderReceiptPdf(data, locale) };
  }

  /**
   * Regista um pagamento (dinheiro, transferência, M-Pesa registado à mão, etc.).
   * - Bloqueia a fatura (FOR UPDATE) para que dois pagamentos simultâneos não ultrapassem o valor.
   * - Idempotente: com o cabeçalho Idempotency-Key, repetir o pedido devolve o mesmo pagamento.
   * - Atribui número de recibo sequencial e notifica o inquilino.
   */
  async record(ctx: OrgContext, input: RecordPaymentInput, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.prisma.payment.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: ctx.organizationId, idempotencyKey } },
      });
      if (existing) {
        if (existing.invoiceId !== input.invoiceId || existing.amount !== input.amount) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'Esta chave de idempotência já foi usada noutro pagamento');
        }
        return presentPayment(existing);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const invoice = await this.lockInvoice(tx, ctx.organizationId, input.invoiceId);
      if (invoice.status === 'VOID') throw badRequest('INVOICE_VOID', 'A fatura está anulada');
      const outstanding = invoice.amount - invoice.paidAmount;
      if (outstanding <= 0) throw conflict('INVOICE_ALREADY_PAID', 'A fatura já está paga');
      if (input.amount > outstanding) {
        throw badRequest('AMOUNT_EXCEEDS_OUTSTANDING', 'O valor é superior ao montante em dívida', {
          outstanding,
        });
      }

      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      if (input.paidAt > todayIn(org.timezone)) {
        throw badRequest('PAYMENT_DATE_IN_FUTURE', 'A data do pagamento não pode ser no futuro');
      }
      const pending = await tx.payment.create({
        data: {
          organizationId: ctx.organizationId,
          invoiceId: invoice.id,
          tenantId: invoice.tenantId,
          amount: input.amount,
          currency: invoice.currency,
          method: input.method,
          status: 'PENDING',
          paidAt: isoDateToDate(input.paidAt),
          reference: input.reference ?? null,
          notes: input.notes,
          idempotencyKey: idempotencyKey ?? null,
          recordedById: ctx.userId,
          initiatedBy: 'USER',
        },
      });
      const payment = await this.settle(tx, org, invoice, pending);
      const receiptNumber = payment.receiptNumber;

      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'payment.recorded',
          entityType: 'payment',
          entityId: payment.id,
          metadata: { invoice: invoice.number, amount: input.amount, method: input.method, receiptNumber },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return presentPayment(payment);
    });
  }

  /** Estorno: o pagamento fica REVERSED (nunca é apagado) e a fatura volta a ter dívida. */
  async reverse(ctx: OrgContext, id: string, input: ReversePaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.payment.findFirst({ where: { id, organizationId: ctx.organizationId } });
      if (!found) throw notFound('Pagamento', 'PAYMENT_NOT_FOUND');
      const invoice = await this.lockInvoice(tx, ctx.organizationId, found.invoiceId);

      // Reler depois do lock da fatura, para não estornar duas vezes em paralelo.
      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.status !== 'CONFIRMED') {
        throw conflict('PAYMENT_NOT_CONFIRMED', 'Só pagamentos confirmados podem ser estornados');
      }

      const updated = await tx.payment.update({
        where: { id },
        data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: input.reason, reversedById: ctx.userId },
      });
      const paidAmount = invoice.paidAmount - payment.amount;
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount,
          status: invoice.status === 'VOID' ? 'VOID' : invoiceStatusFor(invoice.amount, paidAmount),
        },
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'payment.reversed',
          entityType: 'payment',
          entityId: id,
          metadata: { receiptNumber: payment.receiptNumber, amount: payment.amount, reason: input.reason },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return presentPayment(updated);
    });
  }

  /**
   * Confirma um pagamento e aplica-o à fatura (que tem de estar bloqueada pelo chamador):
   * atribui o número de recibo, atualiza o valor pago e o estado, e notifica o inquilino.
   * Usado pelo registo manual e pela confirmação de pagamentos móveis.
   */
  async settle(tx: Tx, org: Organization, invoice: Invoice, payment: Payment, providerTransactionId?: string): Promise<Payment> {
    const year = Number(dateToIsoDate(payment.paidAt).slice(0, 4));
    const receiptNumber = await this.numbers.next(tx, org.id, 'RC', year);
    const confirmed = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CONFIRMED',
        receiptNumber,
        failureReason: null,
        ...(providerTransactionId ? { providerTransactionId, reference: payment.reference ?? providerTransactionId } : {}),
      },
    });

    const paidAmount = invoice.paidAmount + payment.amount;
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { paidAmount, status: invoiceStatusFor(invoice.amount, paidAmount) },
    });

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });
    await this.notifications.notifyContact(
      { email: tenant.email, phone: tenant.phone },
      {
        template: 'PAYMENT_RECEIVED',
        organizationId: org.id,
        tenantId: tenant.id,
        dedupeKey: `paid:${payment.id}`,
        data: {
          tenantName: tenant.fullName,
          organizationName: org.name,
          receiptNumber,
          paid: { amount: payment.amount, currency: invoice.currency },
          invoiceNumber: invoice.number,
          remaining: { amount: invoice.amount - paidAmount, currency: invoice.currency },
        },
      },
      tx,
    );
    return confirmed;
  }

  /** Bloqueia a fatura (SELECT ... FOR UPDATE) e devolve-a. */
  async lockInvoice(tx: Tx, organizationId: string, invoiceId: string) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId } });
    if (!invoice) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    return invoice;
  }
}
