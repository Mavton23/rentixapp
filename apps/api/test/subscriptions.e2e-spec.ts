import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { auth, createApp, refreshCookie, registerStaff, toFreePlan, uniquePhone, type StaffSession } from './helpers';

const DAY = 86_400_000;
/** Telemóvel Vodacom que o simulador aceita (terminações 0001/0002/0003 têm outros resultados). */
const mpesaPhone = () => `84${String(Math.floor(1_000_000 + Math.random() * 8_000_000))}`;

describe('Subscrições, faturação da plataforma, administração e convites (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;
  let prisma: PrismaService;
  let subs: SubscriptionsService;
  let admin: string;

  /** Põe a organização num plano pago com um período já a decorrer. */
  async function setPaid(organizationId: string, code: string, opts: { startedDaysAgo: number; lengthDays: number; cycle?: 'MONTHLY' | 'ANNUAL' }) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code } });
    const start = new Date(Date.now() - opts.startedDaysAgo * DAY);
    const cycle = opts.cycle ?? 'MONTHLY';
    await prisma.subscription.update({
      where: { organizationId },
      data: {
        planId: plan.id,
        status: 'ACTIVE',
        billingCycle: cycle,
        currentPeriodStart: start,
        currentPeriodEnd: new Date(start.getTime() + opts.lengthDays * DAY),
        periodValue: cycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice,
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
        pastDueSince: null,
      },
    });
  }

  const billing = (s: StaffSession) => request(http).get('/api/v1/billing').set(auth(s.token)).expect(200).then((r) => r.body);

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    subs = app.get(SubscriptionsService);
    const a = await registerStaff(app);
    await prisma.user.update({ where: { id: a.userId }, data: { platformRole: 'SUPER_ADMIN' } });
    admin = (await request(http).post('/api/v1/auth/login').send({ email: a.email, password: 'Segredo123' }).expect(200)).body.accessToken;
  });
  afterAll(() => app.close());

  describe('Proprietário', () => {
    it('conta nova começa com 30 dias de teste do Profissional', async () => {
      const s = await registerStaff(app);
      const b = await billing(s);
      expect(b.subscription).toMatchObject({ status: 'TRIALING', plan: { code: 'PROFISSIONAL' } });
      const days = (new Date(b.subscription.currentPeriodEnd).getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(29.9);
      expect(b.limits.maxUnits).toBeNull();
      expect(b.paymentOptions.mobileMethods).toEqual(['MPESA', 'EMOLA']);
      expect(b.plans.map((p: { code: string }) => p.code)).toEqual(['FREE', 'ESSENCIAL', 'PROFISSIONAL']);
    });

    it('escolher o plano em teste: fatura, pagamento por M-Pesa, plano ativo e fatura-recibo em PDF', async () => {
      const s = await registerStaff(app);
      const quote = await request(http).get('/api/v1/billing/quote').query({ planCode: 'PROFISSIONAL', billingCycle: 'MONTHLY' }).set(auth(s.token)).expect(200);
      expect(quote.body).toMatchObject({ kind: 'IMMEDIATE', amount: 349_000, credit: 0 });

      const co = await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'PROFISSIONAL', billingCycle: 'MONTHLY' }).expect(201);
      expect(co.body.mode).toBe('IMMEDIATE');
      expect(co.body.invoice.number).toMatch(/^RTX \d{4}\/\d{6}$/);
      const invoiceId = co.body.invoice.id;

      // Telemóvel errado para a carteira
      const bad = await request(http).post(`/api/v1/billing/invoices/${invoiceId}/pay`).set(auth(s.token)).send({ method: 'MPESA', phone: '86 123 4567' }).expect(400);
      expect(bad.body.error.code).toBe('PHONE_WALLET_MISMATCH');
      // Saldo insuficiente (simulador)
      const fail = await request(http).post(`/api/v1/billing/invoices/${invoiceId}/pay`).set(auth(s.token)).send({ method: 'MPESA', phone: '84 000 0001' }).expect(201);
      await subs.drain();
      const failed = await request(http).get(`/api/v1/billing/payments/${fail.body.id}`).set(auth(s.token)).expect(200);
      expect(failed.body.status).toBe('FAILED');
      expect(failed.body.failureReason).toBeTruthy();

      const pay = await request(http).post(`/api/v1/billing/invoices/${invoiceId}/pay`).set(auth(s.token)).send({ method: 'MPESA', phone: mpesaPhone() }).expect(201);
      await subs.drain();
      const ok = await request(http).get(`/api/v1/billing/payments/${pay.body.id}`).set(auth(s.token)).expect(200);
      expect(ok.body.status).toBe('CONFIRMED');

      const b = await billing(s);
      expect(b.subscription).toMatchObject({ status: 'ACTIVE', plan: { code: 'PROFISSIONAL' }, periodValue: 349_000, billingCycle: 'MONTHLY' });
      expect(b.openInvoices).toHaveLength(0);
      const len = (new Date(b.subscription.currentPeriodEnd).getTime() - new Date(b.subscription.currentPeriodStart).getTime()) / DAY;
      expect(len).toBeGreaterThanOrEqual(28);
      expect(len).toBeLessThanOrEqual(31);

      const paidNote = await prisma.notification.findFirst({ where: { organizationId: s.organizationId, template: 'SUBSCRIPTION_PAID' } });
      expect(paidNote?.recipient).toBe(s.email);

      const pdf = await request(http).get(`/api/v1/billing/invoices/${invoiceId}/pdf`).set(auth(s.token)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

      // Pagar outra vez a mesma fatura não é possível
      const again = await request(http).post(`/api/v1/billing/invoices/${invoiceId}/pay`).set(auth(s.token)).send({ method: 'MPESA', phone: mpesaPhone() }).expect(409);
      expect(again.body.error.code).toBe('INVOICE_NOT_OPEN');
    });

    it('subir de plano a meio do período desconta o tempo não usado', async () => {
      const s = await registerStaff(app);
      await setPaid(s.organizationId, 'ESSENCIAL', { startedDaysAgo: 15, lengthDays: 30 });
      const q = await request(http).get('/api/v1/billing/quote').query({ planCode: 'PROFISSIONAL', billingCycle: 'MONTHLY' }).set(auth(s.token)).expect(200);
      expect(q.body.kind).toBe('IMMEDIATE');
      expect(q.body.credit).toBeGreaterThanOrEqual(49_000);
      expect(q.body.credit).toBeLessThanOrEqual(49_500);
      const co = await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'PROFISSIONAL', billingCycle: 'MONTHLY' }).expect(201);
      expect(co.body.invoice.amount).toBe(349_000 - co.body.invoice.credit);
    });

    it('descer de plano fica agendado e pode ser desfeito', async () => {
      const s = await registerStaff(app);
      await setPaid(s.organizationId, 'PROFISSIONAL', { startedDaysAgo: 2, lengthDays: 30 });
      const co = await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'ESSENCIAL', billingCycle: 'MONTHLY' }).expect(201);
      expect(co.body).toEqual({ mode: 'SCHEDULED', invoice: null });
      let b = await billing(s);
      expect(b.subscription).toMatchObject({ plan: { code: 'PROFISSIONAL' }, scheduledPlan: { code: 'ESSENCIAL' } });

      const same = await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'PROFISSIONAL', billingCycle: 'MONTHLY' }).expect(409);
      expect(same.body.error.code).toBe('ALREADY_ON_PLAN');

      await request(http).post('/api/v1/billing/keep-current').set(auth(s.token)).expect(200);
      b = await billing(s);
      expect(b.subscription.scheduledPlan).toBeNull();

      // Passar para o Grátis com período pago: no fim do período
      await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'FREE', billingCycle: 'MONTHLY' }).expect(201);
      b = await billing(s);
      expect(b.subscription).toMatchObject({ plan: { code: 'PROFISSIONAL' }, cancelAtPeriodEnd: true });
    });

    it('só o proprietário muda de plano', async () => {
      const owner = await registerStaff(app);
      const other = await registerStaff(app);
      await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email: other.email, role: 'MANAGER' }).expect(201);
      const login = await request(http).post('/api/v1/auth/login').send({ email: other.email, password: 'Segredo123' }).expect(200);
      const switched = await request(http).post('/api/v1/auth/switch-organization').set(auth(login.body.accessToken)).set('Cookie', refreshCookie(login, 'rtx_rt')).send({ organizationId: owner.organizationId });
      expect(switched.status).toBeLessThan(300);
      const token = switched.body.accessToken as string;
      await request(http).get('/api/v1/billing').set(auth(token)).expect(200);
      const r = await request(http).post('/api/v1/billing/checkout').set(auth(token)).send({ planCode: 'ESSENCIAL', billingCycle: 'MONTHLY' }).expect(403);
      expect(r.body.error.code).toBe('INSUFFICIENT_ROLE');
    });
  });

  describe('Ciclo de vida', () => {
    it('renovação 7 dias antes, atraso no fim, Grátis 7 dias depois (sem apagar nada)', async () => {
      const s = await registerStaff(app);
      await setPaid(s.organizationId, 'PROFISSIONAL', { startedDaysAgo: 25, lengthDays: 30 });
      const sub0 = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: s.organizationId } });
      const end = sub0.currentPeriodEnd!;

      await subs.processOne(s.organizationId, new Date());
      await subs.processOne(s.organizationId, new Date()); // idempotente
      const renewals = await prisma.subscriptionInvoice.findMany({ where: { organizationId: s.organizationId, kind: 'RENEWAL' } });
      expect(renewals).toHaveLength(1);
      expect(renewals[0]!.periodStart?.getTime()).toBe(end.getTime());
      expect(renewals[0]!.amount).toBe(349_000);
      expect(await prisma.notification.count({ where: { organizationId: s.organizationId, template: 'SUBSCRIPTION_INVOICE' } })).toBe(1);

      await subs.processOne(s.organizationId, new Date(end.getTime() + 3_600_000));
      let sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: s.organizationId }, include: { plan: true } });
      expect(sub.status).toBe('PAST_DUE');
      // Em atraso mantém o plano
      expect((await billing(s)).limits.maxUnits).toBeNull();

      await subs.processOne(s.organizationId, new Date(end.getTime() + 8 * DAY));
      sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: s.organizationId }, include: { plan: true } });
      expect(sub.plan.code).toBe('FREE');
      expect(sub.status).toBe('ACTIVE');
      expect(sub.currentPeriodEnd).toBeNull();
      const voided = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: renewals[0]!.id } });
      expect(voided.status).toBe('VOID');
      const note = await prisma.notification.findFirst({ where: { organizationId: s.organizationId, template: 'SUBSCRIPTION_DOWNGRADED', channel: 'EMAIL' } });
      expect(note?.body).toContain('a renovação não foi paga');
    });

    it('renovação paga durante o atraso continua a partir do fim do período anterior', async () => {
      const s = await registerStaff(app);
      await setPaid(s.organizationId, 'ESSENCIAL', { startedDaysAgo: 31, lengthDays: 30 });
      const end = (await prisma.subscription.findUniqueOrThrow({ where: { organizationId: s.organizationId } })).currentPeriodEnd!;
      // O período acabou sem renovação paga: atraso. (A fatura de renovação, normalmente emitida
      // 7 dias antes pelo cron, é criada aqui à mão para testar o pagamento durante o atraso.)
      await subs.processOne(s.organizationId, new Date());
      expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: s.organizationId } })).status).toBe('PAST_DUE');
      const inv = await prisma.subscriptionInvoice.create({
        data: {
          number: `RTX TESTE/${Date.now()}`,
          organizationId: s.organizationId,
          planId: (await prisma.plan.findUniqueOrThrow({ where: { code: 'ESSENCIAL' } })).id,
          billingCycle: 'MONTHLY',
          kind: 'RENEWAL',
          planAmount: 99_000,
          amount: 99_000,
          periodStart: end,
          dueDate: end,
        },
      });
      const pay = await request(http).post(`/api/v1/billing/invoices/${inv.id}/pay`).set(auth(s.token)).send({ method: 'EMOLA', phone: '86 765 4321' }).expect(201);
      await subs.drain();
      expect((await request(http).get(`/api/v1/billing/payments/${pay.body.id}`).set(auth(s.token))).body.status).toBe('CONFIRMED');
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: s.organizationId } });
      expect(sub.status).toBe('ACTIVE');
      expect(sub.currentPeriodStart?.getTime()).toBe(end.getTime());
      expect(sub.pastDueSince).toBeNull();
    });

    it('descida agendada: a renovação já é do plano novo', async () => {
      const s = await registerStaff(app);
      await setPaid(s.organizationId, 'PROFISSIONAL', { startedDaysAgo: 26, lengthDays: 30 });
      await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'ESSENCIAL', billingCycle: 'ANNUAL' }).expect(201);
      const r = await prisma.subscriptionInvoice.findFirstOrThrow({ where: { organizationId: s.organizationId, kind: 'RENEWAL', status: 'OPEN' }, include: { plan: true } });
      expect(r.plan.code).toBe('ESSENCIAL');
      expect(r.billingCycle).toBe('ANNUAL');
      expect(r.amount).toBe(990_000);
    });

    it('teste terminado passa para o Grátis', async () => {
      const s = await registerStaff(app);
      await prisma.subscription.update({ where: { organizationId: s.organizationId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
      // Antes do cron, os limites já são os do Grátis
      expect((await billing(s)).limits.maxUnits).toBe(3);
      await subs.runLifecycle();
      const b = await billing(s);
      expect(b.subscription).toMatchObject({ status: 'ACTIVE', plan: { code: 'FREE' } });
      const note = await prisma.notification.findFirst({ where: { organizationId: s.organizationId, template: 'SUBSCRIPTION_DOWNGRADED' } });
      expect(note?.body).toContain('o período de teste terminou');
    });

    it('aviso de fim do teste é enviado uma vez por marco', async () => {
      const s = await registerStaff(app);
      await prisma.subscription.update({ where: { organizationId: s.organizationId }, data: { currentPeriodEnd: new Date(Date.now() + 5 * DAY) } });
      await subs.processOne(s.organizationId, new Date());
      await subs.processOne(s.organizationId, new Date());
      expect(await prisma.notification.count({ where: { organizationId: s.organizationId, template: 'TRIAL_ENDING' } })).toBe(1);
    });
  });

  describe('Administração da plataforma', () => {
    it('só SUPER_ADMIN', async () => {
      const s = await registerStaff(app);
      await request(http).get('/api/v1/admin/metrics').set(auth(s.token)).expect(403);
      await request(http).get('/api/v1/admin/organizations').set(auth(s.token)).expect(403);
    });

    it('indicadores, pesquisa e detalhe de organizações', async () => {
      const s = await registerStaff(app, { organizationName: `Imobiliária Pesquisa ${uniquePhone()}` });
      await setPaid(s.organizationId, 'ESSENCIAL', { startedDaysAgo: 1, lengthDays: 30 });
      const m = await request(http).get('/api/v1/admin/metrics').set(auth(admin)).expect(200);
      expect(m.body.mrr).toBeGreaterThanOrEqual(99_000);
      expect(m.body.subscriptions.paying).toBeGreaterThanOrEqual(1);

      const list = await request(http).get('/api/v1/admin/organizations').query({ search: s.email }).set(auth(admin)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ id: s.organizationId, plan: { code: 'ESSENCIAL' }, owner: { email: s.email } });

      const d = await request(http).get(`/api/v1/admin/organizations/${s.organizationId}`).set(auth(admin)).expect(200);
      expect(d.body.members).toHaveLength(1);
      expect(d.body.usage).toMatchObject({ units: 0, tenants: 0, members: 1 });
    });

    it('oferecer um plano e registar uma transferência', async () => {
      const s = await registerStaff(app);
      const until = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
      const set = await request(http)
        .put(`/api/v1/admin/organizations/${s.organizationId}/subscription`)
        .set(auth(admin))
        .send({ planCode: 'ESSENCIAL', billingCycle: 'MONTHLY', status: 'ACTIVE', periodEnd: until, reason: 'Parceiro de lançamento' })
        .expect(200);
      expect(set.body.subscription).toMatchObject({ status: 'ACTIVE', plan: { code: 'ESSENCIAL' }, periodValue: 0 });

      // O proprietário escolhe o anual; paga por transferência; a administração regista.
      const co = await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'ESSENCIAL', billingCycle: 'ANNUAL' }).expect(201);
      expect(co.body.invoice).toMatchObject({ amount: 990_000, credit: 0 });
      const paid = await request(http)
        .post(`/api/v1/admin/billing/invoices/${co.body.invoice.id}/mark-paid`)
        .set(auth(admin))
        .send({ method: 'BANK_TRANSFER', reference: 'BCI 12345', paidOn: new Date().toISOString().slice(0, 10) })
        .expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', paymentMethod: 'BANK_TRANSFER', paymentReference: 'BCI 12345' });
      const b = await billing(s);
      expect(b.subscription).toMatchObject({ billingCycle: 'ANNUAL', periodValue: 990_000 });
      await request(http).post(`/api/v1/admin/billing/invoices/${co.body.invoice.id}/mark-paid`).set(auth(admin))
        .send({ method: 'BANK_TRANSFER', reference: 'BCI 12345', paidOn: new Date().toISOString().slice(0, 10) }).expect(409);

      const audit = await prisma.auditLog.findFirst({ where: { organizationId: s.organizationId, action: 'platform.subscription_set' } });
      expect(audit?.metadata).toMatchObject({ reason: 'Parceiro de lançamento', platformAdmin: true });
    });

    it('anular fatura e editar planos (o Grátis fica gratuito)', async () => {
      const s = await registerStaff(app);
      const co = await request(http).post('/api/v1/billing/checkout').set(auth(s.token)).send({ planCode: 'ESSENCIAL', billingCycle: 'MONTHLY' }).expect(201);
      const v = await request(http).post(`/api/v1/admin/billing/invoices/${co.body.invoice.id}/void`).set(auth(admin)).send({ reason: 'Pedido do cliente' }).expect(200);
      expect(v.body.status).toBe('VOID');

      const plans = await request(http).get('/api/v1/admin/plans').set(auth(admin)).expect(200);
      const free = plans.body.find((p: { code: string }) => p.code === 'FREE');
      const r = await request(http).put(`/api/v1/admin/plans/${free.id}`).set(auth(admin))
        .send({ name: 'Grátis', description: null, monthlyPrice: 100, annualPrice: 0, maxUnits: 3, maxTenants: 3, maxMembers: 1, isActive: true }).expect(400);
      expect(r.body.error.code).toBe('FREE_PLAN_LOCKED');
      const ess = plans.body.find((p: { code: string }) => p.code === 'ESSENCIAL');
      await request(http).put(`/api/v1/admin/plans/${ess.id}`).set(auth(admin))
        .send({ name: 'Essencial', description: 'Até 25 unidades', monthlyPrice: 99_000, annualPrice: 990_000, maxUnits: 25, maxTenants: 25, maxMembers: 2, isActive: true }).expect(200);
      await prisma.plan.update({ where: { id: ess.id }, data: { maxUnits: 20, maxTenants: 20 } });
    });

    it('suspender bloqueia a equipa (menos o plano) e reativar devolve o acesso', async () => {
      const s = await registerStaff(app);
      await request(http).post(`/api/v1/admin/organizations/${s.organizationId}/suspend`).set(auth(admin)).send({ reason: 'Fraude com anúncios' }).expect(200);
      const blocked = await request(http).get('/api/v1/properties').set(auth(s.token)).expect(403);
      expect(blocked.body.error.code).toBe('ORGANIZATION_SUSPENDED');
      await request(http).get('/api/v1/billing').set(auth(s.token)).expect(200);
      await request(http).get('/api/v1/organization').set(auth(s.token)).expect(200);
      const login = await request(http).post('/api/v1/auth/login').send({ email: s.email, password: 'Segredo123' }).expect(200);
      expect(login.body.organization.status).toBe('SUSPENDED');

      await request(http).post(`/api/v1/admin/organizations/${s.organizationId}/reactivate`).set(auth(admin)).expect(200);
      await request(http).get('/api/v1/properties').set(auth(s.token)).expect(200);
    });
  });

  describe('Convites para a equipa', () => {
    const inviteToken = async (email: string) => {
      const n = await prisma.notification.findFirstOrThrow({ where: { template: 'MEMBER_INVITE', recipient: email }, orderBy: { createdAt: 'desc' } });
      return decodeURIComponent(/token=([^\s]+)/.exec(n.body)![1]!);
    };

    it('quem não tem conta recebe convite, cria a conta e entra na organização', async () => {
      const owner = await registerStaff(app);
      const email = `novo-${uniquePhone().slice(-7)}@teste.co.mz`;
      const r = await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email, role: 'ACCOUNTANT' }).expect(201);
      expect(r.body.status).toBe('INVITED');
      const pending = await request(http).get('/api/v1/organization/invites').set(auth(owner.token)).expect(200);
      expect(pending.body).toHaveLength(1);

      const token = await inviteToken(email);
      const preview = await request(http).get(`/api/v1/auth/member-invites/${encodeURIComponent(token)}`).expect(200);
      expect(preview.body).toMatchObject({ email, role: 'ACCOUNTANT', hasAccount: false, invitedBy: 'Gestor Teste' });

      const noName = await request(http).post('/api/v1/auth/member-invites/accept').send({ token, password: 'NovaSenha1' }).expect(422);
      expect(noName.body.error.details).toEqual([{ field: 'name', message: 'Indique o seu nome' }]);
      const accepted = await request(http).post('/api/v1/auth/member-invites/accept').send({ token, password: 'NovaSenha1', name: 'Contabilista Nova' }).expect(200);
      expect(accepted.body.organization).toMatchObject({ id: owner.organizationId, role: 'ACCOUNTANT' });
      expect(accepted.headers['set-cookie']?.toString()).toContain('rtx_rt=');

      await request(http).post('/api/v1/auth/member-invites/accept').send({ token, password: 'NovaSenha1', name: 'Outra vez' }).expect(400);
      expect((await request(http).get('/api/v1/organization/invites').set(auth(owner.token))).body).toHaveLength(0);
    });

    it('convite para quem entretanto criou conta exige a senha dessa conta', async () => {
      const owner = await registerStaff(app);
      const email = `depois-${uniquePhone().slice(-7)}@teste.co.mz`;
      await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email, role: 'VIEWER' }).expect(201);
      const token = await inviteToken(email);
      await registerStaff(app, { email });
      const wrong = await request(http).post('/api/v1/auth/member-invites/accept').send({ token, password: 'Errada1234' }).expect(403);
      expect(wrong.body.error.code).toBe('ACCOUNT_EXISTS_WRONG_PASSWORD');
      const ok = await request(http).post('/api/v1/auth/member-invites/accept').send({ token, password: 'Segredo123' }).expect(200);
      expect(ok.body.organization).toMatchObject({ id: owner.organizationId, role: 'VIEWER' });
      expect(ok.body.memberships).toHaveLength(2);
    });

    it('revogar invalida o link; convites pendentes contam para o limite do plano', async () => {
      const owner = await registerStaff(app);
      const email = `revogar-${uniquePhone().slice(-7)}@teste.co.mz`;
      await request(http).post('/api/v1/organization/members').set(auth(owner.token)).send({ email, role: 'MANAGER' }).expect(201);
      const token = await inviteToken(email);
      const [inv] = (await request(http).get('/api/v1/organization/invites').set(auth(owner.token))).body;
      await request(http).delete(`/api/v1/organization/invites/${inv.id}`).set(auth(owner.token)).expect(204);
      await request(http).get(`/api/v1/auth/member-invites/${encodeURIComponent(token)}`).expect(400);

      const free = await registerStaff(app);
      await toFreePlan(app, free.organizationId);
      const r = await request(http).post('/api/v1/organization/members').set(auth(free.token)).send({ email: `x-${email}`, role: 'MANAGER' }).expect(403);
      expect(r.body.error.code).toBe('PLAN_LIMIT_MEMBERS');
    });
  });
});
