'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { staffApi } from './clients';
import type { Paginated } from './types';

type Params = Record<string, string | number | boolean | undefined>;

/** Lista paginada da API da equipa, mantendo os dados anteriores enquanto carrega a página seguinte. */
export function useList<T>(path: string, params: Params) {
  return useQuery({
    queryKey: [path, params],
    queryFn: () => staffApi.get<Paginated<T>>(path, params),
    placeholderData: keepPreviousData,
  });
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
