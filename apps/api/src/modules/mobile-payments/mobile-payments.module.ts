import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  mpesaGatewaySchema,
  requestMobilePaymentSchema,
  simulatorGatewaySchema,
  type MpesaGatewayInput,
  type RequestMobilePaymentInput,
  type SimulatorGatewayInput,
} from '@rentix/shared';
import { PaymentsModule } from '../payments/payments.module';
import { GatewaysService } from './gateways.service';
import { MobilePaymentsService } from './mobile-payments.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

@ApiTags('Pagamentos móveis')
@ApiBearerAuth()
@Controller('payment-gateways')
export class GatewaysController {
  constructor(private readonly gateways: GatewaysService) {}

  @Get()
  @Roles('MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Fornecedores de pagamento ligados (as credenciais nunca são devolvidas)' })
  list(@Org() ctx: OrgContext) {
    return this.gateways.list(ctx);
  }

  @Put('mpesa')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Ligar a conta M-Pesa (Vodacom) da organização' })
  @ApiZodBody(mpesaGatewaySchema)
  saveMpesa(@Org() ctx: OrgContext, @Body(new ZodPipe(mpesaGatewaySchema)) body: MpesaGatewayInput) {
    return this.gateways.saveMpesa(ctx, body);
  }

  @Put('simulator')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Ligar o simulador (só fora de produção)' })
  @ApiZodBody(simulatorGatewaySchema)
  saveSimulator(@Org() ctx: OrgContext, @Body(new ZodPipe(simulatorGatewaySchema)) body: SimulatorGatewayInput) {
    return this.gateways.saveSimulator(ctx, body);
  }
}

@ApiTags('Pagamentos móveis')
@ApiBearerAuth()
@Controller('payments/mobile')
export class StaffMobilePaymentsController {
  constructor(private readonly mobile: MobilePaymentsService) {}

  @Post()
  @Roles('MANAGER', 'ACCOUNTANT')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pedir o pagamento ao inquilino: recebe no telemóvel o pedido de PIN' })
  @ApiZodBody(requestMobilePaymentSchema)
  request(@Org() ctx: OrgContext, @Body(new ZodPipe(requestMobilePaymentSchema)) body: RequestMobilePaymentInput) {
    return this.mobile.initiate(
      { ...body, organizationId: ctx.organizationId, initiatedBy: 'USER', actorId: ctx.userId },
      { ip: ctx.ip, userAgent: ctx.userAgent },
    );
  }

  @Get(':id/status')
  status(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mobile.status(id, { organizationId: ctx.organizationId });
  }
}

@Module({
  imports: [PaymentsModule],
  controllers: [GatewaysController, StaffMobilePaymentsController],
  providers: [GatewaysService, MobilePaymentsService],
  exports: [GatewaysService, MobilePaymentsService, PaymentsModule],
})
export class MobilePaymentsModule {}
