import { Controller, Get, Header, Injectable, Logger, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import { once } from 'node:events';
import { dateToIsoDate, intlLocale, todayIn, type Locale } from '@rentix/shared';
import { requestLocale, translator } from '../../common/i18n';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage';
import { AllowSuspended, Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

const FOLDER: Record<string, string> = { TENANT: 'inquilinos', LEASE: 'contratos', PROPERTY: 'imoveis', LISTING: 'anuncios', BLOG_POST: 'blog' };
const FOLDER_EN: Record<string, string> = { inquilinos: 'tenants', contratos: 'leases', imoveis: 'properties', anuncios: 'listings', blog: 'blog', outros: 'other' };
const d = (v: Date | null | undefined) => (v ? dateToIsoDate(v) : '');
const m = (minor: number | null | undefined) => (minor === null || minor === undefined ? null : minor / 100);
const safe = (s: string) => s.normalize('NFC').replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').slice(0, 120) || 'ficheiro';

/**
 * Todos os dados de uma organização num ZIP: um livro Excel (imóveis, unidades, inquilinos,
 * contratos, faturas, pagamentos, índice de documentos) e os ficheiros enviados.
 * Para quem sai do Rentix ou pede os seus dados; só o proprietário, e fica na auditoria.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async workbook(organizationId: string, locale: Locale = 'pt'): Promise<{ buffer: Buffer; files: { storageKey: string; path: string }[]; counts: Record<string, number> }> {
    const where = { organizationId };
    const [org, properties, units, tenants, leases, invoices, payments, files] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      this.prisma.property.findMany({ where, orderBy: { name: 'asc' } }),
      this.prisma.unit.findMany({ where, include: { property: { select: { name: true } } }, orderBy: [{ propertyId: 'asc' }, { label: 'asc' }] }),
      this.prisma.tenant.findMany({ where, orderBy: { fullName: 'asc' } }),
      this.prisma.lease.findMany({ where, include: { tenant: { select: { fullName: true } }, unit: { select: { label: true, property: { select: { name: true } } } } }, orderBy: { startDate: 'asc' } }),
      this.prisma.invoice.findMany({ where, include: { tenant: { select: { fullName: true } } }, orderBy: [{ issueDate: 'asc' }, { number: 'asc' }] }),
      this.prisma.payment.findMany({ where, include: { tenant: { select: { fullName: true } }, invoice: { select: { number: true } } }, orderBy: [{ paidAt: 'asc' }] }),
      this.prisma.storedFile.findMany({ where, orderBy: { createdAt: 'asc' } }),
    ]);

    const tr = translator(locale);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Rentix';
    const sheet = (name: string, cols: [string, string, number][], rows: Record<string, unknown>[]) => {
      const ws = wb.addWorksheet(tr(name), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols.map(([key, header, width]) => ({ key, header: tr(header), width }));
      ws.addRows(rows);
      ws.getRow(1).font = { bold: true };
    };
    sheet('Imóveis', [['id', 'Id', 38], ['name', 'Nome', 28], ['type', 'Tipo', 18], ['street', 'Morada', 30], ['neighbourhood', 'Bairro', 18], ['city', 'Cidade', 14], ['archived', 'Arquivado', 12]],
      properties.map((p) => ({ ...p, archived: d(p.archivedAt) })));
    sheet('Unidades', [['id', 'Id', 38], ['property', 'Imóvel', 26], ['label', 'Unidade', 14], ['bedrooms', 'Quartos', 8], ['bathrooms', 'WC', 6], ['areaM2', 'Área m²', 9], ['rent', 'Renda de referência', 16], ['status', 'Estado', 12]],
      units.map((u) => ({ ...u, property: u.property.name, rent: m(u.rentAmount) })));
    sheet('Inquilinos', [['id', 'Id', 38], ['fullName', 'Nome', 28], ['idDocumentType', 'Documento', 12], ['idDocumentNumber', 'Número', 18], ['nuit', 'NUIT', 12], ['phone', 'Telefone', 16], ['email', 'Email', 26], ['occupation', 'Profissão', 18], ['emergency', 'Contacto de emergência', 28], ['notes', 'Notas', 30]],
      tenants.map((t) => ({ ...t, emergency: [t.emergencyContactName, t.emergencyContactPhone].filter(Boolean).join(' ') })));
    sheet('Contratos', [['id', 'Id', 38], ['tenant', 'Inquilino', 26], ['unit', 'Unidade', 28], ['status', 'Estado', 12], ['start', 'Início', 12], ['end', 'Fim', 12], ['rent', 'Renda', 14], ['currency', 'Moeda', 8], ['billingDay', 'Dia', 6], ['deposit', 'Caução', 14], ['terminated', 'Terminado', 12]],
      leases.map((l) => ({ ...l, tenant: l.tenant.fullName, unit: `${l.unit.property.name}, ${l.unit.label}`, start: d(l.startDate), end: d(l.endDate), rent: m(l.rentAmount), deposit: m(l.depositAmount), terminated: d(l.terminatedAt) })));
    sheet('Faturas', [['number', 'Número', 18], ['kind', 'Tipo', 10], ['status', 'Estado', 14], ['tenant', 'Inquilino', 26], ['period', 'Período', 10], ['description', 'Descrição', 32], ['issue', 'Emissão', 12], ['due', 'Vencimento', 12], ['amount', 'Valor', 14], ['paid', 'Pago', 14], ['currency', 'Moeda', 8]],
      invoices.map((i) => ({ ...i, tenant: i.tenant.fullName, issue: d(i.issueDate), due: d(i.dueDate), amount: m(i.amount), paid: m(i.paidAmount) })));
    sheet('Pagamentos', [['receiptNumber', 'Recibo', 18], ['paidAt', 'Data', 12], ['status', 'Estado', 12], ['tenant', 'Inquilino', 26], ['invoice', 'Fatura', 18], ['method', 'Método', 14], ['reference', 'Referência', 22], ['amount', 'Valor', 14], ['currency', 'Moeda', 8]],
      payments.map((p) => ({ ...p, paidAt: d(p.paidAt), tenant: p.tenant.fullName, invoice: p.invoice.number, reference: p.providerTransactionId ?? p.reference ?? '', amount: m(p.amount) })));

    const used = new Set<string>();
    const fileRows = files.map((f) => {
      const folder = FOLDER[f.ownerType] ?? 'outros';
      let path = locale === 'en' ? `files/${FOLDER_EN[folder] ?? 'other'}/${f.ownerId}/${safe(f.filename)}` : `ficheiros/${folder}/${f.ownerId}/${safe(f.filename)}`;
      for (let i = 2; used.has(path); i++) path = path.replace(/(\.[^.]+)?$/, ` (${i})$1`);
      used.add(path);
      return { storageKey: f.storageKey, path, category: f.category, size: f.size, created: d(f.createdAt), shared: f.sharedWithTenant ? tr('sim') : '' };
    });
    sheet('Documentos', [['path', 'Ficheiro no ZIP', 70], ['category', 'Categoria', 14], ['size', 'Bytes', 12], ['created', 'Enviado', 12], ['shared', 'Partilhado com o inquilino', 12]], fileRows);

    const info = wb.addWorksheet(tr('Informação'));
    info.columns = [{ width: 24 }, { width: 60 }];
    info.addRows([
      [tr('Organização'), org.name],
      ['NUIT', org.nuit ?? ''],
      [tr('Exportado em'), new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'short', timeStyle: 'short', timeZone: org.timezone }).format(new Date())],
      [tr('Valores'), tr('Em unidades da moeda (15000,00 = 15 000 MTn). Os ids ligam as folhas entre si e às pastas de ficheiros.')],
    ]);

    return {
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      files: fileRows.map((f) => ({ storageKey: f.storageKey, path: f.path })),
      counts: { properties: properties.length, tenants: tenants.length, leases: leases.length, invoices: invoices.length, payments: payments.length, files: files.length },
    };
  }

  async export(ctx: OrgContext, locale: Locale = 'pt') {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const { buffer, files, counts } = await this.workbook(ctx.organizationId, locale);
    const en = locale === 'en';
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'organization.exported',
      entityType: 'organization',
      entityId: ctx.organizationId,
      metadata: counts,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.append(buffer, { name: en ? 'data.xlsx' : 'dados.xlsx' });
    zip.append(
      en
        ? `Export of the data of ${org.name} on Rentix.\n\n` +
            `data.xlsx: properties, units, tenants, leases, invoices, payments and the index of documents.\n` +
            `files/: documents and photos, by type and by the id of the record they belong to.\n\n` +
            `This file contains your tenants' personal data. Keep it somewhere safe.\n`
        : `Exportação dos dados de ${org.name} no Rentix.\n\n` +
            `dados.xlsx: imóveis, unidades, inquilinos, contratos, faturas, pagamentos e o índice dos documentos.\n` +
            `ficheiros/: documentos e fotografias, por tipo e pelo id do registo a que pertencem.\n\n` +
            `Este ficheiro contém dados pessoais dos seus inquilinos. Guarde-o em local seguro.\n`,
      { name: en ? 'README.txt' : 'LEIA-ME.txt' },
    );
    // Os ficheiros entram um de cada vez (não se abrem centenas de ligações ao armazenamento).
    void (async () => {
      try {
        for (const f of files) {
          try {
            zip.append(await this.storage.get(f.storageKey), { name: f.path });
            await once(zip, 'entry');
          } catch (err) {
            this.logger.warn({ err, key: f.storageKey }, 'Ficheiro em falta na exportação');
            zip.append(en ? `This file could not be read from storage.\n` : `Não foi possível ler este ficheiro do armazenamento.\n`, { name: `${f.path}.${en ? 'MISSING' : 'EM-FALTA'}.txt` });
          }
        }
        await zip.finalize();
      } catch (err) {
        this.logger.error({ err }, 'Exportação interrompida');
        zip.abort();
      }
    })();
    const slug = org.slug || 'organizacao';
    return { stream: zip, filename: `rentix-${slug}-${todayIn(org.timezone)}.zip` };
  }
}

@ApiTags('Organização')
@ApiBearerAuth()
@Controller('organization')
export class DataExportController {
  constructor(private readonly exporter: DataExportService) {}

  @Get('export')
  @Roles('OWNER')
  @AllowSuspended()
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Todos os dados da organização (Excel + ficheiros) num ZIP' })
  async export(@Org() ctx: OrgContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { stream, filename } = await this.exporter.export(ctx, requestLocale(req));
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(stream);
  }
}
