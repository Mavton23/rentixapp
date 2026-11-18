import type { PaginationInput } from '@rentix/shared';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function pageArgs(p: PaginationInput): { skip: number; take: number } {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paginated<T>(data: T[], total: number, p: PaginationInput): Paginated<T> {
  return {
    data,
    meta: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) },
  };
}
