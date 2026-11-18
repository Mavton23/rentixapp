'use client';

import { adoptAccountLocale, reloadTo, useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { z } from 'zod';
import { portalApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import { useTenantSession } from '@/lib/session';
import type { TenantSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { PortalAuthLayout } from '@/components/portal-shell';

const schema = z.object({
  identifier: z.string().trim().min(3, 'Indique o telefone ou email'),
  password: z.string().min(1, 'Indique a senha'),
});

export default function PortalLoginPage() {
  const t = useT();
  const router = useRouter();
  const { status } = useTenantSession();
  const form = useZodForm(schema, { identifier: '', password: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (status === 'authenticated') router.replace('/portal');
  }, [status, router]);

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      const s = await portalApi.post<TenantSession>('/portal/auth/login', v);
      portalApi.setSession(s);
      if (adoptAccountLocale(s.account.locale)) reloadTo('/portal');
      else router.replace('/portal');
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <PortalAuthLayout
      title={t('Entrar')}
      subtitle={t('Veja as suas faturas, pagamentos e recibos.')}
      footer={
        <>
          {t('Ainda não tem acesso? Peça ao seu senhorio para lhe enviar o convite.')}
          <br />
          <Link href="/entrar" className="text-brand hover:underline">
            {t('É senhorio ou gestor? Entre aqui')}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field
          label={t('Telefone ou email')}
          hint={t('Ex.: 84 123 4567')}
          error={errors.identifier?.message}
        >
          {(p) => <Input autoComplete="username" {...p} {...form.register('identifier')} />}
        </Field>
        <Field label={t('Senha')} error={errors.password?.message}>
          {(p) => (
            <Input
              type="password"
              autoComplete="current-password"
              {...p}
              {...form.register('password')}
            />
          )}
        </Field>
        <Link
          href="/portal/recuperar-senha"
          className="-mt-1 self-end text-sm text-brand hover:underline"
        >
          {t('Esqueceu-se da senha?')}
        </Link>
        <Button type="submit" size="lg" loading={isSubmitting}>
          {t('Entrar')}
        </Button>
      </form>
    </PortalAuthLayout>
  );
}
