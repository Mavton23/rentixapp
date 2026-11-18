/**
 * Cliente HTTP da API. Há duas instâncias: uma para a equipa e outra para o portal do inquilino.
 * - O access token vive só em memória (nunca em localStorage).
 * - O refresh token está num cookie httpOnly gerido pela API; o browser envia-o sozinho.
 * - Um 401 provoca uma (única) renovação e o pedido é repetido.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Erros por campo devolvidos pela validação (422). */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { field?: string; message?: string }[])
        .filter((d) => d.field)
        .map((d) => [d.field!, d.message ?? '']),
    );
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;
interface RequestOptions {
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
}

export type Listener<S> = (session: S | null) => void;

export class ApiClient<S extends { accessToken: string }> {
  private session: S | null = null;
  private refreshing: Promise<S | null> | null = null;
  private listeners = new Set<Listener<S>>();
  /** true depois da primeira tentativa de restaurar a sessão. */
  ready = false;

  constructor(
    private readonly refreshPath: string,
    private readonly logoutPath: string,
  ) {}

  // ---------- sessão ----------

  getSession(): S | null {
    return this.session;
  }

  setSession(session: S | null): void {
    this.session = session;
    this.ready = true;
    this.listeners.forEach((l) => l(session));
  }

  subscribe(listener: Listener<S>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Renova a sessão com o cookie de refresh. Pedidos simultâneos partilham a mesma renovação. */
  refresh(): Promise<S | null> {
    if (!this.refreshing) {
      this.refreshing = fetch(`/api/v1${this.refreshPath}`, { method: 'POST', credentials: 'same-origin' })
        .then(async (res) => (res.ok ? ((await res.json()) as S) : null))
        .catch(() => null)
        .then((s) => {
          this.setSession(s);
          return s;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  async logout(): Promise<void> {
    await fetch(`/api/v1${this.logoutPath}`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    this.setSession(null);
  }

  // ---------- pedidos ----------

  get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', path, { body, headers });
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body });
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body });
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
  /** Envio de ficheiros (multipart). O browser define o Content-Type com o separador. */
  upload<T>(path: string, form: FormData) {
    return this.request<T>('POST', path, { body: form });
  }

  /** Conteúdo autenticado como Blob (para pré-visualizar imagens e PDFs privados). */
  async blob(path: string, body?: unknown, retried = false): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.session) headers.Authorization = `Bearer ${this.session.accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api/v1${path}`, {
      method: body !== undefined ? 'POST' : 'GET',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401 && !retried && this.session && (await this.refresh())) return this.blob(path, body, true);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(res.status, data?.error.code ?? 'ERROR', data?.error.message ?? 'Não foi possível abrir o ficheiro.');
    }
    return res.blob();
  }

  /** Descarrega um ficheiro autenticado (ex.: recibo em PDF) e oferece-o ao browser. */
  async download(path: string, fallbackName: string, retried = false): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.session) headers.Authorization = `Bearer ${this.session.accessToken}`;
    const res = await fetch(`/api/v1${path}`, { headers, credentials: 'same-origin' });
    if (res.status === 401 && !retried && this.session && (await this.refresh())) {
      return this.download(path, fallbackName, true);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(res.status, data?.error.code ?? 'ERROR', data?.error.message ?? 'Não foi possível descarregar o ficheiro.');
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
    const url = `/api/v1${path}${toQueryString(opts.query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (this.session) headers.Authorization = `Bearer ${this.session.accessToken}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: isForm ? (opts.body as FormData) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Sem ligação. Verifique a internet e tente de novo.');
    }

    if (res.status === 401 && !retried && this.session) {
      const renewed = await this.refresh();
      if (renewed) return this.request<T>(method, path, opts, true);
    }

    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'ERROR',
        err?.message ?? 'Ocorreu um erro. Tente de novo.',
        err?.details,
      );
    }
    return data as T;
  }
}

function toQueryString(q?: Query): string {
  if (!q) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
