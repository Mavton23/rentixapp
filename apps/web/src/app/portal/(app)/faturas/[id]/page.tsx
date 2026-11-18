'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Download } from 'lucide-react';
import { todayIn } from '@rentix/shared';
import { portalApi } from '@/lib/clients';
import type { PortalInvoiceDetail } from '@/lib/portal-types';
import { date, dueText, money } from '@/lib/format';
import { paymentMethodLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import {
  ErrorState,
  InvoiceStatusBadge,
  LoadingRows,
  Money,
  PaymentStatusBadge,
} from '@/components/ui/display';
import { MobilePayDialog, type MobilePaymentStatus } from '@/components/mobile-pay-dialog';
import { useTenantSession } from '@/lib/session';

export default function PortalInvoicePage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { session } = useTenantSession();
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: ['portal', 'invoice', id],
    queryFn: () => portalApi.get<PortalInvoiceDetail>(`/portal/invoices/${id}`),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const i = q.data;
  const canPay = i.outstanding > 0 && i.onlineMethods.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <title>{t('{description} · Rentix', { description: i.description })}</title>
      <Link
        href="/portal/faturas"
        className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden /> {t('Faturas')}
      </Link>
      <section>
        <h1 className="text-2xl">{t.label(i.description)}</h1>
        <p className="text-ink-soft">
          {t.label(i.number)}, {t.label(i.organization.name)}
        </p>
        <p
          className={`money mt-5 text-[40px] leading-tight font-semibold ${i.isOverdue ? 'text-overdue' : 'text-ink'}`}
        >
          {money(i.outstanding > 0 ? i.outstanding : i.amount, i.currency)}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-ink-soft">
          <InvoiceStatusBadge status={i.status} overdue={i.isOverdue} />
          {i.outstanding > 0
            ? dueText(i.dueDate, todayIn())
            : t('Vencimento a {date}', { date: date(i.dueDate) })}
        </p>
        {i.paidAmount > 0 && i.outstanding > 0 && (
          <p className="mt-2 text-sm text-ink-soft">
            {t('Já pagou')} <Money amount={i.paidAmount} currency={i.currency} /> {t('de')}{' '}
            <Money amount={i.amount} currency={i.currency} />.
          </p>
        )}
        {canPay && (
          <Button size="lg" className="mt-6 w-full sm:w-auto" onClick={() => setPaying(true)}>
            {i.pendingPaymentId ? t('Ver pagamento em curso') : t('Pagar agora')}
          </Button>
        )}
      </section>

      <section className="rounded-panel border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-base">{t('Pagamentos')}</h2>
        {i.payments.length === 0 ? (
          <p className="px-4 py-6 text-center text-ink-soft">
            {t('Ainda sem pagamentos confirmados.')}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {i.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block font-medium">
                    {t('Recibo {receiptNumber}', { receiptNumber: p.receiptNumber })}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {t.label(paymentMethodLabel[p.method])}, {date(p.paidAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-right">
                  <span>
                    <Money amount={p.amount} currency={i.currency} />
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
        )}
      </section>

      {/* Fica montado enquanto aberto, para mostrar a confirmação depois de a fatura ficar paga. */}
      {(canPay || paying) && (
        <MobilePayDialog
          open={paying}
          onOpenChange={setPaying}
          client={portalApi}
          audience="tenant"
          start={(body) => portalApi.post<MobilePaymentStatus>(`/portal/invoices/${id}/pay`, body)}
          statusPath={(pid) => `/portal/payments/${pid}/status`}
          receiptPath={(pid) => `/portal/payments/${pid}/receipt.pdf`}
          outstanding={i.outstanding}
          currency={i.currency}
          methods={i.onlineMethods}
          defaultPhone={session?.account.phone}
          resumeId={i.pendingPaymentId}
          onFinished={() => qc.invalidateQueries({ queryKey: ['portal'] })}
        />
      )}
    </div>
  );
}
