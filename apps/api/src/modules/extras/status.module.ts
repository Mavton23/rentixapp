import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  createIncidentSchema,
  incidentUpdateSchema,
  statusComponentSchema,
  updateStatusComponentSchema,
  type ComponentStatus,
  type CreateIncidentInput,
  type IncidentUpdateInput,
  type StatusComponentInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequireFeature } from '../features/features';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import { CurrentStaff, PlatformAdmin, Public } from '../../common/decorators/auth.decorators';
import type { StaffAuth } from '../../common/auth-context';
import { conflict, notFound } from '../../common/utils/errors';
import { Prisma } from '../../generated/prisma/client';

const SEVERITY: Record<ComponentStatus, number> = { OPERATIONAL: 0, DEGRADED: 1, PARTIAL_OUTAGE: 2, MAJOR_OUTAGE: 3 };
const HISTORY_DAYS = 30;

/** Estado geral = o pior estado entre os componentes. */
export function overallStatus(statuses: ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), 'OPERATIONAL');
}

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async publicStatus() {
    const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
    // A base de dados responde? Se não, nem chegaríamos aqui; o componente "API" reflete-o.
    const [components, active, recent] = await Promise.all([
      this.prisma.statusComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.incident.findMany({
        where: { status: { not: 'RESOLVED' } },
        orderBy: { startedAt: 'desc' },
        include: { components: { select: { id: true, name: true } }, updates: { orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.incident.findMany({
        where: { status: 'RESOLVED', resolvedAt: { gte: since } },
        orderBy: { startedAt: 'desc' },
        take: 20,
        include: { components: { select: { id: true, name: true } }, updates: { orderBy: { createdAt: 'desc' } } },
      }),
    ]);
    return {
      overall: overallStatus(components.map((c) => c.status as ComponentStatus)),
      components: components.map(({ id, name, description, status }) => ({ id, name, description, status })),
      activeIncidents: active,
      recentIncidents: recent,
      generatedAt: new Date(),
    };
  }

  createComponent(input: StatusComponentInput) {
    return this.write(() => this.prisma.statusComponent.create({ data: input }));
  }

  async updateComponent(id: string, input: Partial<StatusComponentInput>) {
    return this.write(() => this.prisma.statusComponent.update({ where: { id }, data: input }));
  }

  async deleteComponent(id: string) {
    await this.prisma.statusComponent.delete({ where: { id } });
  }

  async createIncident(admin: StaffAuth, input: CreateIncidentInput) {
    const incident = await this.prisma.$transaction(async (tx) => {
      const inc = await tx.incident.create({
        data: {
          title: input.title,
          impact: input.impact,
          components: { connect: input.componentIds.map((id) => ({ id })) },
          updates: { create: { status: 'INVESTIGATING', message: input.message } },
        },
        include: { components: true, updates: true },
      });
      if (input.componentStatus && input.componentIds.length) {
        await tx.statusComponent.updateMany({ where: { id: { in: input.componentIds } }, data: { status: input.componentStatus } });
      }
      return inc;
    });
    await this.audit.log({ actorType: 'USER', actorId: admin.userId, action: 'status.incident_created', entityType: 'incident', entityId: incident.id });
    return incident;
  }

  /** Nova atualização. Ao resolver, os componentes afetados voltam a "Operacional". */
  async addUpdate(admin: StaffAuth, id: string, input: IncidentUpdateInput) {
    const incident = await this.prisma.incident.findUnique({ where: { id }, include: { components: { select: { id: true } } } });
    if (!incident) throw notFound('Incidente', 'INCIDENT_NOT_FOUND');
    if (incident.status === 'RESOLVED') throw conflict('INCIDENT_RESOLVED', 'O incidente já está resolvido');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.incidentUpdate.create({ data: { incidentId: id, ...input } });
      const updated = await tx.incident.update({
        where: { id },
        data: { status: input.status, ...(input.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}) },
        include: { components: true, updates: { orderBy: { createdAt: 'desc' } } },
      });
      if (input.status === 'RESOLVED' && incident.components.length) {
        // Só repõe componentes que não estejam envolvidos noutro incidente aberto.
        const stillAffected = await tx.statusComponent.findMany({
          where: { id: { in: incident.components.map((c) => c.id) }, incidents: { some: { status: { not: 'RESOLVED' }, id: { not: id } } } },
          select: { id: true },
        });
        const busy = new Set(stillAffected.map((c) => c.id));
        await tx.statusComponent.updateMany({
          where: { id: { in: incident.components.map((c) => c.id).filter((c) => !busy.has(c)) } },
          data: { status: 'OPERATIONAL' },
        });
      }
      return updated;
    });
    await this.audit.log({
      actorType: 'USER',
      actorId: admin.userId,
      action: 'status.incident_updated',
      entityType: 'incident',
      entityId: id,
      metadata: { status: input.status },
    });
    return result;
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('COMPONENT_EXISTS', 'Já existe um componente com este nome');
      }
      throw err;
    }
  }
}

@ApiTags('Estado do sistema')
@SkipThrottle()
@RequireFeature('STATUS_PAGE')
@Controller('status')
export class StatusPublicController {
  constructor(private readonly status: StatusService) {}

  @Public()
  @Get()
  get() {
    return this.status.publicStatus();
  }
}

@ApiTags('Administração — estado')
@ApiBearerAuth()
@PlatformAdmin()
@RequireFeature('STATUS_PAGE')
@Controller('admin/status')
export class StatusAdminController {
  constructor(private readonly status: StatusService) {}

  @Post('components')
  @ApiZodBody(statusComponentSchema)
  createComponent(@Body(new ZodPipe(statusComponentSchema)) body: StatusComponentInput) {
    return this.status.createComponent(body);
  }

  @Patch('components/:id')
  @ApiZodBody(updateStatusComponentSchema)
  updateComponent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateStatusComponentSchema)) body: z.infer<typeof updateStatusComponentSchema>,
  ) {
    return this.status.updateComponent(id, body);
  }

  @Delete('components/:id')
  @HttpCode(204)
  async deleteComponent(@Param('id', ParseUUIDPipe) id: string) {
    await this.status.deleteComponent(id);
  }

  @Post('incidents')
  @ApiZodBody(createIncidentSchema)
  createIncident(@CurrentStaff() admin: StaffAuth, @Body(new ZodPipe(createIncidentSchema)) body: CreateIncidentInput) {
    return this.status.createIncident(admin, body);
  }

  @Post('incidents/:id/updates')
  @ApiZodBody(incidentUpdateSchema)
  addUpdate(
    @CurrentStaff() admin: StaffAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(incidentUpdateSchema)) body: IncidentUpdateInput,
  ) {
    return this.status.addUpdate(admin, id, body);
  }
}

@Module({
  controllers: [StatusPublicController, StatusAdminController],
  providers: [StatusService],
})
export class StatusModule {}
