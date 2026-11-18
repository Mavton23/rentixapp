import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  acceptMemberInviteSchema,
  type AcceptMemberInviteInput,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrganizationSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  setLocaleSchema,
  type SetLocaleInput,
} from '@rentix/shared';
import { AuthService, StaffSessionResult } from './auth.service';
import { requestLocale } from '../../common/i18n';
import { STAFF_REFRESH_COOKIE, TokenService } from './token.service';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody } from '../../common/decorators/api-zod.decorator';
import {
  CurrentStaff,
  NoOrganizationRequired,
  Public,
  ReqMeta,
} from '../../common/decorators/auth.decorators';
import type { RequestMeta, StaffAuth } from '../../common/auth-context';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Autenticação (equipa)')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  @ApiOperation({ summary: 'Criar conta e organização (o utilizador fica como OWNER)' })
  @ApiZodBody(registerSchema)
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // O idioma em que a conta é criada fica como idioma da organização e do utilizador.
    return this.respond(res, await this.auth.register(body, meta, requestLocale(req)));
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Entrar. Devolve access token; o refresh token vai em cookie httpOnly.' })
  @ApiZodBody(loginSchema)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body, meta));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  @ApiOperation({ summary: 'Renovar o access token (usa o cookie de refresh)' })
  async refresh(
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return this.respond(res, await this.auth.refresh(this.readRefresh(req), meta));
    } catch (err) {
      this.tokens.clearRefreshCookie(res, 'staff');
      throw err;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  @ApiOperation({ summary: 'Terminar a sessão atual' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.readRefresh(req));
    this.tokens.clearRefreshCookie(res, 'staff');
  }

  @NoOrganizationRequired()
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('switch-organization')
  @ApiOperation({ summary: 'Mudar a organização ativa' })
  @ApiZodBody(switchOrganizationSchema)
  async switchOrganization(
    @CurrentStaff() staff: StaffAuth,
    @Body(new ZodPipe(switchOrganizationSchema)) body: { organizationId: string },
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.switchOrganization(
      staff.userId,
      body.organizationId,
      this.readRefresh(req),
      meta,
    );
    return this.respond(res, result);
  }

  @NoOrganizationRequired()
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Utilizador autenticado e organizações a que pertence' })
  me(@CurrentStaff() staff: StaffAuth) {
    return this.auth.me(staff.userId);
  }

  @NoOrganizationRequired()
  @ApiBearerAuth()
  @Patch('me/locale')
  @ApiOperation({ summary: 'Idioma da conta (interface, emails e SMS)' })
  @ApiZodBody(setLocaleSchema)
  setLocale(@CurrentStaff() staff: StaffAuth, @Body(new ZodPipe(setLocaleSchema)) body: SetLocaleInput) {
    return this.auth.setLocale(staff.userId, body.locale);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Pedir link de recuperação (resposta igual exista ou não o email)' })
  @ApiZodBody(forgotPasswordSchema)
  async forgotPassword(
    @Body(new ZodPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.auth.forgotPassword(body, meta);
    return { message: 'Se o email estiver registado, receberá um link de recuperação.' };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('reset-password')
  @ApiOperation({ summary: 'Definir nova senha com o token recebido por email' })
  @ApiZodBody(resetPasswordSchema)
  async resetPassword(
    @Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.auth.resetPassword(body, meta);
  }

  @NoOrganizationRequired()
  @ApiBearerAuth()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('change-password')
  @ApiOperation({ summary: 'Alterar a senha (termina todas as sessões)' })
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @CurrentStaff() staff: StaffAuth,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(staff.userId, body, meta);
    this.tokens.clearRefreshCookie(res, 'staff');
  }

  @Public()
  @Throttle(STRICT)
  @Get('member-invites/:token')
  @ApiOperation({ summary: 'Ver um convite para a equipa (organização, email, se já tem conta)' })
  previewInvite(@Param('token') token: string) {
    return this.auth.previewMemberInvite(token);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('member-invites/accept')
  @ApiOperation({ summary: 'Aceitar o convite (cria a conta se for preciso) e entrar' })
  @ApiZodBody(acceptMemberInviteSchema)
  async acceptInvite(
    @Body(new ZodPipe(acceptMemberInviteSchema)) body: AcceptMemberInviteInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.acceptMemberInvite(body, meta));
  }

  private readRefresh(req: Request): string | undefined {
    // Cookie para browsers; corpo do pedido para clientes nativos (app móvel no futuro).
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[STAFF_REFRESH_COOKIE];
    const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    return fromCookie ?? (typeof fromBody === 'string' ? fromBody : undefined);
  }

  private respond(res: Response, result: StaffSessionResult) {
    const { refreshToken, ...body } = result;
    this.tokens.setRefreshCookie(res, 'staff', refreshToken);
    return body;
  }
}
