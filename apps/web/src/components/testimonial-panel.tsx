'use client';

import { useT } from '@/i18n/client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { useFeatures } from '@/lib/features';
import type { Testimonial } from '@/lib/site-types';
import { moderationStatusLabel } from '@/i18n/extras';
import { cn } from '@/lib/format';
import { Button } from './ui/button';
import { Badge, Panel } from './ui/display';
import { Field, FormError, Input, Textarea } from './ui/form';

/** Definições → deixar (ou editar) um testemunho sobre o Rentix. */
export function TestimonialPanel({ defaultName }: { defaultName: string }) {
  const features = useFeatures();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['testimonial-mine'],
    queryFn: () => staffApi.get<Testimonial | null>('/testimonials/mine'),
    enabled: !!features.TESTIMONIALS,
  });
  if (!features.TESTIMONIALS || q.isLoading) return null;
  return (
    <TestimonialForm
      key={q.data?.id ?? 'new'}
      current={q.data ?? null}
      defaultName={defaultName}
      onSaved={() => qc.invalidateQueries({ queryKey: ['testimonial-mine'] })}
    />
  );
}

function TestimonialForm({
  current,
  defaultName,
  onSaved,
}: {
  current: Testimonial | null;
  defaultName: string;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(current?.name ?? defaultName);
  const [role, setRole] = useState(current?.role ?? '');
  const [city, setCity] = useState(current?.city ?? '');
  const [rating, setRating] = useState(current?.rating ?? 5);
  const [message, setMessage] = useState(current?.message ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (message.trim().length < 20) return setError(t('Escreva pelo menos 20 caracteres.'));
    setSaving(true);
    try {
      await staffApi.put('/testimonials/mine', { name, role, city, rating, message });
      toast.success(t('Obrigado! O testemunho será publicado depois de revisto.'));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Não foi possível guardar'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={t('O seu testemunho')}
      actions={
        current?.status && (
          <Badge
            tone={
              current.status === 'APPROVED'
                ? 'paid'
                : current.status === 'REJECTED'
                  ? 'overdue'
                  : 'due'
            }
          >
            {t.label(moderationStatusLabel[current.status])}
          </Badge>
        )
      }
    >
      <form onSubmit={save} className="flex flex-col gap-4 px-5 py-4" noValidate>
        <p className="text-sm text-ink-soft">
          {t('Conte a outros senhorios como o Rentix o ajuda. Aparece no site depois de revisto.')}
        </p>
        <FormError message={t.label(error)} />
        <fieldset className="flex gap-1" aria-label={t('Avaliação')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} estrelas`}
              aria-pressed={rating === n}
              className="rounded p-0.5"
            >
              <Star
                className={cn('size-6', n <= rating ? 'fill-due text-due' : 'text-line-strong')}
              />
            </button>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('Nome')}>
            {(p) => <Input value={name} onChange={(e) => setName(e.target.value)} {...p} />}
          </Field>
          <Field label={t('Função')} optional>
            {(p) => (
              <Input
                placeholder={t('Senhorio')}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                {...p}
              />
            )}
          </Field>
          <Field label={t('Cidade')} optional>
            {(p) => <Input value={city} onChange={(e) => setCity(e.target.value)} {...p} />}
          </Field>
        </div>
        <Field label={t('Testemunho')}>
          {(p) => (
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              {...p}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" loading={saving} className="self-start">
          {current ? t('Atualizar testemunho') : t('Enviar testemunho')}
        </Button>
      </form>
    </Panel>
  );
}
