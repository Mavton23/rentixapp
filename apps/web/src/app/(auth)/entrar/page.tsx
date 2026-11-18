'use client';

import { adoptAccountLocale, reloadTo, useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { loginSchema } from '@rentix/shared';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { staffApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import { useStaffSession } from '@/lib/session';
import type { StaffSession } from '@/lib/types';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/painel';
}

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { status } = useStaffSession();
  const form = useZodForm(loginSchema, { email: '', password: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, next, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    server.clear();
    try {
      const session = await staffApi.post<StaffSession>('/auth/login', values);
      staffApi.setSession(session);
      if (adoptAccountLocale(session.user.locale)) reloadTo(next);
      else router.replace(next);
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <AuthLayout
      title={t('Entrar')}
      subtitle={t('Aceda à gestão dos seus imóveis.')}
      footer={
        <>
          {t('Ainda não tem conta?')}{' '}
          <Link href="/criar-conta" className="font-medium text-brand hover:underline">
            {t('Criar conta grátis')}
          </Link>
          <br />
          {t('É inquilino?')}{' '}
          <Link href="/portal/entrar" className="font-medium text-brand hover:underline">
            {t('Entrar no portal do inquilino')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field label={t('Email')} error={errors.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...form.register('email')} />}
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
        <Link href="/recuperar-senha" className="-mt-1 self-end text-sm text-brand hover:underline">
          {t('Esqueceu-se da senha?')}
        </Link>
        <Button type="submit" size="lg" loading={isSubmitting}>
          {t('Entrar')}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
