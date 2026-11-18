import { createTranslator, DEFAULT_LOCALE, SHARED_EN, type Locale, type Translate } from '@rentix/shared';
import en from './en.json';

const cache = new Map<Locale, Translate>();

/** Função de tradução para um idioma (português = texto original). */
export function translator(locale: Locale): Translate {
  let t = cache.get(locale);
  if (!t) {
    t = createTranslator(locale, SHARED_EN, en as Record<string, string>);
    cache.set(locale, t);
  }
  return t;
}

/**
 * Idioma da página. No browser vem do <html lang>; no servidor (render inicial) é o português.
 * Usar só em funções auxiliares que formatam dados carregados no browser; nos componentes,
 * preferir useT()/useLocale(), que também funcionam no render do servidor.
 */
export function currentLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  return document.documentElement.lang.startsWith('en') ? 'en' : 'pt';
}

/** Tradução fora de componentes (ver currentLocale). */
export const tx = ((text: string, vars?: Parameters<Translate>[1]) => translator(currentLocale())(text, vars)) as Translate;
tx.label = (text) => translator(currentLocale()).label(text);
