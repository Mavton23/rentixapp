import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  createInvoiceSchema,
  invoiceQuerySchema,
  voidInvoiceSchema,
  type CreateInvoiceInput,
  type VoidInvoiceInput,
} from '@rentix/shared';
import { BillingService } from './billing.service';
import { InvoicesService } from './invoices.service';
import { DocumentNumberService } from './document-number.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

@ApiTags('Faturas')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiZodQuery(invoiceQuerySchema)
  list(@Org() ctx: OrgContext, @Query(new ZodPipe(invoiceQuerySchema)) q: z.infer<typeof invoiceQuerySchema>) {
    return this.invoices.list(ctx, q);
  }

  @Get(':id')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(ctx, id);
  }

  @Post()
  @Roles('MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Fatura avulsa (caução ou outra despesa). As rendas são automáticas.' })
  @ApiZodBody(createInvoiceSchema)
  create(@Org() ctx: OrgContext, @Body(new ZodPipe(createInvoiceSchema)) body: CreateInvoiceInput) {
    return this.invoices.create(ctx, body);
  }

  @Post(':id/void')
  @Roles('MANAGER', 'ACCOUNTANT')
  @HttpCode(200)
  @ApiZodBody(voidInvoiceSchema)
  void(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(voidInvoiceSchema)) body: VoidInvoiceInput,
  ) {
    return this.invoices.void(ctx, id, body);
  }
}

@ApiTags('Faturas')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('run')
  @Roles('MANAGER')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Correr agora a faturação da organização (normalmente automática, todos os dias às 06:00)',
  })
  run(@Org() ctx: OrgContext) {
    return this.billing.runForOrganization(ctx.organizationId);
  }
}

@Module({
  controllers: [InvoicesController, BillingController],
  providers: [BillingService, InvoicesService, DocumentNumberService],
  exports: [BillingService, DocumentNumberService],
})
export class BillingModule {}
