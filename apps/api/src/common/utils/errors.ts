import {
  UnprocessableEntityException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/** Erros de domínio com código estável (o frontend traduz pelo código). */
export const notFound = (what: string, code = 'NOT_FOUND') =>
  new NotFoundException({ code, message: `${what} não encontrado(a)` });

export const conflict = (code: string, message: string, details?: unknown) =>
  new ConflictException({ code, message, details });

export const badRequest = (code: string, message: string, details?: unknown) =>
  new BadRequestException({ code, message, details });

/** Erro de validação de um campo, no mesmo formato do ZodPipe (o frontend assinala o campo). */
export const fieldError = (field: string | null, message: string) =>
  new UnprocessableEntityException({
    code: 'VALIDATION_FAILED',
    message,
    details: field ? [{ field, message }] : [],
  });

export const forbidden = (code: string, message: string) =>
  new ForbiddenException({ code, message });
