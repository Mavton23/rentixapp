'use client';

import { useT } from '@/i18n/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { passwordSchema } from '@rentix/shared';
import { portalApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import type { TenantSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { PortalAuthLayout } from '@/components/portal-shell';

interface InviteInfo {
  tenantName: string;
  organizationName: string;
  email: string | null;
  phone: string | null;
  hasAccount: boolean;
}

const newAccount = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'As senhas não coincidem',
    path: ['confirm'],
  });
const existingAccount = z.object({
  password: z.string().min(1, 'Indique a sua senha'),
  confirm: z.string(),
});

function Invite() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => portalApi.post<InviteInfo>('/portal/auth/invite/verify', { token }),
    enabled: token.length > 0,
    retry: false,
  });

  if (!token || info.isError) {
    return (
      <PortalAuthLayout title={t('Convite inválido')}>
        <FormError
          message={
            info.error instanceof Error
              ? info.error.message
              : t('O link está incompleto. Abra de novo o link que recebeu.')
          }
        />
      </PortalAuthLayout>
    );
  }
  if (!info.data)
    return <PortalAuthLayout title={t('A verificar o convite…')}>{null}</PortalAuthLayout>;
  return <AcceptForm token={token} info={info.data} />;
}

function AcceptForm({ token, info }: { token: string; info: InviteInfo }) {
  const t = useT();
  const router = useRouter();
  const form = useZodForm(info.hasAccount ? existingAccount : newAccount, {
    password: '',
    confirm: '',
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      const s = await portalApi.post<TenantSession>('/portal/auth/invite/accept', {
        token,
        password: v.password,
      });
      portalApi.setSession(s);
      router.replace('/portal');
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <PortalAuthLayout
      title={t('Olá, {0}', { '0': info.tenantName.split(' ')[0] })}
      subtitle={
        info.hasAccount
          ? t(
              '{organizationName} juntou o seu arrendamento ao portal. Como já tem conta, confirme com a sua senha.',
              { organizationName: info.organizationName },
            )
          : t(
              '{organizationName} convidou-o(a) para o portal do inquilino. Crie uma senha para entrar.',
              { organizationName: info.organizationName },
            )
      }
      footer={<>{t('Vai entrar com {0}.', { '0': info.phone ?? info.email })}</>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field
          label={info.hasAccount ? t('A sua senha') : t('Nova senha')}
          hint={info.hasAccount ? undefined : t('Pelo menos 8 caracteres, com letras e números.')}
          error={errors.password?.message}
        >
          {(p) => (
            <Input
              type="password"
              autoComplete={info.hasAccount ? 'current-password' : 'new-password'}
              {...p}
              {...form.register('password')}
            />
          )}
        </Field>
        {!info.hasAccount && (
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
        )}
        <Button type="submit" size="lg" loading={isSubmitting}>
          {info.hasAccount ? t('Confirmar e entrar') : t('Criar senha e entrar')}
        </Button>
      </form>
    </PortalAuthLayout>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <Invite />
    </Suspense>
  );
}
