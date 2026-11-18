'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDebounced, useList } from '@/lib/queries';
import type { TenantListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingRows,
  Money,
  PageHeader,
  Pagination,
  Panel,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';

export default function TenantsPage() {
  const tr = useT();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useList<TenantListItem>('/tenants', {
    search: useDebounced(search),
    page,
    pageSize: 20,
  });

  return (
    <>
      <PageHeader
        title={tr('Inquilinos')}
        actions={
          <Button asChild>
            <Link href="/inquilinos/novo">
              <Plus aria-hidden /> {tr('Novo inquilino')}
            </Link>
          </Button>
        }
      />
      <Panel>
        <div className="border-b border-line px-5 py-3">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={tr('Nome, telefone ou documento')}
          />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          search ? (
            <EmptyState title={tr('Nenhum inquilino encontrado')} />
          ) : (
            <EmptyState
              title={tr('Ainda não tem inquilinos')}
              description={tr('Registe os dados do inquilino para depois criar o contrato.')}
              action={
                <Button asChild>
                  <Link href="/inquilinos/novo">{tr('Novo inquilino')}</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{tr('Nome')}</Th>
                  <Th className="hidden md:table-cell">{tr('Contacto')}</Th>
                  <Th>{tr('Arrenda')}</Th>
                  <Th className="hidden text-right sm:table-cell">{tr('Renda')}</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((t) => {
                  const lease = t.leases[0];
                  return (
                    <Tr key={t.id}>
                      <Td>
                        <Link
                          href={`/inquilinos/${t.id}`}
                          className="font-medium text-ink hover:text-brand"
                        >
                          {tr.label(t.fullName)}
                        </Link>
                        {t.portalEnabled && (
                          <Badge tone="brand" className="ml-2 align-middle">
                            {tr('Portal')}
                          </Badge>
                        )}
                      </Td>
                      <Td className="hidden text-ink-soft md:table-cell">
                        {tr.label(t.phone)}
                        {t.email && (
                          <span className="block text-ink-faint">{tr.label(t.email)}</span>
                        )}
                      </Td>
                      <Td className="text-ink-soft">
                        {lease ? (
                          <>
                            {tr.label(lease.unit.property.name)}
                            <span className="block text-ink-faint">
                              {tr.label(lease.unit.label)}
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-faint">{tr('Sem contrato ativo')}</span>
                        )}
                      </Td>
                      <Td className="hidden text-right sm:table-cell">
                        {lease ? (
                          <Money amount={lease.rentAmount} currency={lease.currency} />
                        ) : (
                          '—'
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
