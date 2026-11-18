'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { todayIn } from '@rentix/shared';
import { portalApi } from '@/lib/clients';
import type { Paginated } from '@/lib/types';
import type { PortalInvoice } from '@/lib/portal-types';
import { date, dueText } from '@/lib/format';
import {
  EmptyState,
  ErrorState,
  InvoiceStatusBadge,
  LoadingRows,
  Money,
  Pagination,
} from '@/components/ui/display';

export default function PortalInvoicesPage() {
  const t = useT();
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['portal', 'invoices', page],
    queryFn: () =>
      portalApi.get<Paginated<PortalInvoice>>('/portal/invoices', { page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const today = todayIn();

  return (
    <>
      <title>{t('Faturas · Rentix')}</title>
      <h1 className="mb-4 text-2xl">{t('Faturas')}</h1>
      <div className="rounded-panel border border-line bg-surface">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState title={t('Ainda não tem faturas')} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data.data.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/portal/faturas/${i.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-paper/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.label(i.description)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                        <InvoiceStatusBadge status={i.status} overdue={i.isOverdue} />
                        {i.outstanding > 0
                          ? dueText(i.dueDate, today)
                          : `${i.number}, ${date(i.dueDate)}`}
                      </span>
                    </span>
                    <Money
                      amount={i.outstanding > 0 ? i.outstanding : i.amount}
                      currency={i.currency}
                    />
                    <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                  </Link>
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
