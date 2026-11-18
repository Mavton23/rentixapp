/**
 * Schemas das funcionalidades extra (blog, site, testemunhos, estado, marketplace).
 */
import { z } from 'zod';
import { CURRENCIES, PROPERTY_TYPES } from './enums';
import { MAX_MINOR_AMOUNT } from './money';
import { emailSchema, paginationSchema, phoneSchema } from './schemas';

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();
const url = z.url('URL inválido').max(500);
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use só letras minúsculas, números e hífenes');

// ---------- Blog ----------

export const POST_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const blogCategorySchema = z.object({
  name: text(1, 80),
  slug: slugSchema.optional(),
  description: optional(500),
});
export type BlogCategoryInput = z.infer<typeof blogCategorySchema>;

export const blogPostSchema = z.object({
  title: text(3, 160),
  slug: slugSchema.optional(),
  excerpt: text(10, 400),
  content: text(20, 100_000),
  coverImageUrl: url.nullish(),
  categoryId: z.uuid().nullish(),
  status: z.enum(POST_STATUSES).default('DRAFT'),
  featured: z.boolean().default(false),
  seoTitle: optional(160),
  seoDescription: optional(300),
});
export type BlogPostInput = z.infer<typeof blogPostSchema>;
export const updateBlogPostSchema = blogPostSchema
  .extend({ status: z.enum(POST_STATUSES), featured: z.boolean() })
  .partial();
export type UpdateBlogPostInput = z.infer<typeof updateBlogPostSchema>;

export const blogQuerySchema = paginationSchema.extend({
  category: z.string().trim().max(80).optional(),
  status: z.enum(POST_STATUSES).optional(),
});

// ---------- Conteúdo do site ----------

export const SITE_CONTENT_KEYS = ['about', 'contact', 'features'] as const;
export type SiteContentKey = (typeof SITE_CONTENT_KEYS)[number];

export const aboutContentSchema = z.object({
  title: text(3, 160),
  subtitle: text(3, 400),
  sections: z.array(z.object({ title: text(1, 160), body: text(1, 5000) })).max(10),
  values: z.array(z.object({ title: text(1, 80), description: text(1, 500) })).max(12),
  cta: z.object({ title: text(1, 160), text: text(1, 500), buttonText: text(1, 60) }).nullish(),
});
export type AboutContent = z.infer<typeof aboutContentSchema>;

export const CONTACT_ITEM_TYPES = ['email', 'phone', 'whatsapp', 'address', 'hours'] as const;
export const contactContentSchema = z.object({
  intro: optional(500),
  items: z
    .array(
      z.object({
        type: z.enum(CONTACT_ITEM_TYPES),
        label: text(1, 80),
        value: text(1, 300),
        extra: optional(300),
      }),
    )
    .max(20),
});
export type ContactContent = z.infer<typeof contactContentSchema>;

export const featuresContentSchema = z.object({
  intro: optional(500),
  items: z
    .array(
      z.object({
        title: text(1, 120),
        description: text(1, 600),
        details: z.array(text(1, 200)).max(10).default([]),
      }),
    )
    .max(30),
});
export type FeaturesContent = z.infer<typeof featuresContentSchema>;

export const SITE_CONTENT_SCHEMAS = {
  about: aboutContentSchema,
  contact: contactContentSchema,
  features: featuresContentSchema,
} as const;

export const contactMessageSchema = z.object({
  name: text(2, 120),
  email: emailSchema,
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  subject: text(3, 160),
  message: text(10, 5000),
  /** Campo invisível para apanhar robots: tem de vir vazio. */
  website: z.string().max(0).optional(),
});
export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

export const CONTACT_MESSAGE_STATUSES = ['NEW', 'READ', 'ARCHIVED'] as const;

// ---------- Testemunhos ----------

export const MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const testimonialSchema = z.object({
  name: text(2, 120),
  role: optional(120),
  city: optional(80),
  rating: z.number().int().min(1).max(5),
  message: text(20, 1000),
});
export type TestimonialInput = z.infer<typeof testimonialSchema>;

