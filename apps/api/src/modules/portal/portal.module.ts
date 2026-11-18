import { Body, Controller, Get, Header, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  acceptTenantInviteSchema,
  paginationSchema,
  payInvoiceSchema,
  type PayInvoiceInput,
  portalInvoiceQuerySchema,
  resetPasswordSchema,
  tenantForgotPasswordSchema,
  tenantLoginSchema,
  verifyInviteSchema,
  type AcceptTenantInviteInput,
  type PaginationInput,
  type ResetPasswordInput,
  type TenantForgotPasswordInput,
  type TenantLoginInput,
  setLocaleSchema,
  type SetLocaleInput,
} from '@rentix/shared';
import { PortalAuthService, TenantSessionResult } from './portal-auth.service';
import { PortalService } from './portal.service';
import { TENANT_REFRESH_COOKIE, TokenService } from '../auth/token.service';
import { MobilePaymentsModule } from '../mobile-payments/mobile-payments.module';
import { MobilePaymentsService } from '../mobile-payments/mobile-payments.service';
import { PaymentsService } from '../payments/payments.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { CurrentTenant, Public, ReqMeta, TenantRoute } from '../../common/decorators/auth.decorators';
import type { RequestMeta, TenantAuth } from '../../common/auth-context';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Portal do inquilino — autenticação')
@Controller('portal/auth')
export class PortalAuthController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('invite/verify')
  @ApiOperation({ summary: 'Validar convite e mostrar a quem pertence' })
  @ApiZodBody(verifyInviteSchema)
  verify(@Body(new ZodPipe(verifyInviteSchema)) body: { token: string }) {
    return this.auth.verifyInvite(body.token);
  }

  @Public()
  @Throttle(STRICT)
  @Post('invite/accept')
  @ApiOperation({ summary: 'Aceitar convite: cria a conta (ou liga a uma conta existente) e entra' })
  @ApiZodBody(acceptTenantInviteSchema)
  async accept(
    @Body(new ZodPipe(acceptTenantInviteSchema)) body: AcceptTenantInviteInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.acceptInvite(body, meta));
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Entrar com email ou telefone' })
  @ApiZodBody(tenantLoginSchema)
  async login(
    @Body(new ZodPipe(tenantLoginSchema)) body: TenantLoginInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body, meta));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(this.readRefresh(req), meta));
    } catch (err) {
      this.tokens.clearRefreshCookie(res, 'tenant');
      throw err;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.readRefresh(req));
    this.tokens.clearRefreshCookie(res, 'tenant');
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  @ApiZodBody(tenantForgotPasswordSchema)
  async forgot(@Body(new ZodPipe(tenantForgotPasswordSchema)) body: TenantForgotPasswordInput, @ReqMeta() meta: RequestMeta) {
    await this.auth.forgotPassword(body, meta);
    return { message: 'Se a conta existir, receberá um link de recuperação.' };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('reset-password')
  @ApiZodBody(resetPasswordSchema)
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput, @ReqMeta() meta: RequestMeta) {
    await this.auth.resetPassword(body, meta);
  }

  private readRefresh(req: Request): string | undefined {
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[TENANT_REFRESH_COOKIE];
    const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    return fromCookie ?? (typeof fromBody === 'string' ? fromBody : undefined);
  }

  private respond(res: Response, result: TenantSessionResult) {
    const { refreshToken, ...body } = result;
    this.tokens.setRefreshCookie(res, 'tenant', refreshToken);
    return body;
  }
}

@ApiTags('Portal do inquilino')
@ApiBearerAuth()
@TenantRoute()
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly mobile: MobilePaymentsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get('me')
  me(@CurrentTenant() t: TenantAuth) {
    return this.portal.me(t.accountId);
  }

  @Patch('me/locale')
  @ApiOperation({ summary: 'Idioma do inquilino (portal, SMS, emails e recibos)' })
  @ApiZodBody(setLocaleSchema)
  setLocale(@CurrentTenant() t: TenantAuth, @Body(new ZodPipe(setLocaleSchema)) body: SetLocaleInput) {
    return this.portal.setLocale(t.accountId, body.locale);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Saldo em dívida, próxima fatura e faturas em atraso' })
  summary(@CurrentTenant() t: TenantAuth) {
    return this.portal.summary(t.accountId);
  }

  @Get('leases')
  leases(@CurrentTenant() t: TenantAuth) {
    return this.portal.leases(t.accountId);
  }

  @Get('invoices')
  @ApiZodQuery(portalInvoiceQuerySchema)
  invoices(@CurrentTenant() t: TenantAuth, @Query(new ZodPipe(portalInvoiceQuerySchema)) q: z.infer<typeof portalInvoiceQuerySchema>) {
    return this.portal.invoices(t.accountId, q);
  }

  @Get('invoices/:id')
  invoice(@CurrentTenant() t: TenantAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.invoice(t.accountId, id);
  }

  @Get('payments')
  @ApiZodQuery(paginationSchema)
  payments(@CurrentTenant() t: TenantAuth, @Query(new ZodPipe(paginationSchema)) q: PaginationInput) {
    return this.portal.payments(t.accountId, q);
  }

  @Post('invoices/:id/pay')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pagar por M-Pesa / e-Mola: o telemóvel recebe o pedido para introduzir o PIN' })
  @ApiZodBody(payInvoiceSchema)
  pay(
    @CurrentTenant() t: TenantAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(payInvoiceSchema)) body: PayInvoiceInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.mobile.initiate(
      { ...body, invoiceId: id, tenantAccountId: t.accountId, initiatedBy: 'TENANT', actorId: t.accountId },
      meta,
    );
  }

  @Get('payments/:id/status')
  @ApiOperation({ summary: 'Estado de um pagamento móvel em curso' })
  paymentStatus(@CurrentTenant() t: TenantAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.mobile.status(id, { tenantAccountId: t.accountId });
  }

  @Get('payments/:id/receipt.pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Recibo em PDF' })
  async receiptPdf(
    @CurrentTenant() t: TenantAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, buffer } = await this.paymentsService.receiptPdf({ tenantAccountId: t.accountId }, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }
}

@Module({
  imports: [MobilePaymentsModule],
  controllers: [PortalAuthController, PortalController],
  providers: [PortalAuthService, PortalService],
})
export class PortalModule {}
