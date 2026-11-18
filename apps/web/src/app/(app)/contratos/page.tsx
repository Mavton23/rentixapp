'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { LeaseStatus } from '@rentix/shared';
import { useDebounced, useList } from '@/lib/queries';
import type { LeaseListItem } from '@/lib/types';
import { date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  LeaseStatusBadge,
  LoadingRows,
  Money,
  PageHeader,
  Pagination,
  Panel,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';

type Filter = LeaseStatus | 'ALL';

export default function LeasesPage() {
  const t = useT();
  const [status, setStatus] = useState<Filter>('ACTIVE');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useList<LeaseListItem>('/leases', {
    status: status === 'ALL' ? undefined : status,
    search: useDebounced(search),
    page,
  });

  return (
    <>
      <PageHeader
        title={t('Contratos')}
        actions={
          <Button asChild>
            <Link href="/contratos/novo">
              <Plus aria-hidden /> {t('Novo contrato')}
            </Link>
          </Button>
        }
      />
      <Panel>
        <FilterTabs<Filter>
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'ACTIVE', label: 'Ativos' },
            { value: 'DRAFT', label: 'Rascunhos' },
            { value: 'ENDED', label: 'Terminados' },
            { value: 'TERMINATED', label: 'Rescindidos' },
            { value: 'ALL', label: 'Todos' },
          ]}
        />
        <div className="border-b border-line px-5 py-3">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={t('Inquilino ou imóvel')}
          />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState
            title={t('Nenhum contrato aqui')}
            description={
              status === 'ACTIVE'
                ? t('Crie um contrato para começar a faturar a renda automaticamente.')
                : undefined
            }
            action={
              status === 'ACTIVE' ? (
                <Button asChild>
                  <Link href="/contratos/novo">{t('Novo contrato')}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t('Inquilino')}</Th>
                  <Th>{t('Imóvel')}</Th>
                  <Th className="hidden md:table-cell">{t('Período')}</Th>
                  <Th className="hidden sm:table-cell">{t('Estado')}</Th>
                  <Th className="text-right">{t('Renda')}</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <Link
                        href={`/contratos/${l.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {t.label(l.tenant.fullName)}
                      </Link>
                    </Td>
                    <Td className="text-ink-soft">
                      {t.label(l.unit.property.name)}
                      <span className="block text-ink-faint">{t.label(l.unit.label)}</span>
                    </Td>
                    <Td className="hidden text-ink-soft md:table-cell">
                      {date(l.startDate)} – {l.endDate ? date(l.endDate) : t('sem termo')}
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <LeaseStatusBadge status={l.status} />
                    </Td>
                    <Td className="text-right">
                      <Money amount={l.rentAmount} currency={l.currency} />
                      <span className="block text-ink-faint">
                        {t('dia {billingDay}', { billingDay: l.billingDay })}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
