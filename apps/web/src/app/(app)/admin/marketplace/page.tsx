'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LISTING_STATUSES, type ListingStatus, type ReportReason } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import type { Paginated } from '@/lib/types';
import type { MyListing } from '@/lib/site-types';
import { date, money } from '@/lib/format';
import { propertyTypeLabel } from '@/i18n/pt';
import { listingPurposeLabel, listingStatusLabel, reportReasonLabel } from '@/i18n/extras';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, FilterTabs, LoadingRows, PageHeader, Panel } from '@/components/ui/display';

type AdminListing = MyListing & { organizationName: string; openReports: number };
interface Report {
  id: string;
  reason: ReportReason;
  description: string | null;
  createdAt: string;
  listing: { id: string; title: string; status: ListingStatus };
}

export default function AdminMarketplacePage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ListingStatus>('PENDING_REVIEW');
  const listings = useQuery({
    queryKey: ['admin-listings', status],
    queryFn: () => staffApi.get<Paginated<AdminListing>>('/admin/marketplace/listings', { status, pageSize: 50 }),
  });
  const reports = useQuery({ queryKey: ['admin-reports'], queryFn: () => staffApi.get<Report[]>('/admin/marketplace/reports') });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin-') });

  async function moderate(l: AdminListing, decision: 'APPROVE' | 'REJECT') {
    let reason: string | undefined;
    if (decision === 'REJECT') {
      reason = prompt('Motivo da rejeição (é enviado ao anunciante):')?.trim();
      if (!reason) return;
    }
    try {
      await staffApi.post(`/admin/marketplace/listings/${l.id}/moderate`, { decision, reason });
      toast.success(decision === 'APPROVE' ? 'Anúncio publicado' : 'Anúncio rejeitado');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível concluir');
    }
  }

  async function resolve(r: Report, status: 'REVIEWED' | 'DISMISSED', closeListing = false) {
    try {
      await staffApi.patch(`/admin/marketplace/reports/${r.id}`, { status, closeListing });
      toast.success(closeListing ? 'Denúncia confirmada e anúncio fechado' : 'Denúncia arquivada');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível concluir');
    }
  }

  return (
    <>
      <PageHeader title="Marketplace" />
      <div className="flex flex-col gap-6">
        <Panel title="Denúncias abertas">
          {!reports.data ? (
            <LoadingRows rows={2} />
          ) : reports.data.length === 0 ? (
            <p className="px-5 py-6 text-center text-ink-soft">Sem denúncias por tratar.</p>
          ) : (
            <ul className="divide-y divide-line">
              {reports.data.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <a href={`/marketplace/${r.listing.id}`} target="_blank" rel="noreferrer" className="font-medium hover:text-brand">{r.listing.title}</a>
                    <p className="text-sm text-ink-soft">
                      {reportReasonLabel[r.reason]}, {date(r.createdAt.slice(0, 10))}
                      {r.description && `: ${r.description}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="danger" onClick={() => resolve(r, 'REVIEWED', true)}>Fechar anúncio</Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve(r, 'DISMISSED')}>Arquivar</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <FilterTabs<ListingStatus> value={status} onChange={setStatus} options={LISTING_STATUSES.map((s) => ({ value: s, label: listingStatusLabel[s] }))} />
          {!listings.data ? (
            <LoadingRows />
          ) : listings.data.data.length === 0 ? (
            <EmptyState title={status === 'PENDING_REVIEW' ? 'Nada por rever' : 'Sem anúncios'} />
          ) : (
            <ul className="divide-y divide-line">
              {listings.data.data.map((l) => (
                <li key={l.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{l.title}</p>
                      <p className="text-sm text-ink-soft">
                        {l.organizationName}, {listingPurposeLabel[l.purpose]}, {propertyTypeLabel[l.propertyType]}, {[l.neighbourhood, l.city].filter(Boolean).join(', ')},{' '}
                        <span className="money">{money(l.price, l.currency)}</span>
                      </p>
                      <p className="mt-2 max-w-3xl text-sm whitespace-pre-line">{l.description}</p>
                      {l.imageUrls.length > 0 && <p className="mt-1 text-xs text-ink-faint">{l.imageUrls.length} fotografias</p>}
                      {l.openReports > 0 && <Badge tone="overdue" className="mt-2">{l.openReports} denúncias</Badge>}
                    </div>
                    {status === 'PENDING_REVIEW' && (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" onClick={() => moderate(l, 'APPROVE')}>Publicar</Button>
                        <Button size="sm" variant="secondary" onClick={() => moderate(l, 'REJECT')}>Rejeitar</Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
