import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}

export type Api = ReturnType<typeof request>;

export interface StaffSession {
  token: string;
  cookie: string;
  userId: string;
  organizationId: string;
  email: string;
}

/** Telefone móvel moçambicano válido (aleatório). */
export function uniquePhone(): string {
  return `+25884${randomInt(1_000_000, 9_999_999)}`;
}

export function refreshCookie(res: request.Response, name: string): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith(`${name}=`));
  if (!c) throw new Error(`Cookie ${name} em falta`);
  return c.split(';')[0]!;
}

export async function registerStaff(app: NestExpressApplication, overrides: Record<string, unknown> = {}): Promise<StaffSession> {
  const email = `user-${randomUUID().slice(0, 8)}@teste.co.mz`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ name: 'Gestor Teste', email, phone: uniquePhone(), password: 'Segredo123', ...overrides })
    .expect(201);
  return {
    token: res.body.accessToken,
    cookie: refreshCookie(res, 'rtx_rt'),
    userId: res.body.user.id,
    organizationId: res.body.organization.id,
    email,
  };
}

/** Promove a organização ao plano sem limites (para testes que criam muitas unidades). */
export async function upgradePlan(app: NestExpressApplication, organizationId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PROFISSIONAL' } });
  await prisma.subscription.update({ where: { organizationId }, data: { planId: plan.id, status: 'ACTIVE' } });
}

/** Põe a organização no plano Grátis (as contas novas começam em teste do Profissional). */
export async function toFreePlan(app: NestExpressApplication, organizationId: string): Promise<void> {
  const prisma = app.get(PrismaService);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
  await prisma.subscription.update({
    where: { organizationId },
    data: { planId: plan.id, status: 'ACTIVE', currentPeriodStart: null, currentPeriodEnd: null, periodValue: 0 },
  });
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function createPropertyWithUnit(app: NestExpressApplication, token: string, label = 'Flat 1') {
  const res = await request(app.getHttpServer())
    .post('/api/v1/properties')
    .set(auth(token))
    .send({
      name: `Prédio ${randomUUID().slice(0, 4)}`,
      type: 'APARTMENT_BUILDING',
      street: 'Av. 24 de Julho, 100',
      city: 'Maputo',
      units: [{ label, rentAmount: 1_500_000 }],
    })
    .expect(201);
  return { propertyId: res.body.id as string, unitId: res.body.units[0].id as string };
}

export async function createTenant(app: NestExpressApplication, token: string, extra: Record<string, unknown> = {}) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/tenants')
    .set(auth(token))
    .send({
      fullName: 'Inquilino Teste',
      phone: uniquePhone(),
      idDocumentType: 'BI',
      idDocumentNumber: `BI${randomUUID().slice(0, 10)}`,
      ...extra,
    })
    .expect(201);
  return res.body.id as string;
}
