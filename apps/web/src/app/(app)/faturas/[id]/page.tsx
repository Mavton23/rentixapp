'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Printer, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { todayIn } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import type { InvoiceDetail, Payment } from '@/lib/types';
import { date, dueText, money, period } from '@/lib/format';
import { invoiceKindLabel, paymentMethodLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import {
  DetailList,
  ErrorState,
  InvoiceStatusBadge,
  LoadingRows,
  Money,
  PageHeader,
  Panel,
  PaymentStatusBadge,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { RecordPaymentDialog } from '@/components/record-payment-dialog';
import { MobilePayDialog, type MobilePaymentStatus } from '@/components/mobile-pay-dialog';
import type { MobileMethod } from '@rentix/shared';

export default function InvoicePage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const key = ['invoice', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => staffApi.get<InvoiceDetail>(`/invoices/${id}`),
  });
  const gateways = useQuery({
    queryKey: ['payment-gateways'],
    queryFn: () => staffApi.get<{ availableMethods: MobileMethod[] }>('/payment-gateways'),
    retry: false,
  });
  const mobileMethods = gateways.data?.availableMethods ?? [];

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} />;
  const i = q.data;
  const refresh = () => qc.invalidateQueries();

  async function voidInvoice() {
    const reason = prompt(t('Motivo da anulação (fica registado):'));
    if (!reason?.trim()) return;
    try {
      await staffApi.post(`/invoices/${id}/void`, { reason: reason.trim() });
      toast.success(t('Fatura anulada'));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível anular'));
    }
  }

  async function reverse(p: Payment) {
    const reason = prompt(
      t('Estornar o pagamento {receiptNumber}? Indique o motivo:', {
        receiptNumber: p.receiptNumber,
      }),
    );
    if (!reason?.trim()) return;
    try {
      await staffApi.post(`/payments/${p.id}/reverse`, { reason: reason.trim() });
      toast.success(t('Pagamento estornado'));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível estornar'));
    }
  }

  const title =
    i.kind === 'RENT'
      ? t('Renda de {period}', { period: period(i.period) })
      : i.description === invoiceKindLabel[i.kind] || i.kind === 'LATE_FEE'
        ? i.description
        : `${invoiceKindLabel[i.kind]}: ${i.description}`;

  return (
    <>
      <PageHeader
        back={{ href: '/faturas', label: 'Faturas' }}
        title={t.label(title)}
        description={t('{number}, emitida a {date}', { number: i.number, date: date(i.issueDate) })}
        actions={
          <>
            {i.outstanding > 0 && (
              <Button onClick={() => setPaying(true)}>{t('Registar pagamento')}</Button>
            )}
            {i.outstanding > 0 && mobileMethods.length > 0 && i.currency === 'MZN' && (
              <Button variant="secondary" onClick={() => setRequesting(true)}>
                <Smartphone aria-hidden /> {t('Pedir por telemóvel')}
              </Button>
            )}
            {i.status !== 'VOID' && i.paidAmount === 0 && (
              <Button variant="ghost" onClick={voidInvoice}>
                {t('Anular fatura')}
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Panel>
            <div className="flex flex-wrap items-end justify-between gap-6 px-5 py-5">
              <div>
                <p className="text-sm text-ink-faint">
                  {i.outstanding > 0 ? t('Em dívida') : 'Valor'}
                </p>
                <p
                  className={`money mt-1 text-4xl font-semibold ${i.isOverdue ? 'text-overdue' : 'text-ink'}`}
                >
                  {money(i.outstanding > 0 ? i.outstanding : i.amount, i.currency)}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <InvoiceStatusBadge status={i.status} overdue={i.isOverdue} />
                  {i.outstanding > 0
                    ? dueText(i.dueDate, todayIn())
                    : t('vencimento a {date}', { date: date(i.dueDate) })}
                </p>
              </div>
              {i.paidAmount > 0 && (
                <p className="text-sm text-ink-soft">
                  {t('Pago')}{' '}
                  <Money amount={i.paidAmount} currency={i.currency} className="text-paid" />{' '}
                  {t('de')} <Money amount={i.amount} currency={i.currency} />
                </p>
              )}
            </div>
            {i.voidReason && (
              <p className="border-t border-line px-5 py-3 text-sm text-ink-soft">
                {t('Anulada: {voidReason}', { voidReason: i.voidReason })}
              </p>
            )}
          </Panel>

          <Panel title={t('Pagamentos')}>
            {i.payments.length === 0 ? (
              <p className="px-5 py-8 text-center text-ink-soft">
                {t('Nenhum pagamento registado.')}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('Recibo')}</Th>
                    <Th className="hidden sm:table-cell">{t('Forma')}</Th>
                    <Th>{t('Estado')}</Th>
                    <Th className="text-right">{t('Valor')}</Th>
                    <Th className="w-0" />
                  </tr>
                </thead>
                <tbody>
                  {i.payments.map((p) => (
                    <Tr key={p.id}>
                      <Td>
                        <span className="font-medium">
                          {p.receiptNumber ?? paymentMethodLabel[p.method]}
                        </span>
                        <span className="block text-ink-faint">
                          {p.failureReason ?? date(p.paidAt)}
                        </span>
                      </Td>
                      <Td className="hidden text-ink-soft sm:table-cell">
                        {t.label(paymentMethodLabel[p.method])}
                        {p.reference && (
                          <span className="block text-ink-faint">{t.label(p.reference)}</span>
                        )}
                      </Td>
                      <Td>
                        <PaymentStatusBadge status={p.status} />
                      </Td>
                      <Td className="text-right">
                        <Money amount={p.amount} currency={p.currency} />
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {p.receiptNumber && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t('Descarregar PDF')}
                            aria-label={t('Descarregar recibo {receiptNumber} em PDF', {
                              receiptNumber: p.receiptNumber,
                            })}
                            onClick={() =>
                              staffApi
                                .download(`/payments/${p.id}/receipt.pdf`, 'recibo.pdf')
                                .catch((e: Error) => toast.error(e.message))
                            }
                          >
                            <Download />
                          </Button>
                        )}
                        {p.receiptNumber && (
                          <Button asChild size="icon" variant="ghost" title={t('Imprimir recibo')}>
                            <Link
                              href={`/recibo/${p.id}`}
                              target="_blank"
                              aria-label={t('Imprimir recibo {receiptNumber}', {
                                receiptNumber: p.receiptNumber,
                              })}
                            >
                              <Printer />
                            </Link>
                          </Button>
                        )}
                        {p.status === 'CONFIRMED' && (
                          <Button size="sm" variant="ghost" onClick={() => reverse(p)}>
                            {t('Estornar')}
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <Panel title={t('Detalhes')}>
          <DetailList
            items={[
              {
                label: 'Inquilino',
                value: (
                  <Link href={`/inquilinos/${i.tenant.id}`} className="text-brand hover:underline">
                    {t.label(i.tenant.fullName)}
                  </Link>
                ),
              },
              { label: t('Imóvel'), value: `${i.lease.unit.property.name}, ${i.lease.unit.label}` },
              {
                label: 'Contrato',
                value: (
                  <Link href={`/contratos/${i.lease.id}`} className="text-brand hover:underline">
                    {t('Ver contrato')}
                  </Link>
                ),
              },
              { label: 'Tipo', value: invoiceKindLabel[i.kind] },
              { label: 'Vencimento', value: date(i.dueDate) },
              ...(i.lateFee
                ? [
                    {
                      label: t('Multa aplicada'),
                      value: (
                        <Link
                          href={`/faturas/${i.lateFee.id}`}
                          className="text-brand hover:underline"
                        >
                          {t.label(i.lateFee.number)} ({money(i.lateFee.amount, i.currency)})
                        </Link>
                      ),
                    },
                  ]
                : []),
              ...(i.parentInvoice
                ? [
                    {
                      label: t('Multa referente a'),
                      value: (
                        <Link
                          href={`/faturas/${i.parentInvoice.id}`}
                          className="text-brand hover:underline"
                        >
                          {t.label(i.parentInvoice.number)}
                        </Link>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Panel>
      </div>

      <RecordPaymentDialog invoice={paying ? i : null} onOpenChange={setPaying} onDone={refresh} />
      {mobileMethods.length > 0 && (
        <MobilePayDialog
          open={requesting}
          onOpenChange={setRequesting}
          client={staffApi}
          audience="staff"
          start={(body) =>
            staffApi.post<MobilePaymentStatus>('/payments/mobile', { ...body, invoiceId: id })
          }
          statusPath={(pid) => `/payments/mobile/${pid}/status`}
          receiptPath={(pid) => `/payments/${pid}/receipt.pdf`}
          outstanding={i.outstanding}
          currency={i.currency}
          methods={mobileMethods}
          defaultPhone={i.tenant.phone}
          onFinished={refresh}
        />
      )}
    </>
  );
}
