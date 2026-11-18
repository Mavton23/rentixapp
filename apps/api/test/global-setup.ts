import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Recria o schema da base de dados de teste aplicando as migrações SQL por ordem
 * e insere os planos base.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://rentix:rentix@localhost:5432/rentix_test';
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const migrations = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const m of migrations) {
      await client.query(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
    }
    // Os planos base vêm da migração 20261116100000_default_plans.
  } finally {
    await client.end();
  }
}
