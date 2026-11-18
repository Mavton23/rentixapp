import { PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Valida e transforma o input com um schema Zod partilhado (@rentix/shared).
 * Campos desconhecidos são descartados (os schemas são z.object, que remove extras),
 * por isso nunca chega ao Prisma um campo que não foi previsto.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Dados inválidos',
        details: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
