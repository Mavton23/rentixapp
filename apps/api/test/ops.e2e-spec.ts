import type { NestExpressApplication } from '@nestjs/platform-express';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CronRunner } from '../src/common/ops/cron-runner.service';
import { OpsService } from '../src/modules/ops/ops.module';
import { auth, createApp, createTenant, registerStaff, type StaffSession } from './helpers';

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const TOKEN = 'token-de-operacoes-0123456789abcdef';

describe('Fiabilidade: crons, saúde, backups, limites e exportação (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;
  let admin: string;
  let owner: StaffSession;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const a = await registerStaff(app);
    await prisma.user.update({ where: { id: a.userId }, data: { platformRole: 'SUPER_ADMIN' } });
    admin = (await request(http).post('/api/v1/auth/login').send({ email: a.email, password: 'Segredo123' }).expect(200)).body.accessToken;
    owner = await registerStaff(app);
  });
  afterAll(() => app.close());

  it('prontidão: base de dados e armazenamento', async () => {
    const r = await request(http).get('/api/v1/health/ready').expect(200);
    expect(r.body).toEqual({ status: 'ok', checks: { database: 'ok', storage: 'ok' } });
  });

  it('executor dos crons: regista sucesso, falhas seguidas e recuperação, sem rebentar', async () => {
    const cron = app.get(CronRunner);
    await expect(cron.execute('marketplace-expire', async () => ({ expired: 3, ignorado: 'texto' }))).resolves.toEqual({ expired: 3, ignorado: 'texto' });
    let j = await prisma.cronJob.findUniqueOrThrow({ where: { name: 'marketplace-expire' } });
    expect(j).toMatchObject({ lastStatus: 'OK', consecutiveFailures: 0, lastResult: { expired: 3 } });

    await expect(cron.execute('marketplace-expire', () => Promise.reject(new Error('fornecedor indisponível')))).resolves.toBeUndefined();
    await cron.execute('marketplace-expire', () => Promise.reject(new Error('outra vez')));
    j = await prisma.cronJob.findUniqueOrThrow({ where: { name: 'marketplace-expire' } });
    expect(j).toMatchObject({ lastStatus: 'FAILED', consecutiveFailures: 2, lastError: 'outra vez' });

    await cron.execute('marketplace-expire', async () => 1);
    j = await prisma.cronJob.findUniqueOrThrow({ where: { name: 'marketplace-expire' } });
    expect(j).toMatchObject({ lastStatus: 'OK', consecutiveFailures: 0 });
    expect(j.runs).toBe(4);

    // Com CRON_ENABLED=false (testes), run() não executa nada.
    let called = false;
    await cron.run('billing-daily', async () => (called = true));
    expect(called).toBe(false);
  });

  it('eventos dos backups: só com o token certo', async () => {
    const body = { kind: 'backup.dump', status: 'OK', details: { bytes: 148720, tables: 39 } };
    await request(http).post('/api/v1/internal/ops-events').send(body).expect(401);
    await request(http).post('/api/v1/internal/ops-events').set('x-ops-token', 'errado').send(body).expect(401);
    await request(http).post('/api/v1/internal/ops-events').set('x-ops-token', TOKEN.replace('0', '1')).send(body).expect(401);
    await request(http).post('/api/v1/internal/ops-events').set('x-ops-token', TOKEN).send({ kind: 'qualquer', status: 'OK' }).expect(422);
    await request(http).post('/api/v1/internal/ops-events').set('x-ops-token', TOKEN).send(body).expect(201);
  });

  it('saúde da plataforma: só administração; crons, backups e problemas', async () => {
    await request(http).get('/api/v1/admin/ops/health').set(auth(owner.token)).expect(403);
    const h = await request(http).get('/api/v1/admin/ops/health').set(auth(admin)).expect(200);
    expect(h.body.crons).toHaveLength(7);
    expect(h.body.backups.lastDump).toMatchObject({ status: 'OK', details: { tables: 39 } });
    const keys = h.body.checks.map((c: { key: string }) => c.key);
    expect(keys).not.toContain('backup:dump');
    expect(keys).toContain('backup:restore'); // ainda sem teste de reposição
    await request(http).post('/api/v1/internal/ops-events').set('x-ops-token', TOKEN).send({ kind: 'backup.restore_test', status: 'OK' }).expect(201);
    const h2 = await request(http).get('/api/v1/admin/ops/health').set(auth(admin)).expect(200);
    expect(h2.body.checks.map((c: { key: string }) => c.key)).not.toContain('backup:restore');
  });

  it('vigilância: pagamento preso gera alerta, uma vez por hora', async () => {
    const ops = app.get(OpsService);
    const tenantId = await createTenant(app, owner.token);
    const prop = await request(http).post('/api/v1/properties').set(auth(owner.token)).send({ name: 'Vigia', type: 'HOUSE', street: 'Rua 1', city: 'Maputo', units: [{ label: 'Casa' }] }).expect(201);
    const lease = await request(http).post('/api/v1/leases').set(auth(owner.token)).send({ unitId: prop.body.units[0].id, tenantId, startDate: '2026-11-01', rentAmount: 1_000_000, billingDay: 5 }).expect(201);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { leaseId: lease.body.id } });
    await prisma.payment.create({
      data: { organizationId: owner.organizationId, invoiceId: inv.id, tenantId, amount: 100_000, currency: 'MZN', method: 'MPESA', status: 'PENDING', paidAt: new Date(), expiresAt: new Date(Date.now() - 2 * 3600_000), providerReference: `RX${Date.now()}` },
    });
    const now = new Date();
    const first = await ops.watch(now);
    expect(first.alerted).toContain('payments:stuck');
    const h = await ops.health(now);
    expect(h.checks.find((c) => c.key === 'payments:stuck')).toMatchObject({ status: 'warning' });
    const again = await ops.watch(new Date(now.getTime() + 15 * 60_000));
    expect(again.alerted).not.toContain('payments:stuck'); // não repete dentro da hora
    const later = await ops.watch(new Date(now.getTime() + 61 * 60_000));
    expect(later.alerted).toContain('payments:stuck');
    await prisma.payment.deleteMany({ where: { organizationId: owner.organizationId, status: 'PENDING' } });
  });

  it('limite de armazenamento do plano', async () => {
    const s = await registerStaff(app);
    const tiny = await prisma.plan.create({ data: { code: `TINY${Date.now()}`, name: 'Mini', monthlyPrice: 1000, annualPrice: 10000, maxStorageMb: 1, isActive: false } });
    await prisma.subscription.update({ where: { organizationId: s.organizationId }, data: { planId: tiny.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400_000) } });
    const tenantId = await createTenant(app, s.token);
    const pdf = (kb: number) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(kb * 1024, 32)]);
    await request(http).post('/api/v1/files').set(auth(s.token)).field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'OTHER').attach('file', pdf(700), 'a.pdf').expect(201);
    const r = await request(http).post('/api/v1/files').set(auth(s.token)).field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'OTHER').attach('file', pdf(700), 'b.pdf').expect(403);
    expect(r.body.error.code).toBe('PLAN_LIMIT_STORAGE');
    const b = await request(http).get('/api/v1/billing').set(auth(s.token)).expect(200);
    expect(b.body.limits.maxStorageMb).toBe(1);
    expect(b.body.usage.storageBytes).toBeGreaterThan(700 * 1024);
  });

  it('exportação de todos os dados: ZIP com Excel e ficheiros, só o proprietário', async () => {
    const tenantId = await createTenant(app, owner.token, { fullName: 'Ana Exportada' });
    const pdf = Buffer.from('%PDF-1.4\nconteudo\n%%EOF');
    await request(http).post('/api/v1/files').set(auth(owner.token)).field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'ID_DOCUMENT').attach('file', pdf, 'BI Ana.pdf').expect(201);
    await request(http).post('/api/v1/files').set(auth(owner.token)).field('ownerType', 'TENANT').field('ownerId', tenantId).field('category', 'OTHER').attach('file', pdf, 'BI Ana.pdf').expect(201);
    const res = await request(http).get('/api/v1/organization/export').set(auth(owner.token)).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/zip');
    writeFileSync('/tmp/rentix-export-test.zip', res.body as Buffer);
    const list = execFileSync('unzip', ['-Z1', '/tmp/rentix-export-test.zip']).toString().trim().split('\n');
    expect(list).toEqual(expect.arrayContaining(['dados.xlsx', 'LEIA-ME.txt', `ficheiros/inquilinos/${tenantId}/BI Ana.pdf`, `ficheiros/inquilinos/${tenantId}/BI Ana (2).pdf`]));
    const content = execFileSync('unzip', ['-p', '/tmp/rentix-export-test.zip', `ficheiros/inquilinos/${tenantId}/BI Ana.pdf`]);
    expect(content.equals(pdf)).toBe(true);
    expect(await prisma.auditLog.count({ where: { organizationId: owner.organizationId, action: 'organization.exported' } })).toBe(1);

    const other = await registerStaff(app);
    await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email: other.email, role: 'MANAGER' }).expect(201);
    const login = await request(http).post('/api/v1/auth/login').send({ email: other.email, password: 'Segredo123' }).expect(200);
    const sw = await request(http).post('/api/v1/auth/switch-organization').set(auth(login.body.accessToken)).set('Cookie', login.headers['set-cookie']![0]!.split(';')[0]!).send({ organizationId: owner.organizationId }).expect(200);
    await request(http).get('/api/v1/organization/export').set(auth(sw.body.accessToken)).expect(403);
  });
});
