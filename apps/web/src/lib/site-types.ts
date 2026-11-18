import type {
  AboutContent,
  ComponentStatus,
  ContactContent,
  FeaturesContent,
  IncidentImpact,
  IncidentStatus,
  InterestStatus,
  ListingPurpose,
  ListingStatus,
  ModerationStatus,
  PostStatus,
  PropertyType,
} from '@rentix/shared';

export type { AboutContent, ContactContent, FeaturesContent };

export interface SiteContentResponse<T> {
  key: string;
  data: T;
  updatedAt: string | null;
}

export interface BlogPostCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string | null;
  featured: boolean;
  readTimeMinutes: number;
  publishedAt: string;
  category: { name: string; slug: string } | null;
}

export interface BlogPostFull extends BlogPostCard {
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  _count: { posts: number };
}

export interface AdminBlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  status: PostStatus;
  featured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  categoryId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  category?: { name: string } | null;
}

export interface Testimonial {
  id: string;
  name: string;
  role: string | null;
  city: string | null;
  rating: number;
  message: string;
  status?: ModerationStatus;
  createdAt?: string;
}

export interface StatusIncident {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  components: { id: string; name: string }[];
  updates: { id: string; status: IncidentStatus; message: string; createdAt: string }[];
}

export interface StatusResponse {
  overall: ComponentStatus;
  components: { id: string; name: string; description: string | null; status: ComponentStatus }[];
  activeIncidents: StatusIncident[];
  recentIncidents: StatusIncident[];
  generatedAt: string;
}

export interface ListingCard {
  id: string;
  title: string;
  purpose: ListingPurpose;
  propertyType: PropertyType;
  price: number;
  currency: string;
  priceNegotiable: boolean;
  neighbourhood: string | null;
  city: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  imageUrl: string | null;
  status: ListingStatus;
  publishedAt: string | null;
  expiresAt: string;
  organizationName: string;
  isMine?: boolean;
  myInterest?: InterestStatus | null;
}

export interface ListingContact {
  organization: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ListingDetail extends Omit<ListingCard, 'imageUrl' | 'myInterest'> {
  description: string;
  province: string | null;
  imageUrls: string[];
  viewsCount: number;
  interestsCount: number;
  rejectionReason: string | null;
  myInterest: { status: InterestStatus; message: string | null; createdAt: string } | null;
  contact: ListingContact | null;
}

export interface MyListing extends Omit<ListingDetail, 'myInterest' | 'contact' | 'organizationName' | 'isMine'> {
  pendingInterests: number;
}

export interface ListingInterestRow {
  id: string;
  status: InterestStatus;
  message: string | null;
  createdAt: string;
  organizationName: string;
  contactName: string | null;
  contact: { email: string; phone: string | null } | null;
}
