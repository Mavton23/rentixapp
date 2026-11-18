import type {
  ComponentStatus,
  IncidentImpact,
  IncidentStatus,
  InterestStatus,
  ListingPurpose,
  ListingStatus,
  ModerationStatus,
  PostStatus,
  ReportReason,
} from '@rentix/shared';

export const componentStatusLabel: Record<ComponentStatus, string> = {
  OPERATIONAL: 'Operacional',
  DEGRADED: 'Desempenho reduzido',
  PARTIAL_OUTAGE: 'Falha parcial',
  MAJOR_OUTAGE: 'Indisponível',
};

export const overallStatusText: Record<ComponentStatus, string> = {
  OPERATIONAL: 'Todos os serviços estão a funcionar',
  DEGRADED: 'Alguns serviços estão mais lentos',
  PARTIAL_OUTAGE: 'Alguns serviços estão com falhas',
  MAJOR_OUTAGE: 'Há serviços indisponíveis',
};

export const incidentStatusLabel: Record<IncidentStatus, string> = {
  INVESTIGATING: 'A investigar',
  IDENTIFIED: 'Causa identificada',
  MONITORING: 'Em observação',
  RESOLVED: 'Resolvido',
};

export const incidentImpactLabel: Record<IncidentImpact, string> = {
  NONE: 'Sem impacto',
  MINOR: 'Impacto ligeiro',
  MAJOR: 'Impacto significativo',
  CRITICAL: 'Impacto crítico',
};

export const listingPurposeLabel: Record<ListingPurpose, string> = {
  RENT: 'Para arrendar',
  SALE: 'Para vender',
  MANAGEMENT: 'Passar gestão',
};

export const listingStatusLabel: Record<ListingStatus, string> = {
  PENDING_REVIEW: 'Em revisão',
  ACTIVE: 'Publicado',
  REJECTED: 'Não aprovado',
  EXPIRED: 'Expirado',
  CLOSED: 'Fechado',
};

export const interestStatusLabel: Record<InterestStatus, string> = {
  PENDING: 'A aguardar resposta',
  ACCEPTED: 'Aceite',
  DECLINED: 'Recusado',
};

export const reportReasonLabel: Record<ReportReason, string> = {
  SPAM: 'Publicidade indesejada',
  INAPPROPRIATE: 'Conteúdo impróprio',
  FALSE_INFO: 'Informação falsa ou desatualizada',
  OTHER: 'Outro motivo',
};

export const moderationStatusLabel: Record<ModerationStatus, string> = {
  PENDING: 'Por rever',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
};

export const postStatusLabel: Record<PostStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
};
