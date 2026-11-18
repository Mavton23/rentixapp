'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { FeatureFlag } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useFeatures } from '@/lib/features';
import type { Paginated } from '@/lib/types';
import type { AdminMetrics } from '@/lib/platform-types';
import { instantDate, money } from '@/lib/format';
import { PageHeader, Panel } from '@/components/ui/display';

function Stat({ label, value, note, href }: { label: string; value: string | number; note?: string; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="money mt-1 font-display text-2xl font-semibold">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-faint">{note}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-panel border border-line bg-surface px-5 py-4 hover:border-line-strong">{body}</Link>
  ) : (
    <div className="rounded-panel border border-line bg-surface px-5 py-4">{body}</div>
  );
}

function PlatformMetrics() {
  const q = useQuery({ queryKey: ['admin-metrics'], queryFn: () => staffApi.get<AdminMetrics>('/admin/metrics') });
  const m = q.data;
  if (!m) return null;
  return (
    <section className="mb-10 flex flex-col gap-4" aria-label="Indicadores da plataforma">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Receita mensal recorrente" value={money(m.mrr)} note={`${m.subscriptions.paying} organizações a pagar`} />
        <Stat label="Recebido nos últimos 30 dias" value={money(m.revenueLast30Days.amount)} note={`${m.revenueLast30Days.invoices} faturas`} href="/admin/faturacao" />
        <Stat label="Faturas por pagar" value={money(m.openInvoices.amount)} note={`${m.openInvoices.count} faturas`} href="/admin/faturacao" />
        <Stat label="Organizações" value={m.organizations.total} note={`${m.organizations.newLast30Days} novas em 30 dias`} href="/admin/organizacoes" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Subscrições">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
            {[
              ['Em teste', m.subscriptions.trialing],
              ['A pagar', m.subscriptions.paying],
              ['Em atraso', m.subscriptions.pastDue],
              ['Grátis', m.subscriptions.free],
            ].map(([l, v]) => (
              <div key={l}>
                <dt className="text-ink-soft">{l}</dt>
                <dd className="money text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-5 py-3 text-sm text-ink-soft">
            Por plano: {m.byPlan.map((p) => `${p.name} ${p.count}`).join(', ')}
            {m.organizations.suspended > 0 && `. Suspensas: ${m.organizations.suspended}`}
          </p>
        </Panel>
        <Panel title="Testes a terminar nos próximos 7 dias">
          {m.trialsEndingSoon.length === 0 ? (
            <p className="px-5 py-6 text-center text-ink-soft">Nenhum.</p>
          ) : (
            <ul className="divide-y divide-line">
              {m.trialsEndingSoon.map((t) => (
                <li key={t.organizationId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <Link href={`/admin/organizacoes/${t.organizationId}`} className="font-medium hover:text-brand">{t.name}</Link>
                  <span className="text-ink-soft">{t.plan}, até {instantDate(t.endsAt, { until: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

const QUEUES: { flag: FeatureFlag; label: string; href: string; path: string; params?: Record<string, string>; array?: boolean }[] = [
  { flag: 'MARKETPLACE', label: 'Anúncios por rever', href: '/admin/marketplace', path: '/admin/marketplace/listings', params: { pageSize: '1' } },
  { flag: 'MARKETPLACE', label: 'Denúncias abertas', href: '/admin/marketplace', path: '/admin/marketplace/reports', array: true },
  { flag: 'CMS', label: 'Mensagens novas', href: '/admin/mensagens', path: '/admin/site/messages', params: { status: 'NEW', pageSize: '1' } },
  { flag: 'TESTIMONIALS', label: 'Testemunhos por rever', href: '/admin/testemunhos', path: '/admin/testimonials', params: { status: 'PENDING', pageSize: '1' } },
];

export default function AdminHome() {
  const features = useFeatures();
  const queues = QUEUES.filter((q) => features[q.flag]);
  const results = useQueries({
    queries: queues.map((q) => ({
      queryKey: ['admin-count', q.path, q.params],
      queryFn: async () => {
        const r = await staffApi.get<Paginated<unknown> | unknown[]>(q.path, q.params);
        return Array.isArray(r) ? r.length : r.meta.total;
      },
    })),
  });
  const enabled = (Object.entries(features) as [FeatureFlag, boolean][]).filter(([, v]) => v).map(([k]) => k);

  return (
    <>
      <PageHeader title="Resumo" />
      <PlatformMetrics />
      <h2 className="mb-3 font-display text-lg font-semibold">Por rever</h2>
      {queues.length === 0 ? (
        <p className="text-ink-soft">Nenhuma funcionalidade extra com moderação está ligada (FEATURES no .env da API).</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {queues.map((q, i) => (
            <Link key={q.label} href={q.href} className="rounded-panel border border-line bg-surface px-5 py-4 hover:border-line-strong">
              <p className="text-sm text-ink-soft">{q.label}</p>
              <p className="money mt-1 text-3xl font-semibold">{results[i]?.data ?? '…'}</p>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-8 text-sm text-ink-faint">Funcionalidades ligadas: {enabled.length ? enabled.join(', ') : 'nenhuma'}.</p>
    </>
  );
}
