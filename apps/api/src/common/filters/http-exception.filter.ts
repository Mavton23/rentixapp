import { requestLocale, translator } from '../i18n';
import * as Sentry from '@sentry/nestjs';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Formato único de erro em toda a API:
 * { "error": { "code": "LEASE_UNIT_OCCUPIED", "message": "...", "details": [...] }, "requestId": "..." }
 * Erros inesperados nunca expõem detalhes internos ao cliente.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const { status, body } = this.toResponse(exception);
    // Mensagens no idioma de quem pediu (os códigos não mudam).
    const t = translator(requestLocale(req));
    body.error.message = t(body.error.message);
    if (Array.isArray(body.error.details)) {
      body.error.details = (body.error.details as unknown[]).map((d) =>
        d && typeof d === 'object' && typeof (d as { message?: unknown }).message === 'string'
          ? { ...(d as object), message: t((d as { message: string }).message) }
          : d,
      );
    }
    body.requestId = req.id ? String(req.id) : undefined;

    // 503 NOT_READY é a prontidão a responder (já vigiada pelo monitor externo), não um erro da aplicação.
    const notReady = status === 503 && (body as { error?: { code?: string } }).error?.code === 'NOT_READY';
    if (status >= 500 && !notReady) {
      this.logger.error(
        { err: exception, path: req.path, method: req.method, requestId: body.requestId },
        'Erro não tratado',
      );
      // Só erros inesperados vão para o Sentry (4xx são do utilizador, não da aplicação).
      Sentry.withScope((scope) => {
        const auth = (req as Request & { auth?: { kind: string; userId?: string; organizationId?: string; accountId?: string } }).auth;
        if (body.requestId) scope.setTag('request_id', body.requestId);
        scope.setTag('route', `${req.method} ${(req as Request & { route?: { path?: string } }).route?.path ?? 'desconhecida'}`);
        if (auth?.organizationId) scope.setTag('organization_id', auth.organizationId);
        if (auth?.userId ?? auth?.accountId) scope.setUser({ id: auth.userId ?? auth.accountId });
        Sentry.captureException(exception);
      });
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Erros do multer (envio de ficheiros) vêm em inglês.
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        return { status, body: { error: { code: 'FILE_TOO_LARGE', message: 'O ficheiro é demasiado grande' } } };
      }
      const r = exception.getResponse();
      if (typeof r === 'object' && r !== null) {
        const obj = r as Record<string, unknown>;
        const message = Array.isArray(obj.message)
          ? obj.message.join('; ')
          : String(obj.message ?? exception.message);
        return {
          status,
          body: {
            error: {
              code: String(obj.code ?? DEFAULT_CODES[status] ?? 'ERROR'),
              message,
              ...(obj.details !== undefined ? { details: obj.details } : {}),
            },
          },
        };
      }
      return {
        status,
        body: { error: { code: DEFAULT_CODES[status] ?? 'ERROR', message: String(r) } },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: {
              code: 'DUPLICATE',
              message: 'Já existe um registo com estes dados',
              details: { target: exception.meta?.target },
            },
          },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: { error: { code: 'NOT_FOUND', message: 'Registo não encontrado' } },
        };
      }
      if (exception.code === 'P2003') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: { code: 'IN_USE', message: 'Este registo está associado a outros dados' },
          },
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } },
    };
  }
}
