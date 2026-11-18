/**
 * Regras de faturação puras (sem base de dados), fáceis de testar.
 * Datas são strings "AAAA-MM-DD" e períodos "AAAA-MM", no fuso da organização.
 */
import { addDays, addMonthsToPeriod, applyBps, dueDateFor, periodOf } from '@rentix/shared';

export interface LeaseBillingInfo {
  startDate: string;
  endDate: string | null;
  billingDay: number;
  firstBillingPeriod: string;
}

/**
 * Períodos de renda que já deviam estar faturados até `today`.
 * Uma fatura é emitida no primeiro dia do período (ou no início do contrato, se for depois).
 */
export function periodsDue(lease: LeaseBillingInfo, today: string): string[] {
  const first = maxStr(lease.firstBillingPeriod, periodOf(lease.startDate));
  let last = periodOf(today);
  if (lease.endDate) last = minStr(last, periodOf(lease.endDate));
  if (lease.startDate > today) return [];

  const out: string[] = [];
  for (let p = first; p <= last; p = addMonthsToPeriod(p, 1)) {
    out.push(p);
    if (out.length > 120) break; // salvaguarda
  }
  return out;
}

/**
 * Datas de emissão e vencimento da renda de um período.
 * A fatura é emitida no dia em que é gerada (`today`). O vencimento é o dia de cobrança,
 * mas nunca antes da emissão: um contrato registado a dia 15, com cobrança a dia 5,
 * não nasce com a renda já em atraso (nem com multa).
 */
export function rentDates(
  lease: LeaseBillingInfo,
  period: string,
  today: string,
): { issueDate: string; dueDate: string } {
  const issueDate = maxStr(today, lease.startDate);
  const dueDate = maxStr(dueDateFor(period, lease.billingDay), issueDate);
  return { issueDate, dueDate };
}

/** Multa aplicável a uma fatura em atraso (0 se ainda não é devida). */
export function lateFeeFor(params: {
  outstanding: number;
  dueDate: string;
  today: string;
  graceDays: number;
  bps: number;
}): number {
  if (params.outstanding <= 0 || params.bps <= 0) return 0;
  const limit = addDays(params.dueDate, params.graceDays);
  if (params.today <= limit) return 0;
  return applyBps(params.outstanding, params.bps);
}

export function invoiceStatusFor(amount: number, paid: number): 'OPEN' | 'PARTIALLY_PAID' | 'PAID' {
  if (paid <= 0) return 'OPEN';
  if (paid >= amount) return 'PAID';
  return 'PARTIALLY_PAID';
}

function maxStr(a: string, b: string): string {
  return a > b ? a : b;
}
function minStr(a: string, b: string): string {
  return a < b ? a : b;
}
