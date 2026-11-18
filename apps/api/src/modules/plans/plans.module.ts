import { Controller, Get, Global, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FREE_PLAN_CODE } from '@rentix/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { Public } from '../../common/decorators/auth.decorators';
import { forbidden } from '../../common/utils/errors';

export interface PlanLimits {
  planCode: string | null;
  maxUnits: number | null;
  maxTenants: number | null;
  maxMembers: number | null;
  /** MB para ficheiros (nulo = sem limite). */
  maxStorageMb: number | null;
}

/** Último recurso, se nem o plano Grátis existir na base de dados. */
const NO_SUBSCRIPTION_LIMITS: PlanLimits = { planCode: null, maxUnits: 3, maxTenants: 3, maxMembers: 1, maxStorageMb: 200 };

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Cria a subscrição de uma organização nova: período de teste num plano pago (primeira
   * organização de quem se regista) ou diretamente o Grátis.
   */
  async startSubscription(tx: Tx, organizationId: string, opts: { trial: boolean }, now = new Date()): Promise<void> {
    const days = this.config.get('TRIAL_DAYS');
    const trialCode = this.config.get('TRIAL_PLAN_CODE');
    const trialPlan =
      opts.trial && days > 0 && trialCode ? await tx.plan.findFirst({ where: { code: trialCode, isActive: true } }) : null;
    if (trialPlan) {
      await tx.subscription.create({
        data: {
          organizationId,
          planId: trialPlan.id,
          status: 'TRIALING',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + days * 86_400_000),
        },
      });
      return;
    }
    const free = await tx.plan.findUnique({ where: { code: FREE_PLAN_CODE } });
    if (free) await tx.subscription.create({ data: { organizationId, planId: free.id, status: 'ACTIVE' } });
  }

  /** Recusa um envio que ultrapasse o espaço do plano. */
  async assertCanStore(organizationId: string, bytes: number): Promise<void> {
    const { maxStorageMb } = await this.limitsFor(organizationId);
    if (maxStorageMb === null) return;
    const used = (await this.prisma.storedFile.aggregate({ where: { organizationId }, _sum: { size: true } }))._sum.size ?? 0;
    if (used + bytes > maxStorageMb * 1024 * 1024) {
      throw forbidden('PLAN_LIMIT_STORAGE', `O seu plano inclui ${maxStorageMb >= 1024 ? `${maxStorageMb / 1024} GB` : `${maxStorageMb} MB`} para ficheiros e já não há espaço. Apague ficheiros antigos ou mude de plano.`);
    }
  }

  /** Quanto a organização está a usar dos limites do plano. */
  async usage(organizationId: string) {
    const [units, tenants, members, invites, storage] = await Promise.all([
      this.prisma.unit.count({ where: { organizationId, archivedAt: null } }),
      this.prisma.tenant.count({ where: { organizationId, archivedAt: null } }),
      this.prisma.membership.count({ where: { organizationId } }),
      this.prisma.memberInvite.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.prisma.storedFile.aggregate({ where: { organizationId }, _sum: { size: true } }),
    ]);
    return { units, tenants, members, pendingInvites: invites, storageBytes: storage._sum.size ?? 0 };
  }

  listPublic() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        name: true,
        description: true,
        monthlyPrice: true,
        annualPrice: true,
        currency: true,
        maxUnits: true,
        maxTenants: true,
        maxMembers: true,
        maxStorageMb: true,
        features: true,
        sortOrder: true,
      },
    });
  }

  async limitsFor(organizationId: string, tx?: Tx): Promise<PlanLimits> {
    const sub = await (tx ?? this.prisma).subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    // Um teste que já acabou conta como Grátis mesmo antes de o cron o processar.
    const trialOver = sub?.status === 'TRIALING' && (!sub.currentPeriodEnd || sub.currentPeriodEnd <= new Date());
    if (!sub || sub.status === 'CANCELED' || trialOver) {
      const free = await (tx ?? this.prisma).plan.findUnique({ where: { code: FREE_PLAN_CODE } });
      return free
        ? { planCode: free.code, maxUnits: free.maxUnits, maxTenants: free.maxTenants, maxMembers: free.maxMembers, maxStorageMb: free.maxStorageMb }
        : NO_SUBSCRIPTION_LIMITS;
    }
    return {
      planCode: sub.plan.code,
      maxUnits: sub.plan.maxUnits,
      maxTenants: sub.plan.maxTenants,
      maxMembers: sub.plan.maxMembers,
      maxStorageMb: sub.plan.maxStorageMb,
    };
  }

  async assertCanAddUnits(organizationId: string, adding: number, tx?: Tx): Promise<void> {
    const { maxUnits } = await this.limitsFor(organizationId, tx);
    if (maxUnits === null) return;
    const count = await (tx ?? this.prisma).unit.count({ where: { organizationId, archivedAt: null } });
    if (count + adding > maxUnits) {
      throw forbidden('PLAN_LIMIT_UNITS', `O seu plano permite até ${maxUnits} unidades. Faça upgrade para adicionar mais.`);
    }
  }

  async assertCanAddTenant(organizationId: string, tx?: Tx): Promise<void> {
    const { maxTenants } = await this.limitsFor(organizationId, tx);
    if (maxTenants === null) return;
    const count = await (tx ?? this.prisma).tenant.count({ where: { organizationId, archivedAt: null } });
    if (count + 1 > maxTenants) {
      throw forbidden('PLAN_LIMIT_TENANTS', `O seu plano permite até ${maxTenants} inquilinos. Faça upgrade para adicionar mais.`);
    }
  }

  async assertCanAddMember(organizationId: string, tx?: Tx): Promise<void> {
    const { maxMembers } = await this.limitsFor(organizationId, tx);
    if (maxMembers === null) return;
    const db = tx ?? this.prisma;
    const count =
      (await db.membership.count({ where: { organizationId } })) +
      (await db.memberInvite.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }));
    if (count + 1 > maxMembers) {
      throw forbidden('PLAN_LIMIT_MEMBERS', `O seu plano permite até ${maxMembers} membros na equipa.`);
    }
  }
}

@ApiTags('Planos')
@Controller('plans')
class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get()
  list() {
    return this.plans.listPublic();
  }
}

@Global()
@Module({
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
