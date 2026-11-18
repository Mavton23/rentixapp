'use client';

import { useT } from '@/i18n/client';
import { z } from 'zod';
import { createTenantSchema, ID_DOCUMENT_TYPES, MARITAL_STATUSES } from '@rentix/shared';
import { useServerError, useZodForm } from '@/lib/forms';
import { idDocumentLabel, maritalStatusLabel } from '@/i18n/pt';
import { Button } from './ui/button';
import { Field, FormError, Input, Select, Textarea } from './ui/form';

/** Campos vazios do formulário passam a "não indicado" antes de validar com o schema da API. */
const blanksToUndefined = (v: unknown) =>
  v && typeof v === 'object'
    ? Object.fromEntries(
        // Idioma vazio = "o da organização" (null); os outros campos vazios = não indicado.
        Object.entries(v).map(([k, val]) => [k, val === '' ? (k === 'locale' ? null : undefined) : val]),
      )
    : v;

export const tenantFormSchema = z.preprocess(blanksToUndefined, createTenantSchema);
export type TenantFormValues = z.output<typeof createTenantSchema>;

type FormInput = Record<keyof TenantFormValues, string>;

export function TenantForm({
  defaults,
  submitLabel,
  onSubmit,
}: {
  defaults?: Partial<FormInput>;
  submitLabel: string;
  onSubmit: (v: TenantFormValues) => Promise<void>;
}) {
  const tr = useT();
  const form = useZodForm(tenantFormSchema as unknown as z.ZodType<TenantFormValues, FormInput>, {
    fullName: '',
    phone: '',
    email: '',
    idDocumentType: 'BI',
    idDocumentNumber: '',
    nuit: '',
    birthDate: '',
    maritalStatus: '',
    occupation: '',
    employer: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    notes: '',
    locale: '',
    ...defaults,
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;
  const err = (k: keyof TenantFormValues) => errors[k]?.message as string | undefined;

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      await onSubmit(v);
    } catch (e) {
      server.handle(e);
    }
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
      <FormError message={tr.label(server.message)} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg font-semibold">{tr('Identificação')}</legend>
        <Field label={tr('Nome completo')} error={err('fullName')} className="sm:col-span-2">
          {(p) => <Input autoComplete="off" {...p} {...form.register('fullName')} />}
        </Field>
        <Field label={tr('Documento')} error={err('idDocumentType')}>
          {(p) => (
            <Select {...p} {...form.register('idDocumentType')}>
              {ID_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {tr.label(idDocumentLabel[t])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={tr('Número do documento')} error={err('idDocumentNumber')}>
          {(p) => <Input {...p} {...form.register('idDocumentNumber')} />}
        </Field>
        <Field label={tr('NUIT')} optional hint={tr('9 dígitos')} error={err('nuit')}>
          {(p) => <Input inputMode="numeric" maxLength={9} {...p} {...form.register('nuit')} />}
        </Field>
        <Field label={tr('Data de nascimento')} optional error={err('birthDate')}>
          {(p) => <Input type="date" {...p} {...form.register('birthDate')} />}
        </Field>
        <Field label={tr('Estado civil')} optional error={err('maritalStatus')}>
          {(p) => (
            <Select {...p} {...form.register('maritalStatus')}>
              <option value="">—</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>
                  {tr.label(maritalStatusLabel[m])}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 font-display text-lg font-semibold">{tr('Contactos')}</legend>
        <p className="text-sm text-ink-soft sm:col-span-2">
          {tr(
            'Lembretes e recibos são enviados por SMS para o telefone e, se indicar, também por email.',
          )}
        </p>
        <Field label={tr('Telefone')} hint={tr('Ex.: 84 123 4567')} error={err('phone')}>
          {(p) => <Input type="tel" inputMode="tel" {...p} {...form.register('phone')} />}
        </Field>
        <Field label={tr('Email')} optional error={err('email')}>
          {(p) => <Input type="email" {...p} {...form.register('email')} />}
        </Field>
        <Field label={tr('Contacto de emergência')} optional error={err('emergencyContactName')}>
          {(p) => (
            <Input placeholder={tr('Nome')} {...p} {...form.register('emergencyContactName')} />
          )}
        </Field>
        <Field label={tr('Telefone de emergência')} optional error={err('emergencyContactPhone')}>
          {(p) => (
            <Input type="tel" inputMode="tel" {...p} {...form.register('emergencyContactPhone')} />
          )}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg font-semibold">
          {tr('Trabalho e notas')}
        </legend>
        <Field label={tr('Profissão')} optional error={err('occupation')}>
          {(p) => <Input {...p} {...form.register('occupation')} />}
        </Field>
        <Field label={tr('Entidade empregadora')} optional error={err('employer')}>
          {(p) => <Input {...p} {...form.register('employer')} />}
        </Field>
        <Field label={tr('Idioma das mensagens e do portal')} error={err('locale')}>
          {(p) => (
            <Select {...p} {...form.register('locale')}>
              <option value="">{tr('Igual ao da organização')}</option>
              <option value="pt">Português</option>
              <option value="en">English</option>
            </Select>
          )}
        </Field>
        <Field label={tr('Notas')} optional error={err('notes')} className="sm:col-span-2">
          {(p) => <Textarea rows={3} {...p} {...form.register('notes')} />}
        </Field>
      </fieldset>

      <div className="flex justify-end border-t border-line pt-5">
        <Button type="submit" loading={isSubmitting}>
          {tr.label(submitLabel)}
        </Button>
      </div>
    </form>
  );
}
