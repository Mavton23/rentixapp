import { Body, Controller, Get, Header, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  checkoutSchema,
  paySubscriptionSchema,
  quoteQuerySchema,
  type CheckoutInput,
  type PaySubscriptionInput,
} from '@rentix/shared';
import { MobilePaymentsModule } from '../mobile-payments/mobile-payments.module';
import { SubscriptionsService } from './subscriptions.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import { AllowSuspended, Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

/** Plano e faturação da organização ativa. Ver: toda a equipa. Mudar e pagar: só o proprietário. */
@ApiTags('Plano e faturação')
@ApiBearerAuth()
@AllowSuspended()
@Controller('billing')
export class BillingController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Plano atual, limites, uso, planos disponíveis e faturas em aberto' })
  overview(@Org() ctx: OrgContext) {
    return this.subs.overview(ctx.organizationId);
  }

  @Get('quote')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Pré-visualizar uma mudança de plano (valor, crédito, quando se aplica)' })
  quote(@Org() ctx: OrgContext, @Query(new ZodPipe(quoteQuerySchema)) q: CheckoutInput) {
    return this.subs.quote(ctx.organizationId, q);
  }

  @Post('checkout')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Mudar de plano: cria a fatura a pagar, ou agenda a mudança para o fim do período' })
  @ApiZodBody(checkoutSchema)
  checkout(@Org() ctx: OrgContext, @Body(new ZodPipe(checkoutSchema)) body: CheckoutInput) {
    return this.subs.checkout(ctx, body);
  }

  @Post('keep-current')
  @Roles('OWNER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desfazer uma mudança agendada ou o pedido para não renovar' })
  keep(@Org() ctx: OrgContext) {
    return this.subs.keepCurrentPlan(ctx);
  }

  @Get('invoices')
  @Roles('ACCOUNTANT')
  invoices(@Org() ctx: OrgContext) {
    return this.subs.listInvoices(ctx.organizationId);
  }

  @Get('invoices/:id/pdf')
  @Roles('ACCOUNTANT')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Fatura (ou fatura-recibo) em PDF' })
  async pdf(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, pdf } = await this.subs.invoicePdf(id, ctx.organizationId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(pdf);
  }

  @Post('invoices/:id/pay')
  @Roles('OWNER')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pagar por M-Pesa/e-Mola: o pedido chega ao telemóvel para confirmar com o PIN' })
  @ApiZodBody(paySubscriptionSchema)
  pay(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paySubscriptionSchema)) body: PaySubscriptionInput) {
    return this.subs.pay(ctx, id, body);
  }

  @Get('payments/:id')
  @Roles('OWNER')
  paymentStatus(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.subs.paymentStatus(ctx.organizationId, id);
  }
}

@Module({
  imports: [MobilePaymentsModule],
  controllers: [BillingController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
