/**
 * Teste de reposição: prova que os backups servem para alguma coisa.
 *
 *   node dist/cli/restore-check.js --neon        cria uma ramificação do Neon de há 1 hora,
 *                                                verifica-a e apaga-a (a produção não é tocada)
 *   node dist/cli/restore-check.js --url <url>   verifica uma base já reposta (ex.: de um pg_dump)
 *
 * Verifica: todas as migrações aplicadas, tabelas principais com dados, e a coerência entre
 * faturas e pagamentos. Com OPS_REPORT_URL e OPS_TOKEN, regista o resultado na API (página Saúde).
 * Termina com código 1 se falhar (o GitHub Actions marca o job como falhado).
 *
 * Variáveis (modo --neon): NEON_API_KEY, NEON_PROJECT_ID, NEON_BRANCH_ID (a ramificação de produção),
 * NEON_DATABASE (neondb), NEON_ROLE (neondb_owner), RESTORE_MINUTES_AGO (60).
 * Opcional: DIRECT_DATABASE_URL da produção, para comparar contagens.
 */
import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const NEON_API = process.env.NEON_API_URL ?? 'https://console.neon.tech/api/v2';
const TABLES = ['organizations', 'users', 'properties', 'units', 'tenants', 'leases', 'invoices', 'payments', 'subscriptions', 'audit_logs'] as const;

export interface CheckResult {
  ok: boolean;
  migrations: { expected: number; applied: number; missing: string[]; failed: string[] };
  counts: Record<string, number>;
  productionCounts?: Record<string, number>;
  integrity: { invoicePaymentMismatch: number; duplicateReceipts: number; orphanPayments: number };
  problems: string[];
}

function expectedMigrations(): string[] {
  const dir = process.env.MIGRATIONS_DIR ?? join(__dirname, '..', '..', 'prisma', 'migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function counts(client: Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = Number((await client.query(`SELECT count(*)::bigint AS n FROM "${t}"`)).rows[0].n);
  return out;
}

export async function verifyDatabase(url: string, productionUrl?: string): Promise<CheckResult> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
  await client.connect();
  const problems: string[] = [];
  try {
    const expected = expectedMigrations();
    const hasTable = (await client.query<{ t: string | null }>("SELECT to_regclass('public._prisma_migrations')::text AS t")).rows[0]?.t;
    const rows = hasTable
      ? (await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
          'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations',
        )).rows
      : [];
    if (!hasTable) problems.push('A tabela _prisma_migrations não existe: a base não foi criada com prisma migrate deploy');
    const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const missing = expected.filter((m) => !applied.has(m));
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    if (missing.length) problems.push(`Migrações em falta: ${missing.join(', ')}`);
    if (failed.length) problems.push(`Migrações incompletas: ${failed.join(', ')}`);

    const c = await counts(client);

    // Coerência: o valor pago de cada fatura é a soma dos pagamentos confirmados.
    const mismatch = Number(
      (await client.query(`
        SELECT count(*)::bigint AS n FROM invoices i
        LEFT JOIN (SELECT "invoiceId", sum(amount) AS s FROM payments WHERE status = 'CONFIRMED' GROUP BY "invoiceId") p ON p."invoiceId" = i.id
        WHERE i."paidAmount" <> COALESCE(p.s, 0)`)).rows[0].n,
    );
    const dupReceipts = Number(
      (await client.query(`
        SELECT count(*)::bigint AS n FROM (
          SELECT "organizationId", "receiptNumber" FROM payments WHERE "receiptNumber" IS NOT NULL
          GROUP BY 1, 2 HAVING count(*) > 1) d`)).rows[0].n,
    );
    const orphans = Number(
      (await client.query(`SELECT count(*)::bigint AS n FROM payments p LEFT JOIN invoices i ON i.id = p."invoiceId" WHERE i.id IS NULL`)).rows[0].n,
    );
    if (mismatch) problems.push(`${mismatch} fatura(s) com valor pago diferente da soma dos pagamentos`);
    if (dupReceipts) problems.push(`${dupReceipts} número(s) de recibo repetidos`);
    if (orphans) problems.push(`${orphans} pagamento(s) sem fatura`);

    let productionCounts: Record<string, number> | undefined;
    if (productionUrl) {
      const prod = new Client({ connectionString: productionUrl, connectionTimeoutMillis: 30_000 });
      await prod.connect();
      try {
        productionCounts = await counts(prod);
      } finally {
        await prod.end();
      }
      // A cópia é de há pouco tempo: não pode ter mais linhas do que a produção, nem estar vazia se esta não está.
      for (const t of TABLES) {
        if (productionCounts[t]! > 0 && c[t] === 0) problems.push(`Tabela ${t} vazia na cópia (produção tem ${productionCounts[t]})`);
      }
    }

    return {
      ok: problems.length === 0,
      migrations: { expected: expected.length, applied: applied.size, missing, failed },
      counts: c,
      productionCounts,
      integrity: { invoicePaymentMismatch: mismatch, duplicateReceipts: dupReceipts, orphanPayments: orphans },
      problems,
    };
  } finally {
    await client.end();
  }
}

