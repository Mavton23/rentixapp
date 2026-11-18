import 'server-only';
import { cookies, headers } from 'next/headers';
import { isLocale, LOCALE_COOKIE, normalizeLocale, type Locale, type Translate } from '@rentix/shared';
import { translator } from './runtime';

/** Idioma do pedido: cookie escolhido pelo utilizador, senão o do browser, senão português. */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  return normalizeLocale((await headers()).get('accept-language'));
}

export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
