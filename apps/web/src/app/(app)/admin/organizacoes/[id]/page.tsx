'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BILLING_CYCLES, todayIn, type BillingCycle } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { ApiError } from '@/lib/api';
import type { AdminOrgDetail, AdminPlan, PlatformInvoice } from '@/lib/platform-types';
import { instantDate, money } from '@/lib/format';
import { memberRoleLabel } from '@/i18n/pt';
import { auditActionLabel, cycleLabel, platformInvoiceStatusLabel, subscriptionStatusLabel } from '@/i18n/platform';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, DetailList, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { MarkPaidDialog } from '@/components/admin/mark-paid-dialog';

const when = (iso: string) => new Intl.DateTimeFormat('pt-MZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Maputo' }).format(new Date(iso));

export default function AdminOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-org', id], queryFn: () => staffApi.get<AdminOrgDetail>(`/admin/organizations/${id}`) });
  const [editSub, setEditSub] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [paying, setPaying] = useState<PlatformInvoice | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('admin-') });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={8} />;
  const o = q.data;
  const s = o.subscription;
  const lim = (n: number | null) => (n === null ? 'ilimitado' : n);

  async function reactivate() {
    try {
      await staffApi.post(`/admin/organizations/${id}/reactivate`);
      toast.success('Organização reativada');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível reativar');
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/admin/organizacoes', label: 'Organizações' }}
        title={o.name}
        description={`Criada a ${instantDate(o.createdAt)}${o.city ? `, ${o.city}` : ''}`}
        actions={
          o.status === 'SUSPENDED' ? (
            <Button onClick={reactivate}>Reativar</Button>
          ) : (
            <Button variant="secondary" onClick={() => setSuspending(true)}>Suspender</Button>
          )
        }
      />
      {o.status === 'SUSPENDED' && (
        <p className="mb-6 rounded-panel border border-overdue/30 bg-overdue-soft px-4 py-3 text-sm">
          Suspensa a {instantDate(o.suspendedAt)}: {o.suspendedReason}. A equipa só vê o plano e as faturas; o portal dos inquilinos continua a funcionar.
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Panel title="Subscrição" actions={<Button size="sm" variant="secondary" onClick={() => setEditSub(true)}>Alterar</Button>}>
            <div className="px-5 py-4">
              {s ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold">
                    {s.plan.name}
                    {s.plan.code !== 'FREE' && <Badge tone={s.status === 'ACTIVE' ? 'paid' : s.status === 'PAST_DUE' ? 'overdue' : 'brand'}>{subscriptionStatusLabel[s.status]}</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {s.currentPeriodEnd ? `${cycleLabel[s.billingCycle]}, até ${instantDate(s.currentPeriodEnd, { until: true })}` : 'Sem prazo'}
                    {s.periodValue === 0 && s.plan.code !== 'FREE' && s.status === 'ACTIVE' && ' (oferecido)'}
                    {s.cancelAtPeriodEnd && '. Não renova.'}
                    {s.scheduledPlan && `. Muda depois para o ${s.scheduledPlan.name}.`}
                  </p>
                </>
              ) : (
                <p className="text-ink-soft">Sem subscrição.</p>
              )}
              <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
                {[
                  ['Unidades', o.usage.units, o.limits.maxUnits],
                  ['Inquilinos', o.usage.tenants, o.limits.maxTenants],
                  ['Equipa', o.usage.members + o.usage.pendingInvites, o.limits.maxMembers],
                ].map(([l, u, m]) => (
                  <div key={l as string}>
                    <dt className="text-ink-soft">{l}</dt>
                    <dd className="money">{u} <span className="text-ink-faint">de {lim(m as number | null)}</span></dd>
                  </div>
                ))}
              </dl>
            </div>
          </Panel>

          <Panel title="Faturas do Rentix">
            {o.invoices.length === 0 ? (
              <p className="px-5 py-6 text-center text-ink-soft">Ainda sem faturas.</p>
            ) : (
              <Table>
                <thead>
                  <tr><Th>Fatura</Th><Th className="text-right">Valor</Th><Th>Estado</Th><Th className="w-0" /></tr>
                </thead>
                <tbody>
                  {o.invoices.map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        <span className="font-medium">{i.number}</span>
                        <span className="block text-ink-faint">{i.plan.name}, {cycleLabel[i.billingCycle].toLowerCase()}, {instantDate(i.createdAt)}</span>
                      </Td>
                      <Td className="money text-right">{money(i.amount, i.currency)}</Td>
                      <Td>
                        <Badge tone={i.status === 'PAID' ? 'paid' : i.status === 'OPEN' ? 'due' : 'neutral'}>{platformInvoiceStatusLabel[i.status]}</Badge>
                        {i.paymentReference && <span className="block text-xs text-ink-faint">{i.paymentReference}</span>}
                      </Td>
                      <Td>{i.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => setPaying(i)}>Registar pagamento</Button>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Dados">
            <div className="px-5 py-4">
              <DetailList
                items={[
                  { label: 'NUIT', value: o.nuit ?? '—' },
                  { label: 'Email', value: o.email ?? '—' },
                  { label: 'Telefone', value: o.phone ?? '—' },
                ]}
              />
            </div>
          </Panel>
          <Panel title="Equipa">
            <ul className="divide-y divide-line">
              {o.members.map((m) => (
                <li key={m.user.id} className="px-5 py-3 text-sm">
                  <span className="font-medium">{m.user.name}</span> <span className="text-ink-faint">({memberRoleLabel[m.role].toLowerCase()})</span>
                  <span className="block text-ink-soft">{[m.user.email, m.user.phone].filter(Boolean).join(', ')}</span>
                  <span className="block text-xs text-ink-faint">{m.user.lastLoginAt ? `Última entrada ${when(m.user.lastLoginAt)}` : 'Nunca entrou'}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Atividade recente">
            <ul className="divide-y divide-line">
              {o.activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 px-5 py-2 text-sm">
                  <span>{auditActionLabel[a.action] ?? a.action}</span>
                  <span className="shrink-0 text-ink-faint">{when(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {editSub && <SubscriptionDialog org={o} onClose={() => setEditSub(false)} onDone={refresh} />}
      <SuspendDialog open={suspending} orgId={o.id} onClose={() => setSuspending(false)} onDone={refresh} />
      <MarkPaidDialog invoice={paying} onClose={() => setPaying(null)} onDone={refresh} />
    </>
  );
}

function SubscriptionDialog({ org, onClose, onDone }: { org: AdminOrgDetail; onClose: () => void; onDone: () => void }) {
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => staffApi.get<AdminPlan[]>('/admin/plans') });
  const s = org.subscription;
  const [planCode, setPlanCode] = useState(s?.plan.code ?? 'FREE');
  const [cycle, setCycle] = useState<BillingCycle>(s?.billingCycle ?? 'MONTHLY');
  const [status, setStatus] = useState<'TRIALING' | 'ACTIVE'>(s?.status === 'TRIALING' ? 'TRIALING' : 'ACTIVE');
  // Por omissão: o fim atual, ou daqui a 30 dias.
  const [periodEnd, setPeriodEnd] = useState(() =>
    todayIn('Africa/Maputo', new Date(s?.currentPeriodEnd ? new Date(s.currentPeriodEnd).getTime() - 1000 : Date.now() + 30 * 86_400_000)),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const free = planCode === 'FREE';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await staffApi.put(`/admin/organizations/${org.id}/subscription`, { planCode, billingCycle: cycle, status, periodEnd: free ? null : periodEnd, reason });
      toast.success('Subscrição alterada');
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && Object.keys(err.fieldErrors).length ? Object.values(err.fieldErrors).join('; ') : err instanceof Error ? err.message : 'Não foi possível guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Alterar subscrição" description="Para oferecer um plano, prolongar um teste ou corrigir um erro. Faturas em aberto são anuladas.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plano">
            {(p) => (
              <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)} {...p}>
                {plans.data?.map((pl) => <option key={pl.code} value={pl.code}>{pl.name}</option>)}
              </Select>
            )}
          </Field>
          {!free && (
            <Field label="Estado">
              {(p) => (
                <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} {...p}>
                  <option value="ACTIVE">Ativo (oferecido)</option>
                  <option value="TRIALING">Em teste</option>
                </Select>
              )}
            </Field>
          )}
        </div>
        {!free && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Válido até (inclusive)">
              {(p) => <Input type="date" min={todayIn()} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} {...p} />}
            </Field>
            <Field label="Ciclo das renovações">
              {(p) => (
                <Select value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle)} {...p}>
                  {BILLING_CYCLES.map((c) => <option key={c} value={c}>{cycleLabel[c]}</option>)}
                </Select>
              )}
            </Field>
          </div>
        )}
        <Field label="Motivo" hint="Fica no histórico da organização.">
          {(p) => <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}
        </Field>
        <Button type="submit" loading={busy}>Guardar</Button>
      </form>
    </Dialog>
  );
}

function SuspendDialog({ open, orgId, onClose, onDone }: { open: boolean; orgId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await staffApi.post(`/admin/organizations/${orgId}/suspend`, { reason });
      toast.success('Organização suspensa');
      setReason('');
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível suspender');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Suspender organização" description="A equipa deixa de poder trabalhar (vê só o plano e as faturas). Os dados não são apagados e o portal dos inquilinos continua.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Motivo">{(p) => <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} {...p} />}</Field>
        <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 3}>Suspender</Button>
      </form>
    </Dialog>
  );
}
