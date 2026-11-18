import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  CONTACT_MESSAGE_STATUSES,
  contactMessageSchema,
  paginationSchema,
  SITE_CONTENT_KEYS,
  SITE_CONTENT_SCHEMAS,
  type ContactMessageInput,
  type PaginationInput,
  type SiteContentKey,
  normalizeLocale,
  type Locale,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../../config/app-config.service';
import { RequireFeature } from '../features/features';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { CurrentStaff, PlatformAdmin, Public, ReqMeta } from '../../common/decorators/auth.decorators';
import type { RequestMeta, StaffAuth } from '../../common/auth-context';
import { notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import type { Prisma } from '../../generated/prisma/client';

const keyPipe = new ZodPipe(z.enum(SITE_CONTENT_KEYS));
const messageQuerySchema = paginationSchema.extend({ status: z.enum(CONTACT_MESSAGE_STATUSES).optional() });
const messageStatusSchema = z.object({ status: z.enum(CONTACT_MESSAGE_STATUSES) });

/** Conteúdo inicial, usado enquanto a administração não o editar. */
const DEFAULTS: Record<SiteContentKey, unknown> = {
  about: {
    title: 'Sobre o Rentix',
    subtitle: 'Gestão de arrendamentos feita em Moçambique, para senhorios e imobiliárias.',
    sections: [
      {
        title: 'Porque existimos',
        body: 'Cobrar rendas, lembrar inquilinos e passar recibos ocupa horas todos os meses. O Rentix faz esse trabalho por si, para que possa dedicar-se aos seus imóveis e às pessoas que neles vivem.',
      },
    ],
    values: [
      { title: 'Transparência', description: 'Senhorio e inquilino veem os mesmos números, sempre atualizados.' },
      { title: 'Simplicidade', description: 'Funciona no telemóvel e com internet fraca.' },
    ],
    cta: { title: 'Comece hoje', text: 'Grátis até 3 unidades.', buttonText: 'Criar conta' },
  },
  contact: {
    intro: 'Fale connosco. Respondemos em dias úteis.',
    items: [
      { type: 'email', label: 'Email', value: 'geral@rentix.co.mz' },
      { type: 'address', label: 'Morada', value: 'Maputo, Moçambique' },
    ],
  },
  features: {
    intro: 'Tudo o que precisa para gerir arrendamentos.',
    items: [
      { title: 'Faturação automática', description: 'Rendas faturadas no início de cada mês, com multas e lembretes.', details: [] },
      { title: 'Pagamentos por telemóvel', description: 'Os inquilinos pagam por M-Pesa a partir do portal.', details: [] },
      { title: 'Portal do inquilino', description: 'Faturas, recibos e contrato sempre à mão.', details: [] },
    ],
  },
};

const DEFAULTS_EN: Record<SiteContentKey, unknown> = {
  about: {
    title: 'About Rentix',
    subtitle: 'Rental management built in Mozambique, for landlords and letting agencies.',
    sections: [
      {
        title: 'Why we exist',
        body: 'Collecting rent, reminding tenants and issuing receipts takes hours every month. Rentix does that work for you, so you can focus on your properties and the people who live in them.',
      },
    ],
    values: [
      { title: 'Transparency', description: 'Landlord and tenant see the same figures, always up to date.' },
      { title: 'Simplicity', description: 'Works on a phone and on a weak connection.' },
    ],
    cta: { title: 'Start today', text: 'Free for up to 3 units.', buttonText: 'Create account' },
  },
  contact: {
    intro: 'Talk to us. We reply on working days.',
    items: [
      { type: 'email', label: 'Email', value: 'geral@rentix.co.mz' },
      { type: 'address', label: 'Address', value: 'Maputo, Mozambique' },
    ],
  },
  features: {
    intro: 'Everything you need to manage rentals.',
    items: [
      { title: 'Automatic invoicing', description: 'Rent invoiced at the start of each month, with late fees and reminders.', details: [] },
      { title: 'Mobile payments', description: 'Tenants pay by M-Pesa from the portal.', details: [] },
      { title: 'Tenant portal', description: 'Invoices, receipts and the lease always at hand.', details: [] },
    ],
  },
};

/** O conteúdo em inglês guarda-se na chave "<chave>.en"; o português na chave simples. */
const storageKey = (key: SiteContentKey, locale: Locale) => (locale === 'en' ? `${key}.en` : key);

@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async get(key: SiteContentKey, locale: Locale = 'pt') {
    const row = await this.prisma.siteContent.findUnique({ where: { key: storageKey(key, locale) } });
    return { key, locale, data: row?.data ?? (locale === 'en' ? DEFAULTS_EN : DEFAULTS)[key], updatedAt: row?.updatedAt ?? null };
  }

  async put(admin: StaffAuth, key: SiteContentKey, raw: unknown, locale: Locale = 'pt') {
    const data = new ZodPipe(SITE_CONTENT_SCHEMAS[key] as z.ZodType<Prisma.InputJsonValue>).transform(raw);
    const sk = storageKey(key, locale);
    const row = await this.prisma.siteContent.upsert({
      where: { key: sk },
      update: { data, updatedById: admin.userId },
      create: { key: sk, data, updatedById: admin.userId },
    });
    await this.audit.log({ actorType: 'USER', actorId: admin.userId, action: 'site.content_updated', entityType: 'site_content', metadata: { key, locale } });
    return { key, locale, data: row.data, updatedAt: row.updatedAt };
  }

  async submitMessage(input: ContactMessageInput, meta: RequestMeta) {
    // Um robot preencheu o campo invisível: aceitar em silêncio, sem gravar.
    if (input.website) return;
    const { website: _w, ...data } = input;
    const msg = await this.prisma.contactMessage.create({ data: { ...data, ip: meta.ip } });
    const to = this.config.get('CONTACT_INBOX');
    if (to) {
      await this.notifications.enqueue({
        template: 'CONTACT_MESSAGE',
        channel: 'EMAIL',
        recipient: to,
        dedupeKey: `contact:${msg.id}`,
        data: { name: data.name, email: data.email, phone: data.phone ?? '', subject: data.subject, message: data.message },
      });
    }
  }

  async listMessages(q: PaginationInput & { status?: (typeof CONTACT_MESSAGE_STATUSES)[number] }) {
    const where: Prisma.ContactMessageWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async setMessageStatus(id: string, status: (typeof CONTACT_MESSAGE_STATUSES)[number]) {
    const m = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!m) throw notFound('Mensagem', 'MESSAGE_NOT_FOUND');
    return this.prisma.contactMessage.update({ where: { id }, data: { status } });
  }
}

