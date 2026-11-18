import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // A API fica atrás do mesmo domínio (/api/v1/...): sem CORS e os cookies de sessão
  // são "first-party" para o browser.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
};

/**
 * Com SENTRY_AUTH_TOKEN (no build), os source maps vão para o Sentry e os erros do browser
 * aparecem com o código original. Sem ele, a configuração do Next fica igual.
 */
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      // Envia os eventos do browser pelo próprio domínio (não são bloqueados por bloqueadores de anúncios).
      tunnelRoute: '/monitorizacao',
      widenClientFileUpload: true,
    })
  : nextConfig;
