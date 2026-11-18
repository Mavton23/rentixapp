/** Ficheiros: documentos privados (inquilinos, contratos, imóveis) e imagens públicas (anúncios, blog). */
import { z } from 'zod';

export const FILE_OWNER_TYPES = ['TENANT', 'LEASE', 'PROPERTY', 'LISTING', 'BLOG_POST'] as const;
export type FileOwnerType = (typeof FILE_OWNER_TYPES)[number];

export const FILE_CATEGORIES = ['ID_DOCUMENT', 'CONTRACT', 'PHOTO', 'RECEIPT', 'COVER', 'OTHER'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/** Que categorias fazem sentido para cada tipo de dono, e se são só imagens. */
export const FILE_RULES: Record<FileOwnerType, { categories: FileCategory[]; imagesOnly: boolean; public: boolean; max: number }> = {
  TENANT: { categories: ['ID_DOCUMENT', 'CONTRACT', 'RECEIPT', 'OTHER'], imagesOnly: false, public: false, max: 30 },
  LEASE: { categories: ['CONTRACT', 'RECEIPT', 'PHOTO', 'OTHER'], imagesOnly: false, public: false, max: 30 },
  PROPERTY: { categories: ['PHOTO', 'CONTRACT', 'OTHER'], imagesOnly: false, public: false, max: 50 },
  LISTING: { categories: ['PHOTO'], imagesOnly: true, public: true, max: 10 },
  BLOG_POST: { categories: ['COVER'], imagesOnly: true, public: true, max: 5 },
};

export const uploadFileSchema = z.object({
  ownerType: z.enum(FILE_OWNER_TYPES),
  ownerId: z.uuid(),
  category: z.enum(FILE_CATEGORIES),
});
export type UploadFileInput = z.infer<typeof uploadFileSchema>;

export const listFilesQuerySchema = z.object({
  ownerType: z.enum(FILE_OWNER_TYPES),
  ownerId: z.uuid(),
});

export const updateFileSchema = z.object({
  sharedWithTenant: z.boolean().optional(),
  filename: z.string().trim().min(1).max(160).optional(),
  category: z.enum(FILE_CATEGORIES).optional(),
});
export type UpdateFileInput = z.infer<typeof updateFileSchema>;
