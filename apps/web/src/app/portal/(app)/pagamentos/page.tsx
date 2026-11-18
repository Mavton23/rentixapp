'use client';

import { useT } from '@/i18n/client';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { portalApi } from '@/lib/clients';
import type { Paginated } from '@/lib/types';
import type { PortalPayment } from '@/lib/portal-types';
import { date } from '@/lib/format';
import { paymentMethodLabel } from '@/i18n/pt';
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  Money,
  Pagination,
  PaymentStatusBadge,
} from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function PortalPaymentsPage() {
  const t = useT();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['portal', 'payments', page],
    queryFn: () =>
      portalApi.get<Paginated<PortalPayment>>('/portal/payments', { page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <title>{t('Pagamentos · Rentix')}</title>
      <h1 className="mb-4 text-2xl">{t('Pagamentos')}</h1>
      <div className="rounded-panel border border-line bg-surface">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState
            title={t('Ainda sem pagamentos')}
            description={t('Os pagamentos aparecem aqui quando o senhorio os confirma.')}
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {t.label(p.invoice.description)}
                    </span>
                    <span className="text-sm text-ink-soft">
                      {t('Recibo {receiptNumber}, {1}, {date}', {
                        receiptNumber: p.receiptNumber,
                        '1': paymentMethodLabel[p.method],
                        date: date(p.paidAt),
                      })}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-right">
                    <span>
                      <Money
                        amount={p.amount}
                        currency={p.currency}
                        className={
                          p.status === 'REVERSED' ? 'text-ink-faint line-through' : 'text-paid'
                        }
                      />
                      {p.status !== 'CONFIRMED' && (
                        <span className="mt-1 block">
                          <PaymentStatusBadge status={p.status} />
                        </span>
                      )}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('Descarregar recibo {receiptNumber}', {
                        receiptNumber: p.receiptNumber,
                      })}
                      onClick={() =>
                        portalApi.download(`/portal/payments/${p.id}/receipt.pdf`, 'recibo.pdf')
                      }
                    >
                      <Download />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
