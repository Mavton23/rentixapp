'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { passwordSchema, phoneSchema } from '@rentix/shared';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { LoadingRows } from '@/components/ui/display';
import { staffApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import type { InvitePreview } from '@/lib/platform-types';
import type { StaffSession } from '@/lib/types';
import { memberRoleLabel } from '@/i18n/pt';

const newAccount = z.object({
  name: z.string().trim().min(1, 'Indique o seu nome').max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || phoneSchema.safeParse(v).success, 'Telefone inválido'),
  password: passwordSchema,
});
const existingAccount = z.object({
  name: z.string(),
  phone: z.string(),
  password: z.string().min(1, 'Indique a sua senha'),
});

function AcceptInvite() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const q = useQuery({
    queryKey: ['member-invite', token],
    queryFn: () => staffApi.get<InvitePreview>(`/auth/member-invites/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });

  if (!token || q.isError) {
    return (
      <AuthLayout title={t('Convite inválido')}>
        <p className="text-ink-soft">
          {t(
            'Este convite já foi usado, foi cancelado ou expirou. Peça um novo a quem o convidou.',
          )}
        </p>
        <Button asChild size="lg" variant="secondary" className="mt-6">
          <Link href="/entrar">{t('Ir para a entrada')}</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (!q.data) {
    return (
      <AuthLayout title={t('Convite')}>
        <LoadingRows rows={3} />
      </AuthLayout>
    );
  }
  return <InviteForm token={token} invite={q.data} />;
}

function InviteForm({ token, invite }: { token: string; invite: InvitePreview }) {
  const t = useT();
  const router = useRouter();
  const form = useZodForm(invite.hasAccount ? existingAccount : newAccount, {
    name: '',
    phone: '',
    password: '',
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      const session = await staffApi.post<StaffSession>('/auth/member-invites/accept', {
        token,
        password: v.password,
        ...(invite.hasAccount ? {} : { name: v.name, phone: v.phone || undefined }),
      });
      staffApi.setSession(session);
      router.replace('/painel');
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <AuthLayout
      title={t('Entrar na equipa de {organizationName}', {
        organizationName: invite.organizationName,
      })}
      subtitle={`${invite.invitedBy ?? t('A equipa')} convidou-o como ${memberRoleLabel[invite.role].toLowerCase()}.`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field label={t('Email')}>
          {(p) => <Input value={invite.email} readOnly disabled {...p} />}
        </Field>
        {invite.hasAccount ? (
          <>
            <p className="text-sm text-ink-soft">
              {t('Já tem conta no Rentix com este email. Confirme com a sua senha.')}
            </p>
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
          </>
        ) : (
          <>
            <Field label={t('O seu nome')} error={errors.name?.message}>
              {(p) => <Input autoComplete="name" {...p} {...form.register('name')} />}
            </Field>
            <Field
              label={t('Telefone')}
              optional
              hint={t('Ex.: 84 123 4567')}
              error={errors.phone?.message}
            >
              {(p) => (
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  {...p}
                  {...form.register('phone')}
                />
              )}
            </Field>
            <Field
              label={t('Escolha uma senha')}
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
          </>
        )}
        <Button type="submit" size="lg" loading={isSubmitting}>
          {invite.hasAccount ? t('Entrar e aceitar') : t('Criar conta e entrar')}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
