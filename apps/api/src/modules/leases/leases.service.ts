import { pickLocale, translator } from '../../common/i18n';
import { Injectable } from '@nestjs/common';
import {
  dateToIsoDate,
  isoDateToDate,
  periodOf,
  todayIn,
  type CreateLeaseInput,
  type LeaseStatus,
  type PaginationInput,
  type TerminateLeaseInput,
} from '@rentix/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import type { OrgContext } from '../../common/auth-context';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import { Prisma, type Lease } from '../../generated/prisma/client';

type LeaseQuery = PaginationInput & { status?: LeaseStatus; tenantId?: string; unitId?: string };

function presentLease<T extends Lease>(l: T) {
  return {
    ...l,
    startDate: dateToIsoDate(l.startDate),
    endDate: l.endDate ? dateToIsoDate(l.endDate) : null,
    terminatedAt: l.terminatedAt ? dateToIsoDate(l.terminatedAt) : null,
  };
}

@Injectable()
export class LeasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
  ) {}

  async list(ctx: OrgContext, q: LeaseQuery) {
    const where: Prisma.LeaseWhereInput = {
      organizationId: ctx.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.unitId ? { unitId: q.unitId } : {}),
      ...(q.search
        ? {
            OR: [
              { tenant: { fullName: { contains: q.search, mode: 'insensitive' } } },
              { unit: { property: { name: { contains: q.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lease.findMany({
        where,
        ...pageArgs(q),
        orderBy: { startDate: 'desc' },
        include: {
          tenant: { select: { id: true, fullName: true, phone: true } },
          unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.lease.count({ where }),
    ]);
    return paginated(rows.map(presentLease), total, q);
  }

  async get(ctx: OrgContext, id: string) {
    const lease = await this.prisma.lease.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        tenant: true,
        unit: { include: { property: true } },
        invoices: { orderBy: { dueDate: 'desc' }, take: 24 },
      },
    });
    if (!lease) throw notFound('Contrato', 'LEASE_NOT_FOUND');
    return {
      ...presentLease(lease),
      invoices: lease.invoices.map((i) => ({
        ...i,
        issueDate: dateToIsoDate(i.issueDate),
        dueDate: dateToIsoDate(i.dueDate),
      })),
    };
  }

  /**
   * Cria um contrato. Com activate=true (padrão): ocupa a unidade, emite a fatura da caução
   * (se houver) e as rendas já devidas — tudo numa transação.
   */
  async create(ctx: OrgContext, input: CreateLeaseInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.billing.lockOrganization(tx, ctx.organizationId);
        const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });

        const unit = await tx.unit.findFirst({
          where: { id: input.unitId, organizationId: ctx.organizationId, archivedAt: null },
        });
        if (!unit) throw notFound('Unidade', 'UNIT_NOT_FOUND');
        const tenant = await tx.tenant.findFirst({
          where: { id: input.tenantId, organizationId: ctx.organizationId, archivedAt: null },
        });
        if (!tenant) throw notFound('Inquilino', 'TENANT_NOT_FOUND');

        const today = todayIn(org.timezone);
        const startPeriod = periodOf(input.startDate);
        const createdPeriod = periodOf(today);

        const lease = await tx.lease.create({
          data: {
            organizationId: ctx.organizationId,
            unitId: unit.id,
            tenantId: tenant.id,
            status: 'DRAFT',
            startDate: isoDateToDate(input.startDate),
            endDate: input.endDate ? isoDateToDate(input.endDate) : null,
            rentAmount: input.rentAmount,
            currency: input.currency ?? org.defaultCurrency,
            billingDay: input.billingDay ?? org.defaultBillingDay,
            firstBillingPeriod: startPeriod > createdPeriod ? startPeriod : createdPeriod,
            depositAmount: input.depositAmount ?? 0,
            lateFeeBps: input.lateFeeBps ?? null,
            gracePeriodDays: input.gracePeriodDays ?? null,
            notes: input.notes,
          },
        });

        await this.audit.log(
          {
            organizationId: ctx.organizationId,
            actorType: 'USER',
            actorId: ctx.userId,
            action: 'lease.created',
            entityType: 'lease',
            entityId: lease.id,
            metadata: { unitId: unit.id, tenantId: tenant.id, rentAmount: lease.rentAmount },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );

        if (input.activate) return this.activateInTx(tx, ctx, lease.id);
        return presentLease(lease);
      });
    } catch (err) {
      throw this.mapUnitOccupied(err);
    }
  }

  async activate(ctx: OrgContext, id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.billing.lockOrganization(tx, ctx.organizationId);
        return this.activateInTx(tx, ctx, id);
      });
    } catch (err) {
      throw this.mapUnitOccupied(err);
    }
  }

  /**
   * Termina o contrato: liberta a unidade e anula as rendas futuras ainda não pagas.
   * Faturas já vencidas continuam em dívida.
   */
  async terminate(ctx: OrgContext, id: string, input: TerminateLeaseInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.billing.lockOrganization(tx, ctx.organizationId);
      const lease = await tx.lease.findFirst({ where: { id, organizationId: ctx.organizationId } });
      if (!lease) throw notFound('Contrato', 'LEASE_NOT_FOUND');
      if (lease.status !== 'ACTIVE' && lease.status !== 'DRAFT') {
        throw conflict('LEASE_NOT_ACTIVE', 'Este contrato já terminou');
      }
      if (input.endDate < dateToIsoDate(lease.startDate)) {
        throw badRequest('INVALID_END_DATE', 'A data de fim não pode ser anterior ao início do contrato');
      }

      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      // Data de fim no futuro (pré-aviso): o contrato continua ativo até lá e o job diário
      // termina-o automaticamente. Data de hoje ou passada: termina já.
      const endsLater = lease.status === 'ACTIVE' && input.endDate >= todayIn(org.timezone);
      const updated = await tx.lease.update({
        where: { id },
        data: {
          status: endsLater ? 'ACTIVE' : 'TERMINATED',
          endDate: isoDateToDate(input.endDate),
          terminatedAt: endsLater ? null : isoDateToDate(input.endDate),
          terminationReason: input.reason,
        },
      });
      if (lease.status === 'ACTIVE' && !endsLater) {
        await tx.unit.update({ where: { id: lease.unitId }, data: { status: 'AVAILABLE' } });
      }

      const voided = await tx.invoice.updateMany({
        where: {
          leaseId: id,
          kind: 'RENT',
          status: 'OPEN',
          paidAmount: 0,
          period: { gt: periodOf(input.endDate) },
        },
        data: { status: 'VOID', voidedAt: new Date(), voidReason: 'Contrato terminado' },
      });

      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'lease.terminated',
          entityType: 'lease',
          entityId: id,
          metadata: { endDate: input.endDate, endsLater, reason: input.reason ?? null, voidedInvoices: voided.count },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return presentLease(updated);
    });
  }

  // ---------- internos ----------

  private async activateInTx(tx: Tx, ctx: OrgContext, id: string) {
    const lease = await tx.lease.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: { tenant: true, unit: true },
    });
    if (!lease) throw notFound('Contrato', 'LEASE_NOT_FOUND');
    if (lease.status !== 'DRAFT') throw conflict('LEASE_NOT_DRAFT', 'Só contratos em rascunho podem ser ativados');
    if (lease.unit.status === 'MAINTENANCE' || lease.unit.status === 'UNAVAILABLE') {
      throw conflict('UNIT_UNAVAILABLE', 'A unidade está indisponível ou em manutenção');
    }

    const activeOnUnit = await tx.lease.count({ where: { unitId: lease.unitId, status: 'ACTIVE' } });
    if (activeOnUnit) throw conflict('LEASE_UNIT_OCCUPIED', 'Esta unidade já tem um contrato ativo');

    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const activated = await tx.lease.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: { tenant: true },
    });
    await tx.unit.update({ where: { id: lease.unitId }, data: { status: 'OCCUPIED' } });

    if (activated.depositAmount > 0) {
      const today = todayIn(org.timezone);
      const start = dateToIsoDate(activated.startDate);
      await this.billing.issueInvoice(tx, org, activated, {
        kind: 'DEPOSIT',
        description: translator(pickLocale(activated.tenant.locale, org.locale))('Caução'),
        issueDate: today,
        dueDate: start > today ? start : today,
        amount: activated.depositAmount,
      });
    }
    await this.billing.generateRentInvoices(tx, org, activated, todayIn(org.timezone));

    await this.audit.log(
      {
        organizationId: ctx.organizationId,
        actorType: 'USER',
        actorId: ctx.userId,
        action: 'lease.activated',
        entityType: 'lease',
        entityId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );
    const { tenant: _t, ...rest } = activated;
    return presentLease(rest);
  }

  /** O índice parcial leases_one_active_per_unit protege contra corridas. */
  private mapUnitOccupied(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('LEASE_UNIT_OCCUPIED', 'Esta unidade já tem um contrato ativo');
    }
    return err;
  }
}
