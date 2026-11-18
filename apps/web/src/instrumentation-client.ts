import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './lib/scrub';

/**
 * Erros no browser (painel, portal, site). NEXT_PUBLIC_SENTRY_DSN é lido no build.
 * Sem gravação de sessões (dados de inquilinos ficariam nas gravações).
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    // Ruído comum de extensões e redes móveis instáveis.
    ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured', 'Load failed', 'NetworkError when attempting to fetch resource'],
    beforeSend: (e) => scrubSentryEvent(e),
  });
}

export const onRouterTransitionStart = dsn ? Sentry.captureRouterTransitionStart : undefined;
