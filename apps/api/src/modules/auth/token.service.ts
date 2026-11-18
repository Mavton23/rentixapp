import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Response } from 'express';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { randomToken, sha256 } from '../../common/utils/crypto';
import type { RequestMeta, StaffTokenClaims } from '../../common/auth-context';
import { JWT_ISSUER, STAFF_AUDIENCE, TENANT_AUDIENCE } from '../../common/guards/auth.guard';
import type { Session } from '../../generated/prisma/client';

export const API_PREFIX = 'api/v1';
export const STAFF_REFRESH_COOKIE = 'rtx_rt';
export const TENANT_REFRESH_COOKIE = 'rtx_trt';
const STAFF_COOKIE_PATH = `/${API_PREFIX}/auth`;
const TENANT_COOKIE_PATH = `/${API_PREFIX}/portal/auth`;

/** Janela em que reutilizar um refresh token acabado de rodar é tratado como corrida (2 separadores). */
const REUSE_GRACE_MS = 10_000;

type SubjectType = 'USER' | 'TENANT';

/**
 * Access tokens: JWT curtos (15 min por omissão), com segredos e audiences distintos
 * para equipa e inquilinos.
 * Refresh tokens: opacos, guardados como hash, rodados a cada uso, enviados em cookie httpOnly.
 * Se um refresh token já usado voltar a aparecer (roubo provável), todas as sessões do
 * utilizador são revogadas.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  get accessTtl(): number {
    return this.config.get('ACCESS_TOKEN_TTL_SECONDS');
  }

  signStaffAccess(claims: StaffTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.get('JWT_STAFF_SECRET'),
      audience: STAFF_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: this.accessTtl,
      algorithm: 'HS256',
    });
  }

  signTenantAccess(accountId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: accountId },
      {
        secret: this.config.get('JWT_TENANT_SECRET'),
        audience: TENANT_AUDIENCE,
        issuer: JWT_ISSUER,
        expiresIn: this.accessTtl,
        algorithm: 'HS256',
      },
    );
  }

  async createSession(
    subjectType: SubjectType,
    subjectId: string,
    organizationId: string | null,
    meta: RequestMeta,
    tx?: Tx,
  ): Promise<{ session: Session; refreshToken: string }> {
    const db = tx ?? this.prisma;
    const refreshToken = randomToken(48);
    const session = await db.session.create({
      data: {
        subjectType,
        subjectId,
        organizationId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { session, refreshToken };
  }

  /** Valida e roda um refresh token. Devolve a nova sessão e o novo token em claro. */
  async rotate(
    rawToken: string | undefined,
    subjectType: SubjectType,
    meta: RequestMeta,
    organizationId?: string | null,
  ): Promise<{ session: Session; refreshToken: string }> {
    const invalid = () =>
      new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Sessão expirada. Entre novamente.' });
    if (!rawToken) throw invalid();

    const current = await this.prisma.session.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!current || current.subjectType !== subjectType) throw invalid();

    if (current.revokedAt) {
      const recentlyRotated =
        current.replacedById && Date.now() - current.revokedAt.getTime() < REUSE_GRACE_MS;
      if (!recentlyRotated) {
        // Reutilização de token já rodado: possível roubo. Terminar todas as sessões.
        await this.revokeAll(subjectType, current.subjectId);
      }
      throw invalid();
    }
    if (current.expiresAt < new Date()) throw invalid();

    return this.prisma.$transaction(async (tx) => {
      const next = await this.createSession(
        subjectType,
        current.subjectId,
        organizationId === undefined ? current.organizationId : organizationId,
        meta,
        tx,
      );
      // Só revoga se ainda não foi revogada (evita duas rotações paralelas válidas).
      const res = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: next.session.id, lastUsedAt: new Date() },
      });
      if (res.count !== 1) throw invalid();
      return next;
    });
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(subjectType: SubjectType, subjectId: string, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma).session.updateMany({
      where: { subjectType, subjectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------- Cookies ----------

  private cookieOptions(path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'lax',
      path,
      domain: this.config.get('COOKIE_DOMAIN') || undefined,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
    };
  }

  setRefreshCookie(res: Response, kind: 'staff' | 'tenant', token: string): void {
    const [name, path] =
      kind === 'staff' ? [STAFF_REFRESH_COOKIE, STAFF_COOKIE_PATH] : [TENANT_REFRESH_COOKIE, TENANT_COOKIE_PATH];
    res.cookie(name, token, this.cookieOptions(path));
  }

  clearRefreshCookie(res: Response, kind: 'staff' | 'tenant'): void {
    const [name, path] =
      kind === 'staff' ? [STAFF_REFRESH_COOKIE, STAFF_COOKIE_PATH] : [TENANT_REFRESH_COOKIE, TENANT_COOKIE_PATH];
    const { maxAge: _maxAge, ...opts } = this.cookieOptions(path);
    res.clearCookie(name, opts);
  }
}
