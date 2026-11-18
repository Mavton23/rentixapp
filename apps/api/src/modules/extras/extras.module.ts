import { Module } from '@nestjs/common';
import { BlogModule } from './blog.module';
import { SiteModule } from './site.module';
import { TestimonialsModule } from './testimonials.module';
import { StatusModule } from './status.module';
import { MarketplaceModule } from './marketplace.module';

/**
 * Funcionalidades extra. Estão sempre registadas, mas cada rota responde 404 enquanto a
 * respetiva flag não estiver em FEATURES (ver modules/features).
 */
@Module({
  imports: [BlogModule, SiteModule, TestimonialsModule, StatusModule, MarketplaceModule],
})
export class ExtrasModule {}
