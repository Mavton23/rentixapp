import { Injectable } from '@nestjs/common';
import type { AddMemberInput, MemberRole, UpdateOrganizationInput } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.module';
import type { OrgContext, RequestMeta } from '../../common/auth-context';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import { uniqueSlug } from '../../common/utils/slug';

const INVITE_DAYS = 7;
const ROLE_LABEL: Record<MemberRole, string> = {
  OWNER: 'proprietário',
  MANAGER: 'gestor',
  ACCOUNTANT: 'contabilista',
  VIEWER: 'consulta',
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async getCurrent(ctx: OrgContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      include: { subscription: { include: { plan: { select: { code: true, name: true } } } } },
    });
    const limits = await this.plans.limitsFor(ctx.organizationId);
    return { ...org, limits };
  }

  async update(ctx: OrgContext, input: UpdateOrganizationInput) {
    const org = await this.prisma.organization.update({
      where: { id: ctx.organizationId },
      data: input,
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: ctx.organizationId,
      metadata: { fields: Object.keys(input) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return org;
  }

  /** Criar mais uma organização (ex.: um gestor que também administra imóveis próprios). */
  async create(userId: string, name: string, meta: RequestMeta) {
    // Organizações adicionais começam no Grátis (o período de teste é só o da primeira).
    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name, slug: uniqueSlug(name), memberships: { create: { userId, role: 'OWNER' } } },
      });
      await this.plans.startSubscription(tx, created.id, { trial: false });
      return created;
    });
    await this.audit.log({
      organizationId: org.id,
      actorType: 'USER',
      actorId: userId,
      action: 'organization.created',
      entityType: 'organization',
      entityId: org.id,
      ...meta,
    });
    return org;
  }

  listMembers(ctx: OrgContext) {
    return this.prisma.membership.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Junta alguém à equipa. Se já tem conta no Rentix entra logo; senão recebe um convite por
   * email (válido 7 dias) para criar a conta. Os convites pendentes contam para o limite do plano.
   */
  async addMember(ctx: OrgContext, input: AddMemberInput): Promise<{ status: 'ADDED' | 'INVITED' }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await this.invite(ctx, input);
      return { status: 'INVITED' };
    }

    await this.prisma.$transaction(async (tx) => {
      await this.plans.assertCanAddMember(ctx.organizationId, tx);
      const exists = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: ctx.organizationId, userId: user.id } },
      });
      if (exists) throw conflict('ALREADY_MEMBER', 'Este utilizador já faz parte da equipa');
      const m = await tx.membership.create({
        data: { organizationId: ctx.organizationId, userId: user.id, role: input.role },
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'member.added',
          entityType: 'membership',
          entityId: m.id,
          metadata: { userId: user.id, role: input.role },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
    return { status: 'ADDED' };
  }

  private async invite(ctx: OrgContext, input: AddMemberInput) {
    const token = randomToken();
    const now = new Date();
    const { org, inviter } = await this.prisma.$transaction(async (tx) => {
      // Um novo convite substitui o anterior para o mesmo email (que deixa de funcionar).
      await tx.memberInvite.updateMany({
        where: { organizationId: ctx.organizationId, email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.plans.assertCanAddMember(ctx.organizationId, tx);
      const invite = await tx.memberInvite.create({
        data: {
          organizationId: ctx.organizationId,
          email: input.email,
          role: input.role,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
          invitedById: ctx.userId,
        },
      });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'member.invited',
          entityType: 'member_invite',
          entityId: invite.id,
          metadata: { email: input.email, role: input.role },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      const inviter = await tx.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      return { org, inviter };
    });
    await this.notifications.enqueue({
      organizationId: ctx.organizationId,
      channel: 'EMAIL',
      recipient: input.email,
      template: 'MEMBER_INVITE',
      data: {
        organizationName: org.name,
        invitedBy: inviter.name,
        role: ROLE_LABEL[input.role],
        inviteUrl: `${this.config.get('WEB_URL')}/convite-equipa?token=${encodeURIComponent(token)}`,
        expiresDays: INVITE_DAYS,
      },
    });
  }

  listInvites(ctx: OrgContext) {
    return this.prisma.memberInvite.findMany({
      where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(ctx: OrgContext, id: string) {
    const res = await this.prisma.memberInvite.updateMany({
      where: { id, organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!res.count) throw notFound('Convite', 'INVITE_NOT_FOUND');
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'member.invite_revoked',
      entityType: 'member_invite',
      entityId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  async changeRole(ctx: OrgContext, userId: string, role: MemberRole) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: ctx.organizationId, userId } },
      });
      if (!m) throw notFound('Membro', 'MEMBER_NOT_FOUND');
      if (m.role === 'OWNER' && role !== 'OWNER') await this.assertNotLastOwner(ctx.organizationId, tx);
      const updated = await tx.membership.update({ where: { id: m.id }, data: { role } });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'member.role_changed',
          entityType: 'membership',
          entityId: m.id,
          metadata: { from: m.role, to: role },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
      return updated;
    });
  }

  async removeMember(ctx: OrgContext, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: ctx.organizationId, userId } },
      });
      if (!m) throw notFound('Membro', 'MEMBER_NOT_FOUND');
      if (m.role === 'OWNER') await this.assertNotLastOwner(ctx.organizationId, tx);
      await tx.membership.delete({ where: { id: m.id } });
      await this.audit.log(
        {
          organizationId: ctx.organizationId,
          actorType: 'USER',
          actorId: ctx.userId,
          action: 'member.removed',
          entityType: 'membership',
          entityId: m.id,
          metadata: { userId },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  private async assertNotLastOwner(organizationId: string, tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) {
    const owners = await tx.membership.count({ where: { organizationId, role: 'OWNER' } });
    if (owners <= 1) throw badRequest('LAST_OWNER', 'A organização precisa de pelo menos um proprietário');
  }
}
