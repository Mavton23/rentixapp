import { z } from 'zod';
/**
 * Idiomas do Rentix. O português é a língua de origem: os textos escrevem-se em português
 * no código e os dicionários traduzem "texto em português" -> "texto noutro idioma".
 * Assim nada fica sem texto: o que não estiver traduzido aparece em português.
 *
 * Variáveis: t('Renova a {data}', { data: '05/12' }). Os textos com variáveis também se
 * encontram quando já vêm preenchidos (ex.: mensagens de erro da API), por correspondência
 * de padrão: "Limite de 3 unidades" encontra a chave "Limite de {0} unidades".
 */
export const LOCALES = ['pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt';
export const LOCALE_NAMES: Record<Locale, string> = { pt: 'Português', en: 'English' };
export const LOCALE_COOKIE = 'rtx_locale';

/** Aceita "en", "en-US", "pt-MZ", ou um Accept-Language ("en-GB,en;q=0.9,pt;q=0.8"). */
export function normalizeLocale(value: string | null | undefined, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (!value) return fallback;
  const tags = value
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of tags) {
    const base = tag.split('-')[0] as Locale;
    if ((LOCALES as readonly string[]).includes(base)) return base;
  }
  return fallback;
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Etiqueta para Intl (números, datas). Inglês com convenções britânicas: 05/12/2026, 15,000.00. */
export function intlLocale(locale: Locale): string {
  return locale === 'en' ? 'en-GB' : 'pt-MZ';
}

export type Dictionary = Record<string, string>;
export type Vars = Record<string, string | number | null | undefined>;
export interface Translate {
  (text: string, vars?: Vars): string;
  /** Só correspondência exata (para valores que podem ser dados do utilizador). */
  label<T extends string | null | undefined>(text: T): T;
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (m, k: string) => (!(k in vars) ? m : vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Pattern {
  re: RegExp;
  names: string[];
  target: string;
}

/** Cria a função de tradução para um idioma a partir de um ou mais dicionários. */
export function createTranslator(locale: Locale, ...dicts: Dictionary[]): Translate {
  if (locale === DEFAULT_LOCALE || dicts.length === 0) {
    const same = ((text: string, vars?: Vars) => interpolate(text, vars)) as Translate;
    same.label = (text) => text;
    return same;
  }
  const dict: Dictionary = Object.assign({}, ...dicts);
  let patterns: Pattern[] | null = null;
  const buildPatterns = () => {
    patterns = [];
    for (const [key, target] of Object.entries(dict)) {
      if (!key.includes('{')) continue;
      const names: string[] = [];
      const src = key
        .split(PLACEHOLDER)
        .map((part, i) => {
          if (i % 2 === 1) {
            names.push(part);
            return '([\\s\\S]+?)';
          }
          return escapeRe(part);
        })
        .join('');
      patterns.push({ re: new RegExp(`^${src}$`), names, target });
    }
    // Padrões mais específicos (mais texto fixo) primeiro.
    patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  };
  const t = ((text: string, vars?: Vars) => {
    if (typeof text !== 'string' || text === '') return text;
    const exact = dict[text];
    if (exact !== undefined) return interpolate(exact, vars);
    if (!vars) {
      if (!patterns) buildPatterns();
      for (const p of patterns!) {
        const m = p.re.exec(text);
        if (!m) continue;
        const found: Vars = {};
        p.names.forEach((n, i) => (found[n] = m[i + 1]));
        return interpolate(p.target, found);
      }
    }
    return interpolate(text, vars);
  }) as Translate;
  t.label = (text) => (typeof text === 'string' && dict[text] !== undefined ? (dict[text] as typeof text) : text);
  return t;
}

/** Nomes dos meses (1-12) no idioma. */
export function monthName(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 15)));
}

/** "2026-11" -> "novembro de 2026" / "November 2026". */
export function formatPeriod(period: string, locale: Locale): string {
  const [y, m] = period.split('-');
  return locale === 'en' ? `${monthName(Number(m), 'en')} ${y}` : `${monthName(Number(m), 'pt')} de ${y}`;
}

/** "2026-11-05" -> "05/11/2026" (igual nos dois idiomas) ou por extenso: "5 de novembro de 2026" / "5 November 2026". */
export function formatIsoDate(iso: string, locale: Locale, long = false): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!long) return `${d}/${m}/${y}`;
  return locale === 'en' ? `${Number(d)} ${monthName(Number(m), 'en')} ${y}` : `${Number(d)} de ${monthName(Number(m), 'pt')} de ${y}`;
}

export const setLocaleSchema = z.object({ locale: z.enum(LOCALES) });
export type SetLocaleInput = z.infer<typeof setLocaleSchema>;
