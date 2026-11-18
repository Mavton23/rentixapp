/**
 * Datas de calendário (vencimentos, início de contrato) são tratadas como strings "YYYY-MM-DD"
 * no fuso horário da organização, para evitar o clássico erro de "o dia mudou por causa do UTC".
 * Períodos de faturação são "YYYY-MM".
 */

export const DEFAULT_TIMEZONE = 'Africa/Maputo';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function isPeriod(s: string): boolean {
  return PERIOD_RE.test(s);
}

/** Data de hoje ("YYYY-MM-DD") num fuso horário. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function periodOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addMonthsToPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + months;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Data de vencimento de um período dado o dia de cobrança (limitado ao fim do mês). */
export function dueDateFor(period: string, billingDay: number): string {
  const day = Math.min(billingDay, daysInMonth(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Diferença em dias de calendário (b - a). */
export function diffDays(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/** Converte "YYYY-MM-DD" num Date às 00:00 UTC (como o Postgres guarda colunas DATE). */
export function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function dateToIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
