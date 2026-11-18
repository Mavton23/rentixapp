// Variáveis para os testes e2e. A base de dados de teste é recriada em global-setup.ts.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://rentix:rentix@localhost:5432/rentix_test';
process.env.JWT_STAFF_SECRET = 'test-staff-secret-0123456789abcdef0123456789';
process.env.JWT_TENANT_SECRET = 'test-tenant-secret-0123456789abcdef0123456789';
process.env.CRON_ENABLED = 'false';
process.env.SWAGGER_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
process.env.RATE_LIMIT_DISABLED = '1';
process.env.WEB_URL = 'http://localhost:3000';
process.env.PAYMENT_SIMULATOR_DELAY_MS = '0';
// Todas as funcionalidades extra ligadas nos testes (features-off.e2e-spec.ts testa o contrário).
process.env.FEATURES = 'BLOG,CMS,MARKETPLACE,STATUS_PAGE,TESTIMONIALS';
process.env.CONTACT_INBOX = 'geral@teste.co.mz';
process.env.STORAGE_DIR = '/tmp/rentix-test-storage';
process.env.UPLOAD_MAX_MB = '2';
process.env.OPS_TOKEN = 'token-de-operacoes-0123456789abcdef';
