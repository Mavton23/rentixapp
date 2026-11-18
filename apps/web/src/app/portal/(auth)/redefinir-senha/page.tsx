'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { z } from 'zod';
import { passwordSchema } from '@rentix/shared';
import { portalApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { PortalAuthLayout } from '@/components/portal-shell';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'As senhas não coincidem',
    path: ['confirm'],
  });

function Reset() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const form = useZodForm(schema, { password: '', confirm: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    try {
      await portalApi.post('/portal/auth/reset-password', { token, password: v.password });
      setDone(true);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <PortalAuthLayout title={t('Nova senha')}>
      {done ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-control bg-paid-soft px-4 py-3 text-paid">{t('Senha alterada.')}</p>
          <Button asChild size="lg">
            <Link href="/portal/entrar">{t('Entrar')}</Link>
          </Button>
        </div>
      ) : !token ? (
        <FormError message={t('Link incompleto. Abra de novo o link que recebeu.')} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
    </PortalAuthLayout>
  );
}

export default function PortalResetPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
