// O Sentry tem de ser carregado antes de tudo o resto.
import './instrument';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';
import { configureApp } from './bootstrap';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(AppConfig);
  const port = config.get('PORT');
  await app.listen(port);
  app.get(Logger).log(`Rentix API a correr em http://localhost:${port}/api/v1 (docs: /api/v1/docs)`);
}

void main();
