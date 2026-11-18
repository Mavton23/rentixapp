import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  createLeaseSchema,
  leaseQuerySchema,
  terminateLeaseSchema,
  type CreateLeaseInput,
  type TerminateLeaseInput,
} from '@rentix/shared';
import { LeasesService } from './leases.service';
import { BillingModule } from '../billing/billing.module';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

@ApiTags('Contratos')
@ApiBearerAuth()
@Controller('leases')
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  @ApiZodQuery(leaseQuerySchema)
  list(@Org() ctx: OrgContext, @Query(new ZodPipe(leaseQuerySchema)) q: z.infer<typeof leaseQuerySchema>) {
    return this.leases.list(ctx, q);
  }

  @Get(':id')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leases.get(ctx, id);
  }

  @Post()
  @Roles('MANAGER')
  @ApiOperation({
    summary: 'Criar contrato. Com activate=true ocupa a unidade e emite caução e rendas devidas.',
  })
  @ApiZodBody(createLeaseSchema)
  create(@Org() ctx: OrgContext, @Body(new ZodPipe(createLeaseSchema)) body: CreateLeaseInput) {
    return this.leases.create(ctx, body);
  }

  @Post(':id/activate')
  @Roles('MANAGER')
  @HttpCode(200)
  activate(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leases.activate(ctx, id);
  }

  @Post(':id/terminate')
  @Roles('MANAGER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terminar contrato: liberta a unidade e anula rendas futuras não pagas' })
  @ApiZodBody(terminateLeaseSchema)
  terminate(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(terminateLeaseSchema)) body: TerminateLeaseInput,
  ) {
    return this.leases.terminate(ctx, id, body);
  }
}

@Module({
  imports: [BillingModule],
  controllers: [LeasesController],
  providers: [LeasesService],
})
export class LeasesModule {}
