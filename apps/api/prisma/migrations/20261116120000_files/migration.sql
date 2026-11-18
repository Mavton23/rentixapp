-- CreateEnum
CREATE TYPE "FileOwnerType" AS ENUM ('TENANT', 'LEASE', 'PROPERTY', 'LISTING', 'BLOG_POST');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "ownerType" "FileOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "sharedWithTenant" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storageKey_key" ON "stored_files"("storageKey");

-- CreateIndex
CREATE INDEX "stored_files_organizationId_ownerType_ownerId_idx" ON "stored_files"("organizationId", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "stored_files_ownerType_ownerId_idx" ON "stored_files"("ownerType", "ownerId");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_size_check" CHECK ("size" > 0);
-- Ficheiros públicos são só imagens (fotografias de anúncios e capas do blog).
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_public_images_check"
  CHECK ("visibility" = 'PRIVATE' OR "contentType" LIKE 'image/%');
