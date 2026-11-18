'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { ApiError } from '@/lib/api';
import type { AdminPlan } from '@/lib/platform-types';
import { moneyInputValue, parseMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, FormError, Input, MoneyInput, Textarea } from '@/components/ui/form';

export default function AdminPlansPage() {
  const q = useQuery({ queryKey: ['admin-plans'], queryFn: () => staffApi.get<AdminPlan[]>('/admin/plans') });
  return (
    <>
      <PageHeader
        title="Planos"
        description="Os preços novos valem para as próximas faturas; períodos já pagos não mudam. Limites vazios significam ilimitado."
      />
      {!q.data ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {q.data.map((p) => (
            <PlanEditor key={`${p.id}:${p.updatedAt}`} plan={p} />
          ))}
        </div>
      )}
    </>
  );
}

const limitText = (n: number | null) => (n === null ? '' : String(n));
const parseLimit = (v: string): number | null | undefined => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

function PlanEditor({ plan }: { plan: AdminPlan }) {
  const qc = useQueryClient();
  const free = plan.code === 'FREE';
  const [v, setV] = useState({
    name: plan.name,
    description: plan.description ?? '',
    monthly: moneyInputValue(plan.monthlyPrice),
    annual: moneyInputValue(plan.annualPrice),
    maxUnits: limitText(plan.maxUnits),
    maxTenants: limitText(plan.maxTenants),
    maxMembers: limitText(plan.maxMembers),
    maxStorageMb: limitText(plan.maxStorageMb),
    isActive: plan.isActive,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const monthlyPrice = parseMoney(v.monthly);
    const annualPrice = parseMoney(v.annual);
    const limits = [parseLimit(v.maxUnits), parseLimit(v.maxTenants), parseLimit(v.maxMembers), parseLimit(v.maxStorageMb)];
    if (monthlyPrice === null || annualPrice === null) return setError('Preço inválido');
    if (limits.some((l) => l === undefined)) return setError('Os limites são números inteiros a partir de 1, ou vazios para ilimitado');
    setBusy(true);
    try {
      await staffApi.put(`/admin/plans/${plan.id}`, {
        name: v.name,
        description: v.description.trim() || null,
        monthlyPrice,
        annualPrice,
        maxUnits: limits[0],
        maxTenants: limits[1],
        maxMembers: limits[2],
        maxStorageMb: limits[3],
        isActive: v.isActive,
      });
      toast.success(`Plano ${v.name} guardado`);
      qc.invalidateQueries({ queryKey: ['admin-plans'] });
    } catch (err) {
      setError(err instanceof ApiError && Object.keys(err.fieldErrors).length ? Object.values(err.fieldErrors).join('; ') : err instanceof Error ? err.message : 'Não foi possível guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {plan.name}
          <span className="text-sm font-normal text-ink-faint">{plan.code}</span>
        </span>
      }
      actions={<Badge tone={plan.isActive ? 'paid' : 'neutral'}>{plan.subscriptions} organizações</Badge>}
    >
      <form onSubmit={save} className="flex flex-col gap-4 px-5 py-4" noValidate>
        <FormError message={error} />
        <Field label="Nome">{(p) => <Input value={v.name} onChange={set('name')} {...p} />}</Field>
        <Field label="Descrição" optional>{(p) => <Textarea rows={2} value={v.description} onChange={set('description')} {...p} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço mensal">{(p) => <MoneyInput value={v.monthly} onChange={set('monthly')} disabled={free} {...p} />}</Field>
          <Field label="Preço anual">{(p) => <MoneyInput value={v.annual} onChange={set('annual')} disabled={free} {...p} />}</Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unidades">{(p) => <Input inputMode="numeric" placeholder="ilimitado" value={v.maxUnits} onChange={set('maxUnits')} {...p} />}</Field>
          <Field label="Inquilinos">{(p) => <Input inputMode="numeric" placeholder="ilimitado" value={v.maxTenants} onChange={set('maxTenants')} {...p} />}</Field>
          <Field label="Equipa">{(p) => <Input inputMode="numeric" placeholder="ilimitado" value={v.maxMembers} onChange={set('maxMembers')} {...p} />}</Field>
        </div>
        <Field label="Ficheiros (MB)" hint="1024 MB = 1 GB">{(p) => <Input inputMode="numeric" placeholder="ilimitado" value={v.maxStorageMb} onChange={set('maxStorageMb')} {...p} />}</Field>
        {!free && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
            Disponível para escolher
          </label>
        )}
        <Button type="submit" variant="secondary" loading={busy} className="self-start">
          Guardar
        </Button>
      </form>
    </Panel>
  );
}
