'use client';

import { useT } from '@/i18n/client';
import { LanguageSwitcher } from '@/components/language-switcher';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { Logo } from './brand';
import { portalApi } from '@/lib/clients';
import { cn } from '@/lib/format';
import { useTenantSession } from '@/lib/session';

const NAV = [
  { href: '/portal', label: 'Início' },
  { href: '/portal/faturas', label: 'Faturas' },
  { href: '/portal/pagamentos', label: 'Pagamentos' },
  { href: '/portal/contrato', label: 'Contrato' },
];

/** Portal do inquilino: uma coluna, pensado para o telemóvel. */
export function PortalShell({ children }: { children: ReactNode }) {
  const t = useT();
  const { session, status } = useTenantSession();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/portal/entrar');
  }, [status, router]);

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <span className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
      </div>
    );
  }

  async function logout() {
    await portalApi.logout();
    qc.clear();
    router.replace('/portal/entrar');
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3">
          <LanguageSwitcher onSave={(locale) => portalApi.patch('/portal/me/locale', { locale })} />
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-ink-soft hover:bg-paper hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden /> {t('Sair')}
          </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-2xl gap-1 overflow-x-auto px-2" aria-label={t('Portal')}>
          {NAV.map((n) => {
            const active =
              n.href === '/portal' ? pathname === '/portal' : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap',
                  active ? 'border-brand font-medium text-ink' : 'border-transparent text-ink-soft',
                )}
              >
                {t.label(n.label)}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}

export function PortalAuthLayout({
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
    <div className="flex min-h-dvh flex-col px-5 py-8">
      <div className="flex items-center justify-between">
        <Logo />
        <LanguageSwitcher />
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <p className="text-sm font-medium text-brand">{t('Portal do inquilino')}</p>
        <h1 className="mt-1 text-[26px] text-ink">{t.label(title)}</h1>
        {subtitle && <p className="mt-1.5 text-ink-soft">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 text-sm text-ink-soft">{footer}</div>}
      </div>
    </div>
  );
}
