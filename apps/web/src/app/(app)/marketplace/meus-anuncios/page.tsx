'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { useList } from '@/lib/queries';
import { useFeatures } from '@/lib/features';
import type { ListingInterestRow, MyListing } from '@/lib/site-types';
import { date, money } from '@/lib/format';
import { interestStatusLabel, listingStatusLabel } from '@/i18n/extras';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  Pagination,
  Panel,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { ListingForm, listingBody } from '@/components/marketplace/listing-form';
import { FilesPanel } from '@/components/files-panel';
import { MarketplaceGate, MarketplaceTabs } from '@/components/marketplace/marketplace-tabs';

const STATUS_TONE = {
  PENDING_REVIEW: 'due',
  ACTIVE: 'paid',
  REJECTED: 'overdue',
  EXPIRED: 'neutral',
  CLOSED: 'neutral',
} as const;

export default function MyListingsPage() {
  const t = useT();
  const features = useFeatures();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MyListing | 'new' | null>(null);
  const [photosOf, setPhotosOf] = useState<{ id: string; title: string } | null>(null);
  const [interestsOf, setInterestsOf] = useState<MyListing | null>(null);
  const q = useList<MyListing>('/marketplace/my-listings', { page, pageSize: 20 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['/marketplace/my-listings'] });

  async function act(l: MyListing, action: 'close' | 'renew') {
    if (
      action === 'close' &&
      !confirm(
        t('Fechar o anúncio "{title}"? Deixa de aparecer no marketplace.', { title: l.title }),
      )
    )
      return;
    try {
      await staffApi.post(`/marketplace/my-listings/${l.id}/${action}`);
      toast.success(action === 'close' ? t('Anúncio fechado') : t('Anúncio renovado'));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível concluir'));
    }
  }

  return (
    <MarketplaceGate enabled={features.MARKETPLACE}>
      <PageHeader
        title={t('Marketplace')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t('Novo anúncio')}
          </Button>
        }
      />
      <MarketplaceTabs />
      <Panel>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState
            title={t('Ainda não publicou anúncios')}
            description={t(
              'Anuncie imóveis a outras imobiliárias: para arrendar a clientes delas, vender ou passar a gestão.',
            )}
            action={<Button onClick={() => setEditing('new')}>{t('Novo anúncio')}</Button>}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t('Anúncio')}</Th>
                  <Th>{t('Estado')}</Th>
                  <Th className="hidden md:table-cell">{t('Interessados')}</Th>
                  <Th className="w-0" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <Link href={`/marketplace/${l.id}`} className="font-medium hover:text-brand">
                        {t.label(l.title)}
                      </Link>
                      <span className="block text-ink-faint">
                        <span className="money">{money(l.price, l.currency)}</span>
                        {t(', {city}, expira a {date}', {
                          city: l.city,
                          date: date(l.expiresAt.slice(0, 10)),
                        })}
                      </span>
                      {l.status === 'REJECTED' && l.rejectionReason && (
                        <span className="block text-sm text-overdue">
                          {t('Motivo: {rejectionReason}', { rejectionReason: l.rejectionReason })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[l.status]}>
                        {t.label(listingStatusLabel[l.status])}
                      </Badge>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <button
                        className="text-brand hover:underline disabled:text-ink-faint disabled:no-underline"
                        disabled={l.interestsCount === 0}
                        onClick={() => setInterestsOf(l)}
                      >
                        {l.interestsCount}
                        {l.pendingInterests > 0 &&
                          t(' ({pendingInterests} por responder)', {
                            pendingInterests: l.pendingInterests,
                          })}
                      </button>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {l.interestsCount > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="md:hidden"
                          onClick={() => setInterestsOf(l)}
                        >
                          {t('Interessados')}
                        </Button>
                      )}
                      {l.status !== 'CLOSED' && (
                        <Button size="sm" variant="ghost" onClick={() => setPhotosOf(l)}>
                          {t('Fotografias')}
                          {l.imageUrls.length > 0 && ` (${l.imageUrls.length})`}
                        </Button>
                      )}
                      {l.status !== 'CLOSED' && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                          {t('Editar')}
                        </Button>
                      )}
                      {l.status === 'EXPIRED' && (
                        <Button size="sm" variant="ghost" onClick={() => act(l, 'renew')}>
                          {t('Renovar')}
                        </Button>
                      )}
                      {(l.status === 'ACTIVE' || l.status === 'PENDING_REVIEW') && (
                        <Button size="sm" variant="ghost" onClick={() => act(l, 'close')}>
                          {t('Fechar')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </Panel>

      <Dialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? t('Novo anúncio') : t('Editar anúncio')}
      >
        {editing && (
          <ListingForm
            listing={editing === 'new' ? undefined : editing}
            onSubmit={async (v) => {
              if (editing === 'new') {
                const created = await staffApi.post<MyListing>(
                  '/marketplace/my-listings',
                  listingBody(v, true),
                );
                toast.success(t("Anúncio criado. Acrescente as fotografias."));
                setEditing(null);
                setPhotosOf(created);
              } else {
                await staffApi.patch(
                  `/marketplace/my-listings/${editing.id}`,
                  listingBody(v, false),
                );
                toast.success(t("Anúncio enviado para revisão"));
                setEditing(null);
              }
              refresh();
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={!!photosOf}
        onOpenChange={(o) => !o && (setPhotosOf(null), refresh())}
        title={t('Fotografias do anúncio')}
        description={t.label(photosOf?.title)}
      >
        {photosOf && (
          <div className="-mx-6 -mb-6">
            <FilesPanel
              ownerType="LISTING"
              ownerId={photosOf.id}
              categories={['PHOTO']}
              canEdit
              imagesOnly
              title={t('Fotografias')}
              description={t(
                'Até 10. A primeira é a capa. Mudar as fotografias envia o anúncio de novo para revisão. A localização gravada pelo telemóvel é removida.',
              )}
            />
          </div>
        )}
      </Dialog>

      <InterestsDialog
        listing={interestsOf}
        onOpenChange={(o) => !o && setInterestsOf(null)}
        onChanged={refresh}
      />
    </MarketplaceGate>
  );
}

function InterestsDialog({
  listing,
  onOpenChange,
  onChanged,
}: {
  listing: MyListing | null;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const q = useQuery({
    queryKey: ['listing-interests', listing?.id],
    queryFn: () =>
      staffApi.get<ListingInterestRow[]>(`/marketplace/my-listings/${listing!.id}/interests`),
    enabled: !!listing,
  });
  async function respond(i: ListingInterestRow, status: 'ACCEPTED' | 'DECLINED') {
    try {
      await staffApi.patch(`/marketplace/my-listings/${listing!.id}/interests/${i.id}`, { status });
      toast.success(
        status === 'ACCEPTED'
          ? t('Aceite. Os contactos foram partilhados.')
          : t('Interesse recusado'),
      );
      q.refetch();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível responder'));
    }
  }
  return (
    <Dialog
      open={!!listing}
      onOpenChange={onOpenChange}
      title={t('Interessados')}
      description={t.label(listing?.title)}
    >
      {!q.data ? (
        <LoadingRows rows={2} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{t.label(i.organizationName)}</p>
                  {i.contactName && (
                    <p className="text-sm text-ink-soft">{t.label(i.contactName)}</p>
                  )}
                </div>
                <Badge
                  tone={
                    i.status === 'ACCEPTED' ? 'paid' : i.status === 'DECLINED' ? 'neutral' : 'due'
                  }
                >
                  {t.label(interestStatusLabel[i.status])}
                </Badge>
              </div>
              {i.message && <p className="mt-2 text-sm">“{t.label(i.message)}”</p>}
              {i.contact && (
                <p className="mt-2 text-sm">
                  <a href={`mailto:${i.contact.email}`} className="text-brand">
                    {t.label(i.contact.email)}
                  </a>
                  {i.contact.phone && (
                    <>
                      ,{' '}
                      <a href={`tel:${i.contact.phone}`} className="text-brand">
                        {t.label(i.contact.phone)}
                      </a>
                    </>
                  )}
                </p>
              )}
              {i.status === 'PENDING' && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => respond(i, 'ACCEPTED')}>
                    {t('Aceitar e partilhar contactos')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => respond(i, 'DECLINED')}>
                    {t('Recusar')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
