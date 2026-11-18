'use client';

import { tx } from '@/i18n/runtime';
import { useIntlLocale, useT } from '@/i18n/client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { emailSchema, MEMBER_ROLES, normalizePhone, type MemberRole } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import type { Member, Organization } from '@/lib/types';
import { optionalString, useServerError, useZodForm } from '@/lib/forms';
import { instantDate } from '@/lib/format';
import type { MemberInvite } from '@/lib/platform-types';
import Link from 'next/link';
import { useStaffSession } from '@/lib/session';
import { memberRoleLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import { Badge, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PaymentGatewaysPanel } from '@/components/payment-gateways-panel';
import { TestimonialPanel } from '@/components/testimonial-panel';

const intIn = (min: number, max: number) =>
  z.coerce.number().int(tx("Número inteiro")).min(min, tx("Mínimo {min}", { min })).max(max, tx("Máximo {max}", { max }));

const orgSchema = z.object({
  name: z.string().trim().min(1, 'Indique o nome').max(120),
  nuit: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{9}$/.test(v), 'NUIT deve ter 9 dígitos'),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || emailSchema.safeParse(v).success, 'Email inválido'),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || normalizePhone(v) !== null, 'Telefone inválido'),
  address: optionalString,
  city: optionalString,
  province: optionalString,
  defaultBillingDay: intIn(1, 28),
  lateFeePercent: z.coerce.number().min(0, 'Mínimo 0').max(100, 'Máximo 100'),
  gracePeriodDays: intIn(0, 60),
  reminderDaysBefore: intIn(0, 30),
  locale: z.enum(['pt', 'en']),
  country: z.string().regex(/^[A-Z]{2}$/),
  defaultCurrency: z.enum(['MZN', 'USD', 'ZAR', 'EUR']),
  timezone: z.string().min(3),
});

/** Países mais prováveis primeiro; os nomes vêm do browser, no idioma da página. */
const COUNTRIES = ['MZ', 'ZA', 'AO', 'ZW', 'MW', 'TZ', 'ZM', 'SZ', 'BW', 'NA', 'KE', 'PT', 'BR', 'GB', 'US'];
const TIMEZONES = (() => {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    // Alguns browsers só listam os nomes canónicos (Maputo aparece como Africa/Harare).
    return list.includes('Africa/Maputo') ? list : ['Africa/Maputo', ...list];
  } catch {
    return ['Africa/Maputo', 'Africa/Johannesburg', 'Africa/Luanda', 'Europe/Lisbon', 'Europe/London', 'UTC'];
  }
})();

export default function SettingsPage() {
  const t = useT();
  const q = useQuery({
    queryKey: ['organization'],
    queryFn: () => staffApi.get<Organization>('/organization'),
  });
  const { session } = useStaffSession();
  const role = session?.organization?.role;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={8} />;

  return (
    <>
      <PageHeader title={t('Definições')} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <OrganizationForm org={q.data} canEdit={role === 'OWNER' || role === 'MANAGER'} />
        <div className="flex flex-col gap-6">
          <PlanPanel org={q.data} />
          <Panel
            title={t('Modelo de contrato')}
            actions={
              <Button asChild size="sm" variant="secondary">
                <Link href="/definicoes/contrato">{t('Editar modelo')}</Link>
              </Button>
            }
          >
            <p className="px-5 py-4 text-sm text-ink-soft">
              {t('O texto do contrato de arrendamento gerado em PDF na página de cada contrato.')}
            </p>
          </Panel>
          <MembersPanel isOwner={role === 'OWNER'} currentUserId={session?.user.id} />
          {role === 'OWNER' && <ExportPanel />}
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-6">
        <PaymentGatewaysPanel canEdit={role === 'OWNER'} />
        <TestimonialPanel defaultName={session?.user.name ?? ''} />
      </div>
    </>
  );
}

