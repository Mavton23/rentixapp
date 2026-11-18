'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { intlLocale, LOCALE_COOKIE, type Locale, type Translate } from '@rentix/shared';
import { translator } from './runtime';

const LocaleContext = createContext<Locale>('pt');

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** t('Texto em português', { variavel }) -> texto no idioma do utilizador. */
export function useT(): Translate {
  return translator(useContext(LocaleContext));
}

export function useIntlLocale(): string {
  return intlLocale(useContext(LocaleContext));
}

/** Muda o idioma no browser (cookie de um ano) e recarrega a página. */
export function switchLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/**
 * Depois de entrar: se a conta tem um idioma guardado diferente do atual, muda o cookie e
 * devolve true (a página tem de ser recarregada para mudar de idioma).
 */
export function adoptAccountLocale(locale: Locale | null | undefined): boolean {
  if (!locale || locale === (document.documentElement.lang.startsWith('en') ? 'en' : 'pt')) return false;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  return true;
}

/** Navegação com recarregamento completo (o idioma da página só muda assim). */
export function reloadTo(url: string) {
  window.location.assign(url);
}
