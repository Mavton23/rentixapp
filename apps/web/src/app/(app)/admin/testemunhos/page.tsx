'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import type { ModerationStatus } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { revalidateSite } from '@/lib/revalidate';
import type { Paginated } from '@/lib/types';
import type { Testimonial } from '@/lib/site-types';
import { moderationStatusLabel } from '@/i18n/extras';
import { Button } from '@/components/ui/button';
import { EmptyState, FilterTabs, LoadingRows, PageHeader, Pagination, Panel } from '@/components/ui/display';

export default function AdminTestimonialsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ModerationStatus>('PENDING');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['admin-testimonials', status, page],
    queryFn: () => staffApi.get<Paginated<Testimonial>>('/admin/testimonials', { status, page }),
  });

  async function moderate(t: Testimonial, s: 'APPROVED' | 'REJECTED') {
    try {
      await staffApi.patch(`/admin/testimonials/${t.id}`, { status: s });
      revalidateSite();
      toast.success(s === 'APPROVED' ? 'Testemunho publicado' : 'Testemunho rejeitado');
      qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('admin-') });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível concluir');
    }
  }

  return (
    <>
      <PageHeader title="Testemunhos" />
      <Panel>
        <FilterTabs<ModerationStatus> value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => ({ value: s, label: moderationStatusLabel[s] }))} />
        {!q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState title="Nada aqui" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data.data.map((t) => (
                <li key={t.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex gap-0.5 text-due" aria-label={`${t.rating} em 5`}>
                      {Array.from({ length: t.rating }).map((_, i) => <Star key={i} className="size-4 fill-current" aria-hidden />)}
                    </div>
                    <p className="mt-1">{t.message}</p>
                    <p className="mt-1 text-sm text-ink-soft">{[t.name, t.role, t.city].filter(Boolean).join(', ')}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {t.status !== 'APPROVED' && <Button size="sm" onClick={() => moderate(t, 'APPROVED')}>Publicar</Button>}
                    {t.status !== 'REJECTED' && <Button size="sm" variant="ghost" onClick={() => moderate(t, 'REJECTED')}>Rejeitar</Button>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
