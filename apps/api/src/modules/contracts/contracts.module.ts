import { Body, Controller, Delete, Get, Header, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CONTRACT_VARIABLES,
  contractPreviewSchema,
  contractTemplateSchema,
  formatIsoDate,
  formatMoney,
  intlLocale,
  moneyToWords,
  normalizeLocale,
  type Locale,
  todayIn,
  unknownTemplateVariables,
  type ContractTemplateInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';
import { badRequest, notFound } from '../../common/utils/errors';
import { defaultContractTemplate } from './default-template';
import { fillTemplate, parseBlocks, renderContractPdf, type ContractPdfOptions } from './contract-pdf';
import { translator } from '../../common/i18n';

const MARITAL: Record<Locale, Record<string, string>> = {
  pt: { SINGLE: 'solteiro(a)', MARRIED: 'casado(a)', DIVORCED: 'divorciado(a)', WIDOWED: 'viúvo(a)', UNION: 'em união de facto' },
  en: { SINGLE: 'single', MARRIED: 'married', DIVORCED: 'divorced', WIDOWED: 'widowed', UNION: 'in a civil union' },
};
const DOC: Record<Locale, Record<string, string>> = {
  pt: { BI: 'Bilhete de Identidade', PASSPORT: 'Passaporte', DIRE: 'DIRE', DRIVING_LICENSE: 'Carta de Condução', OTHER: 'documento' },
  en: { BI: 'Identity Card (BI)', PASSPORT: 'Passport', DIRE: 'DIRE residence permit', DRIVING_LICENSE: "Driving Licence", OTHER: 'ID document' },
};

/** "2026-12-01" → "1 de dezembro de 2026" / "1 December 2026" */
const longDate = (iso: string, locale: Locale = 'pt') => formatIsoDate(iso, locale, true);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const moneyIn = (locale: Locale) => (minor: number, currency: string) =>
  formatMoney(minor, currency, locale === 'en' ? intlLocale('en') : undefined).replace(/[\u202f\u00a0]/g, ' ');
const percent = (bps: number, locale: Locale = 'pt') => `${(bps / 100).toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 })}%`;

/** Prazo entre o início e o fim (inclusive), em meses quando é um número redondo de meses. */
export function termText(start: string, end: string | null, locale: Locale = 'pt'): string {
  if (locale === 'en') return termTextEn(start, end);
  if (!end) return 'duração indeterminada';
  const [ys, ms, ds] = start.split('-').map(Number) as [number, number, number];
  const endPlus = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000);
  const months = (endPlus.getUTCFullYear() - ys) * 12 + (endPlus.getUTCMonth() + 1 - ms);
  if (endPlus.getUTCDate() === ds && months > 0) {
    if (months % 12 === 0) return months === 12 ? '1 (um) ano' : `${months / 12} anos`;
    return months === 1 ? '1 (um) mês' : `${months} meses`;
  }
  const days = Math.round((endPlus.getTime() - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return `${days} dias`;
}

function termTextEn(start: string, end: string | null): string {
  if (!end) return 'an indefinite term';
  const [ys, ms, ds] = start.split('-').map(Number) as [number, number, number];
  const endPlus = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000);
  const months = (endPlus.getUTCFullYear() - ys) * 12 + (endPlus.getUTCMonth() + 1 - ms);
  if (endPlus.getUTCDate() === ds && months > 0) {
    if (months % 12 === 0) return months === 12 ? '1 (one) year' : `${months / 12} years`;
    return months === 1 ? '1 (one) month' : `${months} months`;
  }
  const days = Math.round((endPlus.getTime() - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return `${days} days`;
}

const PDF_LABELS: Record<Locale, NonNullable<ContractPdfOptions['labels']>> = {
  pt: { landlord: 'O Senhorio', tenant: 'O Inquilino', page: (n, total) => `Página ${n} de ${total}   Rubricas: ______  ______` },
  en: { landlord: 'The Landlord', tenant: 'The Tenant', page: (n, total) => `Page ${n} of ${total}   Initials: ______  ______` },
};

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getTemplate(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { contractTemplate: true, contractTemplateUpdatedAt: true, locale: true } });
    const DEFAULT = defaultContractTemplate(normalizeLocale(org.locale));
    return {
      template: org.contractTemplate ?? DEFAULT,
      isDefault: !org.contractTemplate,
      updatedAt: org.contractTemplateUpdatedAt?.toISOString() ?? null,
      defaultTemplate: DEFAULT,
      variables: CONTRACT_VARIABLES,
    };
  }

  async saveTemplate(ctx: OrgContext, input: ContractTemplateInput | null) {
    await this.prisma.organization.update({
      where: { id: ctx.organizationId },
      data: { contractTemplate: input?.template ?? null, contractTemplateUpdatedAt: input ? new Date() : null },
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: input ? 'contract_template.updated' : 'contract_template.reset',
      entityType: 'organization',
      entityId: ctx.organizationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.getTemplate(ctx.organizationId);
  }

  /** Valores das variáveis para um contrato real. Dados em falta ficam em branco para preencher à mão. */
  async varsForLease(organizationId: string, leaseId: string) {
    const lease = await this.prisma.lease.findFirst({
      where: { id: leaseId, organizationId },
      include: { tenant: true, unit: { include: { property: true } }, organization: true },
    });
    if (!lease) throw notFound('Contrato', 'LEASE_NOT_FOUND');
    const { organization: org, tenant: t, unit: u } = lease;
    // O contrato sai no idioma da organização (o mesmo do modelo).
    const loc = normalizeLocale(org.locale);
    const money = moneyIn(loc);
    const p = u.property;
    const start = isoOf(lease.startDate);
    const end = lease.endDate ? isoOf(lease.endDate) : null;
    const unitDesc = [
      u.bedrooms !== null ? `${u.bedrooms} ${loc === 'en' ? (u.bedrooms === 1 ? 'bedroom' : 'bedrooms') : u.bedrooms === 1 ? 'quarto' : 'quartos'}` : null,
      u.bathrooms !== null ? `${u.bathrooms} ${loc === 'en' ? (u.bathrooms === 1 ? 'bathroom' : 'bathrooms') : u.bathrooms === 1 ? 'casa de banho' : 'casas de banho'}` : null,
      u.areaM2 !== null ? `${u.areaM2} ${loc === 'en' ? 'square metres' : 'metros quadrados'}` : null,
    ].filter(Boolean).join(', ');
    const vars: Record<string, string | null> = {
      'senhorio.nome': org.name,
      'senhorio.nuit': org.nuit,
      'senhorio.morada': [org.address, org.city].filter(Boolean).join(', ') || null,
      'senhorio.telefone': org.phone,
      'senhorio.email': org.email,
      'inquilino.nome': t.fullName,
      'inquilino.documento': `${DOC[loc][t.idDocumentType] ?? DOC[loc].OTHER} ${loc === 'en' ? 'no.' : 'n.º'} ${t.idDocumentNumber}`,
      'inquilino.nuit': t.nuit,
      'inquilino.telefone': t.phone,
      'inquilino.email': t.email,
      'inquilino.estado_civil': t.maritalStatus ? MARITAL[loc][t.maritalStatus]! : null,
      'inquilino.profissao': t.occupation,
      'imovel.nome': p.name,
      'imovel.morada': [p.street, p.neighbourhood, p.city].filter(Boolean).join(', '),
      'imovel.cidade': p.city,
      'unidade.nome': u.label,
      'unidade.descricao': unitDesc || null,
      'contrato.inicio': longDate(start, loc),
      'contrato.fim': end ? longDate(end, loc) : loc === 'en' ? 'no end date' : 'sem data de termo',
      'contrato.prazo': termText(start, end, loc),
      'contrato.duracao':
        loc === 'en'
          ? end
            ? `is entered into for a term of ${termText(start, end, loc)}, until ${longDate(end, loc)}, renewing for equal periods unless either party gives notice`
            : 'is entered into for an indefinite term'
          : end
            ? `é celebrado pelo prazo de ${termText(start, end)}, até ${longDate(end)}, renovando-se por iguais períodos se nenhuma das partes o denunciar`
            : 'é celebrado por tempo indeterminado',
      'contrato.renda': money(lease.rentAmount, lease.currency),
      'contrato.renda_extenso': moneyToWords(lease.rentAmount, lease.currency, loc),
      'contrato.dia_pagamento': String(lease.billingDay),
      'contrato.caucao': money(lease.depositAmount, lease.currency),
      'contrato.caucao_extenso': moneyToWords(lease.depositAmount, lease.currency, loc),
      'contrato.multa': percent(lease.lateFeeBps ?? org.lateFeeBps, loc),
      'contrato.tolerancia': String(lease.gracePeriodDays ?? org.gracePeriodDays),
      'data.hoje': longDate(todayIn(org.timezone), loc),
      local: org.city ?? p.city,
    };
    return { vars, lease, org };
  }

  async leasePdf(ctx: OrgContext, leaseId: string) {
    const { vars, lease, org } = await this.varsForLease(ctx.organizationId, leaseId);
    const loc = normalizeLocale(org.locale);
    const template = org.contractTemplate ?? defaultContractTemplate(loc);
    const pdf = await renderContractPdf(parseBlocks(fillTemplate(template, vars)), {
      labels: PDF_LABELS[loc],
      title: `${loc === 'en' ? 'Lease agreement' : 'Contrato de arrendamento'} — ${lease.tenant.fullName}`,
      parties: { landlord: org.name, tenant: lease.tenant.fullName },
      footer: `${org.name} · ${lease.unit.property.name}, ${lease.unit.label} · ${lease.tenant.fullName}`,
    });
    await this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action: 'lease.contract_generated',
      entityType: 'lease',
      entityId: leaseId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    const slug = lease.tenant.fullName.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
    return { filename: `${loc === 'en' ? 'lease' : 'contrato'}-${slug}.pdf`, pdf };
  }

  /** Pré-visualização com dados de exemplo (para o editor do modelo). */
  async previewPdf(organizationId: string, template?: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const loc = normalizeLocale(org.locale);
    const tr = translator(loc);
    const t = template ?? org.contractTemplate ?? defaultContractTemplate(loc);
    const unknown = unknownTemplateVariables(t);
    if (unknown.length) throw badRequest('UNKNOWN_VARIABLES', `Variáveis desconhecidas: ${unknown.join(', ')}`, { unknown });
    const vars: Record<string, string> = Object.fromEntries(CONTRACT_VARIABLES.map((v) => [v.key, tr(v.example)]));
    vars['senhorio.nome'] = org.name;
    if (loc === 'en') {
      vars['contrato.renda'] = moneyIn('en')(2_500_000, 'MZN');
      vars['contrato.caucao'] = moneyIn('en')(5_000_000, 'MZN');
    }
    return renderContractPdf(parseBlocks(fillTemplate(t, vars)), {
      labels: PDF_LABELS[loc],
      title: tr('Pré-visualização do contrato'),
      parties: { landlord: org.name, tenant: CONTRACT_VARIABLES.find((v) => v.key === 'inquilino.nome')!.example },
      footer: `${org.name} · ${tr('pré-visualização com dados de exemplo')}`,
      watermark: tr('EXEMPLO'),
    });
  }
}

@ApiTags('Contratos')
@ApiBearerAuth()
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('organization/contract-template')
  @ApiOperation({ summary: 'Modelo do contrato de arrendamento e variáveis disponíveis' })
  get(@Org() ctx: OrgContext) {
    return this.contracts.getTemplate(ctx.organizationId);
  }

  @Put('organization/contract-template')
  @Roles('MANAGER')
  @ApiZodBody(contractTemplateSchema)
  save(@Org() ctx: OrgContext, @Body(new ZodPipe(contractTemplateSchema)) body: ContractTemplateInput) {
    return this.contracts.saveTemplate(ctx, body);
  }

  @Delete('organization/contract-template')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Voltar ao modelo base do Rentix' })
  reset(@Org() ctx: OrgContext) {
    return this.contracts.saveTemplate(ctx, null);
  }

  @Post('organization/contract-template/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'PDF de pré-visualização com dados de exemplo' })
  async preview(@Org() ctx: OrgContext, @Body(new ZodPipe(contractPreviewSchema)) body: { template?: string }, @Res({ passthrough: true }) res: Response) {
    const pdf = await this.contracts.previewPdf(ctx.organizationId, body.template);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="contrato-exemplo.pdf"' });
    return new StreamableFile(pdf);
  }

  @Get('leases/:id/contract.pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Contrato de arrendamento em PDF, a partir do modelo da organização' })
  async leasePdf(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, pdf } = await this.contracts.leasePdf(ctx, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(pdf);
  }
}

@Module({ controllers: [ContractsController], providers: [ContractsService] })
export class ContractsModule {}
