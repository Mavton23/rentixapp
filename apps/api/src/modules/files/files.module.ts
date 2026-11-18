import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  listFilesQuerySchema,
  updateFileSchema,
  uploadFileSchema,
  type FileOwnerType,
  type UpdateFileInput,
  type UploadFileInput,
} from '@rentix/shared';
import { AppConfig } from '../../config/app-config.service';
import { FilesService, type UploadedBlob } from './files.service';
import { StorageService } from './storage';
import { DataExportController, DataExportService } from './data-export';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { CurrentStaff, CurrentTenant, Org, PlatformAdmin, Public, Roles, TenantRoute } from '../../common/decorators/auth.decorators';
import type { OrgContext, StaffAuth, TenantAuth } from '../../common/auth-context';
import type { StoredFile } from '../../generated/prisma/client';

/** Envia o ficheiro com cabeçalhos que impedem o browser de o executar como página. */
async function send(files: FilesService, f: StoredFile, res: Response, opts: { download: boolean; publicCache?: boolean }) {
  res.set({
    'Content-Type': f.contentType,
    'Content-Length': String(f.size),
    'Content-Disposition': `${opts.download ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': opts.publicCache ? 'public, max-age=31536000, immutable' : 'private, no-store',
  });
  return new StreamableFile(await files.stream(f));
}

@ApiTags('Ficheiros')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @Roles('MANAGER')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Enviar um ficheiro (PDF, JPEG, PNG ou WebP) para um inquilino, contrato, imóvel ou anúncio' })
  upload(@Org() ctx: OrgContext, @Body(new ZodPipe(uploadFileSchema)) body: UploadFileInput, @UploadedFile() file?: UploadedBlob) {
    return this.files.upload({ organizationId: ctx.organizationId, userId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent }, body, file);
  }

  @Get()
  list(@Org() ctx: OrgContext, @Query(new ZodPipe(listFilesQuerySchema)) q: { ownerType: FileOwnerType; ownerId: string }) {
    return this.files.list(ctx.organizationId, q.ownerType, q.ownerId);
  }

  @Get(':id/content')
  async content(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @Res({ passthrough: true }) res: Response) {
    return send(this.files, await this.files.get(ctx.organizationId, id), res, { download: download === '1' });
  }

  @Patch(':id')
  @Roles('MANAGER')
  update(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateFileSchema)) body: UpdateFileInput) {
    return this.files.update({ organizationId: ctx.organizationId, userId: ctx.userId }, id, body);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @HttpCode(204)
  async remove(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.files.remove({ organizationId: ctx.organizationId, userId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent }, id);
  }
}

/** Capas do blog (ficheiros da plataforma, sem organização). */
@ApiTags('Administração da plataforma')
@ApiBearerAuth()
@PlatformAdmin()
@Controller('admin/files')
export class AdminFilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  upload(@CurrentStaff() admin: StaffAuth, @Body(new ZodPipe(uploadFileSchema)) body: UploadFileInput, @UploadedFile() file?: UploadedBlob) {
    return this.files.upload({ organizationId: null, userId: admin.userId }, body, file);
  }

  @Get()
  list(@Query(new ZodPipe(listFilesQuerySchema)) q: { ownerType: FileOwnerType; ownerId: string }) {
    return this.files.list(null, q.ownerType, q.ownerId);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string) {
    await this.files.remove({ organizationId: null, userId: admin.userId }, id);
  }
}

@ApiTags('Portal do inquilino')
@ApiBearerAuth()
@TenantRoute()
@Controller('portal/files')
export class PortalFilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @ApiOperation({ summary: 'Documentos que o senhorio partilhou (contrato, recibos...)' })
  list(@CurrentTenant() t: TenantAuth) {
    return this.files.listForTenantAccount(t.accountId);
  }

  @Get(':id/content')
  async content(@CurrentTenant() t: TenantAuth, @Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @Res({ passthrough: true }) res: Response) {
    return send(this.files, await this.files.getForTenantAccount(t.accountId, id), res, { download: download === '1' });
  }
}

/** Imagens públicas: fotografias de anúncios e capas do blog. */
@ApiTags('Ficheiros')
@Public()
@Controller('public/files')
export class PublicFilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  async content(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    return send(this.files, await this.files.getPublic(id), res, { download: false, publicCache: true });
  }
}

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        storage: memoryStorage(),
        limits: { fileSize: config.get('UPLOAD_MAX_MB') * 1024 * 1024, files: 1, fields: 10 },
      }),
    }),
  ],
  controllers: [FilesController, AdminFilesController, PortalFilesController, PublicFilesController, DataExportController],
  providers: [FilesService, StorageService, DataExportService],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
