'use client';

import { tx } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import { z } from 'zod';
import { LISTING_PURPOSES, PROPERTY_TYPES } from '@rentix/shared';
import { moneyField, optionalString, useServerError, useZodForm } from '@/lib/forms';
import { moneyInputValue } from '@/lib/format';
import { propertyTypeLabel } from '@/i18n/pt';
import { listingPurposeLabel } from '@/i18n/extras';
import type { MyListing } from '@/lib/site-types';
import { Button } from '../ui/button';
import { Field, FormError, Input, MoneyInput, Select, Textarea } from '../ui/form';

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

const schema = z.object({
  title: z.string().trim().min(5, 'Pelo menos 5 caracteres').max(140),
  description: z.string().trim().min(20, 'Descreva com pelo menos 20 caracteres').max(5000),
  purpose: z.enum(LISTING_PURPOSES),
  propertyType: z.enum(PROPERTY_TYPES),
  price: moneyField({ required: true }),
  priceNegotiable: z.boolean(),
  city: z.string().trim().min(2, 'Indique a cidade').max(100),
  neighbourhood: optionalString,
  province: optionalString,
  bedrooms: intOrNull,
  bathrooms: intOrNull,
  areaM2: intOrNull,
  durationDays: z.coerce.number().int().min(7).max(90),
});
export type ListingFormOutput = z.output<typeof schema>;

export function ListingForm({
  listing,
  onSubmit,
}: {
  listing?: MyListing;
  onSubmit: (v: ListingFormOutput) => Promise<void>;
}) {
  const t = useT();
  const form = useZodForm(schema, {
    title: listing?.title ?? '',
    description: listing?.description ?? '',
    purpose: listing?.purpose ?? 'RENT',
    propertyType: listing?.propertyType ?? 'APARTMENT',
    price: listing ? moneyInputValue(listing.price) : '',
    priceNegotiable: listing?.priceNegotiable ?? false,
    city: listing?.city ?? 'Maputo',
    neighbourhood: listing?.neighbourhood ?? '',
    province: listing?.province ?? '',
    bedrooms: listing?.bedrooms?.toString() ?? '',
    bathrooms: listing?.bathrooms?.toString() ?? '',
    areaM2: listing?.areaM2?.toString() ?? '',
    durationDays: 30,
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      await onSubmit(v);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError message={t.label(server.message)} />
      <Field label={t('Título')} error={errors.title?.message}>
        {(p) => (
          <Input
            placeholder={t('Ex.: Apartamento T3 mobilado na Sommerschield')}
            {...p}
            {...form.register('title')}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Objetivo')} error={errors.purpose?.message}>
          {(p) => (
            <Select {...p} {...form.register('purpose')}>
              {LISTING_PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {t.label(listingPurposeLabel[x])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Tipo de imóvel')} error={errors.propertyType?.message}>
          {(p) => (
            <Select {...p} {...form.register('propertyType')}>
              {PROPERTY_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.label(propertyTypeLabel[x])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('Preço')}
          hint={t('Renda mensal ou valor de venda.')}
          error={errors.price?.message}
        >
          {(p) => <MoneyInput {...p} {...form.register('price')} />}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            {...form.register('priceNegotiable')}
          />
          {t('Preço negociável')}
        </label>
        <Field label={t('Cidade')} error={errors.city?.message}>
          {(p) => <Input {...p} {...form.register('city')} />}
        </Field>
        <Field label={t('Bairro')} optional error={errors.neighbourhood?.message}>
          {(p) => <Input {...p} {...form.register('neighbourhood')} />}
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label={t('Quartos')} optional error={errors.bedrooms?.message}>
          {(p) => <Input inputMode="numeric" {...p} {...form.register('bedrooms')} />}
        </Field>
        <Field label={t('WC')} optional error={errors.bathrooms?.message}>
          {(p) => <Input inputMode="numeric" {...p} {...form.register('bathrooms')} />}
        </Field>
        <Field label={t('Área (m²)')} optional error={errors.areaM2?.message}>
          {(p) => <Input inputMode="numeric" {...p} {...form.register('areaM2')} />}
        </Field>
      </div>
      <Field label={t('Descrição')} error={errors.description?.message}>
        {(p) => <Textarea rows={5} {...p} {...form.register('description')} />}
      </Field>
      {!listing && (
        <Field label={t('Duração do anúncio')} error={errors.durationDays?.message}>
          {(p) => (
            <Select {...p} {...form.register('durationDays')}>
              <option value={7}>{t('7 dias')}</option>
              <option value={30}>{t('30 dias')}</option>
              <option value={60}>{t('60 dias')}</option>
              <option value={90}>{t('90 dias')}</option>
            </Select>
          )}
        </Field>
      )}
      <p className="text-sm text-ink-soft">
        {listing
          ? t('Depois de guardar, o anúncio volta a ser revisto antes de aparecer.')
          : t('O anúncio é revisto pela equipa Rentix antes de aparecer às outras imobiliárias.')}
      </p>
      <Button type="submit" loading={isSubmitting} className="self-start">
        {listing ? t('Guardar e enviar para revisão') : t('Enviar para revisão')}
      </Button>
    </form>
  );
}

/** Converte o resultado do formulário no corpo da API. */
export function listingBody(v: ListingFormOutput, includeDuration: boolean) {
  // As fotografias são enviadas à parte (painel Fotografias), não pelo formulário.
  const { durationDays, ...rest } = v;
  return { ...rest, ...(includeDuration ? { durationDays } : {}) };
}
