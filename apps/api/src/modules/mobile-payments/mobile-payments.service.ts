import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { dateToIsoDate, isoDateToDate, todayIn, walletForPhone, type MobileMethod } from '@rentix/shared';
import { CronRunner } from '../../common/ops/cron-runner.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import { GatewaysService } from './gateways.service';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import type { RequestMeta } from '../../common/auth-context';
import type { Payment } from '../../generated/prisma/client';

const WALLET_HINT: Record<MobileMethod, string> = {
  MPESA: 'M-Pesa precisa de um número Vodacom (84 ou 85)',
  EMOLA: 'e-Mola precisa de um número Movitel (86 ou 87)',
  MKESH: 'mKesh precisa de um número Tmcel (82 ou 83)',
};

/** Depois de expirar sem resposta, continua-se a consultar o fornecedor durante este tempo. */
const QUERY_GRACE_MS = 30 * 60_000;

export interface InitiateInput {
  invoiceId: string;
  method: MobileMethod;
  phone: string;
  amount?: number;
  /** Portal: restringe às faturas do inquilino. */
  tenantAccountId?: string;
  /** Equipa: restringe à organização ativa. */
  organizationId?: string;
  initiatedBy: 'USER' | 'TENANT';
  actorId: string;
}

/**
 * Pagamentos por dinheiro móvel (M-Pesa, e-Mola...).
 *
 * 1. initiate(): cria um pagamento PENDING e dispara o pedido ao fornecedor em segundo plano.
 *    O cliente recebe no telemóvel o pedido para introduzir o PIN.
 * 2. O fornecedor responde: confirm() aplica o pagamento à fatura e emite o recibo,
 *    ou fail() regista o motivo.
 * 3. Sem resposta: o varrimento periódico consulta o fornecedor e, por fim, dá o pedido como falhado.
 * O frontend acompanha o estado com GET .../status.
 */
