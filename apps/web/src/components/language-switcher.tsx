'use client';

import { Languages } from 'lucide-react';
import { useState } from 'react';
import { LOCALES, LOCALE_NAMES, type Locale } from '@rentix/shared';
import { switchLocale, useLocale, useT } from '@/i18n/client';
import { cn } from '@/lib/format';

/**
 * Escolha do idioma. Com `onSave`, a escolha também fica guardada na conta
 * (emails, SMS e recibos passam a sair nesse idioma).
 */
export function LanguageSwitcher({
  className,
  inverted,
  onSave,
}: {
  className?: string;
  inverted?: boolean;
  onSave?: (locale: Locale) => Promise<unknown>;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  async function change(next: Locale) {
    if (next === locale) return;
    setBusy(true);
    try {
      await onSave?.(next);
    } catch {
      // Guardar na conta é um extra: o idioma muda na mesma neste browser.
    }
    switchLocale(next);
  }
  return (
    <label
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-control text-sm',
        inverted ? 'text-navy-text hover:text-white' : 'text-ink-soft hover:text-ink',
        className,
      )}
    >
      <Languages className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">{t('Idioma')}</span>
      <select
        value={locale}
        disabled={busy}
        onChange={(e) => change(e.target.value as Locale)}
        className={cn(
          'cursor-pointer appearance-none bg-transparent py-1 pr-1 focus-visible:outline-2 focus-visible:outline-brand',
          inverted && '[&>option]:text-ink',
        )}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
