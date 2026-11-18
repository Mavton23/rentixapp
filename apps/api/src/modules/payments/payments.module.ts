import { Body, Controller, Get, Header, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  paymentQuerySchema,
  recordPaymentSchema,
  reversePaymentSchema,
  type RecordPaymentInput,
  type ReversePaymentInput,
} from '@rentix/shared';
import { PaymentsService } from './payments.service';
import { BillingModule } from '../billing/billing.module';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';
import { badRequest } from '../../common/utils/errors';

@ApiTags('Pagamentos')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @ApiZodQuery(paymentQuerySchema)
  list(@Org() ctx: OrgContext, @Query(new ZodPipe(paymentQuerySchema)) q: z.infer<typeof paymentQuerySchema>) {
    return this.payments.list(ctx, q);
  }

  @Get(':id')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(ctx, id);
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Dados para o recibo' })
  receipt(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.receipt({ organizationId: ctx.organizationId }, id);
  }

  @Get(':id/receipt.pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Recibo em PDF' })
  async receiptPdf(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, buffer } = await this.payments.receiptPdf({ organizationId: ctx.organizationId }, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    return new StreamableFile(buffer);
  }

  @Post()
  @Roles('MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Registar pagamento de uma fatura (gera recibo)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Evita pagamentos duplicados em reenvios' })
  @ApiZodBody(recordPaymentSchema)
  record(
    @Org() ctx: OrgContext,
    @Body(new ZodPipe(recordPaymentSchema)) body: RecordPaymentInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 100)) {
      throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key deve ter entre 8 e 100 caracteres');
    }
    return this.payments.record(ctx, body, idempotencyKey);
  }

  @Post(':id/reverse')
  @Roles('MANAGER', 'ACCOUNTANT')
  @HttpCode(200)
  @ApiOperation({ summary: 'Estornar pagamento (fica registado, nunca é apagado)' })
  @ApiZodBody(reversePaymentSchema)
  reverse(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reversePaymentSchema)) body: ReversePaymentInput,
  ) {
    return this.payments.reverse(ctx, id, body);
  }
}

@Module({
  imports: [BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
