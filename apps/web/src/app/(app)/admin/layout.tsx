'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { FeatureFlag } from '@rentix/shared';
import { useStaffSession } from '@/lib/session';
import { useFeatures } from '@/lib/features';
import { cn } from '@/lib/format';

const TABS: { href: string; label: string; flag?: FeatureFlag }[] = [
  { href: '/admin', label: 'Resumo' },
  { href: '/admin/organizacoes', label: 'Organizações' },
  { href: '/admin/faturacao', label: 'Faturação' },
  { href: '/admin/planos', label: 'Planos' },
  { href: '/admin/saude', label: 'Saúde' },
  { href: '/admin/marketplace', label: 'Marketplace', flag: 'MARKETPLACE' },
  { href: '/admin/blog', label: 'Blog', flag: 'BLOG' },
  { href: '/admin/site', label: 'Conteúdo do site', flag: 'CMS' },
  { href: '/admin/mensagens', label: 'Mensagens', flag: 'CMS' },
  { href: '/admin/testemunhos', label: 'Testemunhos', flag: 'TESTIMONIALS' },
  { href: '/admin/estado', label: 'Estado do serviço', flag: 'STATUS_PAGE' },
];

/** Área de administração da plataforma Rentix (só SUPER_ADMIN; a API valida sempre). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session } = useStaffSession();
  const features = useFeatures();
  const pathname = usePathname();

  if (session && session.user.platformRole !== 'SUPER_ADMIN') {
    return <p className="py-20 text-center text-ink-soft">Esta área é só para a administração do Rentix.</p>;
  }

  const tabs = TABS.filter((t) => !t.flag || features[t.flag]);
  return (
    <>
      <p className="mb-1 text-sm font-medium text-brand">Administração da plataforma</p>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Administração">
        {tabs.map((t) => {
          const active = t.href === '/admin' ? pathname === '/admin' : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn('-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap', active ? 'border-brand font-medium text-ink' : 'border-transparent text-ink-soft hover:text-ink')}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </>
  );
}
