import type { Request } from 'express';
import {
  createTranslator,
  DEFAULT_LOCALE,
  formatMoney,
  intlLocale,
  isLocale,
  LOCALE_COOKIE,
  normalizeLocale,
  SHARED_EN,
  type Locale,
  type Translate,
} from '@rentix/shared';
import en from './en.json';

const cache = new Map<Locale, Translate>();

/** Tradução dos textos da API (o português é a língua de origem). */
export function translator(locale: Locale): Translate {
  let t = cache.get(locale);
  if (!t) {
    t = createTranslator(locale, SHARED_EN, en as Record<string, string>);
    cache.set(locale, t);
  }
  return t;
}

/**
 * Idioma do pedido: cookie escolhido na aplicação (o browser envia-o com cada pedido),
 * cabeçalho x-locale (pedidos do servidor Next), Accept-Language, ou português.
 */
export function requestLocale(req: Pick<Request, 'headers'>): Locale {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === LOCALE_COOKIE)?.[1];
  if (isLocale(cookie)) return cookie;
  const header = req.headers['x-locale'];
  if (typeof header === 'string' && isLocale(header)) return header;
  return normalizeLocale(req.headers['accept-language'] as string | undefined);
}

/** Idioma de uma pessoa: o dela, senão o da organização, senão português. */
export function pickLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const c of candidates) if (c) return normalizeLocale(c);
  return DEFAULT_LOCALE;
}

/** Dinheiro no formato do idioma: "15 000,00 MTn" / "MZN 15,000.00". */
export function moneyIn(locale: Locale, minor: number, currency = 'MZN'): string {
  return locale === 'en' ? formatMoney(minor, currency, intlLocale('en')) : formatMoney(minor, currency);
}
