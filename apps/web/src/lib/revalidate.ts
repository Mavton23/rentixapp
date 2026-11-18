import { staffApi } from './clients';

/** Pede ao servidor Next que refaça as páginas públicas. Falhar não é grave: a cache expira sozinha. */
export function revalidateSite(): void {
  const token = staffApi.getSession()?.accessToken;
  if (!token) return;
  void fetch('/revalidate', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
}
