'use client';

import { useT } from '@/i18n/client';
import { LanguageSwitcher } from '@/components/language-switcher';
import * as DM from '@radix-ui/react-dropdown-menu';
import * as D from '@radix-ui/react-dialog';
import {
  Building2,
  ChartColumn,
  Check,
  ChevronsUpDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  ShieldCheck,
  Store,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Logo } from './brand';
import { staffApi } from '@/lib/clients';
import { cn, daysUntil, initials, instantDate } from '@/lib/format';
import type { BillingOverview } from '@/lib/platform-types';
import { useStaffSession } from '@/lib/session';
import type { StaffSession } from '@/lib/types';
import { memberRoleLabel } from '@/i18n/pt';
import { useFeatures } from '@/lib/features';

const NAV = [
  { href: '/painel', label: 'Painel', icon: LayoutDashboard },
  { href: '/imoveis', label: 'Imóveis', icon: Building2 },
  { href: '/inquilinos', label: 'Inquilinos', icon: Users },
  { href: '/contratos', label: 'Contratos', icon: FileText },
  { href: '/faturas', label: 'Faturas', icon: ReceiptText },
  { href: '/pagamentos', label: 'Pagamentos', icon: Wallet },
  { href: '/relatorios', label: 'Relatórios', icon: ChartColumn },
  { href: '/definicoes', label: 'Definições', icon: Settings },
];

function NavLinks({
  onNavigate,
  isPlatformAdmin,
}: {
  onNavigate?: () => void;
  isPlatformAdmin: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const features = useFeatures();
  const items = [
    ...NAV.slice(0, 7),
    ...(features.MARKETPLACE ? [{ href: '/marketplace', label: 'Marketplace', icon: Store }] : []),
    ...NAV.slice(7),
    ...(isPlatformAdmin ? [{ href: '/admin', label: t('Administração'), icon: ShieldCheck }] : []),
  ];
  return (
    <nav className="flex flex-col gap-0.5" aria-label={t('Principal')}>
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors',
              active
                ? 'bg-white/10 font-medium text-white'
                : 'text-navy-text hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon
              className={cn('size-[18px]', active ? 'text-white' : 'text-navy-text')}
              aria-hidden
            />
            {t.label(label)}
          </Link>
        );
      })}
    </nav>
  );
}

