import { z } from 'zod';
import { FEATURE_FLAGS, type FeatureFlag } from '@rentix/shared';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * Todas as variáveis de ambiente são validadas no arranque.
 * Se faltar algo obrigatório, a API recusa-se a iniciar (melhor do que falhar em produção).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().url(),

    /** URL pública do frontend (links nos emails: convites, recuperação de senha). */
    WEB_URL: z.string().url().default('http://localhost:3000'),
    /** Origens permitidas para CORS (separadas por vírgula). Por omissão, WEB_URL. */
    CORS_ORIGINS: csv,

    JWT_STAFF_SECRET: z.string().min(32, 'JWT_STAFF_SECRET deve ter pelo menos 32 caracteres'),
    JWT_TENANT_SECRET: z.string().min(32, 'JWT_TENANT_SECRET deve ter pelo menos 32 caracteres'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: bool(false),

    /** Chave da API do Resend (re_...). Sem ela, os emails são apenas escritos no log. */
    RESEND_API_KEY: z.string().optional(),
    /** Remetente; o domínio tem de estar verificado no Resend. */
    MAIL_FROM: z.string().default('Rentix <no-reply@rentix.co.mz>'),
    /** Caixa que recebe as mensagens do formulário de contacto do site (CMS). */
    CONTACT_INBOX: z.string().email().optional(),

    /** SMS/WhatsApp: "log" (só escreve no log) ou "twilio". */
    SMS_PROVIDER: z.enum(['log', 'twilio']).default('log'),
    WHATSAPP_PROVIDER: z.enum(['log', 'twilio']).default('log'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    /** Número ou Messaging Service SID de envio de SMS. */
    TWILIO_SMS_FROM: z.string().optional(),
    /** Ex.: whatsapp:+14155238886 */
    TWILIO_WHATSAPP_FROM: z.string().optional(),

    /** Chave (32 bytes em base64) para cifrar as credenciais de pagamento das organizações. */
    PAYMENT_CREDENTIALS_KEY: z.string().min(32).optional(),
    /** Simulador de M-Pesa/e-Mola. Por omissão: ligado fora de produção. */
    PAYMENT_SIMULATOR_ALLOWED: z.enum(['true', 'false', '1', '0']).optional(),
    PAYMENT_SIMULATOR_DELAY_MS: z.coerce.number().int().min(0).default(4000),
    /** Tempo para o cliente confirmar no telemóvel antes de o pedido expirar. */
    MOBILE_PAYMENT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).default(180),

    // ---------- Operações ----------
    /** Ligação direta (sem pool) para migrações e backups. No Neon: o endereço sem "-pooler". */
    DIRECT_DATABASE_URL: z.string().optional(),
    /** Chave para os scripts de backup registarem resultados (POST /internal/ops-events). */
    OPS_TOKEN: z.string().min(24).optional(),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

    // ---------- Ficheiros ----------
    /** local: pasta no disco (desenvolvimento ou um só servidor). s3: qualquer serviço compatível com S3. */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_DIR: z.string().default('./storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    /** Para Cloudflare R2, DigitalOcean Spaces, MinIO... (vazio = AWS). */
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(50).default(10),

    // ---------- Plataforma: cobrança das subscrições ----------
    /** Para onde vão os pagamentos das subscrições. Por omissão: simulador fora de produção, nenhum em produção. */
    PLATFORM_PAYMENT_GATEWAY: z.enum(['none', 'simulator', 'mpesa']).optional(),
    PLATFORM_MPESA_API_KEY: z.string().optional(),
    PLATFORM_MPESA_PUBLIC_KEY: z.string().optional(),
    PLATFORM_MPESA_SERVICE_PROVIDER_CODE: z.string().optional(),
    PLATFORM_MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    /** Dados para transferência bancária, uma linha por "|" (ex.: "BCI|NIB 0008 0000 ...|Titular: Rentix Lda"). */
    PLATFORM_BANK_DETAILS: z.string().optional(),
    PLATFORM_COMPANY_NAME: z.string().default('Rentix'),
    PLATFORM_COMPANY_NUIT: z.string().optional(),
    PLATFORM_COMPANY_ADDRESS: z.string().optional(),
    PLATFORM_BILLING_EMAIL: z.string().email().optional(),
    /** Plano do período de teste das contas novas (vazio = começam no Grátis). */
    TRIAL_PLAN_CODE: z.string().default('PROFISSIONAL'),
    TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(30),

    /** Funcionalidades extra ligadas (ex.: "BLOG,MARKETPLACE"). Vazio = só o produto principal. */
    FEATURES: csv.pipe(z.array(z.enum(FEATURE_FLAGS))),

    SWAGGER_ENABLED: bool(true),
    /** Desligar em réplicas extra para os jobs agendados correrem num só processo. */
    CRON_ENABLED: bool(true),
    TRUST_PROXY: bool(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.PAYMENT_CREDENTIALS_KEY) {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_CREDENTIALS_KEY'], message: 'Obrigatório em produção' });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'Obrigatório com STORAGE_DRIVER=s3' });
      }
    }
    if (env.PLATFORM_PAYMENT_GATEWAY === 'mpesa') {
      for (const k of ['PLATFORM_MPESA_API_KEY', 'PLATFORM_MPESA_PUBLIC_KEY', 'PLATFORM_MPESA_SERVICE_PROVIDER_CODE'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'Obrigatório com PLATFORM_PAYMENT_GATEWAY=mpesa' });
      }
    }
    const twilio = env.SMS_PROVIDER === 'twilio' || env.WHATSAPP_PROVIDER === 'twilio';
    if (twilio && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)) {
      ctx.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: 'Credenciais Twilio em falta' });
    }
  })
  .transform((env) => ({
    ...env,
    CORS_ORIGINS: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : [env.WEB_URL],
    PAYMENT_SIMULATOR_ALLOWED:
      env.PAYMENT_SIMULATOR_ALLOWED === undefined
        ? env.NODE_ENV !== 'production'
        : env.PAYMENT_SIMULATOR_ALLOWED === 'true' || env.PAYMENT_SIMULATOR_ALLOWED === '1',
    PLATFORM_PAYMENT_GATEWAY:
      env.PLATFORM_PAYMENT_GATEWAY ??
      ((env.PAYMENT_SIMULATOR_ALLOWED === undefined ? env.NODE_ENV !== 'production' : env.PAYMENT_SIMULATOR_ALLOWED === 'true' || env.PAYMENT_SIMULATOR_ALLOWED === '1')
        ? ('simulator' as const)
        : ('none' as const)),
    PLATFORM_BANK_DETAILS: env.PLATFORM_BANK_DETAILS ? env.PLATFORM_BANK_DETAILS.split('|').map((l) => l.trim()).filter(Boolean) : [],
    // Em desenvolvimento, sem chave definida, deriva-se uma do segredo JWT (nunca em produção).
    PAYMENT_CREDENTIALS_KEY: env.PAYMENT_CREDENTIALS_KEY ?? `dev-only:${env.JWT_STAFF_SECRET}`,
  }));

export type Env = z.infer<typeof envSchema>;
export type { FeatureFlag };

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida (.env):\n${issues}`);
  }
  return parsed.data;
}
