import { Controller, Get, Header, Module, Param, ParseEnumPipe, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { requestLocale } from '../../common/i18n';
import { REPORT_EXPORT_KINDS, reportRangeSchema, type ReportExportKind, type ReportRange } from '@rentix/shared';
import { AuditService } from '../audit/audit.service';
import { ReportsService } from './reports.service';
import { buildWorkbook } from './report-workbook';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

const FILE: Record<ReportExportKind, string> = { invoices: 'faturas', payments: 'pagamentos', tenants: 'inquilinos', aging: 'dividas' };
const FILE_EN: Record<ReportExportKind, string> = { invoices: 'invoices', payments: 'payments', tenants: 'tenants', aging: 'aged-debt' };

@ApiTags('Relatórios')
@ApiBearerAuth()
@Roles('MANAGER', 'ACCOUNTANT')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Faturado, cobrado, taxa de cobrança, dívida, evolução mensal e resultado por imóvel' })
  summary(@Org() ctx: OrgContext, @Query(new ZodPipe(reportRangeSchema)) q: ReportRange) {
    return this.reports.summary(ctx.organizationId, q);
  }

  @Get('aging')
  @ApiOperation({ summary: 'Dívidas em aberto por inquilino e antiguidade' })
  aging(@Org() ctx: OrgContext) {
    return this.reports.aging(ctx.organizationId);
  }

  @Get('export/:kind')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Exportar para Excel: faturas, pagamentos, inquilinos ou dívidas' })
  async export(
    @Org() ctx: OrgContext,
    @Param('kind', new ParseEnumPipe(REPORT_EXPORT_KINDS)) kind: ReportExportKind,
    @Query(new ZodPipe(reportRangeSchema)) q: ReportRange,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.reports.resolveRange(ctx.organizationId, q);
    const locale = requestLocale(req);
    const file = await buildWorkbook(kind, ctx.organizationId, r, this.reports, locale);
    // Exportar dados pessoais fica registado.
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'report.exported',
      entityType: 'report',
      metadata: { kind, from: r.from, to: r.to },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    const base = (locale === 'en' ? FILE_EN : FILE)[kind];
    const name = kind === 'tenants' || kind === 'aging' ? `${base}-${r.today}` : `${base}-${r.from}_${r.to}`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}.xlsx"`,
    });
    return new StreamableFile(file);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
