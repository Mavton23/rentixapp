import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, createTenant, registerStaff, type StaffSession } from './helpers';

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Idiomas (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;
  let s: StaffSession;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    s = await registerStaff(app);
  });
  afterAll(() => app.close());

  it('erros no idioma do pedido (cookie, cabeçalho ou Accept-Language); o código não muda', async () => {
    const body = { email: 'ninguem@teste.co.mz', password: 'Errada123' };
    const pt = await request(http).post('/api/v1/auth/login').send(body).expect(401);
    expect(pt.body.error.message).toBe('Email ou senha incorretos');
    const en = await request(http).post('/api/v1/auth/login').set('Cookie', 'rtx_locale=en').send(body).expect(401);
    expect(en.body.error).toMatchObject({ code: pt.body.error.code, message: 'Incorrect email or password' });
    const al = await request(http).post('/api/v1/auth/login').set('Accept-Language', 'en-GB,en;q=0.9').send(body).expect(401);
    expect(al.body.error.message).toBe('Incorrect email or password');

    // Validação: mensagens dos campos, incluindo as que têm valores (padrões).
    const v = await request(http).post('/api/v1/tenants').set(auth(s.token)).set('x-locale', 'en').send({ fullName: '', phone: '123' }).expect(422);
    expect(v.body.error.message).toBe('Invalid data');
    const msgs = Object.fromEntries((v.body.error.details as { field: string; message: string }[]).map((d) => [d.field, d.message]));
    expect(msgs.fullName).toBe('Required');
    expect(msgs.phone).toMatch(/^Invalid phone number/);

    // "X não encontrado(a)"
    const nf = await request(http).get('/api/v1/tenants/00000000-0000-4000-8000-000000000000').set(auth(s.token)).set('Cookie', 'rtx_locale=en').expect(404);
    expect(nf.body.error.message).toBe('Tenant not found');
  });

  it('a conta guarda o idioma e a sessão devolve-o', async () => {
    await request(http).patch('/api/v1/auth/me/locale').set(auth(s.token)).send({ locale: 'fr' }).expect(422);
    await request(http).patch('/api/v1/auth/me/locale').set(auth(s.token)).send({ locale: 'en' }).expect(200);
    const login = await request(http).post('/api/v1/auth/login').send({ email: s.email, password: 'Segredo123' }).expect(200);
    expect(login.body.user.locale).toBe('en');
  });

  it('criar conta em inglês: a organização fica em inglês', async () => {
    const res = await request(http)
      .post('/api/v1/auth/register')
      .set('Accept-Language', 'en-US,en;q=0.9')
      .send({ name: 'Jane Smith', email: `jane-${Date.now()}@teste.co.mz`, phone: '+27821234567', password: 'Segredo123' })
      .expect(201);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: res.body.organization.id } });
    expect(org.locale).toBe('en');
    expect(res.body.user.locale).toBe('en');
    expect(res.body.user.phone).toBe('+27821234567');
    const welcome = await prisma.notification.findFirstOrThrow({ where: { organizationId: org.id, template: 'WELCOME', channel: 'EMAIL' } });
    expect(welcome.subject).toBe('Welcome to Rentix, Jane Smith');
  });

  it('inquilino em inglês: faturas, mensagens, recibo e contrato no idioma dele', async () => {
    const tenantId = await createTenant(app, s.token, { locale: 'en', email: `en-${Date.now()}@teste.co.mz` });
    const prop = await request(http).post('/api/v1/properties').set(auth(s.token)).send({ name: 'Casa Inglesa', type: 'HOUSE', street: 'Rua 1', city: 'Maputo', units: [{ label: 'Casa' }] }).expect(201);
    const lease = await request(http)
      .post('/api/v1/leases')
      .set(auth(s.token))
      .send({ unitId: prop.body.units[0].id, tenantId, startDate: '2026-11-01', rentAmount: 1_550_050, depositAmount: 1_000_000, billingDay: 5 })
      .expect(201);

    const invoices = await prisma.invoice.findMany({ where: { leaseId: lease.body.id }, orderBy: { kind: 'asc' } });
    expect(invoices.map((i) => i.description).sort()).toEqual(['Deposit', 'Rent for November 2026']);
    const rent = invoices.find((i) => i.kind === 'RENT')!;
    const n = await prisma.notification.findFirstOrThrow({ where: { tenantId, template: 'INVOICE_ISSUED', channel: 'EMAIL', subject: { contains: rent.number } } });
    expect(n.subject).toBe(`Invoice ${rent.number} — Rent for November 2026`);
    expect(n.body).toMatch(/MZN\s15,500\.50/);

    const pay = await request(http).post('/api/v1/payments').set(auth(s.token)).send({ invoiceId: rent.id, amount: 1_550_050, method: 'CASH', paidAt: '2026-11-03' }).expect(201);
    const pdf = await request(http).get(`/api/v1/payments/${pay.body.id}/receipt.pdf`).set(auth(s.token)).buffer(true).parse(binary).expect(200);
    expect(pdf.headers['content-disposition']).toContain('receipt-');
    const paid = await prisma.notification.findFirstOrThrow({ where: { tenantId, template: 'PAYMENT_RECEIVED', channel: 'EMAIL' } });
    expect(paid.body).toMatch(/We confirm receipt of MZN\s15,500\.50/);

    // O contrato segue o idioma da organização.
    await request(http).patch('/api/v1/organization').set(auth(s.token)).send({ locale: 'en', country: 'MZ' }).expect(200);
    const tpl = await request(http).get('/api/v1/organization/contract-template').set(auth(s.token)).expect(200);
    expect(tpl.body.defaultTemplate).toContain('# Residential Lease Agreement');
    const c = await request(http).get(`/api/v1/leases/${lease.body.id}/contract.pdf`).set(auth(s.token)).buffer(true).parse(binary).expect(200);
    expect(c.headers['content-disposition']).toContain('lease-');
  });
});
