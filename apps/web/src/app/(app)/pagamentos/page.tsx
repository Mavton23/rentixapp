'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { PAYMENT_METHODS, type PaymentMethod } from '@rentix/shared';
import { useDebounced, useList } from '@/lib/queries';
import type { PaymentListItem } from '@/lib/types';
import { date } from '@/lib/format';
import { paymentMethodLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  Money,
  PageHeader,
  Pagination,
  Panel,
  PaymentStatusBadge,
} from '@/components/ui/display';
import { Input, Select } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';

export default function PaymentsPage() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useList<PaymentListItem>('/payments', {
    search: useDebounced(search),
    method: method || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: 25,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title={t('Pagamentos')}
        description={t('Todos os valores recebidos, com o respetivo recibo.')}
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-line px-5 py-3 md:flex-row md:items-center">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              reset();
            }}
            placeholder={t('Recibo, referência ou inquilino')}
          />
          <Select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as PaymentMethod | '');
              reset();
            }}
            aria-label={t('Forma de pagamento')}
            className="md:w-52"
          >
            <option value="">{t('Todas as formas')}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t.label(paymentMethodLabel[m])}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                reset();
              }}
              aria-label={t('Desde')}
              className="md:w-40"
            />
            <span className="text-ink-faint">a</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                reset();
              }}
              aria-label={t('Até')}
              className="md:w-40"
            />
          </div>
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState
            title={t('Sem pagamentos')}
            description={t('Os pagamentos registam-se a partir de cada fatura.')}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t('Inquilino')}</Th>
                  <Th className="hidden md:table-cell">{t('Fatura')}</Th>
                  <Th className="hidden sm:table-cell">{t('Forma')}</Th>
                  <Th className="text-right">{t('Valor')}</Th>
                  <Th className="w-0" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <span className="font-medium">{t.label(p.tenant.fullName)}</span>
                      <span className="block text-ink-faint">
                        {p.receiptNumber ?? t('Sem recibo')}, {date(p.paidAt)}
                      </span>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <Link
                        href={`/faturas/${p.invoice.id}`}
                        className="text-ink-soft hover:text-brand"
                      >
                        {t.label(p.invoice.description)}
                      </Link>
                    </Td>
                    <Td className="hidden text-ink-soft sm:table-cell">
                      {t.label(paymentMethodLabel[p.method])}
                      {p.reference && (
                        <span className="block text-ink-faint">{t.label(p.reference)}</span>
                      )}
                    </Td>
                    <Td className="text-right">
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
                    </Td>
                    <Td className="whitespace-nowrap">
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
                      {p.receiptNumber ? (
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
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
