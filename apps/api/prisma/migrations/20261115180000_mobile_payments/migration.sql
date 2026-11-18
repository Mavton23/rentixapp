-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('SIMULATOR', 'MPESA_VODACOM');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "initiatedBy" "SubjectType",
ADD COLUMN     "payerPhone" TEXT,
ADD COLUMN     "providerReference" TEXT;

-- CreateTable
CREATE TABLE "payment_gateway_configs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "methods" "PaymentMethod"[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentialsEncrypted" TEXT,
    "publicInfo" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_configs_organizationId_gateway_key" ON "payment_gateway_configs"("organizationId", "gateway");

-- CreateIndex
CREATE INDEX "payments_status_expiresAt_idx" ON "payments"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organizationId_providerReference_key" ON "payments"("organizationId", "providerReference");

-- AddForeignKey
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
