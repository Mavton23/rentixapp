-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceKind" AS ENUM ('CHANGE', 'RENEWAL');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pastDueSince" TIMESTAMP(3),
ADD COLUMN     "periodValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledCycle" "BillingCycle",
ADD COLUMN     "scheduledPlanId" UUID,
ALTER COLUMN "currentPeriodStart" DROP NOT NULL,
ALTER COLUMN "currentPeriodEnd" DROP NOT NULL;

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "kind" "SubscriptionInvoiceKind" NOT NULL,
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "planAmount" INTEGER NOT NULL,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MZN',
    "periodStart" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "gateway" "PaymentGateway" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "payerPhone" TEXT NOT NULL,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "initiatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "member_invites" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_number_key" ON "subscription_invoices"("number");

-- CreateIndex
CREATE INDEX "subscription_invoices_organizationId_createdAt_idx" ON "subscription_invoices"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_invoices_status_dueDate_idx" ON "subscription_invoices"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_providerReference_key" ON "subscription_payments"("providerReference");

-- CreateIndex
CREATE INDEX "subscription_payments_invoiceId_idx" ON "subscription_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "subscription_payments_status_expiresAt_idx" ON "subscription_payments"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_invites_tokenHash_key" ON "member_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "member_invites_organizationId_idx" ON "member_invites"("organizationId");

-- CreateIndex
CREATE INDEX "member_invites_email_idx" ON "member_invites"("email");

-- CreateIndex
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "subscriptions"("status", "currentPeriodEnd");

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduledPlanId_fkey" FOREIGN KEY ("scheduledPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Valores nunca negativos; o crédito não pode exceder o preço.
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_amounts_check"
  CHECK ("planAmount" >= 0 AND "credit" >= 0 AND "credit" <= "planAmount" AND "amount" = "planAmount" - "credit");
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_amount_check" CHECK ("amount" > 0);

-- No máximo uma renovação por período que não esteja anulada (o cron pode correr em paralelo).
CREATE UNIQUE INDEX "subscription_invoices_one_renewal_per_period"
  ON "subscription_invoices" ("organizationId", "periodStart")
  WHERE "kind" = 'RENEWAL' AND "status" <> 'VOID';

-- Um só convite pendente por organização e email.
CREATE UNIQUE INDEX "member_invites_one_pending"
  ON "member_invites" ("organizationId", lower("email"))
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

-- Organizações já existentes sem subscrição passam a ter o plano Grátis.
INSERT INTO "subscriptions" ("id", "organizationId", "planId", "status", "billingCycle", "updatedAt")
SELECT gen_random_uuid(), o."id", p."id", 'ACTIVE', 'MONTHLY', now()
FROM "organizations" o CROSS JOIN "plans" p
WHERE p."code" = 'FREE' AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."organizationId" = o."id");

-- Testes sobre o plano Grátis (modelo antigo) ficam simplesmente no Grátis.
UPDATE "subscriptions" s SET "status" = 'ACTIVE', "currentPeriodStart" = NULL, "currentPeriodEnd" = NULL
FROM "plans" p WHERE s."planId" = p."id" AND p."code" = 'FREE';
