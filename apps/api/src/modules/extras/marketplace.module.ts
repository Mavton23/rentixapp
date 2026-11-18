import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  LISTING_STATUSES,
  listingInterestSchema,
  listingQuerySchema,
  listingReportSchema,
  listingSchema,
  moderateListingSchema,
  REPORT_STATUSES,
  resolveReportSchema,
  respondInterestSchema,
  updateListingSchema,
  type ListingInput,
  type ListingReportInput,
  type UpdateListingInput,
} from '@rentix/shared';
import { MarketplaceService } from './marketplace.service';
import { RequireFeature } from '../features/features';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { CurrentStaff, Org, PlatformAdmin, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext, StaffAuth } from '../../common/auth-context';

type ListingQuery = z.infer<typeof listingQuerySchema>;
const adminListingQuery = listingQuerySchema.extend({ status: z.enum(LISTING_STATUSES).optional() });
const reportQuery = z.object({ status: z.enum(REPORT_STATUSES).optional() });

@ApiTags('Marketplace')
@ApiBearerAuth()
@RequireFeature('MARKETPLACE')
@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly market: MarketplaceService) {}

  @Get('listings')
  @ApiOperation({ summary: 'Anúncios ativos de todas as organizações' })
  @ApiZodQuery(listingQuerySchema)
  browse(@Org() ctx: OrgContext, @Query(new ZodPipe(listingQuerySchema)) q: ListingQuery) {
    return this.market.browse(ctx, q);
  }

  @Get('listings/:id')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.get(ctx, id);
  }

  @Post('listings/:id/interests')
  @Roles('MANAGER')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiZodBody(listingInterestSchema)
  interest(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(listingInterestSchema)) body: z.infer<typeof listingInterestSchema>,
  ) {
    return this.market.expressInterest(ctx, id, body.message);
  }

  @Post('listings/:id/reports')
  @Roles('MANAGER')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiZodBody(listingReportSchema)
  report(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(listingReportSchema)) body: ListingReportInput) {
    return this.market.report(ctx, id, body);
  }

  @Get('my-interests')
  myInterests(@Org() ctx: OrgContext) {
    return this.market.myInterests(ctx);
  }

  @Get('my-listings')
  @ApiZodQuery(listingQuerySchema)
  mine(@Org() ctx: OrgContext, @Query(new ZodPipe(listingQuerySchema)) q: ListingQuery) {
    return this.market.mine(ctx, q);
  }

  @Post('my-listings')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Criar anúncio (fica à espera de revisão)' })
  @ApiZodBody(listingSchema)
  create(@Org() ctx: OrgContext, @Body(new ZodPipe(listingSchema)) body: ListingInput) {
    return this.market.create(ctx, body);
  }

  @Patch('my-listings/:id')
  @Roles('MANAGER')
  @ApiZodBody(updateListingSchema)
  update(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateListingSchema)) body: UpdateListingInput) {
    return this.market.update(ctx, id, body);
  }

  @Post('my-listings/:id/close')
  @Roles('MANAGER')
  @HttpCode(200)
  close(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.close(ctx, id);
  }

  @Post('my-listings/:id/renew')
  @Roles('MANAGER')
  @HttpCode(200)
  renew(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.renew(ctx, id);
  }

  @Get('my-listings/:id/interests')
  interests(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.market.interests(ctx, id);
  }

  @Patch('my-listings/:id/interests/:interestId')
  @Roles('MANAGER')
  @ApiZodBody(respondInterestSchema)
  respond(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Body(new ZodPipe(respondInterestSchema)) body: z.infer<typeof respondInterestSchema>,
  ) {
    return this.market.respond(ctx, id, interestId, body.status);
  }
}

@ApiTags('Administração — marketplace')
@ApiBearerAuth()
@PlatformAdmin()
@RequireFeature('MARKETPLACE')
@Controller('admin/marketplace')
export class MarketplaceAdminController {
  constructor(private readonly market: MarketplaceService) {}

  @Get('listings')
  @ApiZodQuery(adminListingQuery)
  list(@Query(new ZodPipe(adminListingQuery)) q: z.infer<typeof adminListingQuery>) {
    return this.market.adminList(q);
  }

  @Post('listings/:id/moderate')
  @HttpCode(200)
  @ApiZodBody(moderateListingSchema)
  moderate(
    @CurrentStaff() admin: StaffAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(moderateListingSchema)) body: z.infer<typeof moderateListingSchema>,
  ) {
    return this.market.moderate(admin, id, body.decision, body.reason);
  }

  @Get('reports')
  reports(@Query(new ZodPipe(reportQuery)) q: z.infer<typeof reportQuery>) {
    return this.market.adminReports(q.status);
  }

  @Patch('reports/:id')
  @ApiZodBody(resolveReportSchema)
  resolve(
    @CurrentStaff() admin: StaffAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(resolveReportSchema)) body: z.infer<typeof resolveReportSchema>,
  ) {
    return this.market.resolveReport(admin, id, body.status, body.notes, body.closeListing);
  }
}

@Module({
  controllers: [MarketplaceController, MarketplaceAdminController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
