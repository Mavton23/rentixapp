/**
 * Sentry: tem de ser o primeiro módulo carregado (main.ts importa-o antes de tudo) para
 * instrumentar http, express e pg. Sem SENTRY_DSN fica desligado e não envia nada.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { scrubEvent, scrubText } from './common/ops/scrub';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // Desempenho: amostra pequena por omissão (custo); 0 desliga.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Por omissão o SDK recolhe cookies, cabeçalhos e corpos: aqui só o mínimo para diagnosticar.
    // A limpeza em beforeSend é uma segunda camada.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'content-type', 'x-request-id'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => {
      if (event.request?.url) event.request.url = scrubText(event.request.url);
      delete event.request?.data;
      return event;
    },
    beforeBreadcrumb: (b) => {
      if (b.message) b.message = scrubText(b.message);
      if (b.data?.url) b.data.url = scrubText(String(b.data.url));
      return b;
    },
  });
}

export const sentryEnabled = !!dsn;