function OrgSwitcher({ session }: { session: StaffSession }) {
  const t = useT();
  const qc = useQueryClient();
  const current = session.organization;
  if (session.memberships.length <= 1) {
    return (
      <div className="px-3">
        <p className="truncate text-sm font-medium text-white">{t.label(current?.name)}</p>
        {current && (
          <p className="text-xs text-navy-text">{t.label(memberRoleLabel[current.role])}</p>
        )}
      </div>
    );
  }

  async function switchTo(organizationId: string) {
    try {
      const s = await staffApi.post<StaffSession>('/auth/switch-organization', { organizationId });
      staffApi.setSession(s);
      qc.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível mudar de organização'));
    }
  }

  return (
    <DM.Root>
      <DM.Trigger className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left hover:bg-white/5">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-white">
            {t.label(current?.name)}
          </span>
          {current && (
            <span className="block text-xs text-navy-text">
              {t.label(memberRoleLabel[current.role])}
            </span>
          )}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-navy-text" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-60 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {session.memberships.map((m) => (
            <DM.Item
              key={m.organizationId}
              onSelect={() => m.organizationId !== current?.id && switchTo(m.organizationId)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-sm outline-none data-highlighted:bg-paper"
            >
              <span>
                {t.label(m.name)}
                <span className="block text-xs text-ink-faint">
                  {t.label(memberRoleLabel[m.role])}
                </span>
              </span>
              {m.organizationId === current?.id && (
                <Check className="size-4 text-brand" aria-hidden />
              )}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function UserBlock({ session }: { session: StaffSession }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  async function logout() {
    await staffApi.logout();
    qc.clear();
    router.replace('/entrar');
  }
  return (
    <div className="border-t border-white/10 px-3 pt-3">
    <LanguageSwitcher
      inverted
      className="mb-3"
      onSave={(locale) => staffApi.patch('/auth/me/locale', { locale })}
    />
    <div className="flex items-center gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
        aria-hidden
      >
        {initials(session.user.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-white">{t.label(session.user.name)}</span>
        <span className="block truncate text-xs text-navy-text">{t.label(session.user.email)}</span>
      </span>
      <button
        onClick={logout}
        className="rounded p-1.5 text-navy-text hover:bg-white/10 hover:text-white"
        aria-label={t('Sair')}
        title={t('Sair')}
      >
        <LogOut className="size-4" />
      </button>
    </div>
    </div>
  );
}

function Sidebar({ session, onNavigate }: { session: StaffSession; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 bg-navy px-3 py-5">
      <div className="px-3">
        <Logo inverted />
      </div>
      <OrgSwitcher session={session} />
      <NavLinks
        onNavigate={onNavigate}
        isPlatformAdmin={session.user.platformRole === 'SUPER_ADMIN'}
      />
      <div className="mt-auto">
        <UserBlock session={session} />
      </div>
    </div>
  );
}

/** Aviso no topo quando o teste está a acabar ou a renovação está por pagar. */
function SubscriptionNotice({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const q = useQuery({
    queryKey: ['billing'],
    queryFn: () => staffApi.get<BillingOverview>('/billing'),
    staleTime: 5 * 60_000,
  });
  const s = q.data?.subscription;
  if (!s || pathname.startsWith('/definicoes/plano')) return null;
  let text: string | null = null;
  let urgent = false;
  if (s.status === 'TRIALING' && s.currentPeriodEnd && daysUntil(s.currentPeriodEnd) <= 7) {
    const d = daysUntil(s.currentPeriodEnd);
    text = t('O teste do {name} termina {1}. Depois a conta passa para o Grátis.', {
      name: s.plan.name,
      '1': d <= 1 ? t("amanhã") : t("daqui a {0} dias", { '0': d }),
    });
  } else if (s.status === 'PAST_DUE') {
    urgent = true;
    text = t('A renovação do {name} está por pagar. Passa para o Grátis a {instantDate}.', {
      name: s.plan.name,
      instantDate: instantDate(s.downgradeAt),
    });
  }
  if (!text) return null;
  return (
    <div
      role="status"
      className={cn(
        'mb-6 flex flex-col gap-3 rounded-panel border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        urgent ? 'border-overdue/30 bg-overdue-soft' : 'border-brand/30 bg-brand-soft',
      )}
    >
      <p className="text-sm">{t.label(text)}</p>
      {isOwner && (
        <Link
          href="/definicoes/plano"
          className={cn(
            'shrink-0 text-sm font-medium hover:underline',
            urgent ? 'text-overdue' : 'text-brand',
          )}
        >
          {urgent ? t('Pagar agora') : t('Escolher plano')}
        </Link>
      )}
    </div>
  );
}

function SuspendedNotice() {
  const t = useT();
  const [checking, setChecking] = useState(false);
  async function recheck() {
    setChecking(true);
    // Renova a sessão: traz o estado atual da organização.
    await staffApi.refresh();
    setChecking(false);
  }
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <ShieldCheck className="mx-auto size-10 text-overdue" aria-hidden />
      <h1 className="mt-4 font-display text-2xl font-semibold">{t('Organização suspensa')}</h1>
      <p className="mt-2 text-ink-soft">
        {t(
          'A administração do Rentix suspendeu o acesso a esta organização. Os dados estão guardados. Para saber o motivo e voltar a ter acesso, contacte o suporte do Rentix.',
        )}
      </p>
      <p className="mt-4 text-sm text-ink-soft">
        {t('Pode continuar a ver o')}{' '}
        <Link href="/definicoes/plano" className="text-brand hover:underline">
          {t('plano e as faturas')}
        </Link>
        .
      </p>
      <button
        onClick={recheck}
        disabled={checking}
        className="mt-6 text-sm font-medium text-brand hover:underline disabled:opacity-50"
      >
        {checking ? t('A verificar…') : t('Verificar de novo')}
      </button>
    </div>
  );
}

/** Estrutura da área da equipa: protege as rotas e mostra a navegação. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const { session, status } = useStaffSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/entrar?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <span className="sr-only">{t('A carregar')}</span>
        <span className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
      </div>
    );
  }

  if (!session.organization) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <p className="font-display text-lg">{t('Não pertence a nenhuma organização.')}</p>
          <p className="mt-1 text-ink-soft">
            {t('Peça ao proprietário para o adicionar à equipa.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar session={session} />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy px-4 py-3 lg:hidden">
        <Logo inverted />
        <D.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <D.Trigger
            className="rounded p-2 text-white hover:bg-white/10"
            aria-label={t('Abrir menu')}
          >
            <Menu className="size-5" />
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-navy/50" />
            <D.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]">
              <D.Title className="sr-only">{t('Menu')}</D.Title>
              <D.Description className="sr-only">{t('Navegação principal')}</D.Description>
              <D.Close
                className="absolute top-4 right-3 z-10 rounded p-1.5 text-navy-text hover:text-white"
                aria-label={t('Fechar menu')}
              >
                <X className="size-5" />
              </D.Close>
              <Sidebar session={session} onNavigate={() => setMenuOpen(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8 sm:py-8">
        {session.organization.status === 'SUSPENDED' &&
        !pathname.startsWith('/definicoes/plano') ? (
          <SuspendedNotice />
        ) : (
          <>
            <SubscriptionNotice isOwner={session.organization.role === 'OWNER'} />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
