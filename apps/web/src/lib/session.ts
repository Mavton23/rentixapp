'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { ApiClient } from './api';
import { portalApi, staffApi } from './clients';
import type { StaffSession, TenantSession } from './types';

type Status = 'loading' | 'authenticated' | 'anonymous';

function useClientSession<S extends { accessToken: string }>(client: ApiClient<S>) {
  const session = useSyncExternalStore(
    (cb) => client.subscribe(cb),
    () => client.getSession(),
    () => null,
  );
  const ready = useSyncExternalStore(
    (cb) => client.subscribe(cb),
    () => client.ready,
    () => false,
  );

  // Primeira visita / recarregar a página: tenta restaurar a sessão a partir do cookie.
  useEffect(() => {
    if (!client.ready) void client.refresh();
  }, [client]);

  const status: Status = !ready ? 'loading' : session ? 'authenticated' : 'anonymous';
  return { session, status };
}

export function useStaffSession() {
  return useClientSession<StaffSession>(staffApi);
}

/** Pode alterar dados (proprietário ou gestor). A API valida sempre. */
export function useCanManage(): boolean {
  const role = useStaffSession().session?.organization?.role;
  return role === 'OWNER' || role === 'MANAGER';
}

export function useTenantSession() {
  return useClientSession<TenantSession>(portalApi);
}
