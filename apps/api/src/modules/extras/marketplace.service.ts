import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { z } from 'zod';
import type {
  ListingInput,
  ListingReportInput,
  ListingStatus,
  listingQuerySchema,
  UpdateListingInput,
} from '@rentix/shared';
import { CronRunner } from '../../common/ops/cron-runner.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../../config/app-config.service';
import { FeaturesService } from '../features/features';
import type { OrgContext, StaffAuth } from '../../common/auth-context';
import { badRequest, conflict, forbidden, notFound } from '../../common/utils/errors';
import { pageArgs, paginated, type Paginated } from '../../common/utils/pagination';
import { Prisma, type Listing } from '../../generated/prisma/client';

type ListingQuery = z.infer<typeof listingQuerySchema>;
const RENEW_DAYS = 30;

/**
 * Marketplace entre organizações: uma imobiliária anuncia um imóvel a outras (para arrendar a clientes
 * delas, vender ou passar a gestão). Os anúncios são revistos pela administração antes de aparecerem.
 * Os contactos só são revelados quando o anunciante aceita o interesse.
 */
@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cron: CronRunner,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly features: FeaturesService,
  ) {}

  // ---------- consulta ----------

  async browse(ctx: OrgContext, q: ListingQuery) {
    const where: Prisma.ListingWhereInput = {
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
      ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
      ...(q.purpose ? { purpose: q.purpose } : {}),
      ...(q.propertyType ? { propertyType: q.propertyType } : {}),
      ...(q.minPrice !== undefined || q.maxPrice !== undefined
        ? { price: { ...(q.minPrice !== undefined ? { gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { lte: q.maxPrice } : {}) } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
              { neighbourhood: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        ...pageArgs(q),
        include: { interests: { where: { organizationId: ctx.organizationId }, select: { status: true } } },
      }),
      this.prisma.listing.count({ where }),
    ]);
    const orgs = await this.orgNames(rows.map((r) => r.organizationId));
    return paginated(
      rows.map(({ interests, ...l }) => ({
        ...this.card(l),
        organizationName: orgs.get(l.organizationId) ?? '',
        isMine: l.organizationId === ctx.organizationId,
        myInterest: interests[0]?.status ?? null,
      })),
      total,
      q,
    );
  }

  async get(ctx: OrgContext, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    const isMine = listing?.organizationId === ctx.organizationId;
    if (!listing || (!isMine && (listing.status !== 'ACTIVE' || listing.expiresAt < new Date()))) {
      throw notFound('Anúncio', 'LISTING_NOT_FOUND');
    }
    if (!isMine) await this.recordView(listing.id, ctx.organizationId);

    const [org, interest] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: listing.organizationId }, select: { name: true } }),
      this.prisma.listingInterest.findUnique({
        where: { listingId_organizationId: { listingId: id, organizationId: ctx.organizationId } },
      }),
    ]);
    return {
      ...listing,
      organizationName: org.name,
      isMine,
      myInterest: interest ? { status: interest.status, message: interest.message, createdAt: interest.createdAt } : null,
      // Contacto do anunciante só depois de aceitar o interesse.
      contact: interest?.status === 'ACCEPTED' ? await this.contactFor(listing.organizationId, listing.createdById) : null,
    };
  }

  async mine(ctx: OrgContext, q: ListingQuery & { status?: ListingStatus }) {
    const where: Prisma.ListingWhereInput = { organizationId: ctx.organizationId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: { _count: { select: { interests: { where: { status: 'PENDING' } } } } },
      }),
      this.prisma.listing.count({ where }),
    ]);
    return paginated(
      rows.map(({ _count, ...l }) => ({ ...l, pendingInterests: _count.interests })),
      total,
      q,
    );
  }

  // ---------- os meus anúncios ----------

  async create(ctx: OrgContext, input: ListingInput) {
    const { durationDays, ...data } = input;
    const listing = await this.prisma.listing.create({
      data: {
        ...data,
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
        status: 'PENDING_REVIEW',
        expiresAt: new Date(Date.now() + durationDays * 86_400_000),
      },
    });
    await this.log(ctx, 'listing.created', listing.id);
    return listing;
  }

  async update(ctx: OrgContext, id: string, input: UpdateListingInput) {
    const listing = await this.own(ctx, id);
    if (listing.status === 'CLOSED') throw conflict('LISTING_CLOSED', 'Este anúncio está fechado');
    // Alterações ao conteúdo voltam a passar pela revisão.
    const updated = await this.prisma.listing.update({
      where: { id },
      data: { ...input, status: 'PENDING_REVIEW', rejectionReason: null },
    });
    await this.log(ctx, 'listing.updated', id, { fields: Object.keys(input) });
    return updated;
  }

  async close(ctx: OrgContext, id: string) {
    await this.own(ctx, id);
    const updated = await this.prisma.listing.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.log(ctx, 'listing.closed', id);
    return updated;
  }

  /** Renova um anúncio expirado: se já tinha sido aprovado, volta a ficar ativo. */
  async renew(ctx: OrgContext, id: string) {
    const listing = await this.own(ctx, id);
    if (listing.status !== 'EXPIRED') throw badRequest('LISTING_NOT_EXPIRED', 'Só anúncios expirados podem ser renovados');
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        status: listing.publishedAt ? 'ACTIVE' : 'PENDING_REVIEW',
        expiresAt: new Date(Date.now() + RENEW_DAYS * 86_400_000),
      },
    });
    await this.log(ctx, 'listing.renewed', id);
    return updated;
  }

  async interests(ctx: OrgContext, id: string) {
    await this.own(ctx, id);
    const rows = await this.prisma.listingInterest.findMany({ where: { listingId: id }, orderBy: { createdAt: 'desc' } });
    const orgs = await this.orgNames(rows.map((r) => r.organizationId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, name: true, email: true, phone: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => {
      const u = byId.get(r.userId);
      return {
        id: r.id,
        status: r.status,
        message: r.message,
        createdAt: r.createdAt,
        organizationName: orgs.get(r.organizationId) ?? '',
        contactName: u?.name ?? null,
        // Contactos só depois de aceitar.
        contact: r.status === 'ACCEPTED' && u ? { email: u.email, phone: u.phone } : null,
      };
    });
  }

  async respond(ctx: OrgContext, listingId: string, interestId: string, status: 'ACCEPTED' | 'DECLINED') {
    const listing = await this.own(ctx, listingId);
    const interest = await this.prisma.listingInterest.findFirst({ where: { id: interestId, listingId } });
    if (!interest) throw notFound('Interesse', 'INTEREST_NOT_FOUND');
    if (interest.status !== 'PENDING') throw conflict('INTEREST_ALREADY_ANSWERED', 'Este interesse já foi respondido');
    const updated = await this.prisma.listingInterest.update({ where: { id: interestId }, data: { status, respondedAt: new Date() } });

    if (status === 'ACCEPTED') {
      const [user, org, contact] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: interest.userId } }),
        this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } }),
        this.contactFor(listing.organizationId, listing.createdById),
      ]);
      if (user) {
        await this.notifications.enqueue({
          template: 'LISTING_INTEREST_ACCEPTED',
          channel: 'EMAIL',
          recipient: user.email,
          userId: user.id,
          dedupeKey: `interest-accepted:${interestId}`,
          data: {
            name: user.name,
            title: listing.title,
            ownerOrg: org.name,
            contact: [contact.name, contact.phone, contact.email].filter(Boolean).join(', '),
            url: `${this.config.get('WEB_URL')}/marketplace/${listing.id}`,
          },
        });
      }
    }
    await this.log(ctx, `listing.interest_${status.toLowerCase()}`, listingId, { interestId });
    return updated;
  }

  // ---------- anúncios de outros ----------

  async expressInterest(ctx: OrgContext, id: string, message?: string) {
    const listing = await this.activeOfOthers(ctx, id);
    let interest;
    try {
      interest = await this.prisma.$transaction(async (tx) => {
        const created = await tx.listingInterest.create({
          data: { listingId: id, organizationId: ctx.organizationId, userId: ctx.userId, message },
        });
        await tx.listing.update({ where: { id }, data: { interestsCount: { increment: 1 } } });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('ALREADY_INTERESTED', 'A sua organização já mostrou interesse neste anúncio');
      }
      throw err;
    }

    const [owner, interestedOrg] = await Promise.all([
      listing.createdById ? this.prisma.user.findUnique({ where: { id: listing.createdById } }) : null,
      this.prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } }),
    ]);
    if (owner) {
      await this.notifications.enqueue({
        template: 'LISTING_INTEREST',
        channel: 'EMAIL',
        recipient: owner.email,
        userId: owner.id,
        dedupeKey: `interest:${interest.id}`,
        data: {
          name: owner.name,
          title: listing.title,
          interestedOrg: interestedOrg.name,
          message: message ?? '',
          url: `${this.config.get('WEB_URL')}/marketplace/meus-anuncios`,
        },
      });
    }
    await this.log(ctx, 'listing.interest_created', id);
    return interest;
  }

  async myInterests(ctx: OrgContext) {
    const rows = await this.prisma.listingInterest.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { listing: true },
    });
    const orgs = await this.orgNames(rows.map((r) => r.listing.organizationId));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        status: r.status,
        message: r.message,
        createdAt: r.createdAt,
        listing: { ...this.card(r.listing), organizationName: orgs.get(r.listing.organizationId) ?? '' },
        contact: r.status === 'ACCEPTED' ? await this.contactFor(r.listing.organizationId, r.listing.createdById) : null,
      })),
    );
  }

  async report(ctx: OrgContext, id: string, input: ListingReportInput) {
    await this.activeOfOthers(ctx, id);
    try {
      const report = await this.prisma.listingReport.create({
        data: { listingId: id, reporterId: ctx.userId, organizationId: ctx.organizationId, ...input },
      });
      await this.log(ctx, 'listing.reported', id, { reason: input.reason });
      return { id: report.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('ALREADY_REPORTED', 'A sua organização já denunciou este anúncio');
      }
      throw err;
    }
  }

  // ---------- administração ----------

  async adminList(q: ListingQuery & { status?: ListingStatus }): Promise<Paginated<unknown>> {
    const where: Prisma.ListingWhereInput = { status: q.status ?? 'PENDING_REVIEW' };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        ...pageArgs(q),
        include: { _count: { select: { reports: { where: { status: 'OPEN' } } } } },
      }),
      this.prisma.listing.count({ where }),
    ]);
    const orgs = await this.orgNames(rows.map((r) => r.organizationId));
    return paginated(
      rows.map(({ _count, ...l }) => ({ ...l, organizationName: orgs.get(l.organizationId) ?? '', openReports: _count.reports })),
      total,
      q,
    );
  }

  async moderate(admin: StaffAuth, id: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw notFound('Anúncio', 'LISTING_NOT_FOUND');
    if (listing.status !== 'PENDING_REVIEW') throw conflict('LISTING_NOT_PENDING', 'O anúncio não está à espera de revisão');
    const approved = decision === 'APPROVE';
    const updated = await this.prisma.listing.update({
      where: { id },
      data: approved
        ? { status: 'ACTIVE', publishedAt: listing.publishedAt ?? new Date(), rejectionReason: null }
        : { status: 'REJECTED', rejectionReason: reason },
    });
    const creator = listing.createdById ? await this.prisma.user.findUnique({ where: { id: listing.createdById } }) : null;
    if (creator) {
      await this.notifications.enqueue({
        template: 'LISTING_REVIEWED',
        channel: 'EMAIL',
        recipient: creator.email,
        userId: creator.id,
        dedupeKey: `listing-reviewed:${id}:${updated.updatedAt.getTime()}`,
        data: {
          name: creator.name,
          title: listing.title,
          approved,
          reason: reason ?? '',
          url: `${this.config.get('WEB_URL')}/marketplace/meus-anuncios`,
        },
      });
    }
    await this.audit.log({
      organizationId: listing.organizationId,
      actorType: 'USER',
      actorId: admin.userId,
      action: approved ? 'listing.approved' : 'listing.rejected',
      entityType: 'listing',
      entityId: id,
      metadata: { reason: reason ?? null },
    });
    return updated;
  }

  async adminReports(status: 'OPEN' | 'REVIEWED' | 'DISMISSED' = 'OPEN') {
    return this.prisma.listingReport.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: { listing: { select: { id: true, title: true, status: true, organizationId: true } } },
      take: 100,
    });
  }

  async resolveReport(admin: StaffAuth, id: string, status: 'REVIEWED' | 'DISMISSED', notes?: string, closeListing = false) {
    const report = await this.prisma.listingReport.findUnique({ where: { id } });
    if (!report) throw notFound('Denúncia', 'REPORT_NOT_FOUND');
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.listingReport.update({
        where: { id },
        data: { status, adminNotes: notes, reviewedById: admin.userId, reviewedAt: new Date() },
      });
      if (closeListing && status === 'REVIEWED') {
        await tx.listing.update({ where: { id: report.listingId }, data: { status: 'CLOSED' } });
      }
      return r;
    });
    await this.audit.log({
      actorType: 'USER',
      actorId: admin.userId,
      action: 'listing.report_resolved',
      entityType: 'listing_report',
      entityId: id,
      metadata: { status, closeListing },
    });
    return updated;
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'marketplace-expire' })
  async scheduledExpire(): Promise<void> {
    if (!this.features.isEnabled('MARKETPLACE')) return;
    await this.cron.run('marketplace-expire', () => this.expire());
  }

  async expire(now = new Date()): Promise<number> {
    const res = await this.prisma.listing.updateMany({
      where: { status: { in: ['ACTIVE', 'PENDING_REVIEW'] }, expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    if (res.count) this.logger.log(`${res.count} anúncios expirados`);
    return res.count;
  }

  // ---------- internos ----------

  private card(l: Listing) {
    return {
      id: l.id,
      title: l.title,
      purpose: l.purpose,
      propertyType: l.propertyType,
      price: l.price,
      currency: l.currency,
      priceNegotiable: l.priceNegotiable,
      neighbourhood: l.neighbourhood,
      city: l.city,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      areaM2: l.areaM2,
      imageUrl: l.imageUrls[0] ?? null,
      status: l.status,
      publishedAt: l.publishedAt,
      expiresAt: l.expiresAt,
    };
  }

  private async own(ctx: OrgContext, id: string) {
    const l = await this.prisma.listing.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!l) throw notFound('Anúncio', 'LISTING_NOT_FOUND');
    return l;
  }

  private async activeOfOthers(ctx: OrgContext, id: string) {
    const l = await this.prisma.listing.findUnique({ where: { id } });
    if (!l || l.status !== 'ACTIVE' || l.expiresAt < new Date()) throw notFound('Anúncio', 'LISTING_NOT_FOUND');
    if (l.organizationId === ctx.organizationId) throw forbidden('OWN_LISTING', 'Este anúncio é da sua organização');
    return l;
  }

  private async recordView(listingId: string, organizationId: string) {
    const res = await this.prisma.listingView.createMany({ data: [{ listingId, organizationId }], skipDuplicates: true });
    if (res.count) await this.prisma.listing.update({ where: { id: listingId }, data: { viewsCount: { increment: 1 } } });
  }

  private async contactFor(organizationId: string, createdById: string | null) {
    const [org, user] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, email: true, phone: true } }),
      createdById ? this.prisma.user.findUnique({ where: { id: createdById }, select: { name: true, email: true, phone: true } }) : null,
    ]);
    return {
      organization: org.name,
      name: user?.name ?? null,
      email: user?.email ?? org.email,
      phone: user?.phone ?? org.phone,
    };
  }

  private async orgNames(ids: string[]) {
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(orgs.map((o) => [o.id, o.name]));
  }

  private log(ctx: OrgContext, action: string, entityId: string, metadata?: Prisma.InputJsonValue) {
    return this.audit.log({
      organizationId: ctx.organizationId,
      actorType: 'USER',
      actorId: ctx.userId,
      action,
      entityType: 'listing',
      entityId,
      metadata,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}
