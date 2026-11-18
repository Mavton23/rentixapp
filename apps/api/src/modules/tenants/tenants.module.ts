import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  createTenantSchema,
  tenantQuerySchema,
  updateTenantSchema,
  type CreateTenantInput,
  type UpdateTenantInput,
} from '@rentix/shared';
import { TenantsService } from './tenants.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

@ApiTags('Inquilinos')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @ApiZodQuery(tenantQuerySchema)
  list(@Org() ctx: OrgContext, @Query(new ZodPipe(tenantQuerySchema)) q: z.infer<typeof tenantQuerySchema>) {
    return this.tenants.list(ctx, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha do inquilino, contratos e saldo em dívida' })
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(ctx, id);
  }

  @Post()
  @Roles('MANAGER')
  @ApiZodBody(createTenantSchema)
  create(@Org() ctx: OrgContext, @Body(new ZodPipe(createTenantSchema)) body: CreateTenantInput) {
    return this.tenants.create(ctx, body);
  }

  @Patch(':id')
  @Roles('MANAGER')
  @ApiZodBody(updateTenantSchema)
  update(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTenantSchema)) body: UpdateTenantInput,
  ) {
    return this.tenants.update(ctx, id, body);
  }

  @Delete(':id')
  @Roles('MANAGER')
  @HttpCode(204)
  async archive(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.tenants.archive(ctx, id);
  }

  @Post(':id/invite')
  @Roles('MANAGER')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Convidar o inquilino para o portal (email e/ou SMS)' })
  invite(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.invite(ctx, id);
  }
}

@Module({
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
