import type { MemberRole } from '@rentix/shared';

export type PlatformRole = 'USER' | 'SUPER_ADMIN';

/** Utilizador da equipa autenticado (proprietário, gestor, contabilista...). */
export interface StaffAuth {
  kind: 'staff';
  userId: string;
  /** Organização ativa nesta sessão. */
  organizationId: string | null;
  role: MemberRole | null;
  platformRole: PlatformRole;
}

/** Inquilino autenticado no portal. */
export interface TenantAuth {
  kind: 'tenant';
  accountId: string;
}

export type AuthContext = StaffAuth | TenantAuth;

/** Claims dos access tokens (JWT). */
export interface StaffTokenClaims {
  sub: string;
  org: string | null;
  role: MemberRole | null;
  prole: PlatformRole;
}

export interface TenantTokenClaims {
  sub: string;
}

/** Contexto mínimo de cada pedido, passado aos serviços para auditoria. */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/** Contexto de uma operação dentro de uma organização. */
export interface OrgContext extends RequestMeta {
  organizationId: string;
  userId: string;
  role: MemberRole;
}
