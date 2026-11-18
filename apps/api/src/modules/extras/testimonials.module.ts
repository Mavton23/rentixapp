import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  MODERATION_STATUSES,
  moderateTestimonialSchema,
  paginationSchema,
  testimonialSchema,
  type TestimonialInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequireFeature } from '../features/features';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { CurrentStaff, NoOrganizationRequired, PlatformAdmin, Public } from '../../common/decorators/auth.decorators';
import type { StaffAuth } from '../../common/auth-context';
import { notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';

const adminQuery = paginationSchema.extend({ status: z.enum(MODERATION_STATUSES).optional() });

@Injectable()
export class TestimonialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listApproved() {
    return this.prisma.testimonial.findMany({
      where: { status: 'APPROVED' },
      orderBy: [{ rating: 'desc' }, { reviewedAt: 'desc' }],
      take: 30,
      select: { id: true, name: true, role: true, city: true, rating: true, message: true },
    });
  }

  mine(userId: string) {
    return this.prisma.testimonial.findUnique({ where: { userId } });
  }

  /** Um testemunho por utilizador; editá-lo volta a pô-lo em revisão. */
  upsertMine(staff: StaffAuth, input: TestimonialInput) {
    return this.prisma.testimonial.upsert({
      where: { userId: staff.userId },
      update: { ...input, status: 'PENDING', reviewedAt: null, organizationId: staff.organizationId },
      create: { ...input, userId: staff.userId, organizationId: staff.organizationId },
    });
  }

  async adminList(q: z.infer<typeof adminQuery>) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.testimonial.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.testimonial.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async moderate(admin: StaffAuth, id: string, status: 'APPROVED' | 'REJECTED') {
    const t = await this.prisma.testimonial.findUnique({ where: { id } });
    if (!t) throw notFound('Testemunho', 'TESTIMONIAL_NOT_FOUND');
    const updated = await this.prisma.testimonial.update({ where: { id }, data: { status, reviewedAt: new Date() } });
    await this.audit.log({
      actorType: 'USER',
      actorId: admin.userId,
      action: 'testimonial.moderated',
      entityType: 'testimonial',
      entityId: id,
      metadata: { status },
    });
    return updated;
  }
}

@ApiTags('Testemunhos')
@RequireFeature('TESTIMONIALS')
@Controller('testimonials')
export class TestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Public()
  @Get()
  list() {
    return this.testimonials.listApproved();
  }

  @ApiBearerAuth()
  @NoOrganizationRequired()
  @Get('mine')
  mine(@CurrentStaff() staff: StaffAuth) {
    return this.testimonials.mine(staff.userId);
  }

  @ApiBearerAuth()
  @NoOrganizationRequired()
  @Put('mine')
  @ApiZodBody(testimonialSchema)
  upsert(@CurrentStaff() staff: StaffAuth, @Body(new ZodPipe(testimonialSchema)) body: TestimonialInput) {
    return this.testimonials.upsertMine(staff, body);
  }
}

@ApiTags('Administração — testemunhos')
@ApiBearerAuth()
@PlatformAdmin()
@RequireFeature('TESTIMONIALS')
@Controller('admin/testimonials')
export class TestimonialsAdminController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @ApiZodQuery(adminQuery)
  list(@Query(new ZodPipe(adminQuery)) q: z.infer<typeof adminQuery>) {
    return this.testimonials.adminList(q);
  }

  @Patch(':id')
  @ApiZodBody(moderateTestimonialSchema)
  moderate(
    @CurrentStaff() admin: StaffAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(moderateTestimonialSchema)) body: z.infer<typeof moderateTestimonialSchema>,
  ) {
    return this.testimonials.moderate(admin, id, body.status);
  }
}

@Module({
  controllers: [TestimonialsController, TestimonialsAdminController],
  providers: [TestimonialsService],
})
export class TestimonialsModule {}
