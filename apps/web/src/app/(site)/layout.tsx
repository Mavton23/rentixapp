import { LanguageSwitcher } from '@/components/language-switcher';
import { getT } from '@/i18n/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getFeatures } from '@/lib/server-api';
import { Logo } from '@/components/brand';
import { Button } from '@/components/ui/button';

// Renderizado a cada pedido (barato): as chamadas à API continuam em cache 30–60 s
// (ver server-api.ts). Assim o site não depende de a API estar acessível durante o build.
export const dynamic = 'force-dynamic';

/** Site público (institucional). Só mostra as secções cujas funcionalidades estão ligadas. */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const t = await getT();
  const f = await getFeatures();
  const nav = [
    f.CMS && { href: '/funcionalidades', label: 'Funcionalidades' },
    f.CMS && { href: '/sobre', label: 'Sobre' },
    f.BLOG && { href: '/blog', label: 'Blog' },
    f.CMS && { href: '/contactos', label: 'Contactos' },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
          <Link href="/" aria-label={t('Rentix, página inicial')}>
            <Logo />
          </Link>
          <nav
            className="hidden items-center gap-6 text-[15px] text-ink-soft md:flex"
            aria-label={t('Site')}
          >
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-ink">
                {t.label(n.label)}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/entrar">{t('Entrar')}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/criar-conta">{t('Criar conta')}</Link>
            </Button>
          </div>
        </div>
        {nav.length > 0 && (
          <nav
            className="flex gap-5 overflow-x-auto border-t border-line px-5 py-2.5 text-sm text-ink-soft md:hidden"
            aria-label={t('Site')}
          >
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap hover:text-ink">
                {t.label(n.label)}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-navy text-navy-text">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Logo inverted />
            <p className="mt-3 max-w-sm text-sm">
              {t('Gestão de arrendamentos para senhorios e imobiliárias. Feito em Moçambique.')}
            </p>
            <LanguageSwitcher inverted className="mt-4" />
          </div>
          <div className="text-sm">
            <p className="font-medium text-white">{t('Produto')}</p>
            <ul className="mt-3 space-y-2">
              {f.CMS && (
                <li>
                  <Link href="/funcionalidades" className="hover:text-white">
                    {t('Funcionalidades')}
                  </Link>
                </li>
              )}
              <li>
                <Link href="/portal/entrar" className="hover:text-white">
                  {t('Portal do inquilino')}
                </Link>
              </li>
              {f.STATUS_PAGE && (
                <li>
                  <Link href="/estado" className="hover:text-white">
                    {t('Estado do serviço')}
                  </Link>
                </li>
              )}
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-medium text-white">{t('Empresa')}</p>
            <ul className="mt-3 space-y-2">
              {f.CMS && (
                <li>
                  <Link href="/sobre" className="hover:text-white">
                    {t('Sobre')}
                  </Link>
                </li>
              )}
              {f.BLOG && (
                <li>
                  <Link href="/blog" className="hover:text-white">
                    {t('Blog')}
                  </Link>
                </li>
              )}
              {f.CMS && (
                <li>
                  <Link href="/contactos" className="hover:text-white">
                    {t('Contactos')}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 px-5 py-4 text-center text-xs">
          {t('© {0} Rentix', { '0': new Date().getFullYear() })}
        </div>
      </footer>
    </div>
  );
}
