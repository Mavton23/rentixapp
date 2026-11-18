'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/format';

const TABS = [
  { href: '/marketplace', label: 'Explorar' },
  { href: '/marketplace/meus-anuncios', label: 'Os meus anúncios' },
  { href: '/marketplace/interesses', label: 'Os meus interesses' },
];

export function MarketplaceTabs() {
  const tr = useT();
  const pathname = usePathname();
  return (
    <nav
      className="mb-6 flex gap-1 overflow-x-auto border-b border-line"
      aria-label={tr('Marketplace')}
    >
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap',
              active
                ? 'border-brand font-medium text-ink'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {tr.label(t.label)}
          </Link>
        );
      })}
    </nav>
  );
}

export function MarketplaceGate({
  enabled,
  children,
}: {
  enabled: boolean | undefined;
  children: React.ReactNode;
}) {
  const t = useT();
  if (enabled === false) {
    return <p className="py-20 text-center text-ink-soft">{t('O marketplace não está ativo.')}</p>;
  }
  return <>{children}</>;
}
