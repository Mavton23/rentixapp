/**
 * Promove um utilizador existente a administrador da plataforma (SUPER_ADMIN).
 *   pnpm --filter @rentix/api admin:promote -- pessoa@exemplo.co.mz
 * Use --revoke para retirar o acesso.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

async function main() {
  const email = process.argv.slice(2).find((a) => a.includes('@'))?.toLowerCase();
  const revoke = process.argv.includes('--revoke');
  if (!email) {
    console.error('Indique o email: pnpm --filter @rentix/api admin:promote -- pessoa@exemplo.co.mz');
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { platformRole: revoke ? 'USER' : 'SUPER_ADMIN' },
    });
    await prisma.auditLog.create({
      data: { actorType: 'SYSTEM', action: revoke ? 'platform.admin_revoked' : 'platform.admin_granted', entityType: 'user', entityId: user.id },
    });
    console.log(`${user.email}: ${revoke ? 'deixou de ser' : 'agora é'} administrador da plataforma. Entre de novo para atualizar a sessão.`);
  } catch {
    console.error(`Não existe utilizador com o email ${email}.`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
