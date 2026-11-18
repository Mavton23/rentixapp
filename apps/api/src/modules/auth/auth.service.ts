import type { Locale } from '@rentix/shared';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  AcceptMemberInviteInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  MemberRole,
  RegisterInput,
  ResetPasswordInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.module';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from './token.service';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../../common/utils/crypto';
import { uniqueSlug } from '../../common/utils/slug';
import { badRequest, conflict, fieldError, forbidden } from '../../common/utils/errors';
import type { RequestMeta } from '../../common/auth-context';
import type { User } from '../../generated/prisma/client';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export interface StaffSessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: { id: string; name: string; email: string; phone: string | null; platformRole: string; locale: 'pt' | 'en' | null };
  organization: { id: string; name: string; role: MemberRole; status: 'ACTIVE' | 'SUSPENDED' } | null;
  memberships: { organizationId: string; name: string; role: MemberRole }[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly plans: PlansService,
  ) {}

  /** Cria a conta, a organização (com o utilizador como OWNER) e o período experimental. */
  async register(input: RegisterInput, meta: RequestMeta, locale: Locale = 'pt'): Promise<StaffSessionResult> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { phone: input.phone }] },
      select: { email: true },
    });
    if (existing) {
      throw existing.email === input.email
        ? conflict('EMAIL_TAKEN', 'Este email já está registado')
        : conflict('PHONE_TAKEN', 'Este telefone já está registado');
    }

    const passwordHash = await hashPassword(input.password);
    const orgName = input.organizationName ?? input.name;

    const { user, orgId } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email: input.email, phone: input.phone, passwordHash, lastLoginAt: new Date(), locale },
      });
      const org = await tx.organization.create({
        data: {
          name: orgName,
          slug: uniqueSlug(orgName),
          email: input.email,
          phone: input.phone,
          locale,
          memberships: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      await this.plans.startSubscription(tx, org.id, { trial: true });
      await this.audit.log(
        {
          organizationId: org.id,
          actorType: 'USER',
          actorId: user.id,
          action: 'auth.registered',
          entityType: 'user',
          entityId: user.id,
          ...meta,
        },
        tx,
      );
      await this.notifications.enqueue(
        {
          template: 'WELCOME',
          channel: 'EMAIL',
          recipient: user.email,
          userId: user.id,
          organizationId: org.id,
          data: { name: user.name, organizationName: org.name, appUrl: this.config.get('WEB_URL') },
        },
        tx,
      );
      return { user, orgId: org.id };
    });

    return this.issueSession(user, orgId, meta);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<StaffSessionResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Compara sempre (mesmo sem utilizador) para não revelar quais emails existem.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email ou senha incorretos' });
    }
    if (user.status !== 'ACTIVE') {
      throw forbidden('ACCOUNT_SUSPENDED', 'Conta suspensa. Contacte o suporte.');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorType: 'USER', actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ...meta });

    const first = await this.prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return this.issueSession(user, first?.organizationId ?? null, meta);
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<StaffSessionResult> {
    const { session, refreshToken } = await this.tokens.rotate(rawToken, 'USER', meta);
    const user = await this.prisma.user.findUnique({ where: { id: session.subjectId } });
    if (!user || user.status !== 'ACTIVE') {
      await this.tokens.revokeAll('USER', session.subjectId);
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Sessão expirada. Entre novamente.' });
    }
    return this.buildResult(user, session.organizationId, refreshToken);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.tokens.revoke(rawToken);
  }

  /** Muda a organização ativa da sessão (para quem pertence a várias). */
  async switchOrganization(
    userId: string,
    organizationId: string,
    rawToken: string | undefined,
    meta: RequestMeta,
  ): Promise<StaffSessionResult> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership) throw forbidden('NOT_A_MEMBER', 'Não pertence a esta organização');

    const { session, refreshToken } = await this.tokens.rotate(rawToken, 'USER', meta, organizationId);
    if (session.subjectId !== userId) throw new UnauthorizedException();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.buildResult(user, organizationId, refreshToken);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        platformRole: true,
        locale: true,
        createdAt: true,
        memberships: {
          select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return user;
  }

  /** Idioma da conta: interface, emails e SMS. */
  async setLocale(userId: string, locale: Locale) {
    await this.prisma.user.update({ where: { id: userId }, data: { locale } });
    return { locale };
  }

  /** Resposta idêntica exista ou não o email. */
  async forgotPassword(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE') return;

    const token = randomToken();
    await this.prisma.$transaction(async (tx) => {
      // Invalida pedidos anteriores ainda ativos.
      await tx.passwordResetToken.updateMany({
        where: { subjectType: 'USER', subjectId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          subjectType: 'USER',
          subjectId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      await this.notifications.enqueue(
        {
          template: 'STAFF_PASSWORD_RESET',
          channel: 'EMAIL',
          recipient: user.email,
          userId: user.id,
          data: {
            name: user.name,
            resetUrl: `${this.config.get('WEB_URL')}/redefinir-senha?token=${encodeURIComponent(token)}`,
          },
        },
        tx,
      );
      await this.audit.log(
        { actorType: 'USER', actorId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, ...meta },
        tx,
      );
    });
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!record || record.subjectType !== 'USER' || record.usedAt || record.expiresAt < new Date()) {
      throw forbidden('INVALID_RESET_TOKEN', 'Link inválido ou expirado. Peça um novo.');
    }
    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw forbidden('INVALID_RESET_TOKEN', 'Link inválido ou expirado. Peça um novo.');
      await tx.user.update({ where: { id: record.subjectId }, data: { passwordHash } });
      await this.tokens.revokeAll('USER', record.subjectId, tx);
      await this.audit.log(
        { actorType: 'USER', actorId: record.subjectId, action: 'auth.password_reset', entityType: 'user', entityId: record.subjectId, ...meta },
        tx,
      );
    });
  }

  async changePassword(userId: string, input: ChangePasswordInput, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new ForbiddenException({ code: 'WRONG_PASSWORD', message: 'A senha atual está incorreta' });
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.tokens.revokeAll('USER', userId, tx);
      await this.audit.log(
        { actorType: 'USER', actorId: userId, action: 'auth.password_changed', entityType: 'user', entityId: userId, ...meta },
        tx,
      );
    });
  }

  // ---------- Convites para a equipa ----------

  private async findValidMemberInvite(token: string) {
    const invite = await this.prisma.memberInvite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: { select: { id: true, name: true, status: true } } },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) {
      throw badRequest('INVITE_INVALID', 'Este convite já não é válido. Peça um novo a quem o convidou.');
    }
    return invite;
  }

  /** Para a página do convite: a quem é, de que organização, e se a pessoa já tem conta. */
  async previewMemberInvite(token: string) {
    const invite = await this.findValidMemberInvite(token);
    const [inviter, user] = await Promise.all([
      invite.invitedById ? this.prisma.user.findUnique({ where: { id: invite.invitedById }, select: { name: true } }) : null,
      this.prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } }),
    ]);
    return {
      organizationName: invite.organization.name,
      email: invite.email,
      role: invite.role,
      invitedBy: inviter?.name ?? null,
      hasAccount: !!user,
    };
  }

  /**
   * Aceita o convite e entra. Sem conta: cria-a com o email do convite. Com conta: exige a
   * senha dela (um convite nunca dá acesso a uma conta alheia).
   */
  async acceptMemberInvite(input: AcceptMemberInviteInput, meta: RequestMeta): Promise<StaffSessionResult> {
    const invite = await this.findValidMemberInvite(input.token);
    const existing = await this.prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      if (!(await verifyPassword(input.password, existing.passwordHash))) {
        throw forbidden('ACCOUNT_EXISTS_WRONG_PASSWORD', 'Já tem conta no Rentix com este email. Use a sua senha atual.');
      }
      if (existing.status !== 'ACTIVE') throw forbidden('ACCOUNT_SUSPENDED', 'Conta suspensa. Contacte o suporte.');
    } else if (!input.name) {
      throw fieldError('name', 'Indique o seu nome');
    }
    if (!existing && input.phone && (await this.prisma.user.findUnique({ where: { phone: input.phone } }))) {
      throw conflict('PHONE_TAKEN', 'Este telefone já está associado a outra conta');
    }
    const passwordHash = existing ? null : await hashPassword(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const used = await tx.memberInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (used.count !== 1) throw badRequest('INVITE_INVALID', 'Este convite já não é válido.');
      const user =
        existing ??
        (await tx.user.create({
          data: { name: input.name!, email: invite.email, phone: input.phone, passwordHash: passwordHash!, emailVerifiedAt: new Date(), lastLoginAt: new Date() },
        }));
      const already = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.id } },
      });
      if (!already) {
        await tx.membership.create({ data: { organizationId: invite.organizationId, userId: user.id, role: invite.role } });
      }
      await this.audit.log(
        {
          organizationId: invite.organizationId,
          actorType: 'USER',
          actorId: user.id,
          action: 'member.invite_accepted',
          entityType: 'member_invite',
          entityId: invite.id,
          metadata: { newAccount: !existing },
          ...meta,
        },
        tx,
      );
      return user;
    });
    return this.issueSession(user, invite.organizationId, meta);
  }

  // ---------- internos ----------

  private async issueSession(user: User, organizationId: string | null, meta: RequestMeta) {
    const { refreshToken } = await this.tokens.createSession('USER', user.id, organizationId, meta);
    return this.buildResult(user, organizationId, refreshToken);
  }

  private async buildResult(
    user: User,
    organizationId: string | null,
    refreshToken: string,
  ): Promise<StaffSessionResult> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id },
      include: { organization: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // Se a organização da sessão deixou de existir/ser acessível, usa a primeira disponível.
    const active =
      memberships.find((m) => m.organizationId === organizationId) ?? memberships[0] ?? null;

    const accessToken = await this.tokens.signStaffAccess({
      sub: user.id,
      org: active?.organizationId ?? null,
      role: active?.role ?? null,
      prole: user.platformRole,
    });

    return {
      accessToken,
      expiresIn: this.tokens.accessTtl,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, platformRole: user.platformRole, locale: (user.locale as 'pt' | 'en' | null) ?? null },
      organization: active
        ? { id: active.organizationId, name: active.organization.name, role: active.role, status: active.organization.status }
        : null,
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        name: m.organization.name,
        role: m.role,
      })),
    };
  }
}