@Injectable()
export class MobilePaymentsService {
  private readonly logger = new Logger(MobilePaymentsService.name);
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronRunner,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly gateways: GatewaysService,
  ) {}

  async initiate(input: InitiateInput, meta: RequestMeta) {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: input.invoiceId,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.tenantAccountId ? { tenant: { accountId: input.tenantAccountId } } : {}),
      },
      include: { organization: true },
    });
    if (!invoice) throw notFound('Fatura', 'INVOICE_NOT_FOUND');
    if (invoice.status === 'VOID') throw badRequest('INVOICE_VOID', 'A fatura está anulada');
    const outstanding = invoice.amount - invoice.paidAmount;
    if (outstanding <= 0) throw conflict('INVOICE_ALREADY_PAID', 'A fatura já está paga');
    const amount = input.amount ?? outstanding;
    if (amount > outstanding) {
      throw badRequest('AMOUNT_EXCEEDS_OUTSTANDING', 'O valor é superior ao montante em dívida', { outstanding });
    }
    if (invoice.currency !== 'MZN') {
      throw badRequest('CURRENCY_NOT_SUPPORTED', 'Pagamentos móveis só estão disponíveis para faturas em meticais');
    }
    if (walletForPhone(input.phone) !== input.method) {
      throw badRequest('PHONE_WALLET_MISMATCH', WALLET_HINT[input.method]);
    }

    const gateway = await this.gateways.resolve(invoice.organizationId, input.method);
    if (!gateway) {
      throw badRequest('METHOD_NOT_AVAILABLE', 'Este método de pagamento não está ativo para este senhorio');
    }

    const inProgress = await this.prisma.payment.findFirst({
      where: { invoiceId: invoice.id, status: 'PENDING', provider: { not: null }, expiresAt: { gt: new Date() } },
    });
    if (inProgress) {
      throw conflict('PAYMENT_IN_PROGRESS', 'Já há um pagamento à espera de confirmação para esta fatura', {
        paymentId: inProgress.id,
      });
    }

    const timeoutMs = this.config.get('MOBILE_PAYMENT_TIMEOUT_SECONDS') * 1000;
    const payment = await this.prisma.payment.create({
      data: {
        organizationId: invoice.organizationId,
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        amount,
        currency: invoice.currency,
        method: input.method,
        status: 'PENDING',
        paidAt: isoDateToDate(todayIn(invoice.organization.timezone)),
        payerPhone: input.phone,
        provider: gateway.config.gateway,
        providerReference: `RX${randomBytes(6).toString('hex').toUpperCase()}`,
        expiresAt: new Date(Date.now() + timeoutMs),
        initiatedBy: input.initiatedBy,
        recordedById: input.initiatedBy === 'USER' ? input.actorId : null,
      },
    });
    await this.audit.log({
      organizationId: invoice.organizationId,
      actorType: input.initiatedBy,
      actorId: input.actorId,
      action: 'payment.mobile_initiated',
      entityType: 'payment',
      entityId: payment.id,
      metadata: { invoice: invoice.number, amount, method: input.method, gateway: gateway.config.gateway },
      ...meta,
    });

    // Em segundo plano: o pedido C2B pode demorar até o cliente introduzir o PIN.
    const job = this.execute(payment.id).finally(() => this.inflight.delete(job));
    this.inflight.add(job);

    return this.present(payment);
  }

  /** Estado para o frontend acompanhar o pedido. */
  async status(paymentId: string, scope: { tenantAccountId?: string; organizationId?: string }) {
    const p = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
        ...(scope.tenantAccountId ? { tenant: { accountId: scope.tenantAccountId } } : {}),
      },
    });
    if (!p) throw notFound('Pagamento', 'PAYMENT_NOT_FOUND');
    return this.present(p);
  }

  /** Só para testes: espera que os pedidos em curso terminem. */
  async drain(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  async execute(paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: { invoice: { select: { number: true } } },
      });
      if (!payment || payment.status !== 'PENDING' || !payment.provider || !payment.payerPhone) return;
      const gateway = await this.prisma.paymentGatewayConfig.findUnique({
        where: { organizationId_gateway: { organizationId: payment.organizationId, gateway: payment.provider as never } },
      });
      if (!gateway) return this.fail(paymentId, 'Fornecedor de pagamento não configurado');

      const result = await this.gateways.providerFor(gateway).collect({
        msisdn: payment.payerPhone,
        amount: payment.amount,
        reference: payment.invoice.number,
        thirdPartyReference: payment.providerReference!,
      });
      if (result.status === 'SUCCESS') await this.confirm(paymentId, result.transactionId);
      else if (result.status === 'FAILED') await this.fail(paymentId, result.message, result.code);
      // PENDING: o varrimento consulta mais tarde.
    } catch (err) {
      this.logger.error({ err, paymentId }, 'Erro ao processar pagamento móvel');
    }
  }

  /** Confirma um pagamento móvel e aplica-o à fatura. Idempotente. */
  async confirm(paymentId: string, providerTransactionId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!found) return;
      const invoice = await this.payments.lockInvoice(tx, found.organizationId, found.invoiceId);
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.status !== 'PENDING') return;

      const outstanding = invoice.amount - invoice.paidAmount;
      if (invoice.status === 'VOID' || payment.amount > outstanding) {
        // O dinheiro saiu do cliente mas a fatura já não o pode receber (paga noutro canal entretanto).
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            expiresAt: null,
            providerTransactionId,
            failureReason: 'Requer revisão: o valor foi recebido mas a fatura já estava paga ou anulada',
          },
        });
        await this.audit.log(
          {
            organizationId: payment.organizationId,
            actorType: 'SYSTEM',
            action: 'payment.needs_review',
            entityType: 'payment',
            entityId: paymentId,
            metadata: { providerTransactionId: providerTransactionId ?? null },
          },
          tx,
        );
        return;
      }

      const org = await tx.organization.findUniqueOrThrow({ where: { id: payment.organizationId } });
      const confirmed = await this.payments.settle(tx, org, invoice, { ...payment, expiresAt: null }, providerTransactionId);
      await tx.payment.update({ where: { id: paymentId }, data: { expiresAt: null } });
      await this.audit.log(
        {
          organizationId: payment.organizationId,
          actorType: 'SYSTEM',
          action: 'payment.mobile_confirmed',
          entityType: 'payment',
          entityId: paymentId,
          metadata: { receiptNumber: confirmed.receiptNumber, providerTransactionId: providerTransactionId ?? null },
        },
        tx,
      );
    });
  }

  async fail(paymentId: string, reason: string, code?: string): Promise<void> {
    const res = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 500), expiresAt: null },
    });
    if (res.count) {
      const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await this.audit.log({
        organizationId: p.organizationId,
        actorType: 'SYSTEM',
        action: 'payment.mobile_failed',
        entityType: 'payment',
        entityId: paymentId,
        metadata: { reason, code: code ?? null },
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'mobile-payments-sweep' })
  async scheduledSweep(): Promise<void> {
    await this.cron.run('mobile-payments-sweep', () => this.sweep());
  }

  /** Pedidos expirados sem resposta: consulta o fornecedor; se continuar sem resposta, dá como falhado. */
  async sweep(now = new Date()): Promise<number> {
    const stale = await this.prisma.payment.findMany({
      where: { status: 'PENDING', provider: { not: null }, expiresAt: { lt: now } },
      take: 50,
    });
    for (const p of stale) {
      try {
        const gateway = await this.prisma.paymentGatewayConfig.findUnique({
          where: { organizationId_gateway: { organizationId: p.organizationId, gateway: p.provider as never } },
        });
        const provider = gateway ? this.gateways.providerFor(gateway) : null;
        const result = provider?.query ? await provider.query(p.providerReference!) : { status: 'UNKNOWN' as const };
        if (result.status === 'SUCCESS') await this.confirm(p.id, result.transactionId);
        else if (result.status === 'FAILED') await this.fail(p.id, result.message);
        else if (now.getTime() - p.expiresAt!.getTime() > QUERY_GRACE_MS) {
          await this.fail(
            p.id,
            `Não foi possível confirmar o pagamento. Se o valor foi debitado, contacte o senhorio com a referência ${p.providerReference}.`,
          );
        }
      } catch (err) {
        this.logger.warn({ err, paymentId: p.id }, 'Falha ao verificar pagamento pendente');
      }
    }
    return stale.length;
  }

  private present(p: Payment) {
    return {
      id: p.id,
      status: p.status,
      method: p.method,
      amount: p.amount,
      currency: p.currency,
      payerPhone: p.payerPhone,
      receiptNumber: p.receiptNumber,
      failureReason: p.failureReason,
      expiresAt: p.expiresAt,
      paidAt: dateToIsoDate(p.paidAt),
      invoiceId: p.invoiceId,
    };
  }
}
