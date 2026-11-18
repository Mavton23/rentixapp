'use client';

import { useT } from '@/i18n/client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { staffApi } from '@/lib/clients';
import { date, money, period } from '@/lib/format';
import { useStaffSession } from '@/lib/session';
import { idDocumentLabel, paymentMethodLabel } from '@/i18n/pt';
import type { IdDocumentType, PaymentMethod, PaymentStatus } from '@rentix/shared';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand';

interface Receipt {
  id: string;
  receiptNumber: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string;
  reference: string | null;
  organization: {
    name: string;
    nuit: string | null;
    address: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
  };
  tenant: {
    fullName: string;
    nuit: string | null;
    idDocumentType: IdDocumentType;
    idDocumentNumber: string;
    phone: string;
  };
  invoice: {
    number: string;
    description: string;
    amount: number;
    paidAmount: number;
    period: string | null;
    lease: { unit: { label: string; property: { name: string; street: string; city: string } } };
  };
}

/** Recibo em formato A4/A5 para imprimir ou guardar em PDF a partir do browser. */
export default function ReceiptPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useStaffSession();
  useEffect(() => {
    if (status === 'anonymous') router.replace(`/entrar?next=/recibo/${id}`);
  }, [status, router, id]);

  const q = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => staffApi.get<Receipt>(`/payments/${id}/receipt`),
    enabled: status === 'authenticated',
  });
  const r = q.data;
  if (q.isError) return <p className="p-10 text-center">{t.label((q.error as Error).message)}</p>;
  if (!r) return <p className="p-10 text-center text-ink-soft">{t('A preparar o recibo…')}</p>;

  const unit = r.invoice.lease.unit;
  return (
    <div className="mx-auto max-w-[720px] bg-surface px-8 py-10 print:max-w-none print:p-0">
      <title>{`Recibo ${r.receiptNumber}`}</title>
      <div className="mb-6 flex justify-end gap-2 print:hidden">
        <Button onClick={() => window.print()}>{t('Imprimir ou guardar PDF')}</Button>
      </div>

      <header className="flex items-start justify-between gap-6 border-b border-ink pb-5">
        <div>
          <p className="font-display text-xl font-semibold">{t.label(r.organization.name)}</p>
          <p className="text-sm text-ink-soft">
            {t.label([r.organization.address, r.organization.city].filter(Boolean).join(', '))}
            {r.organization.nuit && (
              <>
                <br />
                {t('NUIT {nuit}', { nuit: r.organization.nuit })}
              </>
            )}
            {r.organization.phone && (
              <>
                <br />
                {t.label(r.organization.phone)}
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-semibold">{t('Recibo')}</p>
          <p className="money text-lg">{t.label(r.receiptNumber)}</p>
          <p className="text-sm text-ink-soft">{date(r.paidAt)}</p>
        </div>
      </header>

      {r.status === 'REVERSED' && (
        <p className="mt-4 border border-overdue px-3 py-2 text-center font-semibold text-overdue">
          {t('PAGAMENTO ESTORNADO, RECIBO SEM VALIDADE')}
        </p>
      )}

      <section className="mt-8 text-[15px] leading-relaxed">
        <p>
          {t('Recebemos de')} <strong>{t.label(r.tenant.fullName)}</strong>{' '}
          {t('({0} {idDocumentNumber}{2}) a quantia de', {
            '0': idDocumentLabel[r.tenant.idDocumentType],
            idDocumentNumber: r.tenant.idDocumentNumber,
            '2': r.tenant.nuit && t(", NUIT {0}", { '0': r.tenant.nuit }),
          })}
        </p>
        <p className="money my-5 text-4xl font-semibold">{money(r.amount, r.currency)}</p>
        <p>
          {t('referente a')} <strong>{t.label(r.invoice.description)}</strong>
          {r.invoice.period &&
            !r.invoice.description.includes(period(r.invoice.period)) &&
            ` (${period(r.invoice.period)})`}
          {t(', fatura {number}, do imóvel {name}, {label}, {street}, {city}.', {
            number: r.invoice.number,
            name: unit.property.name,
            label: unit.label,
            street: unit.property.street,
            city: unit.property.city,
          })}
        </p>
      </section>

      <dl className="mt-8 grid grid-cols-2 gap-y-2 border-t border-line pt-5 text-sm">
        <dt className="text-ink-soft">{t('Forma de pagamento')}</dt>
        <dd className="text-right">{t.label(paymentMethodLabel[r.method])}</dd>
        {r.reference && (
          <>
            <dt className="text-ink-soft">{t('Referência')}</dt>
            <dd className="text-right">{t.label(r.reference)}</dd>
          </>
        )}
        <dt className="text-ink-soft">{t('Valor da fatura')}</dt>
        <dd className="money text-right">{money(r.invoice.amount, r.currency)}</dd>
        <dt className="text-ink-soft">{t('Total pago até à data')}</dt>
        <dd className="money text-right">{money(r.invoice.paidAmount, r.currency)}</dd>
        <dt className="font-medium">{t('Em dívida nesta fatura')}</dt>
        <dd className="money text-right font-medium">
          {money(r.invoice.amount - r.invoice.paidAmount, r.currency)}
        </dd>
      </dl>

      <div className="mt-16 grid grid-cols-2 gap-10 text-center text-sm text-ink-soft">
        <div className="border-t border-ink pt-2">{t('O senhorio / gestor')}</div>
        <div className="border-t border-ink pt-2">{t('O inquilino')}</div>
      </div>

      <footer className="mt-12 flex items-center justify-between text-xs text-ink-faint">
        <span>{t('Documento emitido pelo Rentix')}</span>
        <Logo className="scale-75 opacity-60" />
      </footer>
    </div>
  );
}
