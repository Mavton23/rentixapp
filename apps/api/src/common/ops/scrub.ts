/**
 * Retira dados pessoais e segredos dos eventos enviados ao Sentry: emails, telefones,
 * tokens, NUIT e números de documento não saem do servidor. Fica o que serve para
 * diagnosticar: rota, código do erro, requestId, ids internos (UUID).
 */
import type { ErrorEvent } from '@sentry/nestjs';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Telefones (+258 84 123 4567, 841234567, +27...): 9 a 15 dígitos com separadores. */
const PHONE = /\+?\d[\d\s-]{7,16}\d/g;
/** JWT e tokens longos (refresh, convites, chaves). */
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

const SENSITIVE_KEY = /pass|token|secret|authorization|cookie|key|nuit|phone|telefone|email|document|msisdn|bi\b/i;

function scrubValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE_KEY.test(k) ? '[removido]' : scrubValue(x, depth + 1)]));
  }
  return v;
}

export function scrubEvent<E extends ErrorEvent>(event: E): E {
  if (event.request) {
    // Corpo, cookies e cabeçalhos com credenciais nunca saem.
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      const { authorization: _a, cookie: _c, Authorization: _A, Cookie: _C, ...rest } = event.request.headers as Record<string, string>;
      event.request.headers = scrubValue(rest) as Record<string, string>;
    }
    if (typeof event.request.query_string === 'string') event.request.query_string = scrubText(event.request.query_string);
    if (event.request.url) event.request.url = scrubText(event.request.url);
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    if (b.data) b.data = scrubValue(b.data) as Record<string, unknown>;
  }
  return event;
}
