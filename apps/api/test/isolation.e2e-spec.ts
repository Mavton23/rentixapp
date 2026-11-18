import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { periodOf, todayIn } from '@rentix/shared';
import { auth, createApp, createPropertyWithUnit, createTenant, registerStaff, uniquePhone, toFreePlan } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

/** Garante que uma organização nunca vê nem altera dados de outra. */
describe('Isolamento entre organizações, papéis e limites (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('organização B não acede a imóveis, inquilinos, contratos nem faturas de A', async () => {
    const a = await registerStaff(app);
    const b = await registerStaff(app);
    const { propertyId, unitId } = await createPropertyWithUnit(app, a.token);
    const tenantId = await createTenant(app, a.token);
    const lease = await request(http)
      .post('/api/v1/leases')
      .set(auth(a.token))
      .send({ unitId, tenantId, startDate: `${periodOf(todayIn())}-01`, rentAmount: 1_000_000 })
      .expect(201);
    const invoices = await request(http).get('/api/v1/invoices').set(auth(a.token)).expect(200);
    const invoiceId = invoices.body.data[0].id;

    await request(http).get(`/api/v1/properties/${propertyId}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/api/v1/properties/${propertyId}`).set(auth(b.token)).send({ name: 'Hack' }).expect(404);
    await request(http).get(`/api/v1/tenants/${tenantId}`).set(auth(b.token)).expect(404);
    await request(http).get(`/api/v1/leases/${lease.body.id}`).set(auth(b.token)).expect(404);
    await request(http).get(`/api/v1/invoices/${invoiceId}`).set(auth(b.token)).expect(404);
    await request(http)
      .post('/api/v1/payments')
      .set(auth(b.token))
      .send({ invoiceId, amount: 100, method: 'CASH', paidAt: todayIn() })
      .expect(404);

    // B não pode criar contrato com a unidade/inquilino de A.
    const bTenant = await createTenant(app, b.token);
    await request(http)
      .post('/api/v1/leases')
      .set(auth(b.token))
      .send({ unitId, tenantId: bTenant, startDate: todayIn(), rentAmount: 100 })
      .expect(404);

    // Listagens de B estão vazias de dados de A.
    const list = await request(http).get('/api/v1/properties').set(auth(b.token)).expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('campos extra no corpo são ignorados (sem atribuição em massa)', async () => {
    const a = await registerStaff(app);
    const b = await registerStaff(app);
    const res = await request(http)
      .post('/api/v1/properties')
      .set(auth(a.token))
      .send({
        name: 'Casa',
        type: 'HOUSE',
        street: 'Rua 1',
        city: 'Matola',
        organizationId: b.organizationId,
        archivedAt: '2020-01-01',
      })
      .expect(201);
    expect(res.body.organizationId).toBe(a.organizationId);
    expect(res.body.archivedAt).toBeNull();
  });

  it('papéis: VIEWER só lê; ACCOUNTANT regista pagamentos mas não cria imóveis', async () => {
    const owner = await registerStaff(app);
    const viewer = await registerStaff(app);
    const accountant = await registerStaff(app);
    const prisma = app.get(PrismaService);
    const pro = await prisma.plan.findUniqueOrThrow({ where: { code: 'PROFISSIONAL' } });
    await prisma.subscription.update({ where: { organizationId: owner.organizationId }, data: { planId: pro.id } });

    await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email: viewer.email, role: 'VIEWER' }).expect(201);
    await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email: accountant.email, role: 'ACCOUNTANT' }).expect(201);

    const switchTo = async (s: typeof viewer) =>
      (
        await request(http)
          .post('/api/v1/auth/switch-organization')
          .set(auth(s.token))
          .set('Cookie', s.cookie)
          .send({ organizationId: owner.organizationId })
          .expect(200)
      ).body;

    const v = await switchTo(viewer);
    expect(v.organization.role).toBe('VIEWER');
    await request(http).get('/api/v1/properties').set(auth(v.accessToken)).expect(200);
    const denied = await request(http)
      .post('/api/v1/properties')
      .set(auth(v.accessToken))
      .send({ name: 'X', type: 'HOUSE', street: 'Y', city: 'Z' })
      .expect(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_ROLE');

    const acc = await switchTo(accountant);
    await request(http)
      .post('/api/v1/properties')
      .set(auth(acc.accessToken))
      .send({ name: 'X', type: 'HOUSE', street: 'Y', city: 'Z' })
      .expect(403);
    // Não pertence: não pode mudar para lá
    const stranger = await registerStaff(app);
    await request(http)
      .post('/api/v1/auth/switch-organization')
      .set(auth(stranger.token))
      .set('Cookie', stranger.cookie)
      .send({ organizationId: owner.organizationId })
      .expect(403);
  });

  it('o último proprietário não pode ser removido', async () => {
    const owner = await registerStaff(app);
    const res = await request(http).delete(`/api/v1/organization/members/${owner.userId}`).set(auth(owner.token)).expect(400);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });

  it('plano Grátis: limite de unidades e inquilinos', async () => {
    const s = await registerStaff(app);
    await toFreePlan(app, s.organizationId);
    const res = await request(http)
      .post('/api/v1/properties')
      .set(auth(s.token))
      .send({
        name: 'Prédio',
        type: 'APARTMENT_BUILDING',
        street: 'Rua',
        city: 'Beira',
        units: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
      })
      .expect(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT_UNITS');

    for (let i = 0; i < 3; i++) await createTenant(app, s.token);
    const t = await request(http)
      .post('/api/v1/tenants')
      .set(auth(s.token))
      .send({ fullName: 'Quarto', phone: uniquePhone(), idDocumentType: 'BI', idDocumentNumber: 'BI-QUARTO' })
      .expect(403);
    expect(t.body.error.code).toBe('PLAN_LIMIT_TENANTS');
  });

  it('documento de identificação duplicado na mesma organização dá conflito', async () => {
    const s = await registerStaff(app);
    await createTenant(app, s.token, { idDocumentNumber: 'BI-123' });
    const res = await request(http)
      .post('/api/v1/tenants')
      .set(auth(s.token))
      .send({ fullName: 'Outro', phone: uniquePhone(), idDocumentType: 'BI', idDocumentNumber: 'BI-123' })
      .expect(409);
    expect(res.body.error.code).toBe('TENANT_DUPLICATE_DOCUMENT');
  });
});
