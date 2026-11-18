'use client';

import { intlLocale } from '@rentix/shared';
import { currentLocale } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Landmark, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import type { BillingCycle } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useStaffSession } from '@/lib/session';
import type {
  BillingOverview,
  ChangeQuote,
  CheckoutResult,
  PlatformInvoice,
  PublicPlan,
} from '@/lib/platform-types';
import { cn, daysUntil, instantDate, money } from '@/lib/format';
import {
  cycleLabel,
  cycleUnit,
  platformInvoiceKindLabel,
  platformInvoiceStatusLabel,
  subscriptionStatusLabel,
} from '@/i18n/platform';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { MobilePayDialog, type MobilePaymentStatus } from '@/components/mobile-pay-dialog';

export default function PlanPage() {
  const t = useT();
  const { session } = useStaffSession();
  const role = session?.organization?.role;
  const isOwner = role === 'OWNER';
  const q = useQuery({
    queryKey: ['billing'],
    queryFn: () => staffApi.get<BillingOverview>('/billing'),
  });
  const [paying, setPaying] = useState<PlatformInvoice | null>(null);
  const [transfer, setTransfer] = useState<PlatformInvoice | null>(null);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={8} />;
  const b = q.data;
  const canPayMobile = b.paymentOptions.mobileMethods.length > 0;

  return (
    <>
      <PageHeader
        back={{ href: '/definicoes', label: t('Definições') }}
        title={t('Plano e faturação')}
      />
      <div className="flex flex-col gap-6">
        <CurrentPlan b={b} isOwner={isOwner} />

        {b.openInvoices.map((inv) => (
          <OpenInvoice
            key={inv.id}
            invoice={inv}
            isOwner={isOwner}
            canPayMobile={canPayMobile}
            hasBank={b.paymentOptions.bankTransfer.length > 0}
            onPay={() => setPaying(inv)}
            onTransfer={() => setTransfer(inv)}
          />
        ))}

        <PlanPicker
          b={b}
          isOwner={isOwner}
          onInvoice={(inv) => (canPayMobile ? setPaying(inv) : setTransfer(inv))}
        />

        {(isOwner || role === 'ACCOUNTANT') && <InvoiceHistory />}
      </div>

      {paying && (
        <MobilePayDialog
          key={paying.id}
          open
          onOpenChange={(o) => !o && setPaying(null)}
          client={staffApi}
          audience="subscription"
          start={(body) =>
            staffApi.post<MobilePaymentStatus>(`/billing/invoices/${paying.id}/pay`, {
              method: body.method,
              phone: body.phone,
            })
          }
          statusPath={(id) => `/billing/payments/${id}`}
          receiptPath={() => `/billing/invoices/${paying.id}/pdf`}
          outstanding={paying.amount}
          currency={paying.currency}
          methods={b.paymentOptions.mobileMethods}
          defaultPhone={session?.user.phone}
          resumeId={b.pendingPaymentId}
          onFinished={() => void q.refetch()}
        />
      )}
      <Dialog
        open={!!transfer}
        onOpenChange={(o) => !o && setTransfer(null)}
        title={t('Pagar por transferência')}
        description={transfer ? `Fatura ${transfer.number}` : undefined}
      >
        {transfer && (
          <div className="flex flex-col gap-4">
            <p className="money font-display text-3xl font-semibold">
              {money(transfer.amount, transfer.currency)}
            </p>
            {b.paymentOptions.bankTransfer.length ? (
              <dl className="rounded-control border border-line bg-paper px-4 py-3 text-sm">
                {b.paymentOptions.bankTransfer.map((l) => (
                  <dd key={l}>{t.label(l)}</dd>
                ))}
                <dd className="mt-2 font-medium">
                  {t('Descritivo: {number}', { number: transfer.number })}
                </dd>
              </dl>
            ) : (
              <p className="text-ink-soft">
                {t('Os dados bancários ainda não estão configurados. Contacte o Rentix.')}
              </p>
            )}
            <p className="text-sm text-ink-soft">
              {t(
                'Quando recebermos a transferência, o plano fica ativo e recebe a fatura-recibo por email. Costuma demorar até um dia útil.',
              )}
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                staffApi.download(`/billing/invoices/${transfer.id}/pdf`, `${transfer.number}.pdf`)
              }
            >
              <Download aria-hidden /> {t('Descarregar a fatura')}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const t = useT();
  const pct = max === null ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  const over = max !== null && used > max;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{t.label(label)}</span>
        <span className={cn('money', over && 'font-medium text-overdue')}>
          {used}{' '}
          {max === null ? <span className="text-ink-faint">{t('de ilimitado')}</span> : t('de {max}', { max })}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-line" aria-hidden>
        {max !== null && (
          <div
            className={cn(
              'h-full rounded-full',
              over ? 'bg-overdue' : pct >= 80 ? 'bg-due' : 'bg-brand',
            )}
            style={{ width: `${Math.max(pct, used ? 3 : 0)}%` }}
          />
        )}
      </div>
    </div>
  );
}

const mb = (bytes: number) => bytes / 1024 / 1024;
const sizeText = (megabytes: number) =>
  megabytes >= 1024
    ? `${(megabytes / 1024).toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: 1 })} GB`
    : `${megabytes.toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: megabytes < 10 ? 1 : 0 })} MB`;

function StorageMeter({ bytes, maxMb }: { bytes: number; maxMb: number | null }) {
  const t = useT();
  const used = mb(bytes);
  const pct = maxMb === null ? 0 : Math.min(100, Math.round((used / maxMb) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{t('Ficheiros')}</span>
        <span className="money">
          {t.label(sizeText(used))}{' '}
          {maxMb === null ? (
            <span className="text-ink-faint">{t('sem limite')}</span>
          ) : (
            t("de {max}", { max: sizeText(maxMb) })
          )}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-line" aria-hidden>
        {maxMb !== null && (
          <div
            className={cn(
              'h-full rounded-full',
              pct >= 95 ? 'bg-overdue' : pct >= 80 ? 'bg-due' : 'bg-brand',
            )}
            style={{ width: `${Math.max(pct, bytes ? 2 : 0)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function CurrentPlan({ b, isOwner }: { b: BillingOverview; isOwner: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const s = b.subscription;
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const free = s.plan.monthlyPrice === 0;
  const end = s.currentPeriodEnd;

  let line: string;
  if (free) line = t('Plano gratuito, sem prazo.');
  else if (s.status === 'TRIALING')
    line = t(
      'Período de teste: faltam {daysUntil} dias (até {instantDate}). Depois, se não escolher um plano, passa para o Grátis.',
      { daysUntil: daysUntil(end!), instantDate: instantDate(end, { until: true }) },
    );
  else if (s.status === 'PAST_DUE')
    line = t(
      'A renovação está por pagar. O plano mantém-se até {instantDate}; depois passa para o Grátis.',
      { instantDate: instantDate(s.downgradeAt) },
    );
  else if (s.cancelAtPeriodEnd)
    line = t('Ativo até {instantDate}. Depois passa para o Grátis.', {
      instantDate: instantDate(end, { until: true }),
    });
  else if (s.scheduledPlan)
    line = t('Ativo até {instantDate}. Depois muda para o {name}{2}.', {
      instantDate: instantDate(end, { until: true }),
      name: s.scheduledPlan.name,
      '2': s.scheduledCycle ? ` (${cycleLabel[s.scheduledCycle].toLowerCase()})` : '',
    });
  else
    line = s.periodValue
      ? t('{ciclo}. Renova a {data} por {valor}.', { ciclo: t(cycleLabel[s.billingCycle]), data: instantDate(end), valor: money(s.billingCycle === 'ANNUAL' ? s.plan.annualPrice : s.plan.monthlyPrice) })
      : t('{ciclo}. Renova a {data}.', { ciclo: t(cycleLabel[s.billingCycle]), data: instantDate(end) });

  async function keep() {
    setBusy(true);
    try {
      await staffApi.post('/billing/keep-current');
      toast.success(t('Mantém o {name}', { name: s!.plan.name }));
      await qc.invalidateQueries({ queryKey: ['billing'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível concluir'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5 sm:p-7">
      <div className="grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <p className="text-sm text-ink-soft">{t('Plano atual')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-3xl font-semibold">{t.label(s.plan.name)}</h2>
            {!free && (
              <Badge
                tone={
                  s.status === 'ACTIVE' ? 'paid' : s.status === 'PAST_DUE' ? 'overdue' : 'brand'
                }
              >
                {t.label(subscriptionStatusLabel[s.status])}
              </Badge>
            )}
          </div>
          <p className="mt-2 max-w-xl text-ink-soft">{t.label(line)}</p>
          {isOwner && (s.cancelAtPeriodEnd || s.scheduledPlan) && (
            <Button variant="secondary" size="sm" className="mt-4" loading={busy} onClick={keep}>
              {t('Manter o {name}', { name: s.plan.name })}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Meter label={t('Unidades')} used={b.usage.units} max={b.limits.maxUnits} />
          <Meter label={t('Inquilinos')} used={b.usage.tenants} max={b.limits.maxTenants} />
          <Meter
            label={t('Equipa (com convites)')}
            used={b.usage.members + b.usage.pendingInvites}
            max={b.limits.maxMembers}
          />
          <StorageMeter bytes={b.usage.storageBytes} maxMb={b.limits.maxStorageMb} />
        </div>
      </div>
    </Panel>
  );
}

function OpenInvoice(props: {
  invoice: PlatformInvoice;
  isOwner: boolean;
  canPayMobile: boolean;
  hasBank: boolean;
  onPay: () => void;
  onTransfer: () => void;
}) {
  const t = useT();
  const { invoice: i } = props;
  return (
    <section
      className="rounded-panel border border-brand/30 bg-brand-soft px-5 py-4 sm:px-7"
      aria-label={t('Fatura {number} por pagar', { number: i.number })}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-ink-soft">
            {t('{0}, fatura {number}', { '0': platformInvoiceKindLabel[i.kind], number: i.number })}
          </p>
          <p className="mt-0.5 font-display text-lg font-semibold">
            {t.label(i.plan.name)} {t.label(cycleLabel[i.billingCycle].toLowerCase())}:{' '}
            <span className="money">{money(i.amount, i.currency)}</span>
          </p>
          <p className="text-sm text-ink-soft">
            {i.credit > 0 && (
              <>{t('Inclui {money} de crédito do plano anterior.', { money: money(i.credit) })} </>
            )}
            {t('Pagar até {instantDate}.', { instantDate: instantDate(i.dueDate) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.isOwner && props.canPayMobile && (
            <Button onClick={props.onPay}>
              <Smartphone aria-hidden /> {t('Pagar por telemóvel')}
            </Button>
          )}
          {props.isOwner && (
            <Button variant="secondary" onClick={props.onTransfer}>
              <Landmark aria-hidden /> {t('Transferência')}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => staffApi.download(`/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`)}
          >
            <Download aria-hidden /> {t('PDF')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function PlanPicker({
  b,
  isOwner,
  onInvoice,
}: {
  b: BillingOverview;
  isOwner: boolean;
  onInvoice: (i: PlatformInvoice) => void;
}) {
  const tr = useT();
  const current = b.subscription;
  const [cycle, setCycle] = useState<BillingCycle>(
    current && current.plan.monthlyPrice > 0 && current.status === 'ACTIVE'
      ? current.billingCycle
      : 'MONTHLY',
  );
  const [choice, setChoice] = useState<PublicPlan | null>(null);
  const paid = b.plans.filter((p) => p.monthlyPrice > 0);
  const savings = paid.length
    ? Math.round((1 - paid[0]!.annualPrice / (paid[0]!.monthlyPrice * 12)) * 100)
    : 0;

  return (
    <Panel>
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <h2 className="font-display text-lg font-semibold">{tr('Planos')}</h2>
        <div
          role="radiogroup"
          aria-label={tr('Ciclo de pagamento')}
          className="inline-flex rounded-control border border-line-strong p-0.5 text-sm"
        >
          {(['MONTHLY', 'ANNUAL'] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                'rounded-[5px] px-3 py-1.5',
                cycle === c ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink',
              )}
            >
              {tr.label(cycleLabel[c])}
              {c === 'ANNUAL' && savings > 0 && (
                <span className={cn('ml-1.5', cycle === c ? 'text-white/80' : 'text-paid')}>
                  {tr('poupa {savings}%', { savings })}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        {b.plans.map((p) => {
          const price = cycle === 'ANNUAL' ? p.annualPrice : p.monthlyPrice;
          const isCurrent =
            current?.plan.code === p.code &&
            (p.monthlyPrice === 0 ||
              (current.billingCycle === cycle && current.status === 'ACTIVE'));
          const isScheduled =
            current?.scheduledPlan?.code === p.code && current.scheduledCycle === cycle;
          const lim = (n: number | null, one: string, many: string, unlimited: string) =>
            n === null ? unlimited : tr('Até {n} {1}', { n, '1': n === 1 ? one : many });
          const onPaidCurrent = current?.plan.code === p.code && current.status === 'ACTIVE';
          return (
            <div key={p.code} className="flex flex-col px-5 py-6 sm:px-7">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-semibold">{tr.label(p.name)}</h3>
                {isCurrent && <Badge tone="brand">{tr('Atual')}</Badge>}
                {isScheduled && <Badge>{tr('Agendado')}</Badge>}
              </div>
              <p className="mt-3">
                <span className="money font-display text-3xl font-semibold">
                  {price === 0 ? tr('Sem custo') : money(price, p.currency)}
                </span>
                {price > 0 && <span className="text-ink-soft"> {tr.label(cycleUnit[cycle])}</span>}
              </p>
              {price > 0 && cycle === 'ANNUAL' && (
                <p className="text-sm text-ink-faint">
                  {tr('equivale a {money} por mês', {
                    money: money(Math.round(p.annualPrice / 12)),
                  })}
                </p>
              )}
              {p.description && (
                <p className="mt-3 text-sm text-ink-soft">{tr.label(p.description)}</p>
              )}
              <ul className="mt-4 flex flex-col gap-1.5 text-sm">
                {[
                  lim(p.maxUnits, tr('unidade'), tr('unidades'), tr('Unidades ilimitadas')),
                  lim(p.maxTenants, tr('inquilino'), tr('inquilinos'), tr('Inquilinos ilimitados')),
                  lim(
                    p.maxMembers,
                    tr('pessoa na equipa'),
                    tr('pessoas na equipa'),
                    tr('Equipa sem limite'),
                  ),
                  p.maxStorageMb === null
                    ? tr('Ficheiros sem limite')
                    : tr('{sizeText} para documentos e fotografias', {
                        sizeText: sizeText(p.maxStorageMb),
                      }),
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-paid" aria-hidden />
                    {tr.label(t)}
                  </li>
                ))}
              </ul>
              {isOwner && !isCurrent && !isScheduled && (
                <Button
                  variant={
                    p.monthlyPrice > (current?.plan.monthlyPrice ?? 0) ? 'primary' : 'secondary'
                  }
                  className="mt-6 self-start"
                  onClick={() => setChoice(p)}
                >
                  {p.monthlyPrice === 0
                    ? tr('Passar para o Grátis')
                    : onPaidCurrent
                      ? tr('Passar a {0}', { '0': cycleLabel[cycle].toLowerCase() })
                      : `Escolher ${p.name}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {!isOwner && (
        <p className="border-t border-line px-5 py-3 text-sm text-ink-soft sm:px-7">
          {tr('Só o proprietário da organização pode mudar de plano.')}
        </p>
      )}
      {choice && (
        <ConfirmChange
          plan={choice}
          cycle={cycle}
          onClose={() => setChoice(null)}
          onInvoice={onInvoice}
        />
      )}
    </Panel>
  );
}

function ConfirmChange({
  plan,
  cycle,
  onClose,
  onInvoice,
}: {
  plan: PublicPlan;
  cycle: BillingCycle;
  onClose: () => void;
  onInvoice: (i: PlatformInvoice) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const effectiveCycle = plan.monthlyPrice === 0 ? 'MONTHLY' : cycle;
  const q = useQuery({
    queryKey: ['billing-quote', plan.code, effectiveCycle],
    queryFn: () =>
      staffApi.get<ChangeQuote>('/billing/quote', {
        planCode: plan.code,
        billingCycle: effectiveCycle,
      }),
  });
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const r = await staffApi.post<CheckoutResult>('/billing/checkout', {
        planCode: plan.code,
        billingCycle: effectiveCycle,
      });
      await qc.invalidateQueries({ queryKey: ['billing'] });
      onClose();
      if (r.invoice && r.invoice.status === 'OPEN') onInvoice(r.invoice);
      else if (r.invoice) toast.success(t('Plano {name} ativo', { name: plan.name }));
      else if (r.mode === 'FREE_NOW') toast.success(t('Passou para o plano Grátis'));
      else toast.success(t('Mudança agendada'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível concluir'));
    } finally {
      setBusy(false);
    }
  }

  const d = q.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        plan.monthlyPrice === 0
          ? t('Passar para o Grátis')
          : `${plan.name}, ${cycleLabel[effectiveCycle].toLowerCase()}`
      }
    >
      {!d ? (
        <LoadingRows rows={3} />
      ) : (
        <div className="flex flex-col gap-4">
          {d.kind === 'IMMEDIATE' && (
            <>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">
                    {t.label(plan.name)} {t.label(cycleLabel[effectiveCycle].toLowerCase())}
                  </dt>
                  <dd className="money">{money(d.planAmount)}</dd>
                </div>
                {d.credit > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-soft">
                      {t('Crédito do {name} (tempo não usado)', { name: d.from.name })}
                    </dt>
                    <dd className="money">-{money(d.credit)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-2 font-medium">
                  <dt>{t('A pagar agora')}</dt>
                  <dd className="money">{money(d.amount)}</dd>
                </div>
              </dl>
              <p className="text-sm text-ink-soft">
                {d.amount === 0
                  ? t('O crédito cobre o valor todo: o plano fica ativo já.')
                  : t(
                      'O novo plano fica ativo assim que o pagamento for confirmado, e o período começa nesse dia.',
                    )}
              </p>
              <Button onClick={confirm} loading={busy}>
                {d.amount === 0 ? t('Ativar plano') : t('Continuar para o pagamento')}
              </Button>
            </>
          )}
          {d.kind === 'SCHEDULED' && (
            <>
              <p>
                {t('Mantém o {name} até {instantDate}, que já está pago. {2}', {
                  name: d.from.name,
                  instantDate: instantDate(d.effectiveAt, { until: true }),
                  '2': d.toFree
                    ? t("Depois passa para o Grátis.")
                    : t("Depois muda para o {0}, e a renovação já sai com o novo preço.", { '0': plan.name }),
                })}
              </p>
              {d.toFree && (
                <p className="text-sm text-ink-soft">
                  {t(
                    'Nenhum dado é apagado. Se tiver mais unidades ou inquilinos do que o Grátis permite, continua a vê-los e a editá-los, mas não pode acrescentar novos.',
                  )}
                </p>
              )}
              <Button variant={d.toFree ? 'secondary' : 'primary'} onClick={confirm} loading={busy}>
                {d.toFree ? t('Não renovar') : t('Agendar mudança')}
              </Button>
            </>
          )}
          {d.kind === 'FREE_NOW' && (
            <>
              <p>
                {t(
                  'A organização passa já para o Grátis. Nenhum dado é apagado, mas não poderá acrescentar unidades, inquilinos ou pessoas acima dos limites.',
                )}
              </p>
              <Button variant="secondary" onClick={confirm} loading={busy}>
                {t('Passar para o Grátis')}
              </Button>
            </>
          )}
          {d.kind === 'CHOOSE_LONGER_CYCLE' && (
            <p>
              {t(
                'Ainda tem muito crédito do plano anual. Escolha o {name} anual para o aproveitar por inteiro.',
                { name: plan.name },
              )}
            </p>
          )}
          {d.kind === 'NOOP' && <p>{t('Já está neste plano.')}</p>}
        </div>
      )}
    </Dialog>
  );
}

function InvoiceHistory() {
  const t = useT();
  const q = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => staffApi.get<PlatformInvoice[]>('/billing/invoices'),
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Panel title={t('Faturas do Rentix')}>
      <Table>
        <thead>
          <tr>
            <Th>{t('Fatura')}</Th>
            <Th className="hidden sm:table-cell">{t('Plano')}</Th>
            <Th className="text-right">{t('Valor')}</Th>
            <Th>{t('Estado')}</Th>
            <Th className="w-0" />
          </tr>
        </thead>
        <tbody>
          {q.data.map((i) => (
            <Tr key={i.id}>
              <Td>
                <span className="font-medium">{t.label(i.number)}</span>
                <span className="block text-ink-faint">{instantDate(i.createdAt)}</span>
              </Td>
              <Td className="hidden sm:table-cell">
                {t.label(i.plan.name)}, {t.label(cycleLabel[i.billingCycle].toLowerCase())}
              </Td>
              <Td className="money text-right">{money(i.amount, i.currency)}</Td>
              <Td>
                <Badge
                  tone={i.status === 'PAID' ? 'paid' : i.status === 'OPEN' ? 'due' : 'neutral'}
                >
                  {t.label(platformInvoiceStatusLabel[i.status])}
                </Badge>
              </Td>
              <Td>
                {i.status !== 'VOID' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      staffApi.download(`/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`)
                    }
                    aria-label={t("Descarregar {0}", { "0": i.number })}
                  >
                    <Download aria-hidden />
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}
