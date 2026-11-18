import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './lib/scrub';

// Erros do servidor Next (páginas do site renderizadas no servidor, /revalidate). Sem DSN, desligado.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend: (e) => scrubSentryEvent(e),
  });
}
