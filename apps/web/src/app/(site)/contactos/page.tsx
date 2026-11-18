import { getLocale, getT } from '@/i18n/server';
import { notFound } from 'next/navigation';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { ContactContent, SiteContentResponse } from '@/lib/site-types';
import { ContactForm } from './contact-form';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Contactos') };
}

const ICONS = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
  address: MapPin,
  hours: Clock,
} as const;

function href(type: keyof typeof ICONS, value: string): string | null {
  const digits = value.replace(/[^\d+]/g, '');
  if (type === 'email') return `mailto:${value}`;
  if (type === 'phone') return `tel:${digits}`;
  if (type === 'whatsapp') return `https://wa.me/${digits.replace(/^\+/, '')}`;
  return null;
}

export default async function ContactPage() {
  const t = await getT();
  if (!(await getFeatures()).CMS) notFound();
  const content = await apiGet<SiteContentResponse<ContactContent>>(`/site/content/contact?locale=${await getLocale()}`);
  if (!content) notFound();
  const c = content.data;

  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-5 py-14 md:grid-cols-[1fr_1.2fr] md:py-20">
      <div>
        <h1 className="text-[36px] sm:text-[44px]">{t('Contactos')}</h1>
        {c.intro && <p className="mt-3 text-lg text-ink-soft">{t.label(c.intro)}</p>}
        <ul className="mt-8 space-y-5">
          {c.items.map((it) => {
            const Icon = ICONS[it.type];
            const link = href(it.type, it.value);
            return (
              <li key={`${it.type}-${it.value}`} className="flex gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="text-sm text-ink-faint">{t.label(it.label)}</p>
                  {link ? (
                    <a href={link} className="font-medium text-ink hover:text-brand">
                      {t.label(it.value)}
                    </a>
                  ) : (
                    <p className="font-medium">{t.label(it.value)}</p>
                  )}
                  {it.extra && <p className="text-sm text-ink-soft">{t.label(it.extra)}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="rounded-panel border border-line bg-surface p-6 sm:p-8">
        <h2 className="text-xl">{t('Envie-nos uma mensagem')}</h2>
        <ContactForm />
      </div>
    </div>
  );
}
