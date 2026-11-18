import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { auth, createApp, refreshCookie, registerStaff } from './helpers';

describe('Autenticação e segurança (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<NestExpressApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('regista: cria utilizador, organização (OWNER) e devolve cookie httpOnly', async () => {
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({ name: 'Ana', email: 'ana@teste.co.mz', phone: '84 555 0001', password: 'Segredo123', organizationName: 'Imobiliária Ana' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined(); // nunca no corpo
    expect(res.body.organization).toMatchObject({ name: 'Imobiliária Ana', role: 'OWNER' });
    expect(res.body.user.phone).toBe('+258845550001');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('rtx_rt='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('não permite email duplicado', async () => {
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({ name: 'Outra', email: 'ana@teste.co.mz', phone: '84 555 0002', password: 'Segredo123' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('valida o input com erros por campo (422)', async () => {
    const res = await request(http)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'invalido', phone: '123', password: 'curta' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'password']));
  });

  it('login: a mesma mensagem para email inexistente e senha errada', async () => {
    const a = await request(http).post('/api/v1/auth/login').send({ email: 'ana@teste.co.mz', password: 'Errada123' }).expect(401);
    const b = await request(http).post('/api/v1/auth/login').send({ email: 'ninguem@teste.co.mz', password: 'Errada123' }).expect(401);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('refresh roda o token; reutilizar um token antigo revoga todas as sessões', async () => {
    const login = await request(http).post('/api/v1/auth/login').send({ email: 'ana@teste.co.mz', password: 'Segredo123' }).expect(200);
    const first = refreshCookie(login, 'rtx_rt');

    const r1 = await request(http).post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
    const second = refreshCookie(r1, 'rtx_rt');
    expect(second).not.toEqual(first);
    expect(r1.body.accessToken).toBeDefined();

    // Esperar a janela de tolerância seria lento; simulamos reutilização "tardia" mexendo na data.
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const prisma = app.get(PrismaService);
    await prisma.session.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    await request(http).post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    // O token novo também deixou de funcionar (todas as sessões foram revogadas).
    await request(http).post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout invalida o refresh token', async () => {
    const s = await registerStaff(app);
    await request(http).post('/api/v1/auth/logout').set('Cookie', s.cookie).expect(204);
    await request(http).post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
  });

  it('rotas protegidas exigem token; tokens adulterados são rejeitados', async () => {
    await request(http).get('/api/v1/properties').expect(401);
    const s = await registerStaff(app);
    await request(http).get('/api/v1/properties').set(auth(s.token + 'x')).expect(401);
    await request(http).get('/api/v1/properties').set(auth(s.token)).expect(200);
  });

  it('token de equipa não serve no portal do inquilino e vice-versa', async () => {
    const s = await registerStaff(app);
    const res = await request(http).get('/api/v1/portal/summary').set(auth(s.token)).expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');

    const { TokenService } = await import('../src/modules/auth/token.service');
    const tenantToken = await app.get(TokenService).signTenantAccess(s.userId);
    await request(http).get('/api/v1/properties').set(auth(tenantToken)).expect(401);
  });

  it('recuperação de senha: resposta igual exista ou não; token de uso único', async () => {
    const s = await registerStaff(app);
    const a = await request(http).post('/api/v1/auth/forgot-password').send({ email: s.email }).expect(202);
    const b = await request(http).post('/api/v1/auth/forgot-password').send({ email: 'nao-existe@teste.co.mz' }).expect(202);
    expect(a.body).toEqual(b.body);

    const { PrismaService } = await import('../src/prisma/prisma.service');
    const prisma = app.get(PrismaService);
    const n = await prisma.notification.findFirstOrThrow({
      where: { template: 'STAFF_PASSWORD_RESET', recipient: s.email },
    });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(n.body)![1]!);

    await request(http).post('/api/v1/auth/reset-password').send({ token, password: 'NovaSenha123' }).expect(204);
    await request(http).post('/api/v1/auth/reset-password').send({ token, password: 'OutraSenha123' }).expect(403);
    await request(http).post('/api/v1/auth/login').send({ email: s.email, password: 'NovaSenha123' }).expect(200);
    // A sessão anterior foi terminada.
    await request(http).post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
  });

  it('limita tentativas de login (rate limiting)', async () => {
    process.env.RATE_LIMIT_DISABLED = '0';
    try {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        const r = await request(http).post('/api/v1/auth/login').send({ email: 'x@teste.co.mz', password: 'Errada123' });
        codes.push(r.status);
      }
      expect(codes).toContain(429);
    } finally {
      process.env.RATE_LIMIT_DISABLED = '1';
    }
  });

  it('respostas de erro seguem o formato padrão e incluem requestId', async () => {
    const res = await request(http).get('/api/v1/properties').expect(401);
    expect(res.body.error).toEqual({ code: 'UNAUTHENTICATED', message: expect.any(String) });
    expect(res.body.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
