'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDebounced, useList } from '@/lib/queries';
import type { PropertyListItem } from '@/lib/types';
import { propertyTypeLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pagination,
  Panel,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';

export default function PropertiesPage() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useList<PropertyListItem>('/properties', {
    search: useDebounced(search),
    page,
    pageSize: 20,
  });

  return (
    <>
      <PageHeader
        title={t('Imóveis')}
        actions={
          <Button asChild>
            <Link href="/imoveis/novo">
              <Plus aria-hidden /> {t('Registar imóvel')}
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
            placeholder={t('Procurar por nome ou morada')}
          />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          search ? (
            <EmptyState
              title={t('Nenhum imóvel encontrado')}
              description={t('Experimente outro nome ou morada.')}
            />
          ) : (
            <EmptyState
              title={t('Ainda não tem imóveis')}
              description={t('Registe uma casa, um prédio com vários apartamentos ou uma loja.')}
              action={
                <Button asChild>
                  <Link href="/imoveis/novo">{t('Registar imóvel')}</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t('Imóvel')}</Th>
                  <Th className="hidden md:table-cell">{t('Tipo')}</Th>
                  <Th className="text-right">{t('Ocupação')}</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link
                        href={`/imoveis/${p.id}`}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {t.label(p.name)}
                      </Link>
                      <span className="block text-ink-soft">
                        {t.label([p.street, p.neighbourhood, p.city].filter(Boolean).join(', '))}
                      </span>
                    </Td>
                    <Td className="hidden text-ink-soft md:table-cell">
                      {t.label(propertyTypeLabel[p.type])}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <span className="money text-ink">
                        {p.stats.occupied}/{p.stats.units}
                      </span>
                      <span className="block text-ink-faint">
                        {p.stats.units === 1 ? 'unidade' : 'unidades'}
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
