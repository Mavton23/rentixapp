'use client';

import { useT } from '@/i18n/client';
import { useState } from 'react';
import { toast } from 'sonner';
import { todayIn } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { ApiError } from '@/lib/api';
import type { PlatformInvoice } from '@/lib/platform-types';
import { money } from '@/lib/format';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Field, FormError, Input, Select } from '../ui/form';

const METHODS = [
  ['BANK_TRANSFER', 'Transferência bancária'],
  ['MPESA', 'M-Pesa (fora do Rentix)'],
  ['EMOLA', 'e-Mola (fora do Rentix)'],
  ['CASH', 'Numerário'],
  ['OTHER', 'Outro'],
] as const;

/** Registar um pagamento de uma fatura do Rentix recebido por outro meio. */
export function MarkPaidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: PlatformInvoice | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIn());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      await staffApi.post(`/admin/billing/invoices/${invoice.id}/mark-paid`, {
        method,
        reference,
        paidOn,
      });
      toast.success(t('Fatura {number} paga; plano ativo', { number: invoice.number }));
      setReference('');
      onDone();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && Object.keys(err.fieldErrors).length
          ? Object.values(err.fieldErrors).join('; ')
          : err instanceof Error
            ? err.message
            : t('Não foi possível registar'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!invoice}
      onOpenChange={(o) => !o && onClose()}
      title={t('Registar pagamento')}
      description={
        invoice
          ? t('{number}, {money}. O plano fica ativo e o cliente recebe a fatura-recibo.', {
              number: invoice.number,
              money: money(invoice.amount, invoice.currency),
            })
          : undefined
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(error)} />
        <Field label={t('Meio')}>
          {(p) => (
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              {...p}
            >
              {METHODS.map(([v, l]) => (
                <option key={v} value={v}>
                  {t.label(l)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('Referência')}
          hint={t('Número da transferência ou do talão, para conferir com o extrato.')}
        >
          {(p) => <Input value={reference} onChange={(e) => setReference(e.target.value)} {...p} />}
        </Field>
        <Field label={t('Data do pagamento')}>
          {(p) => (
            <Input
              type="date"
              value={paidOn}
              max={todayIn()}
              onChange={(e) => setPaidOn(e.target.value)}
              {...p}
            />
          )}
        </Field>
        <Button type="submit" loading={busy}>
          {t('Registar pagamento')}
        </Button>
      </form>
    </Dialog>
  );
}
