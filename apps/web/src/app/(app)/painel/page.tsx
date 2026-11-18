'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { staffApi } from '@/lib/clients';
import type { Dashboard, MoneyByCurrency } from '@/lib/types';
import { date, dueText, money, period, num } from '@/lib/format';
import { paymentMethodLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/ui/display';

const pick = (list: MoneyByCurrency[], currency: string) =>
  list.find((m) => m.currency === currency)?.amount ?? 0;

export default function DashboardPage() {
  const t = useT();
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => staffApi.get<Dashboard>('/dashboard'),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <>
      <PageHeader
        title={t('Painel')}
        description={d ? t('Resumo de {period}', { period: period(d.period) }) : ' '}
        actions={
          <Button asChild variant="secondary">
            <Link href="/contratos/novo">
              <Plus aria-hidden /> {t('Novo contrato')}
            </Link>
          </Button>
        }
      />
      {!d ? <DashboardSkeleton /> : <DashboardBody d={d} />}
    </>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const t = useT();
  const cur = d.defaultCurrency;
  const billed = pick(d.month.billed, cur);
  const collected = pick(d.month.collected, cur);
  const overdue = pick(d.overdue.amount, cur);
  const pct = billed > 0 ? Math.min(100, Math.round((collected / billed) * 100)) : 0;

  if (d.occupancy.units === 0) {
    return (
      <Panel>
        <EmptyState
          title={t('Comece por registar um imóvel')}
          description={t(
            'Depois adicione os inquilinos e crie os contratos. As faturas de renda passam a ser emitidas sozinhas todos os meses.',
          )}
          action={
            <Button asChild>
              <Link href="/imoveis/novo">{t('Registar imóvel')}</Link>
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Faixa do mês: o que entrou face ao que foi faturado */}
      <section
        className="rounded-panel border border-line bg-surface px-5 py-6 sm:px-7"
        aria-labelledby="month-heading"
      >
        <h2 id="month-heading" className="text-base font-medium text-ink-soft">
          {t('Cobrado em {period}', { period: period(d.period) })}
        </h2>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="money text-[40px] leading-none font-semibold text-ink sm:text-[52px]">
            {money(collected, cur)}
          </span>
          <span className="text-ink-soft">
            {t('de')} <span className="money">{money(billed, cur)}</span> {t('em rendas faturadas')}
          </span>
        </div>
        <div
          className="mt-5 h-3 overflow-hidden rounded-full bg-brand-soft"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('Percentagem cobrada')}
        >
          <div className="h-full rounded-full bg-paid" style={{ width: `${pct}%` }} />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label={t('Cobrado')} value={`${pct}%`} />
          <Stat
            label={t('Em atraso')}
            value={
              <span className={overdue > 0 ? 'text-overdue' : undefined}>
                {money(overdue, cur)}
              </span>
            }
            sub={
              d.overdue.invoices
                ? `${d.overdue.invoices} ${d.overdue.invoices === 1 ? t('fatura') : t('faturas')}, ${d.overdue.tenants} ${d.overdue.tenants === 1 ? t('inquilino') : t('inquilinos')}`
                : t('Nada em atraso')
            }
            href={d.overdue.invoices ? '/faturas?estado=atraso' : undefined}
          />
          <Stat
            label={t('Ocupação')}
            value={`${num(d.occupancy.rate)}%`}
            sub={t('{occupied} de {units} unidades', {
              occupied: d.occupancy.occupied,
              units: d.occupancy.units,
            })}
          />
          <Stat
            label={t('Contratos ativos')}
            value={String(d.activeLeases)}
            sub={
              d.tenants === 1
                ? t('1 inquilino registado')
                : t('{tenants} inquilinos registados', { tenants: d.tenants })
            }
          />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title={t('A vencer nos próximos 7 dias')}
          actions={
            <Link href="/faturas" className="text-sm text-brand hover:underline">
              {t('Ver faturas')}
            </Link>
          }
        >
          {d.upcoming.length === 0 ? (
            <p className="px-5 py-8 text-center text-ink-soft">
              {t('Nenhuma fatura vence esta semana.')}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {d.upcoming.map((u) => (
                <li key={u.id}>
                  <Link
                    href={`/faturas/${u.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-paper/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {t.label(u.tenant.fullName)}
                      </span>
                      <span className="block truncate text-sm text-ink-soft">
                        {t.label(u.description)}, {t.label(dueText(u.dueDate, d.today))}
                      </span>
                    </span>
                    <Money amount={u.outstanding} currency={u.currency} className="text-ink" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={t('Pagamentos recentes')}
          actions={
            <Link href="/pagamentos" className="text-sm text-brand hover:underline">
              {t('Ver todos')}
            </Link>
          }
        >
          {d.recentPayments.length === 0 ? (
            <p className="px-5 py-8 text-center text-ink-soft">
              {t('Ainda não registou pagamentos.')}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {t.label(p.tenant.fullName)}
                    </span>
                    <span className="block text-sm text-ink-soft">
                      {t.label(paymentMethodLabel[p.method])}, {date(p.paidAt)}
                    </span>
                  </span>
                  <Money amount={p.amount} currency={p.currency} className="text-paid" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  href?: string;
}) {
  const t = useT();
  return (
    <div>
      <dt className="text-sm text-ink-faint">{t.label(label)}</dt>
      <dd className="money mt-0.5 text-xl font-semibold text-ink">{value}</dd>
      {sub && (
        <dd className="text-sm text-ink-soft">
          {href ? (
            <Link href={href} className="text-brand hover:underline">
              {t.label(sub)}
            </Link>
          ) : (
            sub
          )}
        </dd>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="rounded-panel border border-line bg-surface p-7">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-12 w-72" />
        <Skeleton className="mt-6 h-3 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