// ---------- Estado do sistema ----------

export const COMPONENT_STATUSES = ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];
export const INCIDENT_STATUSES = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_IMPACTS = ['NONE', 'MINOR', 'MAJOR', 'CRITICAL'] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

export const statusComponentSchema = z.object({
  name: text(1, 80),
  description: optional(300),
  status: z.enum(COMPONENT_STATUSES).default('OPERATIONAL'),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type StatusComponentInput = z.infer<typeof statusComponentSchema>;
export const updateStatusComponentSchema = statusComponentSchema
  .extend({ status: z.enum(COMPONENT_STATUSES), sortOrder: z.number().int().min(0).max(1000) })
  .partial();

export const createIncidentSchema = z.object({
  title: text(3, 160),
  impact: z.enum(INCIDENT_IMPACTS),
  message: text(3, 2000),
  componentIds: z.array(z.uuid()).max(20).default([]),
  /** Estado a aplicar aos componentes afetados enquanto o incidente estiver aberto. */
  componentStatus: z.enum(COMPONENT_STATUSES).optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const incidentUpdateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  message: text(3, 2000),
});
export type IncidentUpdateInput = z.infer<typeof incidentUpdateSchema>;

// ---------- Marketplace ----------

export const LISTING_STATUSES = ['PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'EXPIRED', 'CLOSED'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export const LISTING_PURPOSES = ['RENT', 'SALE', 'MANAGEMENT'] as const;
export type ListingPurpose = (typeof LISTING_PURPOSES)[number];
export const INTEREST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED'] as const;
export type InterestStatus = (typeof INTEREST_STATUSES)[number];
export const REPORT_REASONS = ['SPAM', 'INAPPROPRIATE', 'FALSE_INFO', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATUSES = ['OPEN', 'REVIEWED', 'DISMISSED'] as const;

export const listingSchema = z.object({
  title: text(5, 140),
  description: text(20, 5000),
  purpose: z.enum(LISTING_PURPOSES),
  propertyType: z.enum(PROPERTY_TYPES),
  price: z.number().int().min(0).max(MAX_MINOR_AMOUNT),
  currency: z.enum(CURRENCIES).default('MZN'),
  priceNegotiable: z.boolean().default(false),
  neighbourhood: optional(120),
  city: text(2, 100),
  province: optional(100),
  bedrooms: z.number().int().min(0).max(50).nullish(),
  bathrooms: z.number().int().min(0).max(50).nullish(),
  areaM2: z.number().int().min(0).max(1_000_000).nullish(),
  imageUrls: z.array(url).max(10).default([]),
  /** Duração do anúncio em dias. */
  durationDays: z.number().int().min(7).max(90).default(30),
});
export type ListingInput = z.infer<typeof listingSchema>;
export const updateListingSchema = listingSchema
  .omit({ durationDays: true })
  .extend({ currency: z.enum(CURRENCIES), priceNegotiable: z.boolean(), imageUrls: z.array(url).max(10) })
  .partial();
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingQuerySchema = paginationSchema.extend({
  city: z.string().trim().max(100).optional(),
  purpose: z.enum(LISTING_PURPOSES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
});

export const listingInterestSchema = z.object({ message: optional(1000) });
export const respondInterestSchema = z.object({ status: z.enum(['ACCEPTED', 'DECLINED']) });
export const listingReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  description: optional(1000),
});
export type ListingReportInput = z.infer<typeof listingReportSchema>;

export const moderateListingSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), reason: optional(500) })
  .refine((v) => v.decision === 'APPROVE' || !!v.reason, { message: 'Indique o motivo da rejeição', path: ['reason'] });
export const resolveReportSchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED']),
  notes: optional(1000),
  /** Ao confirmar a denúncia, fechar também o anúncio. */
  closeListing: z.boolean().default(false),
});

export const moderateTestimonialSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });
