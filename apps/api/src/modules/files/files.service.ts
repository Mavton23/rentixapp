import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { FILE_RULES, type FileOwnerType, type UpdateFileInput, type UploadFileInput } from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.module';
import { StorageService } from './storage';
import { badRequest, conflict, notFound } from '../../common/utils/errors';
import type { StoredFile } from '../../generated/prisma/client';

export interface UploadedBlob {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface FileActor {
  organizationId: string | null;
  userId: string;
  ip?: string;
  userAgent?: string;
}

type Detected = { contentType: string; ext: string; image: boolean };

/**
 * Tipo real do ficheiro pelos primeiros bytes. O tipo que o browser declara não conta:
 * só passam PDF, JPEG, PNG e WebP.
 */
export function detectType(buf: Buffer): Detected | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { contentType: 'application/pdf', ext: 'pdf', image: false };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg', image: true };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', ext: 'png', image: true };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { contentType: 'image/webp', ext: 'webp', image: true };
  return null;
}

/** Nome seguro para mostrar e para o Content-Disposition (sem caminhos nem caracteres de controlo). */
export function cleanFilename(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? 'ficheiro')
    .normalize('NFC')
    // Sem caracteres de controlo nem aspas (ficariam mal no cabeçalho Content-Disposition).
    .replace(/["\p{Cc}]/gu, '')
    .replace(/\.[^.]{1,8}$/, '')
    .trim()
    .slice(0, 120);
  return `${base || 'ficheiro'}.${ext}`;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
  ) {}

  /** O dono existe e pertence à organização (ou é da plataforma, para o blog). */
  private async assertOwner(organizationId: string | null, ownerType: FileOwnerType, ownerId: string): Promise<void> {
    const where = { id: ownerId, ...(organizationId ? { organizationId } : {}) };
    const found =
      ownerType === 'TENANT'
        ? await this.prisma.tenant.count({ where })
        : ownerType === 'LEASE'
          ? await this.prisma.lease.count({ where })
          : ownerType === 'PROPERTY'
            ? await this.prisma.property.count({ where })
            : ownerType === 'LISTING'
              ? await this.prisma.listing.count({ where })
              : organizationId === null
                ? await this.prisma.blogPost.count({ where: { id: ownerId } })
                : 0;
    if (!found) throw notFound('Registo', 'OWNER_NOT_FOUND');
  }

  async upload(actor: FileActor, input: UploadFileInput, file: UploadedBlob | undefined) {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED', 'Escolha um ficheiro');
    const rules = FILE_RULES[input.ownerType];
    if (!rules.categories.includes(input.category)) throw badRequest('INVALID_CATEGORY', 'Categoria não permitida aqui');
    if ((input.ownerType === 'BLOG_POST') !== (actor.organizationId === null)) throw badRequest('INVALID_OWNER', 'Destino inválido');
    await this.assertOwner(actor.organizationId, input.ownerType, input.ownerId);

    if (input.ownerType === 'LISTING') {
      const l = await this.prisma.listing.findUniqueOrThrow({ where: { id: input.ownerId }, select: { status: true } });
      if (l.status === 'CLOSED') throw conflict('LISTING_CLOSED', 'Este anúncio está fechado');
    }
    const count = await this.prisma.storedFile.count({ where: { ownerType: input.ownerType, ownerId: input.ownerId } });
    if (count >= rules.max) throw conflict('TOO_MANY_FILES', `No máximo ${rules.max} ficheiros aqui. Apague algum antes de enviar outro.`);

    const type = detectType(file.buffer);
    if (!type) throw badRequest('UNSUPPORTED_FILE', 'Só são aceites PDF, JPEG, PNG ou WebP');
    if (rules.imagesOnly && !type.image) throw badRequest('IMAGE_REQUIRED', 'Aqui só são aceites imagens (JPEG, PNG ou WebP)');

    let body = file.buffer;
    let width: number | null = null;
    let height: number | null = null;
    if (type.image) {
      // Endireita pela orientação EXIF, reduz fotografias muito grandes e remove TODOS os metadados
      // (incluindo a localização GPS que os telemóveis gravam). Também rejeita imagens corrompidas.
      try {
        const img = sharp(file.buffer, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate().resize({
          width: 2400,
          height: 2400,
          fit: 'inside',
          withoutEnlargement: true,
        });
        const out =
          type.ext === 'png'
            ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
            : type.ext === 'webp'
              ? await img.webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
              : await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        body = out.data;
        width = out.info.width;
        height = out.info.height;
      } catch {
        throw badRequest('INVALID_IMAGE', 'A imagem está danificada ou não é suportada');
      }
    }

    if (actor.organizationId) await this.plans.assertCanStore(actor.organizationId, body.length);
    const id = randomUUID();
    const key = `${actor.organizationId ?? 'platform'}/${input.ownerType.toLowerCase()}/${id}.${type.ext}`;
    await this.storage.put(key, body, type.contentType);
    try {
      const row = await this.prisma.storedFile.create({
        data: {
          id,
          organizationId: actor.organizationId,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          category: input.category,
          visibility: rules.public ? 'PUBLIC' : 'PRIVATE',
          storageKey: key,
          filename: cleanFilename(file.originalname, type.ext),
          contentType: type.contentType,
          size: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
          width,
          height,
          uploadedById: actor.userId,
        },
      });
      await this.syncOwner(row.ownerType, row.ownerId, { added: row });
      if (actor.organizationId) {
        await this.audit.log({
          organizationId: actor.organizationId,
          actorType: 'USER',
          actorId: actor.userId,
          action: 'file.uploaded',
          entityType: 'file',
          entityId: row.id,
          metadata: { ownerType: input.ownerType, ownerId: input.ownerId, category: input.category, size: row.size },
          ip: actor.ip,
          userAgent: actor.userAgent,
        });
      }
      return this.present(row);
    } catch (err) {
      await this.storage.delete(key);
      throw err;
    }
  }

  async list(organizationId: string | null, ownerType: FileOwnerType, ownerId: string) {
    await this.assertOwner(organizationId, ownerType, ownerId);
    const rows = await this.prisma.storedFile.findMany({
      where: { ownerType, ownerId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.present(r));
  }

  async get(organizationId: string | null, id: string): Promise<StoredFile> {
    const f = await this.prisma.storedFile.findFirst({ where: { id, organizationId } });
    if (!f) throw notFound('Ficheiro', 'FILE_NOT_FOUND');
    return f;
  }

  async update(actor: FileActor, id: string, input: UpdateFileInput) {
    const f = await this.get(actor.organizationId, id);
    if (input.category && !FILE_RULES[f.ownerType].categories.includes(input.category)) {
      throw badRequest('INVALID_CATEGORY', 'Categoria não permitida aqui');
    }
    // Só ficheiros de inquilinos e contratos podem ser mostrados no portal.
    if (input.sharedWithTenant && f.ownerType !== 'TENANT' && f.ownerType !== 'LEASE') {
      throw badRequest('CANNOT_SHARE', 'Só documentos do inquilino ou do contrato podem ser partilhados');
    }
    const row = await this.prisma.storedFile.update({
      where: { id: f.id },
      data: {
        ...(input.sharedWithTenant !== undefined ? { sharedWithTenant: input.sharedWithTenant } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.filename ? { filename: cleanFilename(input.filename, f.storageKey.split('.').pop()!) } : {}),
      },
    });
    return this.present(row);
  }

  async remove(actor: FileActor, id: string): Promise<void> {
    const f = await this.get(actor.organizationId, id);
    await this.prisma.storedFile.delete({ where: { id: f.id } });
    await this.storage.delete(f.storageKey);
    await this.syncOwner(f.ownerType, f.ownerId, { removed: f });
    if (actor.organizationId) {
      await this.audit.log({
        organizationId: actor.organizationId,
        actorType: 'USER',
        actorId: actor.userId,
        action: 'file.deleted',
        entityType: 'file',
        entityId: f.id,
        metadata: { filename: f.filename, ownerType: f.ownerType, ownerId: f.ownerId },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
  }

  /**
   * Mantém as imagens enviadas refletidas no dono: as fotografias do anúncio (imageUrls, pela
   * ordem de envio, depois de endereços externos antigos) e a capa do artigo do blog.
   * Mudar as fotografias de um anúncio devolve-o à revisão, como qualquer outra edição.
   */
  private async syncOwner(ownerType: FileOwnerType, ownerId: string, change: { added?: StoredFile; removed?: StoredFile }) {
    if (ownerType === 'LISTING') {
      const prefix = this.publicUrl('');
      const [listing, uploaded] = await Promise.all([
        this.prisma.listing.findUniqueOrThrow({ where: { id: ownerId }, select: { imageUrls: true, status: true } }),
        this.prisma.storedFile.findMany({ where: { ownerType, ownerId }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
      ]);
      const external = listing.imageUrls.filter((u) => !u.startsWith(prefix));
      await this.prisma.listing.update({
        where: { id: ownerId },
        data: {
          imageUrls: [...external, ...uploaded.map((u) => this.publicUrl(u.id))].slice(0, 10),
          ...(change.added && listing.status !== 'CLOSED' ? { status: 'PENDING_REVIEW', rejectionReason: null } : {}),
        },
      });
    } else if (ownerType === 'BLOG_POST') {
      if (change.added) await this.prisma.blogPost.update({ where: { id: ownerId }, data: { coverImageUrl: this.publicUrl(change.added.id) } });
      if (change.removed) {
        await this.prisma.blogPost.updateMany({ where: { id: ownerId, coverImageUrl: this.publicUrl(change.removed.id) }, data: { coverImageUrl: null } });
      }
    }
  }

  /** Ficheiros que o inquilino pode ver: partilhados da sua ficha e dos seus contratos. */
  async listForTenantAccount(accountId: string) {
    const tenants = await this.prisma.tenant.findMany({ where: { accountId }, select: { id: true, leases: { select: { id: true } } } });
    const tenantIds = tenants.map((t) => t.id);
    const leaseIds = tenants.flatMap((t) => t.leases.map((l) => l.id));
    if (!tenantIds.length) return [];
    const rows = await this.prisma.storedFile.findMany({
      where: {
        sharedWithTenant: true,
        OR: [
          { ownerType: 'TENANT', ownerId: { in: tenantIds } },
          { ownerType: 'LEASE', ownerId: { in: leaseIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.present(r));
  }

  async getForTenantAccount(accountId: string, id: string): Promise<StoredFile> {
    const visible = await this.listForTenantAccount(accountId);
    if (!visible.some((f) => f.id === id)) throw notFound('Ficheiro', 'FILE_NOT_FOUND');
    return this.prisma.storedFile.findUniqueOrThrow({ where: { id } });
  }

  async getPublic(id: string): Promise<StoredFile> {
    const f = await this.prisma.storedFile.findFirst({ where: { id, visibility: 'PUBLIC' } });
    if (!f) throw notFound('Ficheiro', 'FILE_NOT_FOUND');
    return f;
  }

  stream(f: StoredFile) {
    return this.storage.get(f.storageKey);
  }

  /** Endereço público (imagens de anúncios e do blog), servido pelo mesmo domínio do site. */
  publicUrl(id: string): string {
    return `${this.config.get('WEB_URL')}/api/v1/public/files/${id}`;
  }

  present(f: StoredFile) {
    return {
      id: f.id,
      ownerType: f.ownerType,
      ownerId: f.ownerId,
      category: f.category,
      visibility: f.visibility,
      sharedWithTenant: f.sharedWithTenant,
      filename: f.filename,
      contentType: f.contentType,
      size: f.size,
      width: f.width,
      height: f.height,
      url: f.visibility === 'PUBLIC' ? this.publicUrl(f.id) : null,
      createdAt: f.createdAt.toISOString(),
    };
  }
}
