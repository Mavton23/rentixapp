import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.server.config');
  }
}

/** Erros em componentes do servidor, rotas e ações. */
export const onRequestError = Sentry.captureRequestError;
