/**
 * Dinheiro é SEMPRE representado em unidades mínimas inteiras (centavos).
 * 1 500,00 MT  ->  150000
 * Nunca usar floats para cálculos monetários.
 */

/** Limite seguro para valores em centavos guardados em colunas INTEGER do Postgres. */
export const MAX_MINOR_AMOUNT = 2_000_000_000; // 20 000 000,00 na moeda

/**
 * Converte um valor decimal (string ou número) em centavos, sem passar por aritmética de float.
 * Aceita "1500", "1500.5", "1500,50", "1 500,50", "1.500,50", 1500.5.
 */
/** Converte texto escrito pelo utilizador em centavos. Em inglês ('en') a vírgula separa milhares. */
export function toMinor(value: string | number, locale: 'pt' | 'en' = 'pt'): number {
  if (typeof value === 'number') {
    // Números vindos de inputs (ex.: 19.99) já carregam erro de float; arredondar ao centavo.
    if (!Number.isFinite(value)) throw new RangeError('Valor monetário inválido');
    const minor = Math.round(value * 100);
    if (Math.abs(minor) > MAX_MINOR_AMOUNT) throw new RangeError('Valor monetário demasiado alto');
    return minor;
  }
  let s = value.trim().replace(/[\s ]/g, '');

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // O último separador é o decimal; o outro é de milhares.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = locale === 'en' ? s.replace(/,/g, '') : s.replace(',', '.');
  }

  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) throw new RangeError(`Valor monetário inválido: "${value}"`);
  const [, sign, intPart, frac = ''] = match;
  const minor = Number(intPart) * 100 + Number(frac.padEnd(2, '0'));
  if (minor > MAX_MINOR_AMOUNT) throw new RangeError('Valor monetário demasiado alto');
  return sign ? -minor : minor;
}

/** Converte centavos em string decimal com 2 casas ("1500.50"). Útil para APIs externas (M-Pesa, etc.). */
export function toDecimalString(minor: number): string {
  assertInt(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Aplica uma percentagem expressa em pontos-base (1% = 100 bps) a um valor em centavos.
 * Arredondamento "half-up", só com inteiros.
 */
export function applyBps(minor: number, bps: number): number {
  assertInt(minor);
  assertInt(bps);
  const product = minor * bps;
  const q = Math.trunc(product / 10_000);
  const r = Math.abs(product % 10_000);
  return r * 2 >= 10_000 ? q + Math.sign(product) : q;
}

const LOCALE_BY_CURRENCY: Record<string, string> = {
  MZN: 'pt-MZ',
  USD: 'en-US',
  ZAR: 'en-ZA',
  EUR: 'pt-PT',
};

/** Formata centavos para apresentação: formatMoney(150000, 'MZN') -> "1500,00 MTn". */
export function formatMoney(minor: number, currency = 'MZN', locale?: string): string {
  assertInt(minor);
  return new Intl.NumberFormat(locale ?? LOCALE_BY_CURRENCY[currency] ?? 'pt-MZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function assertInt(n: number): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Esperado inteiro, recebido ${n}`);
}
