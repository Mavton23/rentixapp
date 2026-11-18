/**
 * Seed: planos base e, opcionalmente, dados de demonstração.
 *   pnpm db:seed            -> só planos
 *   pnpm db:seed -- --demo  -> planos + conta demo (demo@rentix.co.mz / Demo12345)
 *
 * ATENÇÃO: os preços dos planos são provisórios — ajuste-os antes de ir para produção.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const PLANS = [
  {
    code: 'FREE',
    name: 'Grátis',
    description: 'Para quem está a começar: até 3 unidades.',
    monthlyPrice: 0,
    annualPrice: 0,
    maxUnits: 3,
    maxTenants: 3,
    maxMembers: 1,
    sortOrder: 0,
    features: { portal: true, sms: false, reports: false },
  },
  {
    code: 'ESSENCIAL',
    name: 'Essencial',
    description: 'Até 20 unidades, lembretes por SMS e portal do inquilino.',
    monthlyPrice: 99_000, // 990,00 MT (provisório)
    annualPrice: 990_000,
    maxUnits: 20,
    maxTenants: 20,
    maxMembers: 2,
    sortOrder: 1,
    features: { portal: true, sms: true, reports: true },
  },
  {
    code: 'PROFISSIONAL',
    name: 'Profissional',
    description: 'Imobiliárias: unidades ilimitadas e equipa com papéis.',
    monthlyPrice: 349_000, // 3 490,00 MT (provisório)
    annualPrice: 3_490_000,
    maxUnits: null,
    maxTenants: null,
    maxMembers: 10,
    sortOrder: 2,
    features: { portal: true, sms: true, reports: true, multiUser: true },
  },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, update: plan, create: plan });
  }
  console.log(`Planos: ${PLANS.map((p) => p.code).join(', ')}`);

  if (process.argv.includes('--demo')) await seedDemo();
}

async function seedDemo() {
  const email = 'demo@rentix.co.mz';
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log('Conta demo já existe.');
    return;
  }
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PROFISSIONAL' } });
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: 'Conta Demo',
      email,
      phone: '+258840000000',
      passwordHash: await bcrypt.hash('Demo12345', 12),
      memberships: {
        create: {
          role: 'OWNER',
          organization: {
            create: {
              name: 'Imobiliária Demo',
              slug: 'imobiliaria-demo',
              city: 'Maputo',
              province: 'Maputo Cidade',
              lateFeeBps: 300,
              subscription: {
                create: {
                  planId: plan.id,
                  status: 'TRIALING',
                  currentPeriodStart: now,
                  currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
                },
              },
            },
          },
        },
      },
    },
    include: { memberships: true },
  });
  const orgId = user.memberships[0]!.organizationId;

  await prisma.property.create({
    data: {
      organizationId: orgId,
      name: 'Edifício Polana',
      type: 'APARTMENT_BUILDING',
      street: 'Av. Julius Nyerere, 1200',
      neighbourhood: 'Polana Cimento',
      city: 'Maputo',
      province: 'Maputo Cidade',
      units: {
        create: [
          { organizationId: orgId, label: 'Flat 1A', bedrooms: 2, bathrooms: 1, rentAmount: 2_500_000 },
          { organizationId: orgId, label: 'Flat 1B', bedrooms: 3, bathrooms: 2, rentAmount: 3_500_000 },
          { organizationId: orgId, label: 'Loja R/C', rentAmount: 6_000_000 },
        ],
      },
    },
  });
  await prisma.tenant.create({
    data: {
      organizationId: orgId,
      fullName: 'Ana Machava',
      phone: '+258841234567',
      email: 'ana.machava@example.com',
      idDocumentType: 'BI',
      idDocumentNumber: '110100123456A',
    },
  });
  console.log(`Demo criada: ${email} / Demo12345 (crie um contrato para ver a faturação).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
