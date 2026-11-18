import { getLocale, getT } from '@/i18n/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Star } from 'lucide-react';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { AboutContent, SiteContentResponse, Testimonial } from '@/lib/site-types';
import { Button } from '@/components/ui/button';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Sobre') };
}

export default async function AboutPage() {
  const tr = await getT();
  const f = await getFeatures();
  if (!f.CMS) notFound();
  const [content, testimonials] = await Promise.all([
    apiGet<SiteContentResponse<AboutContent>>(`/site/content/about?locale=${await getLocale()}`),
    f.TESTIMONIALS ? apiGet<Testimonial[]>('/testimonials') : Promise.resolve(null),
  ]);
  if (!content) notFound();
  const a = content.data;

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
      <h1 className="text-[36px] sm:text-[44px]">{tr.label(a.title)}</h1>
      <p className="mt-4 text-xl leading-relaxed text-ink-soft">{tr.label(a.subtitle)}</p>

      {a.sections.map((s) => (
        <section key={s.title} className="mt-12">
          <h2 className="text-2xl">{tr.label(s.title)}</h2>
          {s.body.split(/\n{2,}/).map((p, i) => (
            <p key={i} className="mt-3 text-[17px] leading-relaxed">
              {tr.label(p)}
            </p>
          ))}
        </section>
      ))}

      {a.values.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl">{tr('Em que acreditamos')}</h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            {a.values.map((v) => (
              <div key={v.title} className="border-l-2 border-brand pl-4">
                <dt className="font-display text-lg font-semibold">{tr.label(v.title)}</dt>
                <dd className="mt-1 text-ink-soft">{tr.label(v.description)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {testimonials && testimonials.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl">{tr('O que dizem os clientes')}</h2>
          <div className="mt-6 space-y-6">
            {testimonials.map((t) => (
              <figure key={t.id} className="border-b border-line pb-6">
                <div
                  className="flex gap-0.5 text-due"
                  aria-label={tr('{rating} em 5', { rating: t.rating })}
                >
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="size-4 fill-current" aria-hidden />
                  ))}
                </div>
                <blockquote className="mt-2 text-[17px] leading-relaxed">
                  {tr.label(t.message)}
                </blockquote>
                <figcaption className="mt-2 text-sm text-ink-soft">
                  <span className="font-medium text-ink">{tr.label(t.name)}</span>
                  {[t.role, t.city].filter(Boolean).length > 0 &&
                    `, ${[t.role, t.city].filter(Boolean).join(', ')}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {a.cta && (
        <section className="mt-14 rounded-panel bg-navy px-6 py-8 text-white">
          <h2 className="text-2xl">{tr.label(a.cta.title)}</h2>
          <p className="mt-1 text-navy-text">{tr.label(a.cta.text)}</p>
          <Button asChild className="mt-5">
            <Link href="/criar-conta">{tr.label(a.cta.buttonText)}</Link>
          </Button>
        </section>
      )}
    </div>
  );
}
