'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { todayIn } from '@rentix/shared';
import { useDebounced, useList } from '@/lib/queries';
import type { InvoiceListItem } from '@/lib/types';
import { dueText, date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  InvoiceStatusBadge,
  LoadingRows,
  Money,
  PageHeader,
  Pagination,
  Panel,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';
import { RecordPaymentDialog } from '@/components/record-payment-dialog';

type Filter = 'open' | 'overdue' | 'paid' | 'void' | 'all';

const FILTERS: Record<Filter, Record<string, string | boolean | undefined>> = {
  open: { unpaid: true },
  overdue: { overdue: true },
  paid: { status: 'PAID' },
  void: { status: 'VOID' },
  all: {},
};

function InvoicesList() {
  const t = useT();
  const params = useSearchParams();
  const tenantId = params.get('inquilino') ?? undefined;
  const [filter, setFilter] = useState<Filter>(
    params.get('estado') === 'atraso' ? 'overdue' : tenantId ? 'all' : 'open',
  );
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<InvoiceListItem | null>(null);
  const today = todayIn();

  const q = useList<InvoiceListItem>('/invoices', {
    ...FILTERS[filter],
    tenantId,
    search: useDebounced(search),
    page,
    pageSize: 25,
  });
  const rows = q.data?.data;

  return (
    <>
      <PageHeader
        title={t('Faturas')}
        description={t('As rendas são faturadas automaticamente no início de cada mês.')}
        back={
          tenantId
            ? { href: `/inquilinos/${tenantId}`, label: t('Voltar ao inquilino') }
            : undefined
        }
      />
      <Panel>
        <FilterTabs<Filter>
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: 'open', label: t('Por pagar') },
            { value: 'overdue', label: t('Em atraso') },
            { value: 'paid', label: 'Pagas' },
            { value: 'void', label: 'Anuladas' },
            { value: 'all', label: 'Todas' },
          ]}
        />
        <div className="border-b border-line px-5 py-3">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={t('Número ou inquilino')}
          />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !rows ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState title={filter === 'overdue' ? t('Nada em atraso') : t('Sem faturas')} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t('Inquilino')}</Th>
                  <Th className="hidden md:table-cell">{t('Fatura')}</Th>
                  <Th>{t('Vencimento')}</Th>
                  <Th className="text-right">{t('Em dívida')}</Th>
                  <Th className="w-0" />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link
                        href={`/faturas/${i.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {t.label(i.tenant.fullName)}
                      </Link>
                      <span className="block text-ink-faint">
                        {t.label(i.lease.unit.property.name)}, {t.label(i.lease.unit.label)}
                      </span>
                    </Td>
                    <Td className="hidden text-ink-soft md:table-cell">
                      {t.label(i.description)}
                      <span className="block text-ink-faint">{t.label(i.number)}</span>
                    </Td>
                    <Td>
                      <InvoiceStatusBadge status={i.status} overdue={i.isOverdue} />
                      <span className="mt-1 block text-ink-faint">
                        {i.outstanding > 0 ? dueText(i.dueDate, today) : date(i.dueDate)}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <Money
                        amount={i.outstanding}
                        currency={i.currency}
                        className={i.isOverdue ? 'text-overdue' : undefined}
                      />
                      {i.paidAmount > 0 && i.outstanding > 0 && (
                        <span className="block text-ink-faint">
                          {t('de')} <Money amount={i.amount} currency={i.currency} />
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {i.outstanding > 0 && (
                        <Button size="sm" variant="secondary" onClick={() => setPaying(i)}>
                          {t('Registar pagamento')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data!.meta} onPage={setPage} />
          </>
        )}
      </Panel>
      <RecordPaymentDialog
        invoice={paying}
        onOpenChange={(o) => !o && setPaying(null)}
        onDone={() => q.refetch()}
      />
    </>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoicesList />
    </Suspense>
  );
}
