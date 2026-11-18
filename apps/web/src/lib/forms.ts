'use client';


import { tx } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from './api';
import { parseMoney } from './format';

/** react-hook-form ligado a um schema Zod (normalmente o mesmo que a API usa). */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  defaultValues?: DefaultValues<z.input<S>>,
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never),
    defaultValues,
    mode: 'onTouched',
  });
}

/**
 * Trata erros da API num formulário: erros por campo vão para os campos,
 * o resto fica numa mensagem geral.
 */
export function useServerError<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>) {
  const t = useT();
  const [message, setMessage] = useState<string | null>(null);
  return {
    message,
    clear: () => setMessage(null),
    handle(err: unknown) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors;
        const keys = Object.keys(fields);
        keys.forEach((k) => form.setError(k as Path<T>, { message: fields[k] }));
        setMessage(keys.length ? null : err.message);
      } else {
        setMessage(t("Ocorreu um erro inesperado. Tente de novo."));
      }
    },
  };
}

/** Campo de dinheiro escrito pelo utilizador ("15 000,00") -> centavos. */
export const moneyField = (opts: { required?: boolean; positive?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === '') {
        if (opts.required) ctx.addIssue({ code: 'custom', message: tx("Indique o valor") });
        return undefined;
      }
      const n = parseMoney(v);
      if (n === null || n < 0) {
        ctx.addIssue({ code: 'custom', message: tx("Valor inválido (ex.: 15 000,00)") });
        return z.NEVER;
      }
      if (opts.positive && n === 0) {
        ctx.addIssue({ code: 'custom', message: tx("O valor deve ser maior que zero") });
        return z.NEVER;
      }
      return n;
    });

/** Converte "" em undefined para campos opcionais de texto. */
export const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v));
