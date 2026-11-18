'use client';

import { tx } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { PROPERTY_TYPES, type PropertyType } from '@rentix/shared';
import { moneyField, optionalString, useServerError, useZodForm } from '@/lib/forms';
import { moneyInputValue } from '@/lib/format';
import { propertyTypeLabel } from '@/i18n/pt';
import { Button } from './ui/button';
import { Field, FormError, Input, MoneyInput, Select, Textarea } from './ui/form';

const intOrNull = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: 'custom', message: tx("Número inválido") });
      return z.NEVER;
    }
    return n;
  });

const unitRow = z.object({
  label: z.string().trim().min(1, 'Indique o nome da unidade').max(60),
  bedrooms: intOrNull,
  bathrooms: intOrNull,
  rentAmount: moneyField(),
});

export const propertyFormSchema = z.object({
  name: z.string().trim().min(1, 'Indique um nome').max(120),
  type: z.enum(PROPERTY_TYPES),
  street: z.string().trim().min(1, 'Indique a morada').max(200),
  neighbourhood: optionalString,
  city: z.string().trim().min(1, 'Indique a cidade').max(100),
  province: optionalString,
  description: optionalString,
  units: z.array(unitRow).max(500),
});

export type PropertyFormOutput = z.output<typeof propertyFormSchema>;

const MULTI_UNIT: PropertyType[] = ['APARTMENT_BUILDING', 'COMMERCIAL', 'OFFICE', 'WAREHOUSE'];

export function PropertyForm({
  defaults,
  withUnits,
  submitLabel,
  onSubmit,
}: {
  defaults?: Partial<z.input<typeof propertyFormSchema>>;
  withUnits: boolean;
  submitLabel: string;
  onSubmit: (values: PropertyFormOutput) => Promise<void>;
}) {
  const tr = useT();
  const form = useZodForm(propertyFormSchema, {
    name: '',
    type: 'HOUSE',
    street: '',
    neighbourhood: '',
    city: 'Maputo',
    province: '',
    description: '',
    units: withUnits ? [{ label: 'Principal', bedrooms: '', bathrooms: '', rentAmount: '' }] : [],
    ...defaults,
  });
  const server = useServerError(form);
  const units = useFieldArray({ control: form.control, name: 'units' });
  const { errors, isSubmitting } = form.formState;
  const type = form.watch('type');

  const submit = form.handleSubmit(async (values) => {
    server.clear();
    try {
      await onSubmit(values);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-8" noValidate>
      <FormError message={tr.label(server.message)} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-lg font-semibold">{tr('Dados do imóvel')}</legend>
        <Field
          label={tr('Nome')}
          hint={tr('Como lhe chama no dia a dia. Ex.: Casa da Matola, Prédio Polana.')}
          error={errors.name?.message}
          className="sm:col-span-2"
        >
          {(p) => <Input {...p} {...form.register('name')} />}
        </Field>
        <Field label={tr('Tipo')} error={errors.type?.message}>
          {(p) => (
            <Select {...p} {...form.register('type')}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {tr.label(propertyTypeLabel[t])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={tr('Rua e número')} error={errors.street?.message}>
          {(p) => <Input autoComplete="street-address" {...p} {...form.register('street')} />}
        </Field>
        <Field label={tr('Bairro')} optional error={errors.neighbourhood?.message}>
          {(p) => <Input {...p} {...form.register('neighbourhood')} />}
        </Field>
        <Field label={tr('Cidade')} error={errors.city?.message}>
          {(p) => <Input autoComplete="address-level2" {...p} {...form.register('city')} />}
        </Field>
        <Field label={tr('Província')} optional error={errors.province?.message}>
          {(p) => <Input autoComplete="address-level1" {...p} {...form.register('province')} />}
        </Field>
        <Field
          label={tr('Notas')}
          optional
          error={errors.description?.message}
          className="sm:col-span-2"
        >
          {(p) => <Textarea rows={3} {...p} {...form.register('description')} />}
        </Field>
      </fieldset>

      {withUnits && (
        <fieldset>
          <legend className="font-display text-lg font-semibold">
            {tr('Unidades para arrendar')}
          </legend>
          <p className="mt-1 mb-4 text-sm text-ink-soft">
            {MULTI_UNIT.includes(type)
              ? tr('Acrescente cada apartamento, loja ou escritório que arrenda separadamente.')
              : tr(
                  'Uma casa arrendada inteira tem uma só unidade. Se arrenda partes separadas (anexo, quartos), acrescente-as.',
                )}
          </p>
          <div className="flex flex-col gap-3">
            {units.fields.map((f, i) => {
              const e = errors.units?.[i];
              return (
                <div
                  key={f.id}
                  className="grid grid-cols-2 items-start gap-3 rounded-control border border-line p-3 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]"
                >
                  <Field
                    label={tr('Nome')}
                    error={e?.label?.message}
                    className="col-span-2 sm:col-span-1"
                  >
                    {(p) => (
                      <Input
                        placeholder={tr('Ex.: Flat 1A')}
                        {...p}
                        {...form.register(`units.${i}.label`)}
                      />
                    )}
                  </Field>
                  <Field label={tr('Quartos')} error={e?.bedrooms?.message}>
                    {(p) => (
                      <Input inputMode="numeric" {...p} {...form.register(`units.${i}.bedrooms`)} />
                    )}
                  </Field>
                  <Field label={tr('WC')} error={e?.bathrooms?.message}>
                    {(p) => (
                      <Input
                        inputMode="numeric"
                        {...p}
                        {...form.register(`units.${i}.bathrooms`)}
                      />
                    )}
                  </Field>
                  <Field
                    label={tr('Renda de referência')}
                    optional
                    error={e?.rentAmount?.message}
                    className="col-span-2 sm:col-span-1"
                  >
                    {(p) => <MoneyInput {...p} {...form.register(`units.${i}.rentAmount`)} />}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="col-span-2 justify-self-end sm:col-span-1 sm:mt-7"
                    onClick={() => units.remove(i)}
                    disabled={units.fields.length === 1}
                    aria-label={tr('Remover unidade {0}', { '0': i + 1 })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() =>
              units.append({
                label: `Unidade ${units.fields.length + 1}`,
                bedrooms: '',
                bathrooms: '',
                rentAmount: '',
              })
            }
          >
            <Plus aria-hidden /> {tr('Acrescentar unidade')}
          </Button>
        </fieldset>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-5">
        <Button type="submit" loading={isSubmitting}>
          {tr.label(submitLabel)}
        </Button>
      </div>
    </form>
  );
}

export { moneyInputValue };
