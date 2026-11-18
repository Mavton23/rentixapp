import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestMeta } from '../../common/auth-context';

export interface AuditEntry extends RequestMeta {
  organizationId?: string | null;
  actorType: 'USER' | 'TENANT' | 'SYSTEM';
  actorId?: string | null;
  /** Ex.: "payment.recorded", "lease.terminated". */
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Registo de auditoria: quem fez o quê, quando, e de onde. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Quando chamado com `tx`, o registo é gravado na mesma transação da operação. */
  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    try {
      await db.auditLog.create({
        data: {
          organizationId: entry.organizationId ?? null,
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata,
          ip: entry.ip,
          userAgent: entry.userAgent,
        },
      });
    } catch (err) {
      if (tx) throw err; // dentro de transação, falhar a auditoria falha a operação
      this.logger.error({ err, action: entry.action }, 'Falha ao gravar auditoria');
    }
  }
}
