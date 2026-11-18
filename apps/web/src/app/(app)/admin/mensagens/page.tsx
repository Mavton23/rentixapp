'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { staffApi } from '@/lib/clients';
import type { Paginated } from '@/lib/types';
import { cn } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { EmptyState, FilterTabs, LoadingRows, PageHeader, Pagination, Panel } from '@/components/ui/display';

type Status = 'NEW' | 'READ' | 'ARCHIVED';
interface Message {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  status: Status;
  createdAt: string;
}

const when = (iso: string) => new Intl.DateTimeFormat('pt-MZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Maputo' }).format(new Date(iso));

export default function AdminMessagesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('NEW');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-messages', status, page],
    queryFn: () => staffApi.get<Paginated<Message>>('/admin/site/messages', { status, page }),
  });

  async function setMsgStatus(m: Message, s: Status) {
    await staffApi.patch(`/admin/site/messages/${m.id}`, { status: s });
    qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('admin-') });
  }

  return (
    <>
      <PageHeader title="Mensagens de contacto" />
      <Panel>
        <FilterTabs<Status> value={status} onChange={(v) => { setStatus(v); setPage(1); }}
          options={[{ value: 'NEW', label: 'Novas' }, { value: 'READ', label: 'Lidas' }, { value: 'ARCHIVED', label: 'Arquivadas' }]} />
        {!q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState title="Sem mensagens" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data.data.map((m) => (
                <li key={m.id} className="px-5 py-4">
                  <button
                    className="flex w-full items-start justify-between gap-4 text-left"
                    onClick={() => {
                      setOpen(open === m.id ? null : m.id);
                      if (m.status === 'NEW') void setMsgStatus(m, 'READ');
                    }}
                    aria-expanded={open === m.id}
                  >
                    <span className="min-w-0">
                      <span className={cn('block truncate', m.status === 'NEW' && 'font-semibold')}>{m.subject}</span>
                      <span className="block text-sm text-ink-soft">{m.name}, {m.email}</span>
                    </span>
                    <span className="shrink-0 text-sm text-ink-faint">{when(m.createdAt)}</span>
                  </button>
                  {open === m.id && (
                    <div className="mt-3">
                      <p className="whitespace-pre-line">{m.message}</p>
                      {m.phone && <p className="mt-2 text-sm text-ink-soft">Telefone: {m.phone}</p>}
                      <div className="mt-3 flex gap-2">
                        <Button asChild size="sm"><a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}>Responder por email</a></Button>
                        {m.status !== 'ARCHIVED' && <Button size="sm" variant="ghost" onClick={() => setMsgStatus(m, 'ARCHIVED')}>Arquivar</Button>}
                      </div>
                    </div>
                  )}
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
