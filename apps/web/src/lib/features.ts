'use client';

import { useQuery } from '@tanstack/react-query';
import type { FeatureFlag } from '@rentix/shared';
import { staffApi } from './clients';

/** Funcionalidades extra ligadas no servidor (para mostrar ou esconder menus). */
export function useFeatures(): Partial<Record<FeatureFlag, boolean>> {
  const q = useQuery({
    queryKey: ['features'],
    queryFn: () => staffApi.get<Record<FeatureFlag, boolean>>('/features'),
    staleTime: 5 * 60_000,
  });
  return q.data ?? {};
}
