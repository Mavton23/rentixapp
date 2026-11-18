'use client';

import { intlLocale } from '@rentix/shared';
import { currentLocale } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  addDays,
  todayIn,
  type AgingBucket,
  type PaymentMethod,
  type ReportExportKind,
} from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useStaffSession } from '@/lib/session';
import { cn, date, money } from '@/lib/format';
import { paymentMethodLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { MonthlyChart, type MonthlyPoint } from '@/components/reports/monthly-chart';

type Money = { currency: string; amount: number }[];
interface Summary {
  range: { from: string; to: string };
  currency: string;
  billed: {
    total: Money;
    byKind: { kind: string; currency: string; amount: number; count: number }[];
  };
  collected: {
    total: Money;
    byMethod: { method: PaymentMethod; currency: string; amount: number; count: number }[];
  };
  collectionRate: { currency: string; due: number; paid: number; rate: number | null }[];
  outstanding: { total: Money; overdue: Money };
  monthly: MonthlyPoint[];
  byProperty: {
    id: string;
    name: string;
    units: number;
    occupied: number;
    billed: number;
    collected: number;
    outstanding: number;
  }[];
}
interface Aging {
  today: string;
  rows: {
    tenant: { id: string; fullName: string; phone: string };
    units: string[];
    currency: string;
    buckets: Record<AgingBucket, number>;
    total: number;
    oldestDueDate: string;
    invoices: number;
  }[];
  totals: { currency: string; buckets: Record<AgingBucket, number>; total: number }[];
}

const KIND: Record<string, string> = {
  RENT: 'Rendas',
  DEPOSIT: 'Cauções',
  LATE_FEE: 'Multas',
  OTHER: 'Outros',
};
const BUCKETS: { key: AgingBucket; label: string }[] = [
  { key: 'current', label: 'Por vencer' },
  { key: 'd1_30', label: '1–30 dias' },
  { key: 'd31_60', label: '31–60 dias' },
  { key: 'd61_90', label: '61–90 dias' },
  { key: 'd90_plus', label: '+90 dias' },
];

const pick = (m: Money, c: string) => m.find((x) => x.currency === c)?.amount ?? 0;
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => addDays(`${shiftMonth(iso.slice(0, 7), 1)}-01`, -1);
function shiftMonth(p: string, n: number) {
  const [y, m] = p.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const monthName = (iso: string) => {
  const s = new Intl.DateTimeFormat(intlLocale(currentLocale()), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function ReportsPage() {
  const t = useT();
  const { session } = useStaffSession();
  const today = todayIn();
  const [range, setRange] = useState({ from: monthStart(today), to: today });
  const isWholeMonth =
    range.from === monthStart(range.from) &&
    (range.to === monthEnd(range.from) || (range.to === today && monthStart(today) === range.from));
  const role = session?.organization?.role;
  const allowed = role === 'OWNER' || role === 'MANAGER' || role === 'ACCOUNTANT';

  const summary = useQuery({
    queryKey: ['report-summary', range],
    queryFn: () => staffApi.get<Summary>('/reports/summary', range),
    enabled: allowed,
  });
  const aging = useQuery({
    queryKey: ['report-aging'],
    queryFn: () => staffApi.get<Aging>('/reports/aging'),
    enabled: allowed,
  });

  if (session && !allowed)
    return (
      <p className="py-20 text-center text-ink-soft">
        {t('Os relatórios estão disponíveis para proprietários, gestores e contabilistas.')}
      </p>
    );

  const goMonth = (n: number) => {
    const p = shiftMonth(range.from.slice(0, 7), n);
    const end = monthEnd(`${p}-01`);
    setRange({ from: `${p}-01`, to: end > today ? today : end });
  };

  return (
    <>
      <PageHeader
        title={t('Relatórios')}
        description={t(
          'Faturado, cobrado e em dívida, para acompanhar o negócio e enviar ao contabilista.',
        )}
      />

      <div className="mb-6 flex flex-col gap-3 rounded-panel border border-line bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => goMonth(-1)}
            aria-label={t('Mês anterior')}
          >
            <ChevronLeft />
          </Button>
          <p className="min-w-44 text-center font-display text-lg font-semibold">
            {isWholeMonth ? monthName(range.from) : `${date(range.from)} – ${date(range.to)}`}
          </p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => goMonth(1)}
            disabled={monthStart(range.from) >= monthStart(today)}
            aria-label={t('Mês seguinte')}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className="rounded-control px-2.5 py-1.5 hover:bg-paper"
            onClick={() => setRange({ from: `${today.slice(0, 4)}-01-01`, to: today })}
          >
            {t('Este ano')}
          </button>
          <button
            className="rounded-control px-2.5 py-1.5 hover:bg-paper"
            onClick={() =>
              setRange({
                from: `${Number(today.slice(0, 4)) - 1}-01-01`,
                to: `${Number(today.slice(0, 4)) - 1}-12-31`,
              })
            }
          >
            {t('Ano passado')}
          </button>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-soft">{t('De')}</span>
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
              className="h-9 w-40"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-soft">a</span>
            <Input
              type="date"
              value={range.to}
              min={range.from}
              max={today}
              onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
              className="h-9 w-40"
            />
          </label>
        </div>
      </div>

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : !summary.data ? (
        <LoadingRows rows={8} />
      ) : (
        <SummaryView s={summary.data} />
      )}

      <AgingPanel q={aging} />
      <ExportPanel range={range} />
    </>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'overdue';
}) {
  const t = useT();
  return (
    <div className="rounded-panel border border-line bg-surface px-5 py-4">
      <p className="text-sm text-ink-soft">{t.label(label)}</p>
      <p
        className={cn(
          'money mt-1 font-display text-2xl font-semibold',
          tone === 'overdue' && 'text-overdue',
        )}
      >
        {t.label(value)}
      </p>
      {note && <p className="mt-0.5 text-xs text-ink-faint">{t.label(note)}</p>}
    </div>
  );
}

function SummaryView({ s }: { s: Summary }) {
  const t = useT();
  const c = s.currency;
  const rate = s.collectionRate.find((r) => r.currency === c);
  const others = [
    ...new Set([...s.billed.total, ...s.collected.total].map((x) => x.currency)),
  ].filter((x) => x !== c);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={t('Faturado')}
          value={money(pick(s.billed.total, c), c)}
          note={t('faturas emitidas no período')}
        />
        <Tile
          label={t('Cobrado')}
          value={money(pick(s.collected.total, c), c)}
          note={t('pagamentos recebidos no período')}
        />
        <Tile
          label={t('Taxa de cobrança')}
          value={rate?.rate === null || !rate ? '—' : `${rate.rate.toLocaleString(intlLocale(currentLocale()))}%`}
          note={
            rate
              ? t('{money} de {money2} que venceram', {
                  money: money(rate.paid, c),
                  money2: money(rate.due, c),
                })
              : t('nada venceu no período')
          }
        />
        <Tile
          label={t('Em dívida (vencido)')}
          value={money(pick(s.outstanding.overdue, c), c)}
          note={t('{money} em aberto no total, hoje', {
            money: money(pick(s.outstanding.total, c), c),
          })}
          tone={pick(s.outstanding.overdue, c) > 0 ? 'overdue' : undefined}
        />
      </div>
      {others.length > 0 && (
        <p className="text-sm text-ink-soft">
          {t('Também em {0}: faturado {1}; cobrado {2}.', {
            '0': others.join(', '),
            '1': others.map((o) => money(pick(s.billed.total, o), o)).join(', '),
            '2': others.map((o) => money(pick(s.collected.total, o), o)).join(', '),
          })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={t('Últimos 12 meses')}>
          <div className="px-5 py-4">
            <MonthlyChart data={s.monthly} currency={c} />
          </div>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title={t('Recebido por meio')}>
            {s.collected.byMethod.length === 0 ? (
              <p className="px-5 py-6 text-center text-ink-soft">
                {t('Sem pagamentos no período.')}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {s.collected.byMethod.map((m) => (
                  <li
                    key={`${m.method}${m.currency}`}
                    className="flex justify-between px-5 py-2.5 text-sm"
                  >
                    <span>
                      {t.label(paymentMethodLabel[m.method])}{' '}
                      <span className="text-ink-faint">({m.count})</span>
                    </span>
                    <span className="money">{money(m.amount, m.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('Faturado por tipo')}>
            {s.billed.byKind.length === 0 ? (
              <p className="px-5 py-6 text-center text-ink-soft">{t('Sem faturas no período.')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {s.billed.byKind.map((k) => (
                  <li
                    key={`${k.kind}${k.currency}`}
                    className="flex justify-between px-5 py-2.5 text-sm"
                  >
                    <span>
                      {t.label(KIND[k.kind] ?? k.kind)} <span className="text-ink-faint">({k.count})</span>
                    </span>
                    <span className="money">{money(k.amount, k.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title={t('Por imóvel')}>
        {s.byProperty.length === 0 ? (
          <p className="px-5 py-6 text-center text-ink-soft">{t('Ainda sem imóveis.')}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t('Imóvel')}</Th>
                <Th className="hidden text-right sm:table-cell">{t('Ocupação')}</Th>
                <Th className="text-right">{t('Faturado')}</Th>
                <Th className="text-right">{t('Cobrado')}</Th>
                <Th className="hidden text-right sm:table-cell">{t('Em aberto hoje')}</Th>
              </tr>
            </thead>
            <tbody>
              {s.byProperty.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/imoveis/${p.id}`} className="font-medium hover:text-brand">
                      {t.label(p.name)}
                    </Link>
                  </Td>
                  <Td className="money hidden text-right sm:table-cell">
                    {t('{occupied} de {units}', { occupied: p.occupied, units: p.units })}
                  </Td>
                  <Td className="money text-right">{money(p.billed, c)}</Td>
                  <Td className="money text-right">{money(p.collected, c)}</Td>
                  <Td
                    className={cn(
                      'money hidden text-right sm:table-cell',
                      p.outstanding > 0 && 'text-overdue',
                    )}
                  >
                    {money(p.outstanding, c)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function AgingPanel({ q }: { q: { data?: Aging; isLoading: boolean } }) {
  const tr = useT();
  const a = q.data;
  return (
    <Panel title={tr('Dívidas por antiguidade')} className="mt-6">
      {!a ? (
        <LoadingRows rows={3} />
      ) : a.rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-ink-soft">
          {tr('Nenhum inquilino com valores em aberto.')}
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{tr('Inquilino')}</Th>
              {BUCKETS.map((b) => (
                <Th
                  key={b.key}
                  className={cn(
                    'text-right',
                    b.key === 'current' || b.key === 'd31_60' || b.key === 'd61_90'
                      ? 'hidden md:table-cell'
                      : '',
                  )}
                >
                  {tr.label(b.label)}
                </Th>
              ))}
              <Th className="text-right">{tr('Total')}</Th>
            </tr>
          </thead>
          <tbody>
            {a.rows.map((r) => (
              <Tr key={`${r.tenant.id}${r.currency}`}>
                <Td>
                  <Link
                    href={`/inquilinos/${r.tenant.id}`}
                    className="font-medium hover:text-brand"
                  >
                    {tr.label(r.tenant.fullName)}
                  </Link>
                  <span className="block text-ink-faint">{tr.label(r.units.join('; '))}</span>
                </Td>
                {BUCKETS.map((b) => (
                  <Td
                    key={b.key}
                    className={cn(
                      'money text-right',
                      b.key === 'current' || b.key === 'd31_60' || b.key === 'd61_90'
                        ? 'hidden md:table-cell'
                        : '',
                      r.buckets[b.key] === 0
                        ? 'text-ink-faint'
                        : b.key !== 'current' && 'text-overdue',
                    )}
                  >
                    {r.buckets[b.key] === 0 ? '—' : money(r.buckets[b.key], r.currency)}
                  </Td>
                ))}
                <Td className="money text-right font-medium">{money(r.total, r.currency)}</Td>
              </Tr>
            ))}
            {a.totals.map((t) => (
              <tr key={t.currency} className="bg-paper font-medium">
                <Td>{tr('Total')}</Td>
                {BUCKETS.map((b) => (
                  <Td
                    key={b.key}
                    className={cn(
                      'money text-right',
                      b.key === 'current' || b.key === 'd31_60' || b.key === 'd61_90'
                        ? 'hidden md:table-cell'
                        : '',
                    )}
                  >
                    {money(t.buckets[b.key], t.currency)}
                  </Td>
                ))}
                <Td className="money text-right">{money(t.total, t.currency)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

const EXPORTS: { kind: ReportExportKind; title: string; text: string; ranged: boolean }[] = [
  {
    kind: 'invoices',
    title: 'Faturas',
    text: 'Todas as faturas emitidas no período, com valores pagos e em dívida.',
    ranged: true,
  },
  {
    kind: 'payments',
    title: 'Pagamentos',
    text: 'Recibos do período, com meio de pagamento e referência.',
    ranged: true,
  },
  {
    kind: 'aging',
    title: 'Dívidas',
    text: 'Situação de hoje, por inquilino e antiguidade.',
    ranged: false,
  },
  {
    kind: 'tenants',
    title: 'Inquilinos',
    text: 'Ficha de cada inquilino ativo, contrato e dívida.',
    ranged: false,
  },
];

function ExportPanel({ range }: { range: { from: string; to: string } }) {
  const t = useT();
  const [busy, setBusy] = useState<ReportExportKind | null>(null);
  async function download(kind: ReportExportKind, ranged: boolean) {
    setBusy(kind);
    try {
      const qs = ranged ? `?from=${range.from}&to=${range.to}` : '';
      await staffApi.download(`/reports/export/${kind}${qs}`, `${kind}.xlsx`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível exportar'));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel title={t('Exportar para Excel')} className="mt-6">
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {EXPORTS.map((e) => (
          <div key={e.kind} className="flex flex-col gap-3 px-5 py-4">
            <div>
              <p className="font-medium">{t.label(e.title)}</p>
              <p className="text-sm text-ink-soft">{t.label(e.text)}</p>
              {e.ranged && (
                <p className="mt-1 text-xs text-ink-faint">
                  {date(range.from)} a {date(range.to)}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-auto self-start"
              loading={busy === e.kind}
              onClick={() => download(e.kind, e.ranged)}
            >
              <Download aria-hidden /> {t('Descarregar .xlsx')}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
