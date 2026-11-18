import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { generateKeyPairSync, randomInt } from 'node:crypto';
import { periodOf, todayIn } from '@rentix/shared';
import { auth, createApp, createPropertyWithUnit, createTenant, registerStaff, StaffSession, upgradePlan } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { MobilePaymentsService } from '../src/modules/mobile-payments/mobile-payments.service';

/** Telemóvel Vodacom com um final escolhido (o simulador decide o resultado pelo final). */
const vodacom = (ending = '') => `+25884${String(randomInt(1_000_000, 9_999_999)).slice(0, 7 - ending.length)}${ending}`;

describe('Pagamentos móveis (e2e, com simulador)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;
  let mobile: MobilePaymentsService;
  let owner: StaffSession;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    mobile = app.get(MobilePaymentsService);
    owner = await registerStaff(app);
    await upgradePlan(app, owner.organizationId);
  });
  afterAll(() => app.close());

  /** Contrato com renda de 20 000,00 MT e inquilino com acesso ao portal. */
  async function setupTenant(phone = vodacom()) {
    const { unitId } = await createPropertyWithUnit(app, owner.token);
    const tenantId = await createTenant(app, owner.token, { phone });
    await request(http)
      .post('/api/v1/leases')
      .set(auth(owner.token))
      .send({ unitId, tenantId, startDate: `${periodOf(todayIn())}-01`, rentAmount: 2_000_000 })
      .expect(201);
    await request(http).post(`/api/v1/tenants/${tenantId}/invite`).set(auth(owner.token)).expect(201);
    const n = await prisma.notification.findFirstOrThrow({ where: { tenantId, template: 'TENANT_INVITE' } });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(n.body)![1]!);
    const accepted = await request(http).post('/api/v1/portal/auth/invite/accept').send({ token, password: 'Inquilino1' }).expect(201);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenantId, kind: 'RENT' } });
    return { tenantId, phone, tenantToken: accepted.body.accessToken as string, invoiceId: invoice.id };
  }

  const pay = (token: string, invoiceId: string, body: Record<string, unknown>) =>
    request(http).post(`/api/v1/portal/invoices/${invoiceId}/pay`).set(auth(token)).send(body);

  it('sem fornecedor ativo, o portal não oferece pagamento online', async () => {
    const t = await setupTenant();
    const inv = await request(http).get(`/api/v1/portal/invoices/${t.invoiceId}`).set(auth(t.tenantToken)).expect(200);
    expect(inv.body.onlineMethods).toEqual([]);
    const res = await pay(t.tenantToken, t.invoiceId, { method: 'MPESA', phone: t.phone }).expect(400);
    expect(res.body.error.code).toBe('METHOD_NOT_AVAILABLE');
  });

  it('o proprietário liga o simulador; métodos aparecem no portal', async () => {
    const res = await request(http)
      .put('/api/v1/payment-gateways/simulator')
      .set(auth(owner.token))
      .send({ enabled: true, methods: ['MPESA', 'EMOLA'] })
      .expect(200);
    expect(res.body.availableMethods.sort()).toEqual(['EMOLA', 'MPESA']);

    const t = await setupTenant();
    const inv = await request(http).get(`/api/v1/portal/invoices/${t.invoiceId}`).set(auth(t.tenantToken)).expect(200);
    expect(inv.body.onlineMethods.sort()).toEqual(['EMOLA', 'MPESA']);
  });

  it('pagamento parcial por M-Pesa: pendente → confirmado, com recibo e fatura atualizada', async () => {
    const t = await setupTenant();
    const started = await pay(t.tenantToken, t.invoiceId, { method: 'MPESA', phone: t.phone, amount: 500_000 }).expect(201);
    expect(started.body.status).toBe('PENDING');

    await mobile.drain();
    const status = await request(http).get(`/api/v1/portal/payments/${started.body.id}/status`).set(auth(t.tenantToken)).expect(200);
    expect(status.body.status).toBe('CONFIRMED');
    expect(status.body.receiptNumber).toMatch(/^RC \d{4}\/\d{6}$/);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: t.invoiceId } });
    expect(invoice).toMatchObject({ paidAmount: 500_000, status: 'PARTIALLY_PAID' });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.body.id } });
    expect(payment).toMatchObject({ provider: 'SIMULATOR', initiatedBy: 'TENANT', payerPhone: t.phone });
    expect(payment.providerTransactionId).toMatch(/^SIM/);
    expect(await prisma.notification.count({ where: { template: 'PAYMENT_RECEIVED', tenantId: t.tenantId } })).toBeGreaterThan(0);
  });

  it('o número tem de ser da carteira escolhida', async () => {
    const t = await setupTenant();
    const res = await pay(t.tenantToken, t.invoiceId, { method: 'EMOLA', phone: t.phone }).expect(400);
    expect(res.body.error.code).toBe('PHONE_WALLET_MISMATCH');
  });

  it('saldo insuficiente: pagamento falha com o motivo e a fatura não muda', async () => {
    const t = await setupTenant();
    const started = await pay(t.tenantToken, t.invoiceId, { method: 'MPESA', phone: vodacom('0001') }).expect(201);
    await mobile.drain();
    const status = await request(http).get(`/api/v1/portal/payments/${started.body.id}/status`).set(auth(t.tenantToken)).expect(200);
    expect(status.body).toMatchObject({ status: 'FAILED', failureReason: 'Saldo insuficiente na carteira' });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: t.invoiceId } })).paidAmount).toBe(0);
  });

  it('sem resposta: não deixa iniciar outro pedido e expira com o varrimento', async () => {
    const t = await setupTenant();
    const started = await pay(t.tenantToken, t.invoiceId, { method: 'MPESA', phone: vodacom('0003') }).expect(201);
    await mobile.drain();
    const again = await pay(t.tenantToken, t.invoiceId, { method: 'MPESA', phone: t.phone }).expect(409);
    expect(again.body.error.code).toBe('PAYMENT_IN_PROGRESS');

    // Logo depois de expirar continua a consultar; passado o período de tolerância, falha.
    await mobile.sweep(new Date(Date.now() + 4 * 60_000));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: started.body.id } })).status).toBe('PENDING');
    await mobile.sweep(new Date(Date.now() + 40 * 60_000));
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: started.body.id } });
    expect(p.status).toBe('FAILED');
    expect(p.failureReason).toContain(p.providerReference!);
  });

  it('a equipa pode pedir o pagamento para o telemóvel do inquilino', async () => {
    const t = await setupTenant();
    const res = await request(http)
      .post('/api/v1/payments/mobile')
      .set(auth(owner.token))
      .send({ invoiceId: t.invoiceId, method: 'MPESA', phone: t.phone })
      .expect(201);
    await mobile.drain();
    const status = await request(http).get(`/api/v1/payments/mobile/${res.body.id}/status`).set(auth(owner.token)).expect(200);
    expect(status.body.status).toBe('CONFIRMED');
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: t.invoiceId } })).status).toBe('PAID');
  });

  it('um inquilino não pode pagar nem ver pagamentos de outro', async () => {
    const a = await setupTenant();
    const b = await setupTenant();
    await pay(a.tenantToken, b.invoiceId, { method: 'MPESA', phone: a.phone }).expect(404);
    const started = await pay(b.tenantToken, b.invoiceId, { method: 'MPESA', phone: b.phone }).expect(201);
    await mobile.drain();
    await request(http).get(`/api/v1/portal/payments/${started.body.id}/status`).set(auth(a.tenantToken)).expect(404);
    await request(http).get(`/api/v1/portal/payments/${started.body.id}/receipt.pdf`).set(auth(a.tenantToken)).expect(404);
  });

  it('recibo em PDF para a equipa e para o inquilino', async () => {
    const t = await setupTenant();
    const started = await pay(t.tenantToken, t.invoiceId, { method: 'MPESA', phone: t.phone }).expect(201);
    await mobile.drain();

    const staff = await request(http)
      .get(`/api/v1/payments/${started.body.id}/receipt.pdf`)
      .set(auth(owner.token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(staff.headers['content-type']).toBe('application/pdf');
    expect(staff.headers['content-disposition']).toMatch(/recibo-RC-\d{4}-\d{6}\.pdf/);
    expect((staff.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await request(http).get(`/api/v1/portal/payments/${started.body.id}/receipt.pdf`).set(auth(t.tenantToken)).expect(200);
  });

  it('credenciais M-Pesa: validadas, cifradas e nunca devolvidas', async () => {
    const missing = await request(http)
      .put('/api/v1/payment-gateways/mpesa')
      .set(auth(owner.token))
      .send({ enabled: true, environment: 'sandbox', serviceProviderCode: '171717' })
      .expect(400);
    expect(missing.body.error.code).toBe('MPESA_CREDENTIALS_MISSING');

    const bad = await request(http)
      .put('/api/v1/payment-gateways/mpesa')
      .set(auth(owner.token))
      .send({ enabled: false, environment: 'sandbox', serviceProviderCode: '171717', apiKey: 'chave-secreta-xyz', publicKey: 'A'.repeat(300) })
      .expect(400);
    expect(bad.body.error.code).toBe('MPESA_PUBLIC_KEY_INVALID');

    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pk = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const ok = await request(http)
      .put('/api/v1/payment-gateways/mpesa')
      .set(auth(owner.token))
      .send({ enabled: false, environment: 'sandbox', serviceProviderCode: '171717', apiKey: 'chave-secreta-xyz', publicKey: pk })
      .expect(200);
    const mpesa = ok.body.gateways.find((g: { gateway: string }) => g.gateway === 'MPESA_VODACOM');
    expect(mpesa).toMatchObject({ hasCredentials: true, publicInfo: { serviceProviderCode: '171717', apiKeyHint: '…-xyz' } });
    expect(JSON.stringify(ok.body)).not.toContain('chave-secreta');

    const row = await prisma.paymentGatewayConfig.findFirstOrThrow({ where: { organizationId: owner.organizationId, gateway: 'MPESA_VODACOM' } });
    expect(row.credentialsEncrypted).not.toContain('chave-secreta');

    // Mudar o código sem reenviar as chaves mantém as chaves.
    const kept = await request(http)
      .put('/api/v1/payment-gateways/mpesa')
      .set(auth(owner.token))
      .send({ enabled: false, environment: 'production', serviceProviderCode: '900900' })
      .expect(200);
    expect(kept.body.gateways.find((g: { gateway: string }) => g.gateway === 'MPESA_VODACOM').hasCredentials).toBe(true);
  });

  it('só o proprietário altera as ligações de pagamento', async () => {
    const other = await registerStaff(app);
    // other é OWNER da sua própria organização; aqui testamos um papel inferior via token sintético.
    const { TokenService } = await import('../src/modules/auth/token.service');
    const managerToken = await app.get(TokenService).signStaffAccess({
      sub: other.userId,
      org: owner.organizationId,
      role: 'MANAGER',
      prole: 'USER',
    });
    await request(http).get('/api/v1/payment-gateways').set(auth(managerToken)).expect(200);
    await request(http)
      .put('/api/v1/payment-gateways/simulator')
      .set(auth(managerToken))
      .send({ enabled: false })
      .expect(403);
  });
});
