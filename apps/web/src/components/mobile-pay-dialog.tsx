'use client';

import { useT } from '@/i18n/client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Smartphone, XCircle } from 'lucide-react';
import { normalizePhone, walletForPhone, type MobileMethod } from '@rentix/shared';
import type { ApiClient } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { cn, money, moneyInputValue, parseMoney } from '@/lib/format';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Field, FormError, Input, MoneyInput } from './ui/form';

export interface MobilePaymentStatus {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVERSED';
  amount: number;
  currency: string;
  method: MobileMethod;
  payerPhone: string | null;
  receiptNumber: string | null;
  failureReason: string | null;
  expiresAt: string | null;
}

const WALLETS: Record<MobileMethod, { label: string; operator: string }> = {
  MPESA: { label: 'M-Pesa', operator: 'Vodacom, 84 ou 85' },
  EMOLA: { label: 'e-Mola', operator: 'Movitel, 86 ou 87' },
  MKESH: { label: 'mKesh', operator: 'Tmcel, 82 ou 83' },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cliente da equipa ou do portal. */
  client: Pick<ApiClient<never>, 'get' | 'download'>;
  /** Ex.: (body) => client.post('/portal/invoices/ID/pay', body) */
  start: (body: {
    method: MobileMethod;
    phone: string;
    amount: number;
  }) => Promise<MobilePaymentStatus>;
  statusPath: (id: string) => string;
  receiptPath?: (id: string) => string;
  outstanding: number;
  currency: string;
  methods: MobileMethod[];
  defaultPhone?: string | null;
  /** Pedido já em curso (ao reabrir a página). */
  resumeId?: string | null;
  /** Quem paga: inquilino (portal), equipa a pedir ao inquilino, ou o proprietário a pagar o plano ao Rentix. */
  audience: 'tenant' | 'staff' | 'subscription';
  onFinished: () => void;
}

/**
 * Pagamento por dinheiro móvel: escolher a carteira e o número, depois esperar que a pessoa
 * confirme com o PIN no telemóvel. O estado é consultado a cada 2 segundos.
 */
