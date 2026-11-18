'use client';

import { useT } from '@/i18n/client';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { isIsoDate, PAYMENT_METHODS, todayIn } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { moneyField, optionalString, useServerError, useZodForm } from '@/lib/forms';
import { money, moneyInputValue } from '@/lib/format';
import { paymentMethodLabel } from '@/i18n/pt';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field, FormError, Input, MoneyInput, Select } from './ui/form';

const schema = z.object({
  amount: moneyField({ required: true, positive: true }),
  method: z.enum(PAYMENT_METHODS),
  paidAt: z.string().refine(isIsoDate, 'Data inválida'),
  reference: optionalString,
});

export interface PayableInvoice {
  id: string;
  number: string;
  description: string;
  outstanding: number;
  currency: string;
  tenant: { fullName: string };
}

export function RecordPaymentDialog({
  invoice,
  onOpenChange,
  onDone,
}: {
  invoice: PayableInvoice | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const form = useZodForm(schema, {
    amount: '',
    method: 'MPESA',
    paidAt: todayIn(),
    reference: '',
  });
  const server = useServerError(form);
  // Uma chave por abertura do diálogo: se a rede falhar e o utilizador repetir, o pagamento não duplica.
  const idemKey = useMemo(() => (invoice ? crypto.randomUUID() : ''), [invoice]);
  const { errors, isSubmitting } = form.formState;
  const method = form.watch('method');

  useEffect(() => {
    if (invoice) {
      form.reset({
        amount: moneyInputValue(invoice.outstanding),
        method: 'MPESA',
        paidAt: todayIn(),
        reference: '',
      });
      server.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  const submit = form.handleSubmit(async (v) => {
    if (!invoice) return;
    try {
      const p = await staffApi.post<{ receiptNumber: string }>(
        '/payments',
        {
          invoiceId: invoice.id,
          amount: v.amount,
          method: v.method,
          paidAt: v.paidAt,
          reference: v.reference ?? null,
        },
        { 'Idempotency-Key': idemKey },
      );
      toast.success(
        t('Pagamento registado. Recibo {receiptNumber}', { receiptNumber: p.receiptNumber }),
      );
      onDone();
      onOpenChange(false);
    } catch (err) {
      server.handle(err);
    }
  });

  const needsRef =
    method === 'MPESA' || method === 'EMOLA' || method === 'MKESH' || method === 'BANK_TRANSFER';

  return (
    <Dialog
      open={!!invoice}
      onOpenChange={onOpenChange}
      title={t('Registar pagamento')}
      description={
        invoice && (
          <>
            {t('{fullName}, {description} ({number}). Em dívida:', {
              fullName: invoice.tenant.fullName,
              description: invoice.description,
              number: invoice.number,
            })}{' '}
            <span className="money font-medium text-ink">
              {money(invoice.outstanding, invoice.currency)}
            </span>
          </>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field
          label={t('Valor recebido')}
          hint={t('Pode registar um pagamento parcial.')}
          error={errors.amount?.message}
        >
          {(p) => (
            <MoneyInput
              currency={invoice?.currency === 'MZN' ? 'MT' : invoice?.currency}
              {...p}
              {...form.register('amount')}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Forma de pagamento')} error={errors.method?.message}>
            {(p) => (
              <Select {...p} {...form.register('method')}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t.label(paymentMethodLabel[m])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('Data')} error={errors.paidAt?.message}>
            {(p) => <Input type="date" max={todayIn()} {...p} {...form.register('paidAt')} />}
          </Field>
        </div>
        <Field
          label={needsRef ? t('Referência da transação') : t('Referência')}
          optional
          hint={needsRef ? t('Ex.: o código da mensagem de confirmação do M-Pesa.') : undefined}
          error={errors.reference?.message}
        >
          {(p) => <Input autoComplete="off" {...p} {...form.register('reference')} />}
        </Field>
        <Button type="submit" loading={isSubmitting}>
          {t('Registar pagamento')}
        </Button>
      </form>
    </Dialog>
  );
}
