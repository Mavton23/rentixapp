/** Relatórios e exportações para a contabilidade. */
import { z } from 'zod';
import { isoDateSchema } from './schemas';

export const REPORT_EXPORT_KINDS = ['invoices', 'payments', 'tenants', 'aging'] as const;
export type ReportExportKind = (typeof REPORT_EXPORT_KINDS)[number];

/** Intervalo de datas (inclusive). Sem datas: o mês corrente. No máximo pouco mais de um ano. */
export const reportRangeSchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, { message: 'A data inicial tem de ser anterior à final', path: ['to'] })
  .refine((r) => !r.from || !r.to || Date.parse(r.to) - Date.parse(r.from) <= 400 * 86_400_000, {
    message: 'Escolha um intervalo até um ano',
    path: ['from'],
  });
export type ReportRange = z.infer<typeof reportRangeSchema>;

/** Escalões de antiguidade das dívidas, em dias depois do vencimento. */
export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}
