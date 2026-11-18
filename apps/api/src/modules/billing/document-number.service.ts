import { Injectable } from '@nestjs/common';
import type { Tx } from '../../prisma/prisma.service';

export type DocumentSeries = 'FT' | 'RC';

/**
 * Numeração sequencial e sem buracos por organização, série e ano:
 * "FT 2026/000001" (faturas), "RC 2026/000001" (recibos).
 * O incremento é atómico (INSERT ... ON CONFLICT ... RETURNING) e acontece dentro da
 * transação do documento: se a transação falhar, o número não é consumido.
 */
@Injectable()
export class DocumentNumberService {
  async next(tx: Tx, organizationId: string, series: DocumentSeries, year: number): Promise<string> {
    const key = `${series}:${year}`;
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO document_counters ("organizationId", key, value)
      VALUES (${organizationId}::uuid, ${key}, 1)
      ON CONFLICT ("organizationId", key)
      DO UPDATE SET value = document_counters.value + 1
      RETURNING value`;
    const value = rows[0]!.value;
    return `${series} ${year}/${String(value).padStart(6, '0')}`;
  }
}
