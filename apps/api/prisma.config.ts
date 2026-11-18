import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * A CLI do Prisma (migrações) usa a ligação DIRETA à base de dados. No Neon, a ligação com
 * pool (PgBouncer em modo transação, "-pooler" no endereço) serve a aplicação mas não as
 * migrações. Sem DIRECT_DATABASE_URL, usa DATABASE_URL (desenvolvimento, Postgres local).
 */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || env('DATABASE_URL'),
  },
});
