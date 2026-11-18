import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { periodOf, todayIn } from '@rentix/shared';
import { auth, createApp, createPropertyWithUnit, createTenant, refreshCookie, registerStaff } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Portal do inquilino (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  async function inviteToken(tenantId: string): Promise<string> {
    const n = await prisma.notification.findFirstOrThrow({
      where: { tenantId, template: 'TENANT_INVITE' },
      orderBy: { createdAt: 'desc' },
    });
    return decodeURIComponent(/token=([^\s]+)/.exec(n.body)![1]!);
  }

  async function setup(phone: string, email?: string) {
    const owner = await registerStaff(app);
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token, { phone, ...(email ? { email } : {}) });
    await request(http)
      .post('/api/v1/leases')
      .set(auth(owner.token))
      .send({ unitId, tenantId, startDate: `${periodOf(todayIn())}-01`, rentAmount: 2_000_000 })
      .expect(201);
    await request(http).post(`/api/v1/tenants/${tenantId}/invite`).set(auth(owner.token)).expect(201);
    return { owner, tenantId, token: await inviteToken(tenantId) };
  }

  it('convite → criar senha → entrar com telefone → ver só as suas faturas', async () => {
    const { token } = await setup('84 700 0001');

    const info = await request(http).post('/api/v1/portal/auth/invite/verify').send({ token }).expect(200);
    expect(info.body).toMatchObject({ hasAccount: false, phone: '+258847000001' });

    const accepted = await request(http)
      .post('/api/v1/portal/auth/invite/accept')
      .send({ token, password: 'Inquilino1' })
      .expect(201);
    expect(accepted.body.accessToken).toBeDefined();

    // Convite é de uso único.
    await request(http).post('/api/v1/portal/auth/invite/accept').send({ token, password: 'Inquilino1' }).expect(403);

    const login = await request(http)
      .post('/api/v1/portal/auth/login')
      .send({ identifier: '847000001', password: 'Inquilino1' })
      .expect(200);
    const t = login.body.accessToken;

    const summary = await request(http).get('/api/v1/portal/summary').set(auth(t)).expect(200);
    expect(summary.body.balances).toEqual([{ currency: 'MZN', amount: 2_000_000 }]);

    const invoices = await request(http).get('/api/v1/portal/invoices').set(auth(t)).expect(200);
    expect(invoices.body.data).toHaveLength(1);

    // Refresh do portal usa o seu próprio cookie.
    const r = await request(http).post('/api/v1/portal/auth/refresh').set('Cookie', refreshCookie(login, 'rtx_trt')).expect(200);
    expect(r.body.accessToken).toBeDefined();
  });

  it('a mesma pessoa arrendando a duas organizações tem uma só conta e vê ambos os contratos', async () => {
    const first = await setup('84 700 0002', 'pessoa@teste.co.mz');
    await request(http)
      .post('/api/v1/portal/auth/invite/accept')
      .send({ token: first.token, password: 'Inquilino1' })
      .expect(201);

    const second = await setup('84 700 0002', 'pessoa@teste.co.mz');
    const info = await request(http).post('/api/v1/portal/auth/invite/verify').send({ token: second.token }).expect(200);
    expect(info.body.hasAccount).toBe(true);

    // Com conta existente, o convite exige a senha atual (não permite tomar a conta).
    const wrong = await request(http)
      .post('/api/v1/portal/auth/invite/accept')
      .send({ token: second.token, password: 'Outra12345' })
      .expect(403);
    expect(wrong.body.error.code).toBe('ACCOUNT_EXISTS_WRONG_PASSWORD');

    const ok = await request(http)
      .post('/api/v1/portal/auth/invite/accept')
      .send({ token: second.token, password: 'Inquilino1' })
      .expect(201);
    const leases = await request(http).get('/api/v1/portal/leases').set(auth(ok.body.accessToken)).expect(200);
    expect(leases.body).toHaveLength(2);
  });

  it('um inquilino não vê faturas de outro', async () => {
    const a = await setup('84 700 0003');
    const b = await setup('84 700 0004');
    const ta = (await request(http).post('/api/v1/portal/auth/invite/accept').send({ token: a.token, password: 'Inquilino1' }).expect(201)).body.accessToken;
    await request(http).post('/api/v1/portal/auth/invite/accept').send({ token: b.token, password: 'Inquilino1' }).expect(201);

    const bInvoice = await prisma.invoice.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    await request(http).get(`/api/v1/portal/invoices/${bInvoice.id}`).set(auth(ta)).expect(404);
  });

  it('recuperação de senha do portal por SMS', async () => {
    const { token } = await setup('84 700 0005');
    await request(http).post('/api/v1/portal/auth/invite/accept').send({ token, password: 'Inquilino1' }).expect(201);
    await request(http).post('/api/v1/portal/auth/forgot-password').send({ identifier: '+258847000005' }).expect(202);

    const n = await prisma.notification.findFirstOrThrow({
      where: { template: 'TENANT_PASSWORD_RESET', recipient: '+258847000005' },
    });
    expect(n.channel).toBe('SMS');
    const reset = decodeURIComponent(/token=([^\s]+)/.exec(n.body)![1]!);
    await request(http).post('/api/v1/portal/auth/reset-password').send({ token: reset, password: 'NovaSenha9' }).expect(204);
    await request(http).post('/api/v1/portal/auth/login').send({ identifier: '847000005', password: 'NovaSenha9' }).expect(200);
  });
});
