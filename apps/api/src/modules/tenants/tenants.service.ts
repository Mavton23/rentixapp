import { Injectable } from '@nestjs/common';
import type { CreateTenantInput, PaginationInput, UpdateTenantInput } from '@rentix/shared';
import { isoDateToDate } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../../config/app-config.service';
import type { OrgContext } from '../../common/auth-context';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { Prisma } from '../../generated/prisma/client';

const INVITE_TTL_MS = 7 * 86_400_000;

type TenantQuery = PaginationInput & { hasActiveLease?: boolean };

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async list(ctx: OrgContext, q: TenantQuery) {
    const where: Prisma.TenantWhereInput = {
      organizationId: ctx.organizationId,
      archivedAt: null,
      ...(q.hasActiveLease === true ? { leases: { some: { status: 'ACTIVE' } } } : {}),
      ...(q.hasActiveLease === false ? { leases: { none: { status: 'ACTIVE' } } } : {}),
      ...(q.search
        ? {
            OR: [
              { fullName: { contains: q.search, mode: 'insensitive' } },
              { phone: { contains: q.search.replace(/\s/g, '') } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { idDocumentNumber: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        ...pageArgs(q),
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          idDocumentType: true,
          idDocumentNumber: true,
          accountId: true,
          createdAt: true,
          leases: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              rentAmount: true,
              currency: true,
              unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } },
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    const data = rows.map(({ accountId, ...t }) => ({ ...t, portalEnabled: accountId !== null }));
    return paginated(data, total, q);
  }

  async get(ctx: OrgContext, id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        leases: {
          orderBy: { startDate: 'desc' },
          include: { unit: { select: { id: true, label: true, property: { select: { id: true, name: true } } } } },
        },
      },
    });
    if (!tenant) throw notFound('Inquilino', 'TENANT_NOT_FOUND');

    const open = await this.prisma.invoice.aggregate({
      where: { tenantId: id, organizationId: ctx.organizationId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
      _sum: { amount: true, paidAmount: true },
    });
    const { accountId, ...rest } = tenant;
    return {
      ...rest,
      portalEnabled: accountId !== null,
      balance: (open._sum.amount ?? 0) - (open._sum.paidAmount ?? 0),
    };
  }

  async create(ctx: OrgContext, input: CreateTenantInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.plans.assertCanAddTenant(ctx.organizationId, tx);
      try {
        const tenant = await tx.tenant.create({
          data: {
            ...input,
            birthDate: input.birthDate ? isoDateToDate(input.birthDate) : null,
            organizationId: ctx.organizationId,
          },
        });
        await this.audit.log(
          {
            organizationId: ctx.organizationId,
            actorType: 'USER',
            actorId: ctx.userId,
            action: 'tenant.created',
            entityType: 'tenant',
            entityId: tenant.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
        return tenant;
      } catch (err) {
        throw this.mapDuplicate(err);
      }
    });
  }

  async update(ctx: OrgContext, id: string, input: UpdateTenantInput) {
    await this.ensure(ctx, id);
    const { birthDate, ...rest } = input;
    try {
      const tenant = await this.prisma.tenant.update({
        where: { id },
        data: {
          ...rest,
          ...(birthDate !== undefined ? { birthDate: birthDate ? isoDateToDate(birthDate) : null } : {}),
        },
      });
      await this.audit.log({
        organizationId: ctx.organizationId,
        actorType: 'USER',
        actorId: ctx.userId,
        action: 'tenant.updated',
        entityType: 'tenant',
        entityId: id,
        metadata: { fields: Object.keys(input) },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return tenant;
    } catch (err) {
      throw this.mapDuplicate(err);
    }
  }

  async archive(ctx: OrgContext, id: string) {
    await this.ensure(ctx, id);
    const active = await this.prisma.lease.count({ where: { tenantId: id, status: 'ACTIVE' } });
    if (active) throw conflict('TENANT_HAS_ACTIVE_LEASE', 'Termine o contrato ativo antes de arquivar o inquilino');
    await this.prisma.tenant.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'tenant.archived',
      entityType: 'tenant',
      entityId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * Envia convite para o portal do inquilino (email e/ou SMS).
   * Convites anteriores ainda válidos são invalidados.
   */
  async invite(ctx: OrgContext, id: string) {
    const tenant = await this.ensure(ctx, id);
    if (!tenant.email && !tenant.phone) {
      throw badRequest('TENANT_NO_CONTACT', 'O inquilino precisa de email ou telefone para receber o convite');
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.tenantInvite.updateMany({
        where: { tenantId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.tenantInvite.create({
        data: { tenantId: id, tokenHash: sha256(token), expiresAt, createdById: ctx.userId },
      });
      await this.notifications.notifyContact(
        { email: tenant.email, phone: tenant.phone },
        {
          template: 'TENANT_INVITE',
          organizationId: ctx.organizationId,
          tenantId: id,
          data: {
            tenantName: tenant.fullName,
            organizationName: org.name,
            inviteUrl: `${this.config.get('WEB_URL')}/portal/convite?token=${encodeURIComponent(token)}`,
          },
        },
        tx,
      );
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'tenant.invited',
          entityType: 'tenant',
          entityId: id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
    return { expiresAt };
  }

  private async ensure(ctx: OrgContext, id: string) {
    const t = await this.prisma.tenant.findFirst({
      where: { id, organizationId: ctx.organizationId, archivedAt: null },
    });
    if (!t) throw notFound('Inquilino', 'TENANT_NOT_FOUND');
    return t;
  }

  private mapDuplicate(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('TENANT_DUPLICATE_DOCUMENT', 'Já existe um inquilino com este documento de identificação');
    }
    return err;
  }
}
