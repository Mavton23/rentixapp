import { getLocale, getT } from '@/i18n/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Star } from 'lucide-react';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { FeaturesContent, SiteContentResponse, Testimonial } from '@/lib/site-types';
import { Button } from '@/components/ui/button';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('Rentix — rendas cobradas a tempo'),
    description: t(
      'Faturas automáticas, lembretes por SMS, pagamentos por M-Pesa e recibos para senhorios e imobiliárias em Moçambique.',
    ),
  };
}

/** Página inicial do site. Sem o CMS ligado, a raiz leva diretamente à aplicação. */
export default async function Home() {
  const tr = await getT();
  const f = await getFeatures();
  if (!f.CMS) redirect('/painel');

  const [features, testimonials] = await Promise.all([
    apiGet<SiteContentResponse<FeaturesContent>>(`/site/content/features?locale=${await getLocale()}`),
    f.TESTIMONIALS ? apiGet<Testimonial[]>('/testimonials') : Promise.resolve(null),
  ]);

  return (
    <>
      {/* Abertura: o que o inquilino vê no telemóvel é o argumento */}
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
          <div>
            <h1 className="font-display text-[40px] leading-[1.08] font-bold sm:text-[56px]">
              {tr('As rendas dos seus imóveis, cobradas a tempo.')}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-navy-text">
              {tr(
                'O Rentix emite as faturas no início do mês, lembra os inquilinos por SMS, recebe por M-Pesa e passa o recibo. Fica a saber, a qualquer momento, quem pagou e quem deve.',
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/criar-conta">{tr('Criar conta grátis')}</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
              >
                <Link href="/entrar">{tr('Entrar')}</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-navy-text">
              {tr('30 dias do Profissional para experimentar. Depois, grátis até 3 unidades.')}
            </p>
          </div>

          <div
            className="mx-auto w-full max-w-[300px] rounded-[28px] bg-white p-3 text-ink shadow-2xl ring-8 ring-white/10"
            aria-hidden
          >
            <div className="rounded-[20px] bg-paper px-4 pt-5 pb-4">
              <p className="text-xs text-ink-soft">{tr('Olá, Ana')}</p>
              <p className="mt-3 text-xs text-ink-soft">{tr('Tem em dívida')}</p>
              <p className="money text-[32px] leading-tight font-semibold">{tr('15 000,00 MTn')}</p>
              <p className="mt-1 text-xs text-ink-soft">{tr('Renda de dezembro, vence a 05/12')}</p>
              <div className="mt-4 rounded-xl bg-brand py-2.5 text-center text-sm font-medium text-white">
                {tr('Pagar com M-Pesa')}
              </div>
              <div className="mt-4 rounded-xl border border-line bg-surface p-3 text-xs">
                <p className="font-medium">{tr('Recibo RC 2026/000124')}</p>
                <p className="text-ink-soft">{tr('Renda de novembro, paga a 03/11')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Como funciona: é mesmo uma sequência */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-20">
        <h2 className="text-[28px]">{tr('Como funciona')}</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {[
            [
              tr('Registe os imóveis e os inquilinos'),
              tr(
                'Uma casa, um prédio com vários apartamentos ou lojas: cada unidade tem o seu contrato.',
              ),
            ],
            [
              tr('Crie o contrato'),
              tr(
                'Renda, dia de pagamento, caução e multa. A partir daí, as faturas são emitidas sozinhas.',
              ),
            ],
            [
              tr('Receba e acompanhe'),
              tr(
                'Os inquilinos pagam por M-Pesa no portal, ou regista o pagamento. O recibo segue por SMS e email.',
              ),
            ],
          ].map(([title, text], i) => (
            <li key={title} className="border-t-2 border-brand pt-4">
              <span className="font-display text-sm font-semibold text-brand">
                {tr('Passo {0}', { '0': i + 1 })}
              </span>
              <h3 className="mt-1 text-lg">{tr.label(title)}</h3>
              <p className="mt-2 text-ink-soft">{tr.label(text)}</p>
            </li>
          ))}
        </ol>
      </section>

      {features && features.data.items.length > 0 && (
        <section className="border-y border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
            <h2 className="text-[28px]">{tr('O que faz por si')}</h2>
            {features.data.intro && (
              <p className="mt-2 max-w-2xl text-ink-soft">{tr.label(features.data.intro)}</p>
            )}
            <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.data.items.slice(0, 6).map((it) => (
                <div key={it.title}>
                  <dt className="font-display text-lg font-semibold">{tr.label(it.title)}</dt>
                  <dd className="mt-1.5 text-ink-soft">{tr.label(it.description)}</dd>
                </div>
              ))}
            </dl>
            <Link
              href="/funcionalidades"
              className="mt-10 inline-block font-medium text-brand hover:underline"
            >
              {tr('Ver todas as funcionalidades')}
            </Link>
          </div>
        </section>
      )}

      {testimonials && testimonials.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <h2 className="text-[28px]">{tr('Quem já usa')}</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {testimonials.slice(0, 3).map((t) => (
              <figure key={t.id} className="flex flex-col rounded-panel border border-line p-6">
                <div
                  className="flex gap-0.5 text-due"
                  aria-label={tr('{rating} em 5', { rating: t.rating })}
                >
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="size-4 fill-current" aria-hidden />
                  ))}
                </div>
                <blockquote className="mt-3 flex-1 text-[17px] leading-relaxed">
                  {tr.label(t.message)}
                </blockquote>
                <figcaption className="mt-4 text-sm text-ink-soft">
                  <span className="font-medium text-ink">{tr.label(t.name)}</span>
                  {[t.role, t.city].filter(Boolean).length > 0 &&
                    `, ${[t.role, t.city].filter(Boolean).join(', ')}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="bg-brand text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-12 md:flex-row md:items-center">
          <div>
            <h2 className="text-[26px]">{tr('Comece este mês.')}</h2>
            <p className="mt-1 text-white/80">
              {tr('Registe o primeiro imóvel em menos de cinco minutos.')}
            </p>
          </div>
          <Button asChild size="lg" className="bg-white text-brand-strong hover:bg-white/90">
            <Link href="/criar-conta">{tr('Criar conta grátis')}</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
