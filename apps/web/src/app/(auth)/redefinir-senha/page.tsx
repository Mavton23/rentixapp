'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { passwordSchema } from '@rentix/shared';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { staffApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'As senhas não coincidem',
    path: ['confirm'],
  });

function ResetForm() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const form = useZodForm(schema, { password: '', confirm: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await staffApi.post('/auth/reset-password', { token, password: values.password });
      setDone(true);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <AuthLayout title={t('Nova senha')}>
      {done ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-control bg-paid-soft px-4 py-3 text-paid">
            {t('Senha alterada. Já pode entrar.')}
          </p>
          <Button asChild size="lg">
            <Link href="/entrar">{t('Entrar')}</Link>
          </Button>
        </div>
      ) : !token ? (
        <FormError
          message={t('Link incompleto. Abra o link do email outra vez ou peça um novo.')}
        />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormError message={t.label(server.message)} />
          <Field
            label={t('Nova senha')}
            hint={t('Pelo menos 8 caracteres, com letras e números.')}
            error={errors.password?.message}
          >
            {(p) => (
              <Input
                type="password"
                autoComplete="new-password"
                {...p}
                {...form.register('password')}
              />
            )}
          </Field>
          <Field label={t('Repita a senha')} error={errors.confirm?.message}>
            {(p) => (
              <Input
                type="password"
                autoComplete="new-password"
                {...p}
                {...form.register('confirm')}
              />
            )}
          </Field>
          <Button type="submit" size="lg" loading={isSubmitting}>
            {t('Guardar senha')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
