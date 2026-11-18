import { getT } from '@/i18n/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { BlogPostFull } from '@/lib/site-types';
import { date } from '@/lib/format';
import { Markdown } from '@/components/markdown';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await apiGet<BlogPostFull>(`/blog/posts/${encodeURIComponent((await params).slug)}`);
  if (!post) return { title: 'Artigo' };
  return {
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: post.coverImageUrl ? [post.coverImageUrl] : undefined,
      type: 'article',
    },
  };
}

export default async function PostPage({ params }: Props) {
  const t = await getT();
  if (!(await getFeatures()).BLOG) notFound();
  const post = await apiGet<BlogPostFull>(`/blog/posts/${encodeURIComponent((await params).slug)}`);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-[68ch] px-5 py-14 md:py-20">
      <Link href="/blog" className="text-sm text-ink-soft hover:text-ink">
        {t('Blog')}
      </Link>
      <h1 className="mt-3 text-[34px] leading-tight sm:text-[42px]">{t.label(post.title)}</h1>
      <p className="mt-3 text-ink-faint">
        {post.category?.name && <>{t.label(post.category.name)}, </>}
        {t('{date}, {readTimeMinutes} min de leitura', {
          date: date(post.publishedAt),
          readTimeMinutes: post.readTimeMinutes,
        })}
      </p>
      {post.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- imagens externas definidas na administração
        <img
          src={post.coverImageUrl}
          alt=""
          className="mt-8 aspect-[16/9] w-full rounded-panel object-cover"
        />
      )}
      <Markdown className="mt-8">{t.label(post.content)}</Markdown>
    </article>
  );
}