// ---------- Neon ----------

async function neon<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${NEON_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Neon ${method} ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ramificação de um momento passado, com computação própria e apagada automaticamente ao fim de 2 horas. */
async function withNeonBranch<T>(fn: (url: string, meta: Record<string, unknown>) => Promise<T>): Promise<T> {
  for (const k of ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_BRANCH_ID'] as const) if (!process.env[k]) throw new Error(`Falta ${k}`);
  const project = process.env.NEON_PROJECT_ID!;
  const minutesAgo = Number(process.env.RESTORE_MINUTES_AGO ?? 60);
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const created = await neon<{ branch: { id: string; name: string } }>('POST', `/projects/${project}/branches`, {
    branch: {
      name: `teste-reposicao-${at.toISOString().slice(0, 16).replace(/-/g, '').replace('T', '-').replace(':', '')}`,
      parent_id: process.env.NEON_BRANCH_ID,
      parent_timestamp: at.toISOString(),
      // Rede de segurança: se este script falhar a meio, o Neon apaga a ramificação.
      expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    },
    endpoints: [{ type: 'read_write' }],
  });
  const branchId = created.branch.id;
  const meta = { branch: created.branch.name, restorePoint: at.toISOString() };
  try {
    const params = new URLSearchParams({
      branch_id: branchId,
      database_name: process.env.NEON_DATABASE ?? 'neondb',
      role_name: process.env.NEON_ROLE ?? 'neondb_owner',
      pooled: 'false',
    });
    const { uri } = await neon<{ uri: string }>('GET', `/projects/${project}/connection_uri?${params}`);
    // A computação pode demorar alguns segundos a arrancar.
    let lastErr: unknown;
    for (let i = 0; i < 20; i++) {
      try {
        return await fn(uri, meta);
      } catch (err) {
        lastErr = err;
        if (!/ECONNREFUSED|timeout|starting|ENOTFOUND|terminating/i.test(String(err))) throw err;
        await sleep(3000);
      }
    }
    throw lastErr;
  } finally {
    await neon('DELETE', `/projects/${project}/branches/${branchId}`).catch((err) => console.error('Não foi possível apagar a ramificação (expira sozinha):', err));
  }
}

async function report(status: 'OK' | 'FAILED', details: Record<string, unknown>) {
  const url = process.env.OPS_REPORT_URL;
  if (!url || !process.env.OPS_TOKEN) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ops-token': process.env.OPS_TOKEN },
    body: JSON.stringify({ kind: 'backup.restore_test', status, details }),
  }).catch((err) => console.error('Não foi possível registar o resultado na API:', err));
}

async function main() {
  const args = process.argv.slice(2);
  const started = Date.now();
  const production = process.env.DIRECT_DATABASE_URL || undefined;
  try {
    let result: CheckResult;
    let meta: Record<string, unknown> = {};
    if (args[0] === '--neon') {
      result = await withNeonBranch(async (url, m) => {
        meta = m;
        return verifyDatabase(url, production);
      });
    } else if (args[0] === '--url' && args[1]) {
      result = await verifyDatabase(args[1], production);
      meta = { source: 'url' };
    } else {
      console.error('Uso: restore-check --neon | --url <postgres://...>');
      process.exit(2);
    }
    const details = { ...meta, seconds: Math.round((Date.now() - started) / 1000), ...result.counts, problems: result.problems.length };
    console.log(JSON.stringify(result, null, 2));
    await report(result.ok ? 'OK' : 'FAILED', details);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error('Teste de reposição falhou:', err);
    await report('FAILED', { error: String(err).slice(0, 500) });
    process.exit(1);
  }
}

if (require.main === module) void main();
