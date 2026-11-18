'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SubscriptionStatus } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useDebounced } from '@/lib/queries';
import type { Paginated } from '@/lib/types';
import type { AdminOrgRow } from '@/lib/platform-types';
import { instantDate } from '@/lib/format';
import { subscriptionStatusLabel } from '@/i18n/platform';
import { Badge, EmptyState, FilterTabs, LoadingRows, PageHeader, Pagination, Panel } from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';

type Filter = 'ALL' | SubscriptionStatus | 'SUSPENDED';

export default function AdminOrganizationsPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const q = useQuery({
    queryKey: ['admin-orgs', filter, debounced, page],
    queryFn: () =>
      staffApi.get<Paginated<AdminOrgRow>>('/admin/organizations', {
        page,
        search: debounced || undefined,
        status: filter === 'SUSPENDED' ? 'SUSPENDED' : undefined,
        subscriptionStatus: filter !== 'ALL' && filter !== 'SUSPENDED' ? filter : undefined,
      }),
  });

  return (
    <>
      <PageHeader title="Organizações" />
      <Panel>
        <FilterTabs<Filter>
          value={filter}
          onChange={(v) => { setFilter(v); setPage(1); }}
          options={[
            { value: 'ALL', label: 'Todas' },
            { value: 'TRIALING', label: 'Em teste' },
            { value: 'ACTIVE', label: 'Ativas' },
            { value: 'PAST_DUE', label: 'Em atraso' },
            { value: 'SUSPENDED', label: 'Suspensas' },
          ]}
        />
        <div className="border-b border-line px-5 py-3">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Nome, email do proprietário ou NUIT" />
        </div>
        {!q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState title="Nenhuma organização" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Organização</Th>
                  <Th>Plano</Th>
                  <Th className="hidden text-right md:table-cell">Unidades</Th>
                  <Th className="hidden text-right md:table-cell">Inquilinos</Th>
                  <Th className="hidden lg:table-cell">Criada</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((o) => (
                  <Tr key={o.id}>
                    <Td>
                      <Link href={`/admin/organizacoes/${o.id}`} className="font-medium hover:text-brand">{o.name}</Link>
                      {o.status === 'SUSPENDED' && <Badge tone="overdue" className="ml-2">Suspensa</Badge>}
                      <span className="block text-ink-faint">{o.owner ? `${o.owner.name}, ${o.owner.email}` : 'Sem proprietário'}</span>
                    </Td>
                    <Td>
                      {o.plan?.name ?? '—'}
                      {o.subscriptionStatus && o.plan?.code !== 'FREE' && (
                        <span className="block text-ink-faint">
                          {subscriptionStatusLabel[o.subscriptionStatus]}
                          {o.currentPeriodEnd && `, até ${instantDate(o.currentPeriodEnd, { until: true })}`}
                        </span>
                      )}
                    </Td>
                    <Td className="money hidden text-right md:table-cell">{o.counts.units}</Td>
                    <Td className="money hidden text-right md:table-cell">{o.counts.tenants}</Td>
                    <Td className="hidden text-ink-soft lg:table-cell">{instantDate(o.createdAt)}</Td>
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
