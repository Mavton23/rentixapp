import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { MemberRole } from '@rentix/shared';
import { AppConfig } from '../../config/app-config.service';
import type { StaffTokenClaims, TenantTokenClaims } from '../auth-context';
import { OrgStatusCache } from '../org-status.cache';
import {
  ALLOW_SUSPENDED,
  AUDIENCE,
  AuthedRequest,
  IS_PUBLIC,
  NO_ORG,
  PLATFORM_ADMIN,
  ROLES,
} from '../decorators/auth.decorators';

export const JWT_ISSUER = 'rentix';
export const STAFF_AUDIENCE = 'rentix:staff';
export const TENANT_AUDIENCE = 'rentix:tenant';

/**
 * Guard global único. Por omissão todas as rotas exigem token de EQUIPA.
 * - @Public(): sem autenticação.
 * - @TenantRoute(): exige token de INQUILINO (segredo e audience diferentes:
 *   um token de inquilino nunca é aceite numa rota da equipa e vice-versa).
 * - @Roles(...): papel exigido na organização ativa (OWNER passa sempre).
 * - @PlatformAdmin(): apenas SUPER_ADMIN.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly orgStatus: OrgStatusCache,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = this.extractBearer(req);
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sessão em falta' });

    const audience = this.reflector.getAllAndOverride<string>(AUDIENCE, targets) ?? 'staff';

    if (audience === 'tenant') {
      const claims = await this.verify<TenantTokenClaims>(token, 'JWT_TENANT_SECRET', TENANT_AUDIENCE);
      req.auth = { kind: 'tenant', accountId: claims.sub };
      return true;
    }

    const claims = await this.verify<StaffTokenClaims>(token, 'JWT_STAFF_SECRET', STAFF_AUDIENCE);
    req.auth = {
      kind: 'staff',
      userId: claims.sub,
      organizationId: claims.org,
      role: claims.role,
      platformRole: claims.prole,
    };

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN, targets)) {
      if (claims.prole !== 'SUPER_ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado' });
      return true;
    }

    const noOrg = this.reflector.getAllAndOverride<boolean>(NO_ORG, targets);
    if (!noOrg && (!claims.org || !claims.role)) {
      throw new ForbiddenException({ code: 'NO_ORGANIZATION', message: 'Nenhuma organização ativa' });
    }

    if (claims.org && !noOrg && !this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED, targets)) {
      if (await this.orgStatus.isSuspended(claims.org)) {
        throw new ForbiddenException({
          code: 'ORGANIZATION_SUSPENDED',
          message: 'Esta organização está suspensa. Contacte o suporte do Rentix.',
        });
      }
    }

    const roles = this.reflector.getAllAndOverride<MemberRole[]>(ROLES, targets);
    if (roles?.length && claims.role !== 'OWNER' && !roles.includes(claims.role as MemberRole)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: 'Não tem permissão para esta operação',
      });
    }
    return true;
  }

  private extractBearer(req: AuthedRequest): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }

  private async verify<T extends object>(
    token: string,
    secretKey: 'JWT_STAFF_SECRET' | 'JWT_TENANT_SECRET',
    audience: string,
  ): Promise<T> {
    try {
      return await this.jwt.verifyAsync<T>(token, {
        secret: this.config.get(secretKey),
        audience,
        issuer: JWT_ISSUER,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Sessão inválida ou expirada' });
    }
  }
}
