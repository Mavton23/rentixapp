import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPropertySchema,
  propertyQuerySchema,
  unitInputSchema,
  updatePropertySchema,
  updateUnitSchema,
  type CreatePropertyInput,
  type UnitInput,
  type UpdatePropertyInput,
  type UpdateUnitInput,
} from '@rentix/shared';
import type { z } from 'zod';
import { PropertiesService } from './properties.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { Org, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext } from '../../common/auth-context';

@ApiTags('Imóveis')
@ApiBearerAuth()
@Controller()
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get('properties')
  @ApiZodQuery(propertyQuerySchema)
  list(@Org() ctx: OrgContext, @Query(new ZodPipe(propertyQuerySchema)) q: z.infer<typeof propertyQuerySchema>) {
    return this.properties.list(ctx, q);
  }

  @Get('properties/:id')
  get(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.properties.get(ctx, id);
  }

  @Post('properties')
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Criar imóvel. Sem "units", cria uma unidade "Principal".' })
  @ApiZodBody(createPropertySchema)
  create(@Org() ctx: OrgContext, @Body(new ZodPipe(createPropertySchema)) body: CreatePropertyInput) {
    return this.properties.create(ctx, body);
  }

  @Patch('properties/:id')
  @Roles('MANAGER')
  @ApiZodBody(updatePropertySchema)
  update(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePropertySchema)) body: UpdatePropertyInput,
  ) {
    return this.properties.update(ctx, id, body);
  }

  @Delete('properties/:id')
  @Roles('MANAGER')
  @HttpCode(204)
  @ApiOperation({ summary: 'Arquivar imóvel (só sem contratos ativos)' })
  async archive(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.properties.archive(ctx, id);
  }

  @Post('properties/:id/units')
  @Roles('MANAGER')
  @ApiZodBody(unitInputSchema)
  addUnit(
    @Org() ctx: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(unitInputSchema)) body: UnitInput,
  ) {
    return this.properties.addUnit(ctx, id, body);
  }

  @Get('units/available')
  @ApiOperation({ summary: 'Unidades livres (para criar contratos)' })
  available(@Org() ctx: OrgContext) {
    return this.properties.availableUnits(ctx);
  }

  @Patch('units/:unitId')
  @Roles('MANAGER')
  @ApiZodBody(updateUnitSchema)
  updateUnit(
    @Org() ctx: OrgContext,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(updateUnitSchema)) body: UpdateUnitInput,
  ) {
    return this.properties.updateUnit(ctx, unitId, body);
  }

  @Delete('units/:unitId')
  @Roles('MANAGER')
  @HttpCode(204)
  async archiveUnit(@Org() ctx: OrgContext, @Param('unitId', ParseUUIDPipe) unitId: string) {
    await this.properties.archiveUnit(ctx, unitId);
  }
}

@Module({
  controllers: [PropertiesController],
  providers: [PropertiesService],
})
export class PropertiesModule {}
