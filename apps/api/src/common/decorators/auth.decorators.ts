import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { MemberRole } from '@rentix/shared';
import type { AuthContext, OrgContext, StaffAuth, TenantAuth } from '../auth-context';

export const IS_PUBLIC = 'rentix:public';
export const AUDIENCE = 'rentix:audience';
export const ROLES = 'rentix:roles';
export const PLATFORM_ADMIN = 'rentix:platformAdmin';
export const NO_ORG = 'rentix:noOrg';
export const ALLOW_SUSPENDED = 'rentix:allowSuspended';

/** Rota sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rota do portal do inquilino (aceita apenas tokens de inquilino). */
export const TenantRoute = () => SetMetadata(AUDIENCE, 'tenant');

/** Rota da equipa que não exige organização ativa (ex.: /auth/me, criar organização). */
export const NoOrganizationRequired = () => SetMetadata(NO_ORG, true);

/**
 * Restringe a rota a determinados papéis na organização ativa.
 * OWNER tem sempre acesso.
 */
/** Rota que continua acessível com a organização suspensa (ver o estado, pagar o plano). */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED, true);

export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES, roles);

/** Apenas administradores da plataforma Rentix. */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN, true);

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}

function getAuth(ctx: ExecutionContext): AuthContext {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new UnauthorizedException();
  return req.auth;
}

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
}

export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffAuth => {
  const auth = getAuth(ctx);
  if (auth.kind !== 'staff') throw new ForbiddenException();
  return auth;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantAuth => {
  const auth = getAuth(ctx);
  if (auth.kind !== 'tenant') throw new ForbiddenException();
  return auth;
});

/** Contexto da organização ativa: organizationId, userId, papel, IP e user-agent. */
export const Org = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const auth = getAuth(ctx);
  if (auth.kind !== 'staff' || !auth.organizationId || !auth.role) {
    throw new ForbiddenException({ code: 'NO_ORGANIZATION', message: 'Nenhuma organização ativa' });
  }
  const req = ctx.switchToHttp().getRequest<Request>();
  return { organizationId: auth.organizationId, userId: auth.userId, role: auth.role, ...meta(req) };
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  meta(ctx.switchToHttp().getRequest<Request>()),
);
