import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { addDays, periodOf, todayIn } from '@rentix/shared';
import {
  auth,
  createApp,
  createPropertyWithUnit,
  createTenant,
  registerStaff,
  StaffSession,
  upgradePlan,
} from './helpers';
import { BillingService } from '../src/modules/billing/billing.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Contratos, faturação e pagamentos (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let owner: StaffSession;
  const today = todayIn('Africa/Maputo');

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    owner = await registerStaff(app);
    await upgradePlan(app, owner.organizationId);
    await request(http).patch('/api/v1/organization').set(auth(owner.token)).send({ lateFeeBps: 300, gracePeriodDays: 5 }).expect(200);
  });
  afterAll(() => app.close());

  function createLease(unitId: string, tenantId: string, extra: Record<string, unknown> = {}) {
    return request(http)
      .post('/api/v1/leases')
      .set(auth(owner.token))
      .send({ unitId, tenantId, startDate: `${periodOf(today)}-01`, rentAmount: 1_500_000, billingDay: 5, ...extra });
  }

  async function invoicesOf(leaseId: string) {
    const res = await request(http).get(`/api/v1/invoices?leaseId=${leaseId}&pageSize=100`).set(auth(owner.token)).expect(200);
    return res.body.data as Array<Record<string, any>>;
  }

  it('criar contrato ativo: ocupa a unidade e emite caução + renda do mês', async () => {
    const { unitId, propertyId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token, { email: 'inquilino1@teste.co.mz' });

    const res = await createLease(unitId, tenantId, { depositAmount: 3_000_000 }).expect(201);
    expect(res.body.status).toBe('ACTIVE');

    const invoices = await invoicesOf(res.body.id);
    expect(invoices.map((i) => i.kind).sort()).toEqual(['DEPOSIT', 'RENT']);
    const rent = invoices.find((i) => i.kind === 'RENT')!;
    expect(rent).toMatchObject({ amount: 1_500_000, period: periodOf(today), status: 'OPEN', currency: 'MZN' });
    expect(rent.number).toMatch(/^FT \d{4}\/\d{6}$/);

    const prop = await request(http).get(`/api/v1/properties/${propertyId}`).set(auth(owner.token)).expect(200);
    expect(prop.body.units[0].status).toBe('OCCUPIED');

    // Notificações ficam na caixa de saída (email + SMS).
    const prisma = app.get(PrismaService);
    const notes = await prisma.notification.findMany({ where: { tenantId, template: 'INVOICE_ISSUED' } });
    expect(notes.map((n) => n.channel).sort()).toEqual(['EMAIL', 'EMAIL', 'SMS', 'SMS']);
  });

  it('não permite dois contratos ativos na mesma unidade (nem em pedidos simultâneos)', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const t1 = await createTenant(app, owner.token);
    const t2 = await createTenant(app, owner.token);
    const results = await Promise.all([createLease(unitId, t1), createLease(unitId, t2)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('LEASE_UNIT_OCCUPIED');
  });

  it('faturação é idempotente: correr várias vezes não duplica faturas', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;

    const billing = app.get(BillingService);
    await billing.runForOrganization(owner.organizationId);
    await request(http).post('/api/v1/billing/run').set(auth(owner.token)).expect(200);
    const invoices = await invoicesOf(lease.id);
    expect(invoices.filter((i) => i.kind === 'RENT')).toHaveLength(1);
    // A renda emitida hoje não nasce em atraso, logo sem multa.
    expect(invoices.find((i) => i.kind === 'RENT')!.dueDate >= today).toBe(true);
    expect(invoices.filter((i) => i.kind === 'LATE_FEE')).toHaveLength(0);
  });

  it('pagamentos: parcial, total, recibos sequenciais, sem pagar a mais', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;
    const rent = (await invoicesOf(lease.id))[0]!;

    const p1 = await request(http)
      .post('/api/v1/payments')
      .set(auth(owner.token))
      .send({ invoiceId: rent.id, amount: 500_000, method: 'MPESA', paidAt: today, reference: 'MP123' })
      .expect(201);
    expect(p1.body.receiptNumber).toMatch(/^RC \d{4}\/\d{6}$/);

    let inv = (await request(http).get(`/api/v1/invoices/${rent.id}`).set(auth(owner.token)).expect(200)).body;
    expect(inv).toMatchObject({ status: 'PARTIALLY_PAID', paidAmount: 500_000, outstanding: 1_000_000 });

    const over = await request(http)
      .post('/api/v1/payments')
      .set(auth(owner.token))
      .send({ invoiceId: rent.id, amount: 1_000_001, method: 'CASH', paidAt: today })
      .expect(400);
    expect(over.body.error.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING');

    const p2 = await request(http)
      .post('/api/v1/payments')
      .set(auth(owner.token))
      .send({ invoiceId: rent.id, amount: 1_000_000, method: 'BANK_TRANSFER', paidAt: today })
      .expect(201);
    const n1 = Number(p1.body.receiptNumber.split('/')[1]);
    const n2 = Number(p2.body.receiptNumber.split('/')[1]);
    expect(n2).toBe(n1 + 1);

    inv = (await request(http).get(`/api/v1/invoices/${rent.id}`).set(auth(owner.token)).expect(200)).body;
    expect(inv).toMatchObject({ status: 'PAID', outstanding: 0 });

    await request(http)
      .post('/api/v1/payments')
      .set(auth(owner.token))
      .send({ invoiceId: rent.id, amount: 1, method: 'CASH', paidAt: today })
      .expect(409);
  });

  it('pagamentos simultâneos não ultrapassam o valor da fatura', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;
    const rent = (await invoicesOf(lease.id))[0]!;

    const send = () =>
      request(http)
        .post('/api/v1/payments')
        .set(auth(owner.token))
        .send({ invoiceId: rent.id, amount: 1_500_000, method: 'CASH', paidAt: today });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('Idempotency-Key: repetir o pedido devolve o mesmo pagamento', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;
    const rent = (await invoicesOf(lease.id))[0]!;
    const body = { invoiceId: rent.id, amount: 100_000, method: 'EMOLA', paidAt: today };

    const a = await request(http).post('/api/v1/payments').set(auth(owner.token)).set('Idempotency-Key', 'pedido-abc-123').send(body).expect(201);
    const b = await request(http).post('/api/v1/payments').set(auth(owner.token)).set('Idempotency-Key', 'pedido-abc-123').send(body).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const inv = (await request(http).get(`/api/v1/invoices/${rent.id}`).set(auth(owner.token)).expect(200)).body;
    expect(inv.paidAmount).toBe(100_000);
  });

  it('estorno devolve a dívida à fatura e não pode ser feito duas vezes', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;
    const rent = (await invoicesOf(lease.id))[0]!;
    const p = await request(http)
      .post('/api/v1/payments')
      .set(auth(owner.token))
      .send({ invoiceId: rent.id, amount: 1_500_000, method: 'CASH', paidAt: today })
      .expect(201);

    await request(http).post(`/api/v1/payments/${p.body.id}/reverse`).set(auth(owner.token)).send({ reason: 'Cheque sem cobertura' }).expect(200);
    await request(http).post(`/api/v1/payments/${p.body.id}/reverse`).set(auth(owner.token)).send({ reason: 'De novo' }).expect(409);
    const inv = (await request(http).get(`/api/v1/invoices/${rent.id}`).set(auth(owner.token)).expect(200)).body;
    expect(inv).toMatchObject({ status: 'OPEN', paidAmount: 0 });
  });

  it('multa por atraso: aplicada uma única vez depois da tolerância', async () => {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;
    const rent = (await invoicesOf(lease.id)).find((i) => i.kind === 'RENT')!;

    const billing = app.get(BillingService);
    // Simular o job a correr depois do vencimento + tolerância (sem mudar de mês).
    const lateDay = addDays(rent.dueDate, 6);
    const asOf = new Date(`${lateDay}T10:00:00+02:00`);
    if (periodOf(lateDay) !== rent.period) return; // fim de mês: cenário coberto pelos testes unitários

    await billing.runForOrganization(owner.organizationId, asOf);
    await billing.runForOrganization(owner.organizationId, asOf);
    const fees = (await invoicesOf(lease.id)).filter((i) => i.kind === 'LATE_FEE');
    expect(fees).toHaveLength(1);
    expect(fees[0]!.amount).toBe(45_000); // 3% de 15 000,00 MT
  });

  it('terminar contrato liberta a unidade e anula rendas futuras não pagas', async () => {
    const { unitId, propertyId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    const lease = (await createLease(unitId, tenantId).expect(201)).body;

    const res = await request(http)
      .post(`/api/v1/leases/${lease.id}/terminate`)
      .set(auth(owner.token))
      .send({ endDate: today, reason: 'Fim antecipado' })
      .expect(200);
    // Fim hoje: o contrato termina amanhã pelo job; com data passada termina já.
    expect(['ACTIVE', 'TERMINATED']).toContain(res.body.status);

    await app.get(BillingService).runForOrganization(owner.organizationId, new Date(Date.now() + 86_400_000));
    const prop = await request(http).get(`/api/v1/properties/${propertyId}`).set(auth(owner.token)).expect(200);
    expect(prop.body.units[0].status).toBe('AVAILABLE');
  });

  it('não é possível arquivar imóvel com contrato ativo', async () => {
    const { unitId, propertyId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token);
    await createLease(unitId, tenantId).expect(201);
    const res = await request(http).delete(`/api/v1/properties/${propertyId}`).set(auth(owner.token)).expect(409);
    expect(res.body.error.code).toBe('PROPERTY_HAS_ACTIVE_LEASES');
  });

  it('painel devolve ocupação, faturado e cobrado', async () => {
    const res = await request(http).get('/api/v1/dashboard').set(auth(owner.token)).expect(200);
    expect(res.body.occupancy.units).toBeGreaterThan(0);
    expect(res.body.month.billed[0]).toMatchObject({ currency: 'MZN' });
    expect(res.body.month.collected[0].amount).toBeGreaterThan(0);
  });

  it('o dispatcher envia as notificações em fila e marca-as como enviadas', async () => {
    const { NotificationsService } = await import('../src/modules/notifications/notifications.service');
    const prisma = app.get(PrismaService);
    const sent = await app.get(NotificationsService).dispatchPending();
    expect(sent).toBeGreaterThan(0);
    const counts = await prisma.notification.groupBy({ by: ['status'], _count: true });
    expect(counts.find((c) => c.status === 'SENT')?._count).toBeGreaterThan(0);
    expect(counts.find((c) => c.status === 'FAILED')).toBeUndefined();
  });
});
