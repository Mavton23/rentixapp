import { Global, Module } from '@nestjs/common';
import { OrgStatusCache } from './common/org-status.cache';
import { CronRunner } from './common/ops/cron-runner.service';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from './config/config.module';
import { AppConfig } from './config/app-config.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthGuard } from './common/guards/auth.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { FeaturesModule } from './modules/features/features';
import { HealthController } from './modules/health/health.controller';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { LeasesModule } from './modules/leases/leases.module';
import { BillingModule } from './modules/billing/billing.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PortalModule } from './modules/portal/portal.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PlansModule } from './modules/plans/plans.module';
import { MobilePaymentsModule } from './modules/mobile-payments/mobile-payments.module';
import { ExtrasModule } from './modules/extras/extras.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { ReportsModule } from './modules/reports/reports.module';
import { FilesModule } from './modules/files/files.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { OpsModule } from './modules/ops/ops.module';

@Global()
@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          genReqId: (req, res) => {
            const id = (req.headers['x-request-id'] as string) || randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Nunca registar tokens, senhas ou cookies.
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
          // A query string pode ter e-mails ou telefones (pesquisas): regista-se só o caminho.
          serializers: {
            req: (req: { id: unknown; method: string; url: string; headers: Record<string, unknown>; remoteAddress?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url.split('?')[0],
              userAgent: req.headers['user-agent'],
              remoteAddress: req.remoteAddress,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/health/ready' },
        },
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      // Só para testes automatizados; nunca definir em produção.
      skipIf: () => process.env.RATE_LIMIT_DISABLED === '1',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    NotificationsModule,
    FeaturesModule,
    AuthModule,
    PlansModule,
    OrganizationsModule,
    PropertiesModule,
    TenantsModule,
    LeasesModule,
    BillingModule,
    PaymentsModule,
    MobilePaymentsModule,
    SubscriptionsModule,
    PlatformAdminModule,
    ReportsModule,
    FilesModule,
    ContractsModule,
    OpsModule,
    PortalModule,
    DashboardModule,
    ExtrasModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: primeiro o limite de pedidos, depois a autenticação.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    OrgStatusCache,
    CronRunner,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [OrgStatusCache, CronRunner],
})
export class AppModule {}
