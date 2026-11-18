'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { InterestStatus } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useFeatures } from '@/lib/features';
import type { ListingCard, ListingContact } from '@/lib/site-types';
import { date, money } from '@/lib/format';
import { interestStatusLabel, listingStatusLabel } from '@/i18n/extras';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Panel,
} from '@/components/ui/display';
import { MarketplaceGate, MarketplaceTabs } from '@/components/marketplace/marketplace-tabs';

interface MyInterest {
  id: string;
  status: InterestStatus;
  message: string | null;
  createdAt: string;
  listing: ListingCard;
  contact: ListingContact | null;
}

export default function MyInterestsPage() {
  const t = useT();
  const features = useFeatures();
  const q = useQuery({
    queryKey: ['my-interests'],
    queryFn: () => staffApi.get<MyInterest[]>('/marketplace/my-interests'),
  });

  return (
    <MarketplaceGate enabled={features.MARKETPLACE}>
      <PageHeader title={t('Marketplace')} />
      <MarketplaceTabs />
      <Panel>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.length === 0 ? (
          <EmptyState
            title={t('Ainda não mostrou interesse em nenhum anúncio')}
            action={
              <Link href="/marketplace" className="text-brand hover:underline">
                {t('Explorar anúncios')}
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/marketplace/${i.listing.id}`}
                    className="font-medium hover:text-brand"
                  >
                    {t.label(i.listing.title)}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    {t.label(i.listing.organizationName)},{' '}
                    <span className="money">{money(i.listing.price, i.listing.currency)}</span>
                    {t(', enviado a {date}', { date: date(i.createdAt.slice(0, 10)) })}
                  </p>
                  {i.contact && (
                    <p className="mt-2 text-sm">
                      {i.contact.name ?? i.contact.organization}
                      {i.contact.phone && (
                        <>
                          :{' '}
                          <a href={`tel:${i.contact.phone}`} className="text-brand">
                            {t.label(i.contact.phone)}
                          </a>
                        </>
                      )}
                      {i.contact.email && (
                        <>
                          ,{' '}
                          <a href={`mailto:${i.contact.email}`} className="text-brand">
                            {t.label(i.contact.email)}
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {i.listing.status !== 'ACTIVE' && (
                    <Badge>{t.label(listingStatusLabel[i.listing.status])}</Badge>
                  )}
                  <Badge
                    tone={
                      i.status === 'ACCEPTED' ? 'paid' : i.status === 'DECLINED' ? 'neutral' : 'due'
                    }
                  >
                    {t.label(interestStatusLabel[i.status])}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </MarketplaceGate>
  );
}
