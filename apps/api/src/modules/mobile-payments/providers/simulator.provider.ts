import type { CollectRequest, CollectResult, MobileMoneyProvider, QueryResult } from './provider';

/**
 * Simulador para desenvolvimento e demonstrações. Nunca movimenta dinheiro.
 * O resultado depende dos últimos dígitos do telemóvel:
 *   ...0001 -> saldo insuficiente
 *   ...0002 -> cliente cancelou
 *   ...0003 -> sem resposta (fica pendente e expira)
 *   outros  -> pagamento aprovado
 */
export class SimulatorProvider implements MobileMoneyProvider {
  private readonly results = new Map<string, QueryResult>();

  constructor(private readonly delayMs: number) {}

  async collect(req: CollectRequest): Promise<CollectResult> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    let result: CollectResult;
    if (req.msisdn.endsWith('0001')) {
      result = { status: 'FAILED', code: 'SIM-INSUFFICIENT', message: 'Saldo insuficiente na carteira' };
    } else if (req.msisdn.endsWith('0002')) {
      result = { status: 'FAILED', code: 'SIM-CANCELLED', message: 'O pagamento foi cancelado no telemóvel' };
    } else if (req.msisdn.endsWith('0003')) {
      result = { status: 'PENDING', message: 'Sem resposta do telemóvel' };
    } else {
      result = { status: 'SUCCESS', transactionId: `SIM${Date.now().toString(36).toUpperCase()}` };
    }
    this.results.set(
      req.thirdPartyReference,
      result.status === 'SUCCESS'
        ? { status: 'SUCCESS', transactionId: result.transactionId }
        : result.status === 'FAILED'
          ? { status: 'FAILED', message: result.message }
          : { status: 'PENDING' },
    );
    return result;
  }

  async query(thirdPartyReference: string): Promise<QueryResult> {
    return this.results.get(thirdPartyReference) ?? { status: 'UNKNOWN' };
  }
}
