'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { CURRENCIES, isIsoDate, todayIn, type Currency } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import type { AvailableUnit, Organization, Paginated, TenantListItem } from '@/lib/types';
import { moneyField, optionalString, useServerError, useZodForm } from '@/lib/forms';
import { moneyInputValue, num } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, FormError, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';

const date = z.string().refine(isIsoDate, 'Data inválida');
const schema = z
  .object({
    unitId: z.string().min(1, 'Escolha a unidade'),
    tenantId: z.string().min(1, 'Escolha o inquilino'),
    startDate: date,
    endDate: z.string().refine((v) => v === '' || isIsoDate(v), 'Data inválida'),
    rentAmount: moneyField({ required: true, positive: true }),
    depositAmount: moneyField(),
    currency: z.enum(CURRENCIES),
    billingDay: z.coerce.number().int().min(1, 'Entre 1 e 28').max(28, 'Entre 1 e 28'),
    lateFeePercent: z.string().trim(),
    notes: optionalString,
  })
  .refine((v) => !v.endDate || v.endDate > v.startDate, {
    message: 'Deve ser depois do início',
    path: ['endDate'],
  });

function NewLeaseForm() {
  const tr = useT();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();

  const units = useQuery({
    queryKey: ['units-available'],
    queryFn: () => staffApi.get<AvailableUnit[]>('/units/available'),
  });
  const tenants = useQuery({
    queryKey: ['tenants-no-lease'],
    queryFn: () =>
      staffApi.get<Paginated<TenantListItem>>('/tenants', { hasActiveLease: false, pageSize: 100 }),
  });
  const org = useQuery({
    queryKey: ['organization'],
    queryFn: () => staffApi.get<Organization>('/organization'),
  });

  const form = useZodForm(schema, {
    unitId: params.get('unidade') ?? '',
    tenantId: params.get('inquilino') ?? '',
    startDate: todayIn(),
    endDate: '',
    rentAmount: '',
    depositAmount: '',
    currency: 'MZN',
    billingDay: 5,
    lateFeePercent: '',
    notes: '',
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;
  const unitId = form.watch('unitId');

  // Preenche a renda com o valor de referência da unidade e o dia de cobrança da organização.
  useEffect(() => {
    const u = units.data?.find((x) => x.id === unitId);
    if (u?.rentAmount && !form.getValues('rentAmount'))
      form.setValue('rentAmount', moneyInputValue(u.rentAmount));
  }, [unitId, units.data, form]);
  useEffect(() => {
    if (org.data) {
      form.setValue('billingDay', org.data.defaultBillingDay);
      form.setValue('currency', org.data.defaultCurrency);
    }
  }, [org.data, form]);

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    const pct = v.lateFeePercent.replace(',', '.');
    const lateFeeBps = pct === '' ? null : Math.round(Number(pct) * 100);
    if (
      lateFeeBps !== null &&
      (!Number.isFinite(lateFeeBps) || lateFeeBps < 0 || lateFeeBps > 10_000)
    ) {
      form.setError('lateFeePercent', { message: tr('Percentagem inválida') });
      return;
    }
    try {
      const lease = await staffApi.post<{ id: string }>('/leases', {
        unitId: v.unitId,
        tenantId: v.tenantId,
        startDate: v.startDate,
        endDate: v.endDate || null,
        rentAmount: v.rentAmount,
        depositAmount: v.depositAmount ?? 0,
        currency: v.currency as Currency,
        billingDay: v.billingDay,
        lateFeeBps,
        notes: v.notes,
        activate: true,
      });
      await qc.invalidateQueries();
      toast.success(tr('Contrato criado. As faturas já foram emitidas.'));
      router.push(`/contratos/${lease.id}`);
    } catch (err) {
      server.handle(err);
    }
  });

  if (!units.data || !tenants.data) return <LoadingRows rows={6} />;

  if (units.data.length === 0 || tenants.data.data.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={
            units.data.length === 0
              ? tr('Não há unidades livres')
              : tr('Não há inquilinos sem contrato')
          }
          description={
            units.data.length === 0
              ? tr('Registe um imóvel ou acrescente uma unidade antes de criar o contrato.')
              : tr('Registe primeiro o inquilino.')
          }
          action={
            <Button asChild>
              {units.data.length === 0 ? (
                <Link href="/imoveis/novo">{tr('Registar imóvel')}</Link>
              ) : (
                <Link href="/inquilinos/novo">{tr('Novo inquilino')}</Link>
              )}
            </Button>
          }
        />
      </Panel>
    );
  }

  const orgFee = org.data ? num(org.data.lateFeeBps / 100) : '';

  return (
    <Panel className="p-5 sm:p-7">
      <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
        <FormError message={tr.label(server.message)} />
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 font-display text-lg font-semibold">
            {tr('Quem arrenda o quê')}
          </legend>
          <Field label={tr('Unidade')} error={errors.unitId?.message}>
            {(p) => (
              <Select {...p} {...form.register('unitId')}>
                <option value="">{tr('Escolha…')}</option>
                {units.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {tr.label(u.property.name)}, {tr.label(u.label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={tr('Inquilino')} error={errors.tenantId?.message}>
            {(p) => (
              <Select {...p} {...form.register('tenantId')}>
                <option value="">{tr('Escolha…')}</option>
                {tenants.data.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tr.label(t.fullName)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={tr('Início')} error={errors.startDate?.message}>
            {(p) => <Input type="date" {...p} {...form.register('startDate')} />}
          </Field>
          <Field
            label={tr('Fim')}
            optional
            hint={tr('Deixe em branco se não tiver termo.')}
            error={errors.endDate?.message}
          >
            {(p) => <Input type="date" {...p} {...form.register('endDate')} />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 font-display text-lg font-semibold">{tr('Valores')}</legend>
          <Field label={tr('Renda mensal')} error={errors.rentAmount?.message}>
            {(p) => <MoneyInput placeholder="0,00" {...p} {...form.register('rentAmount')} />}
          </Field>
          <Field label={tr('Moeda')} error={errors.currency?.message}>
            {(p) => (
              <Select {...p} {...form.register('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {tr.label(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={tr('Dia de pagamento')}
            hint={tr('Dia do mês em que a renda vence (1 a 28).')}
            error={errors.billingDay?.message}
          >
            {(p) => (
              <Input type="number" min={1} max={28} {...p} {...form.register('billingDay')} />
            )}
          </Field>
          <Field
            label={tr('Caução')}
            optional
            hint={tr('Emitimos uma fatura de caução ao criar o contrato.')}
            error={errors.depositAmount?.message}
          >
            {(p) => <MoneyInput placeholder="0,00" {...p} {...form.register('depositAmount')} />}
          </Field>
          <Field
            label={tr('Multa por atraso (%)')}
            optional
            hint={
              orgFee ? tr('Em branco usa a definição geral: {orgFee}%.', { orgFee }) : undefined
            }
            error={errors.lateFeePercent?.message}
          >
            {(p) => (
              <Input
                inputMode="decimal"
                placeholder={tr.label(orgFee)}
                {...p}
                {...form.register('lateFeePercent')}
              />
            )}
          </Field>
          <Field
            label={tr('Notas')}
            optional
            className="sm:col-span-2"
            error={errors.notes?.message}
          >
            {(p) => <Textarea rows={3} {...p} {...form.register('notes')} />}
          </Field>
        </fieldset>

        <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-soft">
            {tr('A unidade fica ocupada e a fatura da renda deste mês é emitida de imediato.')}
          </p>
          <Button type="submit" loading={isSubmitting}>
            {tr('Criar contrato')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export default function NewLeasePage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('Novo contrato')} back={{ href: '/contratos', label: 'Contratos' }} />
      <Suspense>
        <NewLeaseForm />
      </Suspense>
    </>
  );
}
