import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfig } from './config/app-config.service';
import { API_PREFIX } from './modules/auth/token.service';

/** Configuração comum à aplicação real e aos testes e2e. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  if (config.get('TRUST_PROXY')) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED')) {
    const doc = new DocumentBuilder()
      .setTitle('Rentix API')
      .setDescription(
        [
          'API de gestão de arrendamentos.',
          '',
          '**Autenticação:** `POST /auth/login` devolve `accessToken` (válido ~15 min) e coloca o refresh token num cookie httpOnly. Use `Authorization: Bearer <accessToken>` e renove com `POST /auth/refresh`.',
          '',
          '**Valores monetários** são sempre inteiros em centavos (1 500,00 MT = `150000`). **Datas** de calendário no formato `AAAA-MM-DD`.',
          '',
          '**Erros:** `{ "error": { "code", "message", "details?" }, "requestId" }`.',
        ].join('\n'),
      )
      .setVersion('2.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, SwaggerModule.createDocument(app, doc), {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}
