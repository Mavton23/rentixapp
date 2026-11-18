import { Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  AcceptTenantInviteInput,
  ResetPasswordInput,
  TenantForgotPasswordInput,
  TenantLoginInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from '../auth/token.service';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../../common/utils/crypto';
import { forbidden } from '../../common/utils/errors';
import type { RequestMeta } from '../../common/auth-context';
import type { TenantAccount } from '../../generated/prisma/client';

const RESET_TTL_MS = 60 * 60 * 1000;

export interface TenantSessionResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  account: { id: string; email: string | null; phone: string | null; locale: 'pt' | 'en' | null };
}

const invalidInvite = () => forbidden('INVALID_INVITE', 'Convite inválido ou expirado. Peça um novo ao seu senhorio.');

/**
 * Autenticação do portal do inquilino.
 * Uma pessoa tem UMA conta (TenantAccount) mesmo que arrende a várias organizações;
 * cada convite liga a ficha do inquilino dessa organização à conta.
 */
@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async verifyInvite(token: string) {
    const invite = await this.findValidInvite(token);
    const { tenant } = invite;
    const existing = await this.findAccount(tenant.email, tenant.phone);
    return {
      tenantName: tenant.fullName,
      organizationName: tenant.organization.name,
      email: tenant.email,
      phone: tenant.phone,
      /** Se já tem conta, o portal pede a senha atual em vez de criar uma nova. */
      hasAccount: existing !== null,
    };
  }

  async acceptInvite(input: AcceptTenantInviteInput, meta: RequestMeta): Promise<TenantSessionResult> {
    const invite = await this.findValidInvite(input.token);
    const { tenant } = invite;
    const existing = await this.findAccount(tenant.email, tenant.phone);

    // Conta já existente: exigir a senha dela (um convite não pode sequestrar uma conta).
    if (existing && !(await verifyPassword(input.password, existing.passwordHash))) {
      throw forbidden('ACCOUNT_EXISTS_WRONG_PASSWORD', 'Já tem conta no portal. Entre com a sua senha atual.');
    }
    const passwordHash = existing ? null : await hashPassword(input.password);

    const account = await this.prisma.$transaction(async (tx) => {
      const used = await tx.tenantInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw invalidInvite();

      const account =
        existing ??
        (await tx.tenantAccount.create({
          data: { email: tenant.email, phone: tenant.phone, passwordHash: passwordHash! },
        }));
      await tx.tenant.update({ where: { id: tenant.id }, data: { accountId: account.id } });
      await this.audit.log(
        {
          organizationId: tenant.organizationId,
          actorType: 'TENANT',
          actorId: account.id,
          action: 'portal.invite_accepted',
          entityType: 'tenant',
          entityId: tenant.id,
          ...meta,
        },
        tx,
      );
      return account;
    });

    return this.issue(account, meta);
  }

  async login(input: TenantLoginInput, meta: RequestMeta): Promise<TenantSessionResult> {
    const { email, phone } = input.identifier;
    const account = await this.prisma.tenantAccount.findUnique({
      where: email ? { email } : { phone: phone! },
    });
    const ok = await verifyPassword(input.password, account?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!account || !ok) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Dados de acesso incorretos' });
    }
    if (account.status !== 'ACTIVE') throw forbidden('ACCOUNT_BLOCKED', 'Acesso bloqueado. Contacte o seu senhorio.');

    await this.prisma.tenantAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorType: 'TENANT', actorId: account.id, action: 'portal.login', entityType: 'tenant_account', entityId: account.id, ...meta });
    return this.issue(account, meta);
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<TenantSessionResult> {
    const { session, refreshToken } = await this.tokens.rotate(rawToken, 'TENANT', meta);
    const account = await this.prisma.tenantAccount.findUnique({ where: { id: session.subjectId } });
    if (!account || account.status !== 'ACTIVE') {
      await this.tokens.revokeAll('TENANT', session.subjectId);
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Sessão expirada. Entre novamente.' });
    }
    return {
      accessToken: await this.tokens.signTenantAccess(account.id),
      expiresIn: this.tokens.accessTtl,
      refreshToken,
      account: { id: account.id, email: account.email, phone: account.phone, locale: await this.accountLocale(account.id) },
    };
  }

  logout(rawToken: string | undefined) {
    return this.tokens.revoke(rawToken);
  }

  /** Envia link por email ou SMS, consoante o identificador. Resposta sempre igual. */
  async forgotPassword(input: TenantForgotPasswordInput, meta: RequestMeta): Promise<void> {
    const { email, phone } = input.identifier;
    const account = await this.prisma.tenantAccount.findUnique({
      where: email ? { email } : { phone: phone! },
      include: { tenants: { select: { fullName: true }, take: 1 } },
    });
    if (!account || account.status !== 'ACTIVE') return;

    const token = randomToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { subjectType: 'TENANT', subjectId: account.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          subjectType: 'TENANT',
          subjectId: account.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      });
      await this.notifications.enqueue(
        {
          template: 'TENANT_PASSWORD_RESET',
          channel: email ? 'EMAIL' : 'SMS',
          recipient: (email ?? phone)!,
          tenantId: null,
          locale: (await this.accountLocale(account.id)) ?? undefined,
          data: {
            name: account.tenants[0]?.fullName ?? '',
            resetUrl: `${this.config.get('WEB_URL')}/portal/redefinir-senha?token=${encodeURIComponent(token)}`,
          },
        },
        tx,
      );
      await this.audit.log(
        { actorType: 'TENANT', actorId: account.id, action: 'portal.password_reset_requested', entityType: 'tenant_account', entityId: account.id, ...meta },
        tx,
      );
    });
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!record || record.subjectType !== 'TENANT' || record.usedAt || record.expiresAt < new Date()) {
      throw forbidden('INVALID_RESET_TOKEN', 'Link inválido ou expirado. Peça um novo.');
    }
    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw forbidden('INVALID_RESET_TOKEN', 'Link inválido ou expirado. Peça um novo.');
      await tx.tenantAccount.update({ where: { id: record.subjectId }, data: { passwordHash } });
      await this.tokens.revokeAll('TENANT', record.subjectId, tx);
      await this.audit.log(
        { actorType: 'TENANT', actorId: record.subjectId, action: 'portal.password_reset', entityType: 'tenant_account', entityId: record.subjectId, ...meta },
        tx,
      );
    });
  }

  // ---------- internos ----------

  private async findValidInvite(token: string) {
    const invite = await this.prisma.tenantInvite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { tenant: { include: { organization: { select: { name: true } } } } },
    });
    if (!invite || invite.usedAt || invite.expiresAt < new Date() || invite.tenant.archivedAt) {
      throw invalidInvite();
    }
    return invite;
  }

  private findAccount(email: string | null, phone: string | null) {
    const or = [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])];
    if (!or.length) return Promise.resolve(null);
    return this.prisma.tenantAccount.findFirst({ where: { OR: or } });
  }

  private async issue(account: TenantAccount, meta: RequestMeta): Promise<TenantSessionResult> {
    const { refreshToken } = await this.tokens.createSession('TENANT', account.id, null, meta);
    return {
      accessToken: await this.tokens.signTenantAccess(account.id),
      expiresIn: this.tokens.accessTtl,
      refreshToken,
      account: { id: account.id, email: account.email, phone: account.phone, locale: await this.accountLocale(account.id) },
    };
  }

  /** Idioma escolhido pelo inquilino (guardado nas fichas de inquilino da conta). */
  private async accountLocale(accountId: string): Promise<'pt' | 'en' | null> {
    const t = await this.prisma.tenant.findFirst({ where: { accountId, locale: { not: null } }, select: { locale: true } });
    return (t?.locale as 'pt' | 'en' | null) ?? null;
  }
}
