import { Injectable } from '@nestjs/common';
import type {
  CreatePropertyInput,
  PaginationInput,
  PropertyType,
  UnitInput,
  UpdatePropertyInput,
  UpdateUnitInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.module';
import type { OrgContext } from '../../common/auth-context';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import type { Prisma } from '../../generated/prisma/client';

type PropertyQuery = PaginationInput & { type?: PropertyType; city?: string };

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
  ) {}

  async list(ctx: OrgContext, q: PropertyQuery) {
    const where: Prisma.PropertyWhereInput = {
      organizationId: ctx.organizationId,
      archivedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { street: { contains: q.search, mode: 'insensitive' } },
              { neighbourhood: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: 'desc' },
        include: {
          units: {
            where: { archivedAt: null },
            select: { id: true, label: true, status: true, rentAmount: true },
            orderBy: { label: 'asc' },
          },
        },
      }),
      this.prisma.property.count({ where }),
    ]);
    const data = rows.map((p) => ({
      ...p,
      stats: {
        units: p.units.length,
        occupied: p.units.filter((u) => u.status === 'OCCUPIED').length,
      },
    }));
    return paginated(data, total, q);
  }

  async get(ctx: OrgContext, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: {
        units: {
          where: { archivedAt: null },
          orderBy: { label: 'asc' },
          include: {
            leases: {
              where: { status: 'ACTIVE' },
              select: {
                id: true,
                rentAmount: true,
                currency: true,
                startDate: true,
                endDate: true,
                tenant: { select: { id: true, fullName: true, phone: true } },
              },
            },
          },
        },
      },
    });
    if (!property) throw notFound('Imóvel', 'PROPERTY_NOT_FOUND');
    return property;
  }

  async create(ctx: OrgContext, input: CreatePropertyInput) {
    const units: UnitInput[] = input.units?.length ? input.units : [{ label: 'Principal' }];
    this.assertUniqueLabels(units);

    return this.prisma.$transaction(async (tx) => {
      await this.plans.assertCanAddUnits(ctx.organizationId, units.length, tx);
      const { units: _u, ...data } = input;
      const property = await tx.property.create({
        data: {
          ...data,
          organizationId: ctx.organizationId,
          units: {
            create: units.map((u) => ({ ...u, organizationId: ctx.organizationId })),
          },
        },
        include: { units: true },
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'property.created',
          entityType: 'property',
          entityId: property.id,
          metadata: { units: units.length },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return property;
    });
  }

  async update(ctx: OrgContext, id: string, input: UpdatePropertyInput) {
    await this.ensureProperty(ctx, id);
    const property = await this.prisma.property.update({ where: { id }, data: input });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'property.updated',
      entityType: 'property',
      entityId: id,
      metadata: { fields: Object.keys(input) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return property;
  }

  /** Arquiva (não apaga): o histórico de contratos e pagamentos mantém-se. */
  async archive(ctx: OrgContext, id: string) {
    await this.ensureProperty(ctx, id);
    const active = await this.prisma.lease.count({
      where: { organizationId: ctx.organizationId, status: 'ACTIVE', unit: { propertyId: id } },
    });
    if (active > 0) {
      throw conflict('PROPERTY_HAS_ACTIVE_LEASES', 'Termine os contratos ativos antes de arquivar o imóvel');
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.unit.updateMany({ where: { propertyId: id, archivedAt: null }, data: { archivedAt: now } }),
      this.prisma.property.update({ where: { id }, data: { archivedAt: now } }),
    ]);
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'property.archived',
      entityType: 'property',
      entityId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  // ---------- Unidades ----------

  async addUnit(ctx: OrgContext, propertyId: string, input: UnitInput) {
    await this.ensureProperty(ctx, propertyId);
    return this.prisma.$transaction(async (tx) => {
      await this.plans.assertCanAddUnits(ctx.organizationId, 1, tx);
      const unit = await tx.unit.create({
        data: { ...input, propertyId, organizationId: ctx.organizationId },
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'unit.created',
          entityType: 'unit',
          entityId: unit.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return unit;
    });
  }

  async updateUnit(ctx: OrgContext, unitId: string, input: UpdateUnitInput) {
    const unit = await this.ensureUnit(ctx, unitId);
    if (input.status && input.status !== unit.status) {
      const hasActive = await this.prisma.lease.count({ where: { unitId, status: 'ACTIVE' } });
      if (hasActive && input.status !== 'OCCUPIED') {
        throw conflict('UNIT_HAS_ACTIVE_LEASE', 'A unidade tem um contrato ativo');
      }
      if (!hasActive && input.status === 'OCCUPIED') {
        throw badRequest('UNIT_NO_LEASE', 'Para marcar como ocupada, crie um contrato');
      }
    }
    return this.prisma.unit.update({ where: { id: unitId }, data: input });
  }

  async archiveUnit(ctx: OrgContext, unitId: string) {
    await this.ensureUnit(ctx, unitId);
    const active = await this.prisma.lease.count({ where: { unitId, status: 'ACTIVE' } });
    if (active) throw conflict('UNIT_HAS_ACTIVE_LEASE', 'Termine o contrato ativo antes de arquivar');
    await this.prisma.unit.update({ where: { id: unitId }, data: { archivedAt: new Date() } });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'unit.archived',
      entityType: 'unit',
      entityId: unitId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  /** Unidades disponíveis (para o formulário de novo contrato). */
  availableUnits(ctx: OrgContext) {
    return this.prisma.unit.findMany({
      where: { organizationId: ctx.organizationId, archivedAt: null, status: 'AVAILABLE' },
      select: {
        id: true,
        label: true,
        rentAmount: true,
        property: { select: { id: true, name: true, street: true, city: true } },
      },
      orderBy: [{ property: { name: 'asc' } }, { label: 'asc' }],
    });
  }

  // ---------- internos ----------

  private async ensureProperty(ctx: OrgContext, id: string) {
    const p = await this.prisma.property.findFirst({
      where: { id, organizationId: ctx.organizationId, archivedAt: null },
    });
    if (!p) throw notFound('Imóvel', 'PROPERTY_NOT_FOUND');
    return p;
  }

  private async ensureUnit(ctx: OrgContext, id: string) {
    const u = await this.prisma.unit.findFirst({
      where: { id, organizationId: ctx.organizationId, archivedAt: null },
    });
    if (!u) throw notFound('Unidade', 'UNIT_NOT_FOUND');
    return u;
  }

  private assertUniqueLabels(units: UnitInput[]) {
    const labels = units.map((u) => u.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      throw badRequest('DUPLICATE_UNIT_LABEL', 'Cada unidade precisa de um nome diferente');
    }
  }
}
