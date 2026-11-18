import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { diffDays, formatMoney, formatPeriod, intlLocale, toDecimalString, todayIn, toMinor } from '@rentix/shared';
import { currentLocale, tx } from '@/i18n/runtime';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Valor no formato do idioma: "15 000,00 MTn" (pt) ou "MZN 15,000.00" (en). */
export function money(minor: number, currency = 'MZN'): string {
  return currentLocale() === 'en' ? formatMoney(minor, currency, intlLocale('en')) : formatMoney(minor, currency);
}

/** "2026-11-05" -> "05/11/2026" */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Data (em Maputo) de um instante. Com `until`, é o último dia incluído num período que acaba
 * nesse instante: um período que acaba às 00:00 de dia 16 é "até 15".
 */
export function instantDate(ts: string | null | undefined, opts: { until?: boolean } = {}): string {
  if (!ts) return '—';
  const t = new Date(ts).getTime() - (opts.until ? 1000 : 0);
  return date(todayIn('Africa/Maputo', new Date(t)));
}

/** Dias inteiros que faltam até um instante (0 se já passou). */
export function daysUntil(ts: string): number {
  return Math.max(0, Math.ceil((new Date(ts).getTime() - Date.now()) / 86_400_000));
}

/** "2026-11" -> "novembro de 2026" / "November 2026" */
export function period(p: string | null | undefined): string {
  if (!p) return '—';
  return formatPeriod(p, currentLocale());
}

/** Texto curto sobre o vencimento: "vence hoje", "vence em 3 dias", "12 dias em atraso". */
export function dueText(dueDate: string, today: string): string {
  const d = diffDays(today, dueDate);
  if (d === 0) return tx('vence hoje');
  if (d === 1) return tx('vence amanhã');
  if (d > 1) return tx('vence em {d} dias', { d });
  if (d === -1) return tx('1 dia em atraso');
  return tx('{d} dias em atraso', { d: -d });
}

/** Converte o que o utilizador escreveu ("15 000,50") em centavos, ou null se inválido. */
export function parseMoney(input: string): number | null {
  try {
    return toMinor(input, currentLocale());
  } catch {
    return null;
  }
}

/** Centavos -> texto editável num campo ("15000,50"). */
export function moneyInputValue(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return currentLocale() === 'en' ? toDecimalString(minor) : toDecimalString(minor).replace('.', ',');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Número no formato do idioma: 33,3 (pt) / 33.3 (en). */
export function num(n: number, maxFractionDigits = 2): string {
  return n.toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: maxFractionDigits });
}
