'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { portalApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { PortalAuthLayout } from '@/components/portal-shell';

const schema = z.object({ identifier: z.string().trim().min(3, 'Indique o telefone ou email') });

export default function PortalForgotPage() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const form = useZodForm(schema, { identifier: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    try {
      await portalApi.post('/portal/auth/forgot-password', v);
      setSent(true);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <PortalAuthLayout
      title={t('Recuperar senha')}
      subtitle={sent ? undefined : t('Enviamos um link por SMS ou email.')}
      footer={
        <Link href="/portal/entrar" className="text-brand hover:underline">
          {t('Voltar a entrar')}
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-control bg-paid-soft px-4 py-3 text-paid">
          {t('Se a conta existir, vai receber o link em poucos minutos. É válido durante 1 hora.')}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormError message={t.label(server.message)} />
          <Field label={t('Telefone ou email')} error={errors.identifier?.message}>
            {(p) => <Input autoComplete="username" {...p} {...form.register('identifier')} />}
          </Field>
          <Button type="submit" size="lg" loading={isSubmitting}>
            {t('Enviar link')}
          </Button>
        </form>
      )}
    </PortalAuthLayout>
  );
}
