import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  blogCategorySchema,
  blogPostSchema,
  blogQuerySchema,
  updateBlogPostSchema,
  type BlogCategoryInput,
  type BlogPostInput,
  type UpdateBlogPostInput,
} from '@rentix/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequireFeature } from '../features/features';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApiZodBody, ApiZodQuery } from '../../common/decorators/api-zod.decorator';
import { CurrentStaff, PlatformAdmin, Public } from '../../common/decorators/auth.decorators';
import type { StaffAuth } from '../../common/auth-context';
import { conflict, notFound } from '../../common/utils/errors';
import { pageArgs, paginated } from '../../common/utils/pagination';
import { slugify } from '../../common/utils/slug';
import { Prisma } from '../../generated/prisma/client';

type BlogQuery = z.infer<typeof blogQuerySchema>;

/** ~200 palavras por minuto. */
export function readTime(markdown: string): number {
  return Math.max(1, Math.round(markdown.split(/\s+/).filter(Boolean).length / 200));
}

const PUBLIC_POST = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverImageUrl: true,
  featured: true,
  readTimeMinutes: true,
  publishedAt: true,
  category: { select: { name: true, slug: true } },
} satisfies Prisma.BlogPostSelect;

@Injectable()
export class BlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- público ----------

  async listPublished(q: BlogQuery) {
    const where: Prisma.BlogPostWhereInput = {
      status: 'PUBLISHED',
      publishedAt: { lte: new Date() },
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.search
        ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { excerpt: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        select: PUBLIC_POST,
        orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async getPublished(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
      select: { ...PUBLIC_POST, content: true, seoTitle: true, seoDescription: true, updatedAt: true },
    });
    if (!post) throw notFound('Artigo', 'POST_NOT_FOUND');
    return post;
  }

  categories() {
    return this.prisma.blogCategory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true, _count: { select: { posts: { where: { status: 'PUBLISHED' } } } } },
    });
  }

  // ---------- administração ----------

  async adminList(q: BlogQuery) {
    const where: Prisma.BlogPostWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: { category: { select: { name: true } } },
        ...pageArgs(q),
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async adminGet(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw notFound('Artigo', 'POST_NOT_FOUND');
    return post;
  }

  async create(admin: StaffAuth, input: BlogPostInput) {
    const post = await this.write(() =>
      this.prisma.blogPost.create({
        data: {
          ...input,
          slug: input.slug ?? slugify(input.title),
          readTimeMinutes: readTime(input.content),
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
          authorId: admin.userId,
        },
      }),
    );
    await this.audit.log({ actorType: 'USER', actorId: admin.userId, action: 'blog.post_created', entityType: 'blog_post', entityId: post.id });
    return post;
  }

  async update(admin: StaffAuth, id: string, input: UpdateBlogPostInput) {
    const current = await this.adminGet(id);
    const post = await this.write(() =>
      this.prisma.blogPost.update({
        where: { id },
        data: {
          ...input,
          ...(input.content ? { readTimeMinutes: readTime(input.content) } : {}),
          // Primeira publicação fixa a data; republicar não a altera.
          ...(input.status === 'PUBLISHED' && !current.publishedAt ? { publishedAt: new Date() } : {}),
        },
      }),
    );
    await this.audit.log({
      actorType: 'USER',
      actorId: admin.userId,
      action: 'blog.post_updated',
      entityType: 'blog_post',
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return post;
  }

  async remove(admin: StaffAuth, id: string) {
    await this.adminGet(id);
    await this.prisma.blogPost.delete({ where: { id } });
    await this.audit.log({ actorType: 'USER', actorId: admin.userId, action: 'blog.post_deleted', entityType: 'blog_post', entityId: id });
  }

  createCategory(input: BlogCategoryInput) {
    return this.write(() =>
      this.prisma.blogCategory.create({ data: { ...input, slug: input.slug ?? slugify(input.name) } }),
    );
  }

  async updateCategory(id: string, input: BlogCategoryInput) {
    return this.write(() => this.prisma.blogCategory.update({ where: { id }, data: input }));
  }

  async deleteCategory(id: string) {
    // Os artigos ficam sem categoria (onDelete: SetNull).
    await this.prisma.blogCategory.delete({ where: { id } });
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('SLUG_TAKEN', 'Já existe um registo com este endereço (slug) ou nome');
      }
      throw err;
    }
  }
}

@ApiTags('Blog')
@RequireFeature('BLOG')
@Controller('blog')
export class BlogPublicController {
  constructor(private readonly blog: BlogService) {}

  @Public()
  @Get('posts')
  @ApiZodQuery(blogQuerySchema)
  list(@Query(new ZodPipe(blogQuerySchema)) q: BlogQuery) {
    return this.blog.listPublished(q);
  }

  @Public()
  @Get('posts/:slug')
  get(@Param('slug') slug: string) {
    return this.blog.getPublished(slug);
  }

  @Public()
  @Get('categories')
  categories() {
    return this.blog.categories();
  }
}

@ApiTags('Administração — blog')
@ApiBearerAuth()
@PlatformAdmin()
@RequireFeature('BLOG')
@Controller('admin/blog')
export class BlogAdminController {
  constructor(private readonly blog: BlogService) {}

  @Get('posts')
  @ApiZodQuery(blogQuerySchema)
  list(@Query(new ZodPipe(blogQuerySchema)) q: BlogQuery) {
    return this.blog.adminList(q);
  }

  @Get('posts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.adminGet(id);
  }

  @Post('posts')
  @ApiZodBody(blogPostSchema)
  create(@CurrentStaff() admin: StaffAuth, @Body(new ZodPipe(blogPostSchema)) body: BlogPostInput) {
    return this.blog.create(admin, body);
  }

  @Patch('posts/:id')
  @ApiZodBody(updateBlogPostSchema)
  update(
    @CurrentStaff() admin: StaffAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateBlogPostSchema)) body: UpdateBlogPostInput,
  ) {
    return this.blog.update(admin, id, body);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  async remove(@CurrentStaff() admin: StaffAuth, @Param('id', ParseUUIDPipe) id: string) {
    await this.blog.remove(admin, id);
  }

  @Post('categories')
  @ApiZodBody(blogCategorySchema)
  createCategory(@Body(new ZodPipe(blogCategorySchema)) body: BlogCategoryInput) {
    return this.blog.createCategory(body);
  }

  @Put('categories/:id')
  @ApiZodBody(blogCategorySchema)
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(blogCategorySchema)) body: BlogCategoryInput) {
    return this.blog.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    await this.blog.deleteCategory(id);
  }
}

@Module({
  controllers: [BlogPublicController, BlogAdminController],
  providers: [BlogService],
})
export class BlogModule {}
