import { getLocale, getT } from '@/i18n/server';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { FeaturesContent, SiteContentResponse } from '@/lib/site-types';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Funcionalidades') };
}

export default async function FeaturesPage() {
  const t = await getT();
  if (!(await getFeatures()).CMS) notFound();
  const content = await apiGet<SiteContentResponse<FeaturesContent>>(`/site/content/features?locale=${await getLocale()}`);
  if (!content) notFound();
  const { intro, items } = content.data;

  return (
    <div className="mx-auto max-w-4xl px-5 py-14 md:py-20">
      <h1 className="text-[36px] sm:text-[44px]">{t('Funcionalidades')}</h1>
      {intro && <p className="mt-3 max-w-2xl text-lg text-ink-soft">{t.label(intro)}</p>}
      <div className="mt-12 divide-y divide-line border-y border-line">
        {items.map((it) => (
          <section key={it.title} className="grid gap-3 py-8 md:grid-cols-[1fr_1.4fr] md:gap-10">
            <h2 className="text-xl">{t.label(it.title)}</h2>
            <div>
              <p className="text-ink-soft">{t.label(it.description)}</p>
              {it.details.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {it.details.map((d) => (
                    <li key={d} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-paid" aria-hidden />
                      {t.label(d)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
