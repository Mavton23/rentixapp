import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  addMemberSchema,
  MEMBER_ROLES,
  updateOrganizationSchema,
  type AddMemberInput,
  type MemberRole,
  type UpdateOrganizationInput,
} from '@rentix/shared';
import { OrganizationsService } from './organizations.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import { AllowSuspended, CurrentStaff, NoOrganizationRequired, Org, ReqMeta, Roles } from '../../common/decorators/auth.decorators';
import type { OrgContext, RequestMeta, StaffAuth } from '../../common/auth-context';

const createOrgSchema = z.object({ name: z.string().trim().min(1).max(120) });
const changeRoleSchema = z.object({ role: z.enum(MEMBER_ROLES) });

@ApiTags('Organização')
@ApiBearerAuth()
@Controller('organization')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  @AllowSuspended()
  @ApiOperation({ summary: 'Organização ativa, subscrição e limites do plano' })
  get(@Org() ctx: OrgContext) {
    return this.orgs.getCurrent(ctx);
  }

  @Patch()
  @Roles('MANAGER')
  @ApiOperation({ summary: 'Atualizar dados e definições (multa, tolerância, lembretes...)' })
  @ApiZodBody(updateOrganizationSchema)
  update(@Org() ctx: OrgContext, @Body(new ZodPipe(updateOrganizationSchema)) body: UpdateOrganizationInput) {
    return this.orgs.update(ctx, body);
  }

  @Get('members')
  members(@Org() ctx: OrgContext) {
    return this.orgs.listMembers(ctx);
  }

  @Post('members')
  @Roles('OWNER')
  @ApiZodBody(addMemberSchema)
  addMember(@Org() ctx: OrgContext, @Body(new ZodPipe(addMemberSchema)) body: AddMemberInput) {
    return this.orgs.addMember(ctx, body);
  }

  @Get('invites')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Convites pendentes para a equipa' })
  invites(@Org() ctx: OrgContext) {
    return this.orgs.listInvites(ctx);
  }

  @Delete('invites/:id')
  @Roles('OWNER')
  @HttpCode(204)
  async revokeInvite(@Org() ctx: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.orgs.revokeInvite(ctx, id);
  }

  @Put('members/:userId/role')
  @Roles('OWNER')
  @ApiZodBody(changeRoleSchema)
  changeRole(
    @Org() ctx: OrgContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(changeRoleSchema)) body: { role: MemberRole },
  ) {
    return this.orgs.changeRole(ctx, userId, body.role);
  }

  @Delete('members/:userId')
  @Roles('OWNER')
  @HttpCode(204)
  async removeMember(@Org() ctx: OrgContext, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.orgs.removeMember(ctx, userId);
  }
}

@ApiTags('Organização')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsCreateController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  @NoOrganizationRequired()
  @ApiOperation({ summary: 'Criar outra organização (o utilizador fica como OWNER)' })
  @ApiZodBody(createOrgSchema)
  create(
    @CurrentStaff() staff: StaffAuth,
    @Body(new ZodPipe(createOrgSchema)) body: { name: string },
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.orgs.create(staff.userId, body.name, meta);
  }
}

@Module({
  controllers: [OrganizationsController, OrganizationsCreateController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
