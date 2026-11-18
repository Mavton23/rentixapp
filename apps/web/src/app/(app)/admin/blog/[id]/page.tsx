'use client';

import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { POST_STATUSES, type PostStatus } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { revalidateSite } from '@/lib/revalidate';
import { ApiError } from '@/lib/api';
import type { AdminBlogPost, BlogCategory } from '@/lib/site-types';
import { postStatusLabel } from '@/i18n/extras';
import { cn } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Markdown } from '@/components/markdown';

/** Editor de artigo: /admin/blog/novo cria, /admin/blog/<id> edita. */
export default function BlogEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'novo';
  const q = useQuery({
    queryKey: ['admin-post', id],
    queryFn: () => staffApi.get<AdminBlogPost>(`/admin/blog/posts/${id}`),
    enabled: !isNew,
  });
  if (!isNew && !q.data) return <LoadingRows rows={8} />;
  return <Editor key={id} post={isNew ? null : q.data!} />;
}

function Editor({ post }: { post: AdminBlogPost | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['blog-categories'], queryFn: () => staffApi.get<BlogCategory[]>('/blog/categories') });
  const [v, setV] = useState({
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    content: post?.content ?? '',
    coverImageUrl: post?.coverImageUrl ?? '',
    categoryId: post?.categoryId ?? '',
    status: (post?.status ?? 'DRAFT') as PostStatus,
    featured: post?.featured ?? false,
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
  });
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    const body = {
      ...v,
      slug: v.slug || undefined,
      coverImageUrl: v.coverImageUrl || null,
      categoryId: v.categoryId || null,
    };
    try {
      if (post) await staffApi.patch(`/admin/blog/posts/${post.id}`, body);
      else {
        const created = await staffApi.post<AdminBlogPost>('/admin/blog/posts', body);
        router.replace(`/admin/blog/${created.id}`);
      }
      toast.success(v.status === 'PUBLISHED' ? 'Artigo publicado' : 'Artigo guardado');
      qc.invalidateQueries({ queryKey: ['admin-posts'] });
      revalidateSite();
      if (post) qc.invalidateQueries({ queryKey: ['admin-post', post.id] });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError(Object.keys(err.fieldErrors).length ? 'Corrija os campos assinalados.' : err.message);
      } else setError('Não foi possível guardar');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!post || !confirm('Apagar este artigo de vez?')) return;
    await staffApi.delete(`/admin/blog/posts/${post.id}`);
    revalidateSite();
    qc.invalidateQueries({ queryKey: ['admin-posts'] });
    router.replace('/admin/blog');
  }

  return (
    <form onSubmit={save} noValidate>
      <PageHeader
        back={{ href: '/admin/blog', label: 'Blog' }}
        title={post ? 'Editar artigo' : 'Novo artigo'}
        actions={
          <>
            {post && <Button type="button" variant="ghost" onClick={remove}>Apagar</Button>}
            {post?.status === 'PUBLISHED' && (
              <Button asChild variant="secondary"><a href={`/blog/${post.slug}`} target="_blank" rel="noreferrer">Ver no site</a></Button>
            )}
            <Button type="submit" loading={saving}>Guardar</Button>
          </>
        }
      />
      <FormError message={error} />
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          <div className="flex flex-col gap-4">
            <Field label="Título" error={fieldErrors.title}>
              {(p) => <Input value={v.title} onChange={(e) => set('title', e.target.value)} className="text-lg" {...p} />}
            </Field>
            <Field label="Resumo" hint="Aparece na lista de artigos e nas partilhas." error={fieldErrors.excerpt}>
              {(p) => <Textarea rows={2} value={v.excerpt} onChange={(e) => set('excerpt', e.target.value)} {...p} />}
            </Field>
            <div>
              <div role="tablist" className="mb-2 flex gap-1 text-sm">
                {(['write', 'preview'] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={cn('rounded px-3 py-1', tab === t ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper')}>
                    {t === 'write' ? 'Escrever' : 'Pré-visualizar'}
                  </button>
                ))}
                <span className="ml-auto self-center text-xs text-ink-faint">Markdown: ## título, **negrito**, - lista, [ligação](https://…)</span>
              </div>
              {tab === 'write' ? (
                <Field label="Texto" error={fieldErrors.content}>
                  {(p) => <Textarea rows={22} value={v.content} onChange={(e) => set('content', e.target.value)} className="font-mono text-sm leading-relaxed" {...p} />}
                </Field>
              ) : (
                <div className="min-h-96 rounded-control border border-line p-5">
                  {v.content ? <Markdown>{v.content}</Markdown> : <p className="text-ink-faint">Nada para mostrar.</p>}
                </div>
              )}
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Publicação" className="p-0">
            <div className="flex flex-col gap-4 px-5 py-4">
              <Field label="Estado">
                {(p) => (
                  <Select value={v.status} onChange={(e) => set('status', e.target.value as PostStatus)} {...p}>
                    {POST_STATUSES.map((s) => <option key={s} value={s}>{postStatusLabel[s]}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Categoria">
                {(p) => (
                  <Select value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} {...p}>
                    <option value="">Sem categoria</option>
                    {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand" checked={v.featured} onChange={(e) => set('featured', e.target.checked)} />
                Destacar no topo do blog
              </label>
            </div>
          </Panel>
          <Panel title="Detalhes" className="p-0">
            <div className="flex flex-col gap-4 px-5 py-4">
              <Field label="Endereço (slug)" optional hint="Gerado a partir do título se ficar vazio." error={fieldErrors.slug}>
                {(p) => <Input value={v.slug} onChange={(e) => set('slug', e.target.value)} placeholder="como-cobrar-rendas" {...p} />}
              </Field>
              <div className="flex flex-col gap-2">
                <Field label="Imagem de capa" optional hint={post ? 'Envie uma imagem ou cole um endereço https.' : 'Guarde o artigo para poder enviar uma imagem; ou cole um endereço https.'} error={fieldErrors.coverImageUrl}>
                  {(p) => <Input value={v.coverImageUrl} onChange={(e) => set('coverImageUrl', e.target.value)} {...p} />}
                </Field>
                {v.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.coverImageUrl} alt="" className="aspect-[16/9] w-full rounded-control border border-line object-cover" />
                )}
                {post && <CoverUpload postId={post.id} onUploaded={(url) => set('coverImageUrl', url)} />}
              </div>
              <Field label="Título para motores de busca" optional error={fieldErrors.seoTitle}>
                {(p) => <Input value={v.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} {...p} />}
              </Field>
              <Field label="Descrição para motores de busca" optional error={fieldErrors.seoDescription}>
                {(p) => <Textarea rows={3} value={v.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} {...p} />}
              </Field>
            </div>
          </Panel>
        </div>
      </div>
    </form>
  );
}

function CoverUpload({ postId, onUploaded }: { postId: string; onUploaded: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function send(file: File) {
    setBusy(true);
    const form = new FormData();
    form.set('ownerType', 'BLOG_POST');
    form.set('ownerId', postId);
    form.set('category', 'COVER');
    form.set('file', file);
    try {
      const f = await staffApi.upload<{ url: string }>('/admin/files', form);
      onUploaded(f.url);
      toast.success('Capa enviada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className="self-start" loading={busy} onClick={() => input.current?.click()}>
        Enviar imagem
      </Button>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }} />
    </>
  );
}
