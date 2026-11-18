import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/auth.decorators';

@ApiTags('Sistema')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Para o balanceador/monitorização: 200 se a base de dados responde. */
  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ code: 'DB_UNAVAILABLE', message: 'Base de dados indisponível' });
    }
  }
}
