import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TTL_MS = 15_000;

/**
 * Estado das organizações (ativa/suspensa) consultado em cada pedido da equipa.
 * Fica em memória 15 s para não ir à base de dados a cada pedido; suspender ou reativar
 * limpa a entrada. Com várias réplicas, a mudança chega às outras em até 15 s.
 */
@Injectable()
export class OrgStatusCache {
  private readonly cache = new Map<string, { suspended: boolean; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async isSuspended(organizationId: string): Promise<boolean> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.suspended;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
    const suspended = org?.status === 'SUSPENDED';
    this.cache.set(organizationId, { suspended, at: Date.now() });
    return suspended;
  }

  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }
}
