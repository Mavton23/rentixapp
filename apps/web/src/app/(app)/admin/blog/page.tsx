'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PostStatus } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { revalidateSite } from '@/lib/revalidate';
import type { Paginated } from '@/lib/types';
import type { AdminBlogPost, BlogCategory } from '@/lib/site-types';
import { date } from '@/lib/format';
import { postStatusLabel } from '@/i18n/extras';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, FilterTabs, LoadingRows, PageHeader, Pagination, Panel } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';

type Filter = PostStatus | 'ALL';

export default function AdminBlogPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const posts = useQuery({
    queryKey: ['admin-posts', status, page],
    queryFn: () => staffApi.get<Paginated<AdminBlogPost>>('/admin/blog/posts', { status: status === 'ALL' ? undefined : status, page }),
  });
  const cats = useQuery({ queryKey: ['blog-categories'], queryFn: () => staffApi.get<BlogCategory[]>('/blog/categories') });
  const [newCat, setNewCat] = useState('');

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    try {
      await staffApi.post('/admin/blog/categories', { name: newCat.trim() });
      setNewCat('');
      revalidateSite();
      qc.invalidateQueries({ queryKey: ['blog-categories'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar');
    }
  }

  async function removeCategory(c: BlogCategory) {
    if (!confirm(`Apagar a categoria "${c.name}"? Os artigos ficam sem categoria.`)) return;
    await staffApi.delete(`/admin/blog/categories/${c.id}`);
    revalidateSite();
    qc.invalidateQueries({ queryKey: ['blog-categories'] });
  }

  return (
    <>
      <PageHeader
        title="Blog"
        actions={
          <Button asChild>
            <Link href="/admin/blog/novo"><Plus aria-hidden /> Novo artigo</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Panel>
          <FilterTabs<Filter>
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ value: 'ALL', label: 'Todos' }, { value: 'DRAFT', label: 'Rascunhos' }, { value: 'PUBLISHED', label: 'Publicados' }, { value: 'ARCHIVED', label: 'Arquivados' }]}
          />
          {!posts.data ? (
            <LoadingRows />
          ) : posts.data.data.length === 0 ? (
            <EmptyState title="Sem artigos" action={<Button asChild><Link href="/admin/blog/novo">Escrever o primeiro</Link></Button>} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr><Th>Artigo</Th><Th>Estado</Th><Th className="hidden md:table-cell">Atualizado</Th></tr>
                </thead>
                <tbody>
                  {posts.data.data.map((p) => (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`/admin/blog/${p.id}`} className="font-medium hover:text-brand">{p.title}</Link>
                        <span className="block text-ink-faint">/blog/{p.slug}{p.category && `, ${p.category.name}`}</span>
                      </Td>
                      <Td>
                        <Badge tone={p.status === 'PUBLISHED' ? 'paid' : 'neutral'}>{postStatusLabel[p.status]}</Badge>
                        {p.featured && <Badge tone="brand" className="ml-1">Destaque</Badge>}
                      </Td>
                      <Td className="hidden text-ink-soft md:table-cell">{date(p.updatedAt.slice(0, 10))}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <Pagination {...posts.data.meta} onPage={setPage} />
            </>
          )}
        </Panel>

        <Panel title="Categorias">
          <ul className="divide-y divide-line">
            {cats.data?.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span>{c.name} <span className="text-ink-faint">({c._count.posts})</span></span>
                <button className="text-ink-faint hover:text-overdue" onClick={() => removeCategory(c)} aria-label={`Apagar ${c.name}`}>Apagar</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addCategory} className="flex gap-2 border-t border-line px-5 py-3">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nova categoria" aria-label="Nova categoria" className="h-9" />
            <Button type="submit" size="sm" variant="secondary">Criar</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
