'use client';

import { useT } from '@/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { portalApi } from '@/lib/clients';
import { Button } from '@/components/ui/button';
import { fileCategoryLabel, fileSize, openFile, type FileRow } from '@/components/files-panel';
import type { PortalLease } from '@/lib/portal-types';
import { date, money } from '@/lib/format';
import {
  DetailList,
  EmptyState,
  ErrorState,
  LeaseStatusBadge,
  LoadingRows,
} from '@/components/ui/display';

export default function PortalLeasePage() {
  const t = useT();
  const q = useQuery({
    queryKey: ['portal', 'leases'],
    queryFn: () => portalApi.get<PortalLease[]>('/portal/leases'),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;

  return (
    <>
      <title>{t('Contrato · Rentix')}</title>
      <h1 className="mb-4 text-2xl">{q.data.length > 1 ? t('Contratos') : t('Contrato')}</h1>
      {q.data.length === 0 ? (
        <EmptyState title={t('Sem contratos')} />
      ) : (
        <div className="flex flex-col gap-4">
          {q.data.map((l) => (
            <section key={l.id} className="rounded-panel border border-line bg-surface">
              <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-base">
                    {t.label(l.unit.property.name)}, {t.label(l.unit.label)}
                  </h2>
                  <p className="text-sm text-ink-soft">
                    {t.label(
                      [l.unit.property.street, l.unit.property.neighbourhood, l.unit.property.city]
                        .filter(Boolean)
                        .join(', '),
                    )}
                  </p>
                </div>
                <LeaseStatusBadge status={l.status} />
              </header>
              <DetailList
                items={[
                  {
                    label: t('Renda mensal'),
                    value: <span className="money">{money(l.rentAmount, l.currency)}</span>,
                  },
                  {
                    label: 'Pagamento',
                    value: t('Até ao dia {billingDay} de cada mês', { billingDay: l.billingDay }),
                  },
                  { label: t('Início'), value: date(l.startDate) },
                  { label: 'Fim', value: l.endDate ? date(l.endDate) : t('Sem termo') },
                  {
                    label: t('Caução'),
                    value: l.depositAmount ? (
                      <span className="money">{money(l.depositAmount, l.currency)}</span>
                    ) : (
                      t('Sem caução')
                    ),
                  },
                  {
                    label: 'Senhorio',
                    value: [l.organization.name, l.organization.phone].filter(Boolean).join(', '),
                  },
                ]}
              />
            </section>
          ))}
        </div>
      )}
      <PortalDocuments />
    </>
  );
}

/** Documentos que o senhorio partilhou: contrato assinado, comprovativos... */
function PortalDocuments() {
  const t = useT();
  const q = useQuery({
    queryKey: ['portal', 'files'],
    queryFn: () => portalApi.get<FileRow[]>('/portal/files'),
  });
  if (!q.data?.length) return null;
  return (
    <section className="mt-6 rounded-panel border border-line bg-surface">
      <h2 className="border-b border-line px-5 py-3 font-display text-base font-semibold">
        {t('Documentos')}
      </h2>
      <ul className="divide-y divide-line">
        {q.data.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-5 py-3">
            <FileText className="size-5 shrink-0 text-ink-soft" aria-hidden />
            <div className="min-w-0 flex-1">
              <button
                className="block max-w-full truncate text-left font-medium hover:text-brand"
                onClick={() => openFile(portalApi, `/portal/files/${f.id}/content`)}
              >
                {t.label(f.filename)}
              </button>
              <span className="block text-xs text-ink-faint">
                {t.label(fileCategoryLabel[f.category])}, {t.label(fileSize(f.size))}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("Descarregar {0}", { "0": f.filename })}
              onClick={() =>
                portalApi.download(`/portal/files/${f.id}/content?download=1`, f.filename)
              }
            >
              <Download aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
