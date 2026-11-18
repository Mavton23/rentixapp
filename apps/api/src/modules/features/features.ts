import {
  CanActivate,
  ExecutionContext,
  Global,
  Injectable,
  Module,
  NotFoundException,
  SetMetadata,
  Controller,
  Get,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_FLAGS, type FeatureFlag } from '@rentix/shared';
import { AppConfig } from '../../config/app-config.service';
import { Public } from '../../common/decorators/auth.decorators';

/**
 * Feature flags. As funcionalidades extra (blog, CMS, marketplace, página de estado,
 * testemunhos) existem no código mas só são ativadas se estiverem em FEATURES=...
 * Uma rota marcada com @RequireFeature('BLOG') responde 404 enquanto a flag estiver desligada.
 */
@Injectable()
export class FeaturesService {
  private readonly enabled: Set<FeatureFlag>;

  constructor(config: AppConfig) {
    this.enabled = new Set(config.get('FEATURES'));
  }

  isEnabled(flag: FeatureFlag): boolean {
    return this.enabled.has(flag);
  }

  all(): Record<FeatureFlag, boolean> {
    return Object.fromEntries(FEATURE_FLAGS.map((f) => [f, this.enabled.has(f)])) as Record<FeatureFlag, boolean>;
  }
}

const FEATURE_KEY = 'rentix:feature';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const flag = this.reflector.getAllAndOverride<FeatureFlag>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (flag && !this.features.isEnabled(flag)) throw new NotFoundException();
    return true;
  }
}

export const RequireFeature = (flag: FeatureFlag) =>
  applyDecorators(SetMetadata(FEATURE_KEY, flag), UseGuards(FeatureGuard));

@ApiTags('Sistema')
@Controller('features')
class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  /** O frontend usa isto para esconder menus de funcionalidades desligadas. */
  @Public()
  @Get()
  list() {
    return this.features.all();
  }
}

@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, FeatureGuard],
  exports: [FeaturesService, FeatureGuard],
})
export class FeaturesModule {}
