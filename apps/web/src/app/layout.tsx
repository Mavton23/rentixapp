import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { I18nProvider } from '@/i18n/client';
import { getLocale, getT } from '@/i18n/server';
import { Providers } from './providers';

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  return {
    title: { default: 'Rentix', template: '%s · Rentix' },
    description: t('Gestão de arrendamentos: imóveis, inquilinos, rendas e pagamentos num só lugar.'),
    applicationName: 'Rentix',
    metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
    openGraph: { siteName: 'Rentix', locale: locale === 'en' ? 'en_GB' : 'pt_MZ', type: 'website' },
    appleWebApp: { title: 'Rentix', statusBarStyle: 'black-translucent' },
  };
}

export const viewport: Viewport = {
  themeColor: '#0f2a44',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === 'en' ? 'en' : 'pt-MZ'}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