function OrganizationForm({ org, canEdit }: { org: Organization; canEdit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const form = useZodForm(orgSchema, {
    name: org.name,
    nuit: org.nuit ?? '',
    email: org.email ?? '',
    phone: org.phone ?? '',
    address: org.address ?? '',
    city: org.city ?? '',
    province: org.province ?? '',
    defaultBillingDay: org.defaultBillingDay,
    lateFeePercent: org.lateFeeBps / 100,
    gracePeriodDays: org.gracePeriodDays,
    reminderDaysBefore: org.reminderDaysBefore,
    locale: org.locale === 'en' ? 'en' : 'pt',
    country: org.country ?? 'MZ',
    defaultCurrency: org.defaultCurrency as 'MZN',
    timezone: org.timezone,
  });
  const intl = useIntlLocale();
  const regionName = (code: string) => {
    try {
      return new Intl.DisplayNames([intl], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      await staffApi.patch('/organization', {
        name: v.name,
        nuit: v.nuit || null,
        email: v.email || null,
        phone: v.phone || null,
        address: v.address ?? null,
        city: v.city ?? null,
        province: v.province ?? null,
        defaultBillingDay: v.defaultBillingDay,
        lateFeeBps: Math.round(v.lateFeePercent * 100),
        gracePeriodDays: v.gracePeriodDays,
        reminderDaysBefore: v.reminderDaysBefore,
        locale: v.locale,
        country: v.country,
        defaultCurrency: v.defaultCurrency,
        timezone: v.timezone,
      });
      await qc.invalidateQueries({ queryKey: ['organization'] });
      toast.success(t('Definições guardadas'));
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <Panel className="p-5 sm:p-7">
      <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
        <FormError message={t.label(server.message)} />
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 font-display text-lg font-semibold">
            {t('Dados da organização')}
          </legend>
          <p className="text-sm text-ink-soft sm:col-span-2">
            {t('Aparecem nos recibos e nas mensagens aos inquilinos.')}
          </p>
          <Field label={t('Nome')} error={errors.name?.message} className="sm:col-span-2">
            {(p) => <Input {...p} {...form.register('name')} />}
          </Field>
          <Field label={t('NUIT')} optional error={errors.nuit?.message}>
            {(p) => <Input inputMode="numeric" maxLength={9} {...p} {...form.register('nuit')} />}
          </Field>
          <Field label={t('Telefone')} optional error={errors.phone?.message}>
            {(p) => <Input type="tel" {...p} {...form.register('phone')} />}
          </Field>
          <Field
            label={t('Email')}
            optional
            error={errors.email?.message}
            className="sm:col-span-2"
          >
            {(p) => <Input type="email" {...p} {...form.register('email')} />}
          </Field>
          <Field
            label={t('Morada')}
            optional
            error={errors.address?.message}
            className="sm:col-span-2"
          >
            {(p) => <Input {...p} {...form.register('address')} />}
          </Field>
          <Field label={t('Cidade')} optional error={errors.city?.message}>
            {(p) => <Input {...p} {...form.register('city')} />}
          </Field>
          <Field label={t('Província')} optional error={errors.province?.message}>
            {(p) => <Input {...p} {...form.register('province')} />}
          </Field>
        </fieldset>

        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 font-display text-lg font-semibold">{t('Cobrança')}</legend>
          <p className="text-sm text-ink-soft sm:col-span-2">
            {t(
              'Valores usados por omissão em novos contratos. Cada contrato pode ter a sua própria multa.',
            )}
          </p>
          <Field
            label={t('Dia de pagamento')}
            hint={t('Dia do mês em que a renda vence.')}
            error={errors.defaultBillingDay?.message}
          >
            {(p) => (
              <Input
                type="number"
                min={1}
                max={28}
                {...p}
                {...form.register('defaultBillingDay')}
              />
            )}
          </Field>
          <Field
            label={t('Multa por atraso (%)')}
            hint={t('Aplicada uma vez sobre o valor em dívida.')}
            error={errors.lateFeePercent?.message}
          >
            {(p) => (
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                {...p}
                {...form.register('lateFeePercent')}
              />
            )}
          </Field>
          <Field
            label={t('Tolerância (dias)')}
            hint={t('Dias depois do vencimento antes de aplicar a multa.')}
            error={errors.gracePeriodDays?.message}
          >
            {(p) => (
              <Input type="number" min={0} max={60} {...p} {...form.register('gracePeriodDays')} />
            )}
          </Field>
          <Field
            label={t('Lembrete (dias antes)')}
            hint={t('0 desliga o lembrete antes do vencimento.')}
            error={errors.reminderDaysBefore?.message}
          >
            {(p) => (
              <Input
                type="number"
                min={0}
                max={30}
                {...p}
                {...form.register('reminderDaysBefore')}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={!canEdit}>
          <legend className="mb-3 font-display text-lg font-semibold">{t('Região e idioma')}</legend>
          <Field
            label={t('Idioma por omissão')}
            hint={t('Para emails, SMS, recibos e contratos dos inquilinos que não escolheram outro.')}
            error={errors.locale?.message}
          >
            {(p) => (
              <Select {...p} {...form.register('locale')}>
                <option value="pt">Português</option>
                <option value="en">English</option>
              </Select>
            )}
          </Field>
          <Field label={t('País')} error={errors.country?.message}>
            {(p) => (
              <Select {...p} {...form.register('country')}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {regionName(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('Moeda dos novos contratos')}
            hint={t('Cada contrato guarda a sua moeda; mudar aqui não altera os existentes.')}
            error={errors.defaultCurrency?.message}
          >
            {(p) => (
              <Select {...p} {...form.register('defaultCurrency')}>
                <option value="MZN">{t('Metical (MZN)')}</option>
                <option value="ZAR">{t('Rand (ZAR)')}</option>
                <option value="USD">{t('Dólar americano (USD)')}</option>
                <option value="EUR">{t('Euro (EUR)')}</option>
              </Select>
            )}
          </Field>
          <Field
            label={t('Fuso horário')}
            hint={t('Define o "hoje" da faturação, dos vencimentos e dos lembretes.')}
            error={errors.timezone?.message}
          >
            {(p) => (
              <Select {...p} {...form.register('timezone')}>
                {TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>

        {canEdit && (
          <div className="flex justify-end border-t border-line pt-5">
            <Button type="submit" loading={isSubmitting}>
              {t('Guardar definições')}
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

function PlanPanel({ org }: { org: Organization }) {
  const t = useT();
  const sub = org.subscription;
  return (
    <Panel
      title={t('Plano')}
      actions={
        <Button asChild size="sm" variant="secondary">
          <Link href="/definicoes/plano">{t('Plano e faturação')}</Link>
        </Button>
      }
    >
      <div className="px-5 py-4">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          {sub?.plan.name ?? t('Grátis')}
          {sub?.status === 'TRIALING' && <Badge tone="brand">{t('Em teste')}</Badge>}
          {sub?.status === 'PAST_DUE' && <Badge tone="overdue">{t('Pagamento em atraso')}</Badge>}
        </p>
        {sub?.currentPeriodEnd && (
          <p className="text-sm text-ink-soft">
            {sub.status === 'TRIALING' ? t('Teste até') : t('Período até')}{' '}
            {instantDate(sub.currentPeriodEnd, { until: true })}
          </p>
        )}
      </div>
    </Panel>
  );
}

const memberSchema = z.object({
  email: emailSchema,
  role: z.enum(['MANAGER', 'ACCOUNTANT', 'VIEWER']),
});

function MembersPanel({ isOwner, currentUserId }: { isOwner: boolean; currentUserId?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['members'],
    queryFn: () => staffApi.get<Member[]>('/organization/members'),
  });
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => staffApi.get<MemberInvite[]>('/organization/invites'),
    enabled: isOwner,
  });
  const form = useZodForm(memberSchema, { email: '', role: 'MANAGER' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const add = form.handleSubmit(async (v) => {
    server.clear();
    try {
      const r = await staffApi.post<{ status: 'ADDED' | 'INVITED' }>('/organization/members', v);
      form.reset();
      toast.success(
        r.status === 'ADDED'
          ? t('Membro adicionado')
          : t('Convite enviado para {email}', { email: v.email }),
      );
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['invites'] });
    } catch (err) {
      server.handle(err);
    }
  });

  async function changeRole(userId: string, role: MemberRole) {
    try {
      await staffApi.put(`/organization/members/${userId}/role`, { role });
      toast.success(t('Papel alterado'));
      qc.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível alterar'));
    }
  }

  async function revoke(i: MemberInvite) {
    if (!confirm(t('Cancelar o convite para {email}?', { email: i.email }))) return;
    try {
      await staffApi.delete(`/organization/invites/${i.id}`);
      toast.success(t('Convite cancelado'));
      qc.invalidateQueries({ queryKey: ['invites'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível cancelar'));
    }
  }

  async function remove(userId: string, name: string) {
    if (!confirm(t('Remover {name} da equipa?', { name }))) return;
    try {
      await staffApi.delete(`/organization/members/${userId}`);
      toast.success(t('Membro removido'));
      qc.invalidateQueries({ queryKey: ['members'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível remover'));
    }
  }

  return (
    <Panel title={t('Equipa')}>
      {!q.data ? (
        <LoadingRows rows={2} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('Pessoa')}</Th>
              <Th>{t('Papel')}</Th>
              {isOwner && <Th className="w-0" />}
            </tr>
          </thead>
          <tbody>
            {q.data.map((m) => (
              <Tr key={m.user.id}>
                <Td>
                  <span className="font-medium">{t.label(m.user.name)}</span>
                  <span className="block text-ink-faint">{t.label(m.user.email)}</span>
                </Td>
                <Td>
                  {isOwner && m.user.id !== currentUserId ? (
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole(m.user.id, e.target.value as MemberRole)}
                      aria-label={t('Papel de {name}', { name: m.user.name })}
                      className="h-8 w-40 text-sm"
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t.label(memberRoleLabel[r])}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    t.label(memberRoleLabel[m.role])
                  )}
                </Td>
                {isOwner && (
                  <Td>
                    {m.user.id !== currentUserId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => remove(m.user.id, m.user.name)}
                      >
                        {t('Remover')}
                      </Button>
                    )}
                  </Td>
                )}
              </Tr>
            ))}
            {invites.data?.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <span className="font-medium">{t.label(i.email)}</span>
                  <span className="block text-ink-faint">
                    {t('Convite enviado, válido até {instantDate}', {
                      instantDate: instantDate(i.expiresAt),
                    })}
                  </span>
                </Td>
                <Td>{t.label(memberRoleLabel[i.role])}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => revoke(i)}>
                    {t('Cancelar')}
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {isOwner && (
        <form
          onSubmit={add}
          className="flex flex-col gap-3 border-t border-line px-5 py-4"
          noValidate
        >
          <p className="text-sm text-ink-soft">
            {t(
              'Quem já tem conta no Rentix entra logo na equipa. Quem ainda não tem recebe um convite por email.',
            )}
          </p>
          <FormError message={t.label(server.message)} />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label={t('Email')} error={errors.email?.message}>
              {(p) => <Input type="email" {...p} {...form.register('email')} />}
            </Field>
            <Field label={t('Papel')} error={errors.role?.message}>
              {(p) => (
                <Select {...p} {...form.register('role')}>
                  <option value="MANAGER">{t.label(memberRoleLabel.MANAGER)}</option>
                  <option value="ACCOUNTANT">{t.label(memberRoleLabel.ACCOUNTANT)}</option>
                  <option value="VIEWER">{t.label(memberRoleLabel.VIEWER)}</option>
                </Select>
              )}
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={isSubmitting} className="self-start">
            {t('Convidar')}
          </Button>
        </form>
      )}
    </Panel>
  );
}

/** Exportação de todos os dados (proprietário). */
function ExportPanel() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await staffApi.download('/organization/export', 'rentix-dados.zip');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível exportar'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={t('Os seus dados')}>
      <div className="flex flex-col items-start gap-3 px-5 py-4">
        <p className="text-sm text-ink-soft">
          {t(
            'Um ZIP com tudo: imóveis, inquilinos, contratos, faturas e pagamentos em Excel, e todos os documentos e fotografias. Contém dados pessoais dos inquilinos: guarde-o em local seguro.',
          )}
        </p>
        <Button variant="secondary" loading={busy} onClick={run}>
          {t('Exportar todos os dados')}
        </Button>
      </div>
    </Panel>
  );
}
