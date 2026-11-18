-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "maxStorageMb" INTEGER;

-- CreateTable
CREATE TABLE "cron_jobs" (
    "name" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastDurationMs" INTEGER,
    "lastResult" JSONB,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_jobs_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ops_events" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ops_events_kind_createdAt_idx" ON "ops_events"("kind", "createdAt");

-- Limites de armazenamento dos planos base (MB). Ajustáveis em /admin/planos.
UPDATE "plans" SET "maxStorageMb" = 200 WHERE "code" = 'FREE' AND "maxStorageMb" IS NULL;
UPDATE "plans" SET "maxStorageMb" = 2048 WHERE "code" = 'ESSENCIAL' AND "maxStorageMb" IS NULL;
UPDATE "plans" SET "maxStorageMb" = 20480 WHERE "code" = 'PROFISSIONAL' AND "maxStorageMb" IS NULL;
