import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import type { FeatureFlag } from '@rentix/shared';

/**
 * Pedidos à API feitos no servidor Next.js (páginas públicas renderizadas no servidor, boas para SEO).
 * Os dados são guardados em cache e revalidados a cada `revalidate` segundos.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export async function apiGet<T>(path: string, revalidate = 60): Promise<T | null> {
  // No build (ex.: Docker) a API normalmente não está a correr: as páginas saem "desligadas"
  // e são refeitas no primeiro pedido, ao fim de `revalidate` segundos.
  if (process.env.NEXT_PHASE === 'phase-production-build') return null;
  try {
    const res = await fetch(`${API_URL}/api/v1${path}`, { next: { revalidate } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    // Erros internos do Next (renderização dinâmica, redirect, notFound) têm de seguir caminho.
    unstable_rethrow(err);
    console.error(`Falha ao obter ${path}:`, err);
    return null;
  }
}

export async function getFeatures(): Promise<Record<FeatureFlag, boolean>> {
  return (
    (await apiGet<Record<FeatureFlag, boolean>>('/features', 30)) ?? {
      BLOG: false,
      CMS: false,
      MARKETPLACE: false,
      STATUS_PAGE: false,
      TESTIMONIALS: false,
    }
  );
}
