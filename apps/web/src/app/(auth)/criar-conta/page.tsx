'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { registerSchema } from '@rentix/shared';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { staffApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import type { StaffSession } from '@/lib/types';

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const form = useZodForm(registerSchema, {
    name: '',
    email: '',
    phone: '',
    password: '',
    organizationName: '',
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    server.clear();
    try {
      const session = await staffApi.post<StaffSession>('/auth/register', {
        ...values,
        organizationName: values.organizationName || undefined,
      });
      staffApi.setSession(session);
      router.replace('/painel');
    } catch (err) {
      server.handle(err);
    }
  });

  return (
    <AuthLayout
      title={t('Criar conta')}
      subtitle={t('30 dias do plano Profissional, sem cartão. Depois, grátis até 3 unidades.')}
      footer={
        <>
          {t('Já tem conta?')}{' '}
          <Link href="/entrar" className="font-medium text-brand hover:underline">
            {t('Entrar')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field label={t('O seu nome')} error={errors.name?.message}>
          {(p) => <Input autoComplete="name" {...p} {...form.register('name')} />}
        </Field>
        <Field
          label={t('Nome da imobiliária ou empresa')}
          optional
          hint={t('Se gere os seus próprios imóveis, pode deixar em branco.')}
          error={errors.organizationName?.message}
        >
          {(p) => (
            <Input autoComplete="organization" {...p} {...form.register('organizationName')} />
          )}
        </Field>
        <Field label={t('Email')} error={errors.email?.message}>
          {(p) => <Input type="email" autoComplete="email" {...p} {...form.register('email')} />}
        </Field>
        <Field label={t('Telefone')} hint={t('Ex.: 84 123 4567')} error={errors.phone?.message}>
          {(p) => (
            <Input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              {...p}
              {...form.register('phone')}
            />
          )}
        </Field>
        <Field
          label={t('Senha')}
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
        <Button type="submit" size="lg" loading={isSubmitting}>
          {t('Criar conta')}
        </Button>
      </form>
    </AuthLayout>
  );
}