export function MobilePayDialog(props: Props) {
  const t = useT();
  const {
    open,
    onOpenChange,
    client,
    outstanding,
    currency,
    methods,
    defaultPhone,
    resumeId,
    audience,
  } = props;
  const [method, setMethod] = useState<MobileMethod>(() => {
    const n = defaultPhone ? normalizePhone(defaultPhone) : null;
    const w = n ? walletForPhone(n) : null;
    return w && methods.includes(w) ? w : (methods[0] ?? 'MPESA');
  });
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [phone, setPhone] = useState(defaultPhone ? defaultPhone.replace(/^\+258/, '') : '');
  const [amount, setAmount] = useState(moneyInputValue(outstanding));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payment, setPayment] = useState<MobilePaymentStatus | null>(null);
  const [pollId, setPollId] = useState<string | null>(null);

  // Retoma um pedido em curso (ao reabrir a página com um pagamento à espera).
  const activeId = pollId ?? (open && resumeId && !resumeDismissed ? resumeId : null);
  const normalized = normalizePhone(phone);

  // Escolhe a carteira automaticamente pelo prefixo do número.
  function changePhone(value: string) {
    setPhone(value);
    const n = normalizePhone(value);
    const detected = n ? walletForPhone(n) : null;
    if (detected && methods.includes(detected)) setMethod(detected);
  }

  // Acompanha o estado enquanto estiver pendente.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    const tick = async () => {
      try {
        const p = await client.get<MobilePaymentStatus>(props.statusPath(activeId));
        if (stop) return;
        setPayment(p);
        if (p.status === 'PENDING') setTimeout(tick, 2000);
        else props.onFinished();
      } catch {
        if (!stop) setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function reset() {
    setPayment(null);
    setPollId(null);
    setResumeDismissed(true);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalized) return setError(t('Número de telemóvel inválido'));
    if (walletForPhone(normalized) !== method)
      return setError(
        t('Para {label} use um número {operator}.', {
          label: WALLETS[method].label,
          operator: WALLETS[method].operator,
        }),
      );
    const value = parseMoney(amount);
    if (value === null || value <= 0) return setError(t('Valor inválido'));
    if (value > outstanding)
      return setError(t('O valor máximo é {money}', { money: money(outstanding, currency) }));
    setSubmitting(true);
    try {
      const p = await props.start({ method, phone: normalized, amount: value });
      setPayment(p);
      setPollId(p.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAYMENT_IN_PROGRESS') {
        const id = (err.details as { paymentId?: string } | undefined)?.paymentId;
        if (id) setPollId(id);
      }
      setError(err instanceof Error ? err.message : t('Não foi possível iniciar o pagamento'));
    } finally {
      setSubmitting(false);
    }
  }

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o && payment?.status !== 'PENDING') reset();
  };

  const wallet = WALLETS[payment?.method ?? method];
  const who = audience === 'staff' ? t('no telemóvel do inquilino') : t('no seu telemóvel');
  const fixedAmount = audience === 'subscription';

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={audience === 'staff' ? t('Pedir pagamento por telemóvel') : t('Pagar agora')}
      description={
        !activeId
          ? `${fixedAmount ? t('A pagar') : t('Em dívida')}: ${money(outstanding, currency)}`
          : undefined
      }
    >
      {activeId && (!payment || payment.status === 'PENDING') ? (
        <div
          className="flex flex-col items-center py-4 text-center"
          role="status"
          aria-live="polite"
        >
          <span className="relative flex size-16 items-center justify-center rounded-full bg-brand-soft">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand/15 motion-reduce:hidden" />
            <Smartphone className="size-7 text-brand" aria-hidden />
          </span>
          <p className="mt-5 font-display text-lg font-semibold">{t('Confirme {who}', { who })}</p>
          <p className="mt-1 max-w-xs text-ink-soft">
            {t('Foi enviado um pedido {label}{1}', {
              label: wallet.label,
              '1': payment?.payerPhone && t(" para {0}", { '0': payment.payerPhone }),
            })}
            {payment && (
              <>
                {' '}
                {t('de')}{' '}
                <span className="money font-medium text-ink">
                  {money(payment.amount, payment.currency)}
                </span>
              </>
            )}
            {t('. Introduza o PIN para concluir.')}
          </p>
          <p className="mt-4 text-sm text-ink-faint">
            {t('Esta janela atualiza sozinha. Pode fechá-la: o pagamento continua.')}
          </p>
        </div>
      ) : payment?.status === 'CONFIRMED' ? (
        <div className="flex flex-col items-center py-4 text-center" role="status">
          <CheckCircle2 className="size-14 text-paid" aria-hidden />
          <p className="mt-4 font-display text-lg font-semibold">{t('Pagamento recebido')}</p>
          <p className="mt-1 text-ink-soft">
            <span className="money font-medium text-ink">
              {money(payment.amount, payment.currency)}
            </span>{' '}
            {t('por {label}. {1}', {
              label: wallet.label,
              '1': fixedAmount
                ? t("Fatura-recibo {0}.", { '0': payment.receiptNumber })
                : t("Recibo {0}.", { '0': payment.receiptNumber }),
            })}
          </p>
          <div className="mt-6 flex gap-2">
            {props.receiptPath && (
              <Button
                variant="secondary"
                onClick={() =>
                  client.download(
                    props.receiptPath!(payment.id),
                    fixedAmount ? 'fatura-recibo.pdf' : 'recibo.pdf',
                  )
                }
              >
                {fixedAmount ? t('Descarregar fatura-recibo') : t('Descarregar recibo')}
              </Button>
            )}
            <Button onClick={() => close(false)}>{t('Fechar')}</Button>
          </div>
        </div>
      ) : payment?.status === 'FAILED' ? (
        <div className="flex flex-col items-center py-4 text-center" role="alert">
          <XCircle className="size-14 text-overdue" aria-hidden />
          <p className="mt-4 font-display text-lg font-semibold">
            {t('O pagamento não foi concluído')}
          </p>
          <p className="mt-1 max-w-sm text-ink-soft">{t.label(payment.failureReason)}</p>
          <Button className="mt-6" onClick={reset}>
            {t('Tentar de novo')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormError message={t.label(error)} />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('Carteira')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {methods.map((m) => (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-pointer flex-col rounded-control border px-3 py-2.5 has-focus-visible:ring-3 has-focus-visible:ring-brand/20',
                    method === m
                      ? 'border-brand bg-brand-soft'
                      : 'border-line-strong hover:bg-paper',
                  )}
                >
                  <input
                    type="radio"
                    name="wallet"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                    className="sr-only"
                  />
                  <span className="font-medium">{t.label(WALLETS[m].label)}</span>
                  <span className="text-xs text-ink-soft">{t.label(WALLETS[m].operator)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t('Número de telemóvel')} hint={t('Ex.: 84 123 4567')}>
            {(p) => (
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => changePhone(e.target.value)}
                {...p}
              />
            )}
          </Field>
          {!fixedAmount && (
            <Field label={t('Valor')} hint={t('Pode pagar só uma parte.')}>
              {(p) => (
                <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} {...p} />
              )}
            </Field>
          )}
          <Button type="submit" size="lg" loading={submitting}>
            {audience === 'staff'
              ? t('Enviar pedido {label}', { label: WALLETS[method].label })
              : t('Pagar com {label}', { label: WALLETS[method].label })}
          </Button>
          <p className="text-center text-xs text-ink-faint">
            {audience === 'tenant'
              ? t('O valor vai diretamente para a conta do senhorio.')
              : audience === 'staff'
                ? t('O inquilino recebe no telemóvel um pedido para confirmar com o PIN.')
                : t('Recebe no telemóvel um pedido para confirmar com o PIN.')}
          </p>
        </form>
      )}
    </Dialog>
  );
}
