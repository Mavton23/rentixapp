'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { forgotPasswordSchema } from '@rentix/shared';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { staffApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const form = useZodForm(forgotPasswordSchema, { email: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await staffApi.post('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <AuthLayout
      title={t('Recuperar senha')}
      subtitle={sent ? undefined : t('Enviamos um link para definir uma nova senha.')}
      footer={
        <Link href="/entrar" className="font-medium text-brand hover:underline">
          {t('Voltar a entrar')}
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-control bg-paid-soft px-4 py-3 text-paid">
          {t(
            'Se o email estiver registado, vai receber um link em poucos minutos. O link é válido durante 1 hora.',
          )}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FormError message={t.label(server.message)} />
          <Field label={t('Email')} error={errors.email?.message}>
            {(p) => <Input type="email" autoComplete="email" {...p} {...form.register('email')} />}
          </Field>
          <Button type="submit" size="lg" loading={isSubmitting}>
            {t('Enviar link')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
