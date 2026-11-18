/** Retira emails, telefones e tokens de textos enviados ao Sentry (igual à API). */
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s-]{7,16}\d/g;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scrubText(s: string): string {
  return s
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(TOKEN, (m) => (UUID.test(m) ? m : '[token]'))
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? '[telefone]' : m));
}

/** Limpa um evento do Sentry: mensagens, exceções, URL e migalhas. Não guarda o utilizador. */
export function scrubSentryEvent<E extends { message?: string; request?: { url?: string; query_string?: unknown; data?: unknown; cookies?: unknown; headers?: unknown }; user?: unknown; exception?: { values?: { value?: string }[] }; breadcrumbs?: { message?: string; data?: Record<string, unknown> }[] }>(e: E): E {
  if (e.message) e.message = scrubText(e.message);
  if (e.request) {
    if (e.request.url) e.request.url = scrubText(e.request.url);
    delete e.request.query_string;
    delete e.request.data;
    delete e.request.cookies;
    delete e.request.headers;
  }
  delete e.user;
  for (const ex of e.exception?.values ?? []) if (ex.value) ex.value = scrubText(ex.value);
  for (const b of e.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    if (b.data?.url) b.data.url = scrubText(String(b.data.url));
  }
  return e;
}
