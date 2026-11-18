import { getT } from '@/i18n/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { BlogCategory, BlogPostCard } from '@/lib/site-types';
import type { Paginated } from '@/lib/types';
import { cn, date } from '@/lib/format';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Blog') };
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; pagina?: string }>;
}) {
  const t = await getT();
  // Ler searchParams primeiro torna a página dinâmica; caso contrário, um build com o BLOG
  // desligado congelava a página como 404 estático.
  const sp = await searchParams;
  if (!(await getFeatures()).BLOG) notFound();
  const page = Math.max(1, Number(sp.pagina) || 1);
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: '12',
    ...(sp.categoria ? { category: sp.categoria } : {}),
  });
  const [posts, categories] = await Promise.all([
    apiGet<Paginated<BlogPostCard>>(`/blog/posts?${qs}`),
    apiGet<BlogCategory[]>('/blog/categories'),
  ]);
  const cats = (categories ?? []).filter((c) => c._count.posts > 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-14 md:py-20">
      <h1 className="text-[36px] sm:text-[44px]">{t('Blog')}</h1>
      <p className="mt-2 text-lg text-ink-soft">
        {t('Ideias práticas para quem arrenda imóveis em Moçambique.')}
      </p>

      {cats.length > 0 && (
        <nav className="mt-8 flex flex-wrap gap-2" aria-label={t('Categorias')}>
          <Link
            href="/blog"
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              !sp.categoria ? 'border-ink bg-ink text-white' : 'border-line-strong hover:bg-paper',
            )}
          >
            {t('Todos')}
          </Link>
          {cats.map((c) => (
            <Link
              key={c.id}
              href={`/blog?categoria=${c.slug}`}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                sp.categoria === c.slug
                  ? 'border-ink bg-ink text-white'
                  : 'border-line-strong hover:bg-paper',
              )}
            >
              {t.label(c.name)}
            </Link>
          ))}
        </nav>
      )}

      {!posts || posts.data.length === 0 ? (
        <p className="mt-12 text-ink-soft">{t('Ainda não há artigos publicados.')}</p>
      ) : (
        <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2">
          {posts.data.map((p) => (
            <article key={p.id}>
              {p.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- imagens externas definidas na administração
                <img
                  src={p.coverImageUrl}
                  alt=""
                  className="mb-4 aspect-[16/9] w-full rounded-panel object-cover"
                  loading="lazy"
                />
              )}
              <p className="text-sm text-ink-faint">
                {p.category?.name && <>{t.label(p.category.name)}, </>}
                {t('{date}, {readTimeMinutes} min de leitura', {
                  date: date(p.publishedAt),
                  readTimeMinutes: p.readTimeMinutes,
                })}
              </p>
              <h2 className="mt-1 text-xl leading-snug">
                <Link href={`/blog/${p.slug}`} className="hover:text-brand">
                  {t.label(p.title)}
                </Link>
              </h2>
              <p className="mt-2 text-ink-soft">{t.label(p.excerpt)}</p>
            </article>
          ))}
        </div>
      )}

      {posts && posts.meta.totalPages > 1 && (
        <nav className="mt-14 flex justify-between text-sm" aria-label={t('Páginas')}>
          {page > 1 ? (
            <Link
              href={`/blog?${new URLSearchParams({ ...(sp.categoria ? { categoria: sp.categoria } : {}), pagina: String(page - 1) })}`}
              className="text-brand hover:underline"
            >
              {t('Artigos mais recentes')}
            </Link>
          ) : (
            <span />
          )}
          {page < posts.meta.totalPages && (
            <Link
              href={`/blog?${new URLSearchParams({ ...(sp.categoria ? { categoria: sp.categoria } : {}), pagina: String(page + 1) })}`}
              className="text-brand hover:underline"
            >
              {t('Artigos anteriores')}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
