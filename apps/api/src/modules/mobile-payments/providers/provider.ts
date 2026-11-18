/**
 * Interface comum aos fornecedores de dinheiro móvel (M-Pesa, e-Mola, agregadores...).
 * Para acrescentar um fornecedor: implementar esta interface e registá-lo no GatewaysService.
 */

export interface CollectRequest {
  /** Telemóvel em E.164 (+2588XXXXXXXX). */
  msisdn: string;
  /** Valor em centavos. */
  amount: number;
  /** Referência visível para o cliente (ex.: número da fatura). */
  reference: string;
  /** Referência única do nosso lado, para consultas e para evitar duplicados. */
  thirdPartyReference: string;
}

export type CollectResult =
  | { status: 'SUCCESS'; transactionId: string; conversationId?: string }
  | { status: 'FAILED'; code: string; message: string }
  /** Sem resposta definitiva (ex.: tempo de ligação esgotado): consultar mais tarde. */
  | { status: 'PENDING'; message?: string };

export type QueryResult =
  | { status: 'SUCCESS'; transactionId?: string }
  | { status: 'FAILED'; message: string }
  | { status: 'PENDING' | 'UNKNOWN' };

export interface MobileMoneyProvider {
  /**
   * Pede ao cliente que confirme o pagamento no telemóvel (USSD push) e espera pelo resultado.
   * Nunca lança exceções por recusa do cliente: devolve FAILED com uma mensagem em português.
   */
  collect(req: CollectRequest): Promise<CollectResult>;
  /** Consulta o estado de um pedido anterior (opcional). */
  query?(thirdPartyReference: string): Promise<QueryResult>;
}
