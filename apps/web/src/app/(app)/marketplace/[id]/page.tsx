'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { REPORT_REASONS, type ReportReason } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import type { ListingDetail } from '@/lib/site-types';
import { date, money } from '@/lib/format';
import { propertyTypeLabel } from '@/i18n/pt';
import {
  interestStatusLabel,
  listingPurposeLabel,
  listingStatusLabel,
  reportReasonLabel,
} from '@/i18n/extras';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  DetailList,
  ErrorState,
  LoadingRows,
  PageHeader,
  Panel,
} from '@/components/ui/display';
import { Field, Select, Textarea } from '@/components/ui/form';

export default function ListingPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = ['listing', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => staffApi.get<ListingDetail>(`/marketplace/listings/${id}`),
  });
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} />;
  const l = q.data;

  async function interest() {
    setSending(true);
    try {
      await staffApi.post(`/marketplace/listings/${id}/interests`, {
        message: message.trim() || undefined,
      });
      toast.success(t('Interesse enviado. Avisamos quando o anunciante responder.'));
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível enviar'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/marketplace', label: 'Marketplace' }}
        title={t.label(l.title)}
        description={t('{0}, publicado por {organizationName}', {
          '0': [l.neighbourhood, l.city, l.province].filter(Boolean).join(', '),
          organizationName: l.organizationName,
        })}
        actions={
          l.isMine ? (
            <Button asChild variant="secondary">
              <Link href="/marketplace/meus-anuncios">{t('Gerir os meus anúncios')}</Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setReportOpen(true)}>
              <Flag aria-hidden /> {t('Denunciar')}
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          {l.imageUrls.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {l.imageUrls.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- imagens externas do anunciante
                <img
                  key={src}
                  src={src}
                  alt={`Fotografia ${i + 1}`}
                  className={`w-full rounded-panel object-cover ${i === 0 ? 'aspect-[16/9] sm:col-span-2' : 'aspect-[4/3]'}`}
                  loading="lazy"
                />
              ))}
            </div>
          )}
          <Panel title={t('Descrição')}>
            <p className="px-5 py-4 whitespace-pre-line">{t.label(l.description)}</p>
          </Panel>
          <Panel title={t('Características')}>
            <DetailList
              items={[
                { label: 'Objetivo', value: listingPurposeLabel[l.purpose] },
                { label: 'Tipo', value: t.label(propertyTypeLabel[l.propertyType]) },
                { label: 'Quartos', value: l.bedrooms },
                { label: t('Casas de banho'), value: l.bathrooms },
                { label: t('Área'), value: l.areaM2 !== null ? `${l.areaM2} m²` : null },
                {
                  label: 'Publicado',
                  value: l.publishedAt ? date(l.publishedAt.slice(0, 10)) : null,
                },
              ]}
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <div className="px-5 py-5">
              <p className="money text-3xl font-semibold">{money(l.price, l.currency)}</p>
              <p className="text-sm text-ink-soft">
                {l.priceNegotiable ? t('Negociável') : t('Preço fixo')}
              </p>
              {l.isMine ? (
                <div className="mt-4 space-y-1 text-sm text-ink-soft">
                  <p>
                    {t('Estado:')}{' '}
                    <Badge tone={l.status === 'ACTIVE' ? 'paid' : 'neutral'}>
                      {t.label(listingStatusLabel[l.status])}
                    </Badge>
                  </p>
                  <p>
                    {t('{viewsCount} organizações viram este anúncio', {
                      viewsCount: l.viewsCount,
                    })}
                  </p>
                  <p>{t('{interestsCount} interessados', { interestsCount: l.interestsCount })}</p>
                </div>
              ) : l.myInterest ? (
                <div className="mt-5">
                  <p className="text-sm">
                    {t('O seu interesse:')}{' '}
                    <Badge tone={l.myInterest.status === 'ACCEPTED' ? 'paid' : 'neutral'}>
                      {t.label(interestStatusLabel[l.myInterest.status])}
                    </Badge>
                  </p>
                  {l.contact ? (
                    <div className="mt-4 rounded-control bg-paid-soft px-4 py-3 text-sm">
                      <p className="font-medium text-ink">
                        {l.contact.name ?? l.contact.organization}
                      </p>
                      {l.contact.phone && (
                        <a href={`tel:${l.contact.phone}`} className="block text-brand">
                          {t.label(l.contact.phone)}
                        </a>
                      )}
                      {l.contact.email && (
                        <a href={`mailto:${l.contact.email}`} className="block text-brand">
                          {t.label(l.contact.email)}
                        </a>
                      )}
                    </div>
                  ) : (
                    l.myInterest.status === 'PENDING' && (
                      <p className="mt-2 text-sm text-ink-soft">
                        {t('Os contactos aparecem aqui quando o anunciante aceitar.')}
                      </p>
                    )
                  )}
                </div>
              ) : (
                <div className="mt-5 flex flex-col gap-3">
                  <Field label={t('Mensagem para o anunciante')} optional>
                    {(p) => (
                      <Textarea
                        rows={3}
                        placeholder={t('Ex.: Tenho um cliente à procura de um T3 nesta zona.')}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        {...p}
                      />
                    )}
                  </Field>
                  <Button onClick={interest} loading={sending}>
                    {t('Tenho interesse')}
                  </Button>
                  <p className="text-xs text-ink-faint">
                    {t('Os contactos de ambos só são partilhados se o anunciante aceitar.')}
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} listingId={id} />
    </>
  );
}

function ReportDialog({
  open,
  onOpenChange,
  listingId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  listingId: string;
}) {
  const t = useT();
  const [reason, setReason] = useState<ReportReason>('FALSE_INFO');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    setSending(true);
    try {
      await staffApi.post(`/marketplace/listings/${listingId}/reports`, {
        reason,
        description: description.trim() || undefined,
      });
      toast.success(t('Denúncia enviada. Obrigado.'));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível enviar'));
    } finally {
      setSending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Denunciar anúncio')}
      description={t('A equipa Rentix revê todas as denúncias.')}
    >
      <div className="flex flex-col gap-4">
        <Field label={t('Motivo')}>
          {(p) => (
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              {...p}
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t.label(reportReasonLabel[r])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Detalhes')} optional>
          {(p) => (
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              {...p}
            />
          )}
        </Field>
        <Button variant="danger" onClick={send} loading={sending}>
          {t('Enviar denúncia')}
        </Button>
      </div>
    </Dialog>
  );
}
