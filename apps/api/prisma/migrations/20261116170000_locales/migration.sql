-- Idiomas: utilizadores e inquilinos podem escolher; a organização define o idioma por omissão.
ALTER TABLE "users" ADD COLUMN "locale" TEXT;
ALTER TABLE "tenants" ADD COLUMN "locale" TEXT;
ALTER TABLE "organizations" ALTER COLUMN "locale" SET DEFAULT 'pt';
UPDATE "organizations" SET "locale" = CASE WHEN "locale" ILIKE 'en%' THEN 'en' ELSE 'pt' END;
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("locale" IS NULL OR "locale" IN ('pt', 'en'));
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_locale_check" CHECK ("locale" IS NULL OR "locale" IN ('pt', 'en'));
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_locale_check" CHECK ("locale" IN ('pt', 'en'));
