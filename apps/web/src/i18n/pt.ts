/**
 * Rótulos em português (Moçambique) para os valores do domínio.
 * Para acrescentar outro idioma, criar um ficheiro com as mesmas chaves.
 */
import type {
  IdDocumentType,
  InvoiceKind,
  InvoiceStatus,
  LeaseStatus,
  MaritalStatus,
  MemberRole,
  PaymentMethod,
  PaymentStatus,
  PropertyType,
  UnitStatus,
} from '@rentix/shared';

export const propertyTypeLabel: Record<PropertyType, string> = {
  HOUSE: 'Casa',
  APARTMENT_BUILDING: 'Prédio',
  APARTMENT: 'Apartamento',
  COMMERCIAL: 'Loja / comercial',
  OFFICE: 'Escritório',
  WAREHOUSE: 'Armazém',
  LAND: 'Terreno',
  OTHER: 'Outro',
};

export const unitStatusLabel: Record<UnitStatus, string> = {
  AVAILABLE: 'Livre',
  OCCUPIED: 'Ocupada',
  MAINTENANCE: 'Em obras',
  UNAVAILABLE: 'Indisponível',
};

export const leaseStatusLabel: Record<LeaseStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  ENDED: 'Terminado',
  TERMINATED: 'Rescindido',
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  OPEN: 'Por pagar',
  PARTIALLY_PAID: 'Pago em parte',
  PAID: 'Paga',
  VOID: 'Anulada',
};

export const invoiceKindLabel: Record<InvoiceKind, string> = {
  RENT: 'Renda',
  DEPOSIT: 'Caução',
  LATE_FEE: 'Multa',
  OTHER: 'Outra',
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH: 'Numerário',
  BANK_TRANSFER: 'Transferência bancária',
  MPESA: 'M-Pesa',
  EMOLA: 'e-Mola',
  MKESH: 'mKesh',
  CARD: 'Cartão',
  CHEQUE: 'Cheque',
  OTHER: 'Outro',
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  PENDING: 'A aguardar',
  CONFIRMED: 'Confirmado',
  FAILED: 'Não concluído',
  REVERSED: 'Estornado',
};

export const memberRoleLabel: Record<MemberRole, string> = {
  OWNER: 'Proprietário',
  MANAGER: 'Gestor',
  ACCOUNTANT: 'Contabilista',
  VIEWER: 'Só consulta',
};

export const idDocumentLabel: Record<IdDocumentType, string> = {
  BI: 'Bilhete de Identidade',
  PASSPORT: 'Passaporte',
  DIRE: 'DIRE',
  DRIVING_LICENSE: 'Carta de condução',
  OTHER: 'Outro',
};

export const maritalStatusLabel: Record<MaritalStatus, string> = {
  SINGLE: 'Solteiro(a)',
  MARRIED: 'Casado(a)',
  DIVORCED: 'Divorciado(a)',
  WIDOWED: 'Viúvo(a)',
  UNION: 'União de facto',
};

