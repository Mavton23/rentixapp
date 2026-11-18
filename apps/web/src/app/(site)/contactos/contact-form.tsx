'use client';

import { useT } from '@/i18n/client';
import { useState } from 'react';
import { contactMessageSchema } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useServerError, useZodForm } from '@/lib/forms';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';

export function ContactForm() {
  const t = useT();
  const [sent, setSent] = useState(false);
  const form = useZodForm(contactMessageSchema, {
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
    website: '',
  });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    server.clear();
    try {
      await staffApi.post('/site/contact', v);
      setSent(true);
    } catch (err) {
      server.handle(err);
    }
  });

  if (sent) {
    return (
      <p role="status" className="mt-5 rounded-control bg-paid-soft px-4 py-3 text-paid">
        {t('Mensagem enviada. Respondemos para o seu email em dias úteis.')}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
      <FormError message={t.label(server.message)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Nome')} error={errors.name?.message}>
          {(p) => <Input autoComplete="name" {...p} {...form.register('name')} />}
        </Field>
        <Field label={t('Telefone')} optional error={errors.phone?.message as string | undefined}>
          {(p) => <Input type="tel" autoComplete="tel" {...p} {...form.register('phone')} />}
        </Field>
      </div>
      <Field label={t('Email')} error={errors.email?.message}>
        {(p) => <Input type="email" autoComplete="email" {...p} {...form.register('email')} />}
      </Field>
      <Field label={t('Assunto')} error={errors.subject?.message}>
        {(p) => <Input {...p} {...form.register('subject')} />}
      </Field>
      <Field label={t('Mensagem')} error={errors.message?.message}>
        {(p) => <Textarea rows={5} {...p} {...form.register('message')} />}
      </Field>
      {/* Campo-armadilha para robots: invisível e fora da ordem de tabulação. */}
      <div aria-hidden className="absolute -left-[9999px]">
        <label>
          {t('Website')}
          <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
        </label>
      </div>
      <Button type="submit" loading={isSubmitting} className="self-start">
        {t('Enviar mensagem')}
      </Button>
    </form>
  );
}
