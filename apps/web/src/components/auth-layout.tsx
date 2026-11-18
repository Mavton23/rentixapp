'use client';

import { useT } from '@/i18n/client';
import type { ReactNode } from 'react';
import { Logo } from './brand';
import { LanguageSwitcher } from './language-switcher';

/**
 * Ecrãs de entrada. À esquerda (só em ecrãs largos), o que o Rentix faz por quem arrenda:
 * a mensagem real que o inquilino recebe no telemóvel.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy p-10 text-white lg:flex">
        <Logo inverted />
        <div className="max-w-md">
          <p className="font-display text-[34px] leading-[1.15] font-semibold">
            {t('As rendas de todos os seus imóveis, cobradas a tempo.')}
          </p>
          <p className="mt-4 text-navy-text">
            {t(
              'Faturas emitidas sozinhas no início do mês, lembretes por SMS antes do vencimento e recibos para cada pagamento.',
            )}
          </p>
          <figure
            className="mt-10 max-w-sm"
            aria-label={t('Exemplo de lembrete enviado ao inquilino')}
          >
            <div className="rounded-2xl rounded-bl-sm bg-navy-2 px-4 py-3 text-[15px] leading-snug text-white/90 ring-1 ring-white/10">
              {t(
                'Imobiliária Costa: lembrete — 15 000,00 MTn da fatura FT 2026/000124 vence a 05/12/2026.',
              )}
            </div>
            <figcaption className="mt-2 text-xs text-navy-text">
              {t('SMS enviado ao inquilino 3 dias antes')}
            </figcaption>
          </figure>
        </div>
        <p className="text-sm text-navy-text">{t('Feito em Moçambique.')}</p>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <LanguageSwitcher />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-[26px] text-ink">{t.label(title)}</h1>
          {subtitle && <p className="mt-1.5 text-ink-soft">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-ink-soft">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