@ApiTags('Site')
@RequireFeature('CMS')
@Controller('site')
export class SitePublicController {
  constructor(private readonly site: SiteService) {}

  @Public()
  @Get('content/:key')
  get(@Param('key', keyPipe) key: SiteContentKey, @Query('locale') locale?: string) {
    return this.site.get(key, normalizeLocale(locale));
  }

  @Public()
  @Post('contact')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiZodBody(contactMessageSchema)
  async contact(@Body(new ZodPipe(contactMessageSchema)) body: ContactMessageInput, @ReqMeta() meta: RequestMeta) {
    await this.site.submitMessage(body, meta);
    return { message: 'Mensagem recebida. Obrigado!' };
  }
}

@ApiTags('Administração — site')
@ApiBearerAuth()
@PlatformAdmin()
@RequireFeature('CMS')
@Controller('admin/site')
export class SiteAdminController {
  constructor(private readonly site: SiteService) {}

  @Put('content/:key')
  put(@CurrentStaff() admin: StaffAuth, @Param('key', keyPipe) key: SiteContentKey, @Body() body: unknown, @Query('locale') locale?: string) {
    return this.site.put(admin, key, body, normalizeLocale(locale));
  }

  @Get('messages')
  @ApiZodQuery(messageQuerySchema)
  messages(@Query(new ZodPipe(messageQuerySchema)) q: z.infer<typeof messageQuerySchema>) {
    return this.site.listMessages(q);
  }

  @Patch('messages/:id')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(messageStatusSchema)) body: z.infer<typeof messageStatusSchema>) {
    return this.site.setMessageStatus(id, body.status);
  }
}

@Module({
  controllers: [SitePublicController, SiteAdminController],
  providers: [SiteService],
})
export class SiteModule {}
