'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { Bath, BedDouble, Building2, Ruler } from 'lucide-react';
import {
  LISTING_PURPOSES,
  PROPERTY_TYPES,
  type ListingPurpose,
  type PropertyType,
} from '@rentix/shared';
import { useDebounced, useList } from '@/lib/queries';
import { useFeatures } from '@/lib/features';
import type { ListingCard } from '@/lib/site-types';
import { money } from '@/lib/format';
import { propertyTypeLabel } from '@/i18n/pt';
import { interestStatusLabel, listingPurposeLabel } from '@/i18n/extras';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pagination,
} from '@/components/ui/display';
import { Input, Select } from '@/components/ui/form';
import { SearchBox } from '@/components/search-box';
import { MarketplaceGate, MarketplaceTabs } from '@/components/marketplace/marketplace-tabs';

export default function MarketplacePage() {
  const tr = useT();
  const features = useFeatures();
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [purpose, setPurpose] = useState<ListingPurpose | ''>('');
  const [type, setType] = useState<PropertyType | ''>('');
  const [page, setPage] = useState(1);
  const q = useList<ListingCard>('/marketplace/listings', {
    search: useDebounced(search),
    city: useDebounced(city) || undefined,
    purpose: purpose || undefined,
    propertyType: type || undefined,
    page,
    pageSize: 12,
  });
  const reset = () => setPage(1);

  return (
    <MarketplaceGate enabled={features.MARKETPLACE}>
      <PageHeader
        title={tr('Marketplace')}
        description={tr('Imóveis anunciados por outras imobiliárias e senhorios no Rentix.')}
      />
      <MarketplaceTabs />
      <div className="mb-5 flex flex-col gap-3 md:flex-row">
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            reset();
          }}
          placeholder={tr('Procurar anúncios')}
        />
        <Input
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            reset();
          }}
          placeholder={tr('Cidade')}
          aria-label={tr('Cidade')}
          className="md:w-40"
        />
        <Select
          value={purpose}
          onChange={(e) => {
            setPurpose(e.target.value as ListingPurpose | '');
            reset();
          }}
          aria-label={tr('Objetivo')}
          className="md:w-44"
        >
          <option value="">{tr('Todos os objetivos')}</option>
          {LISTING_PURPOSES.map((p) => (
            <option key={p} value={p}>
              {tr.label(listingPurposeLabel[p])}
            </option>
          ))}
        </Select>
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value as PropertyType | '');
            reset();
          }}
          aria-label={tr('Tipo')}
          className="md:w-44"
        >
          <option value="">{tr('Todos os tipos')}</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {tr.label(propertyTypeLabel[t])}
            </option>
          ))}
        </Select>
      </div>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <LoadingRows />
      ) : q.data.data.length === 0 ? (
        <div className="rounded-panel border border-line bg-surface">
          <EmptyState
            title={tr('Nenhum anúncio encontrado')}
            description={tr('Experimente outros filtros, ou publique o seu.')}
          />
        </div>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.data.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/marketplace/${l.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-panel border border-line bg-surface hover:border-line-strong"
                >
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagens externas do anunciante
                    <img
                      src={l.imageUrl}
                      alt=""
                      className="aspect-[16/10] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="flex aspect-[16/10] items-center justify-center bg-paper text-ink-faint"
                      aria-hidden
                    >
                      <Building2 className="size-10" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="brand">{tr.label(listingPurposeLabel[l.purpose])}</Badge>
                      {l.isMine && <Badge>{tr('Seu')}</Badge>}
                      {l.myInterest && (
                        <Badge tone={l.myInterest === 'ACCEPTED' ? 'paid' : 'neutral'}>
                          {tr.label(interestStatusLabel[l.myInterest])}
                        </Badge>
                      )}
                    </div>
                    <h2 className="mt-2 text-base leading-snug group-hover:text-brand">
                      {tr.label(l.title)}
                    </h2>
                    <p className="text-sm text-ink-soft">
                      {tr.label([l.neighbourhood, l.city].filter(Boolean).join(', '))},{' '}
                      {tr.label(l.organizationName)}
                    </p>
                    <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-sm text-ink-soft">
                      {l.bedrooms !== null && (
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="size-4" aria-hidden />
                          {l.bedrooms}
                        </span>
                      )}
                      {l.bathrooms !== null && (
                        <span className="inline-flex items-center gap-1">
                          <Bath className="size-4" aria-hidden />
                          {l.bathrooms}
                        </span>
                      )}
                      {l.areaM2 !== null && (
                        <span className="inline-flex items-center gap-1">
                          <Ruler className="size-4" aria-hidden />
                          {l.areaM2} m²
                        </span>
                      )}
                      <span className="money ml-auto text-base font-semibold text-ink">
                        {money(l.price, l.currency)}
                      </span>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-panel border border-line bg-surface empty:hidden">
            <Pagination {...q.data.meta} onPage={setPage} />
          </div>
        </>
      )}
    </MarketplaceGate>
  );
}
