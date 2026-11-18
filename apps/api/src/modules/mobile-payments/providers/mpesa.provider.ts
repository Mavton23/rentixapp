import { constants, publicEncrypt } from 'node:crypto';
import { toDecimalString } from '@rentix/shared';
import type { CollectRequest, CollectResult, MobileMoneyProvider, QueryResult } from './provider';

/**
 * Cliente da Vodacom M-Pesa Open API (Moçambique) — C2B "single stage" e consulta de estado.
 *
 * Construído a partir da documentação pública do portal developer.mpesa.vm.co.mz e dos SDKs
 * da comunidade. ANTES DE IR PARA PRODUÇÃO, validar no sandbox com a conta de programador:
 * anfitriões/portas, cabeçalho Origin e a tabela de códigos INS-*.
 *
 * Autenticação: a API Key é cifrada com a Public Key (RSA, PKCS#1 v1.5) e enviada em base64
 * como "Bearer". O pedido C2B é síncrono: a resposta chega quando o cliente introduz o PIN
 * (ou desiste), o que pode demorar até ~1-2 minutos.
 */

export interface MpesaCredentials {
  apiKey: string;
  publicKey: string;
  serviceProviderCode: string;
  environment: 'sandbox' | 'production';
  /** Valor do cabeçalho Origin pedido pela Vodacom. */
  origin?: string;
}

type FetchFn = typeof fetch;

const HOSTS = {
  sandbox: 'https://api.sandbox.vm.co.mz',
  production: 'https://api.vm.co.mz',
} as const;
const C2B = { port: 18352, path: '/ipg/v1x/c2bPayment/singleStage/' };
const QUERY = { port: 18353, path: '/ipg/v1x/queryTransactionStatus/' };

/** Mensagens para os códigos mais comuns (confirmar a lista completa no portal). */
const INS_MESSAGES: Record<string, string> = {
  'INS-1': 'Erro interno do M-Pesa. Tente de novo.',
  'INS-2': 'Credenciais M-Pesa inválidas. Verifique a configuração.',
  'INS-4': 'A conta M-Pesa do cliente não está ativa.',
  'INS-5': 'O pagamento foi cancelado no telemóvel.',
  'INS-6': 'O pagamento falhou no M-Pesa.',
  'INS-9': 'O cliente não confirmou a tempo.',
  'INS-10': 'Pagamento duplicado.',
  'INS-13': 'Código de serviço M-Pesa inválido. Verifique a configuração.',
  'INS-15': 'Valor inválido para o M-Pesa.',
  'INS-16': 'O M-Pesa está sobrecarregado. Tente daqui a pouco.',
  'INS-2006': 'Saldo insuficiente na conta M-Pesa.',
  'INS-2051': 'Número de telemóvel inválido para o M-Pesa.',
};

export function mpesaBearer(apiKey: string, publicKey: string): string {
  const body = publicKey.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`;
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(apiKey)).toString('base64');
}

/** M-Pesa aceita referências alfanuméricas curtas. */
export function mpesaReference(value: string, max = 20): string {
  return value.replace(/[^A-Za-z0-9]/g, '').slice(0, max) || 'RENTIX';
}

/** "+258841234567" -> "258841234567" */
export function mpesaMsisdn(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** 150000 centavos -> "1500"; 150050 -> "1500.50" */
export function mpesaAmount(minor: number): string {
  return toDecimalString(minor).replace(/\.00$/, '');
}

export class MpesaVodacomProvider implements MobileMoneyProvider {
  constructor(
    private readonly creds: MpesaCredentials,
    private readonly fetchFn: FetchFn = fetch,
    private readonly timeoutMs = 120_000,
  ) {}

  private url(endpoint: { port: number; path: string }): string {
    return `${HOSTS[this.creds.environment]}:${endpoint.port}${endpoint.path}`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mpesaBearer(this.creds.apiKey, this.creds.publicKey)}`,
      Origin: this.creds.origin ?? 'developer.mpesa.vm.co.mz',
    };
  }

  async collect(req: CollectRequest): Promise<CollectResult> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url(C2B), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          input_TransactionReference: mpesaReference(req.reference),
          input_CustomerMSISDN: mpesaMsisdn(req.msisdn),
          input_Amount: mpesaAmount(req.amount),
          input_ThirdPartyReference: mpesaReference(req.thirdPartyReference),
          input_ServiceProviderCode: this.creds.serviceProviderCode,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Sem resposta: o cliente pode ter pago na mesma. Consulta-se o estado mais tarde.
      return { status: 'PENDING', message: 'Sem resposta do M-Pesa' };
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, string | undefined>;
    const code = body.output_ResponseCode ?? `HTTP-${res.status}`;
    if (code === 'INS-0' && body.output_TransactionID) {
      return {
        status: 'SUCCESS',
        transactionId: body.output_TransactionID,
        conversationId: body.output_ConversationID,
      };
    }
    if (code === 'INS-9' || res.status >= 500) {
      return { status: 'PENDING', message: INS_MESSAGES[code] ?? 'Sem resposta definitiva do M-Pesa' };
    }
    return {
      status: 'FAILED',
      code,
      message: INS_MESSAGES[code] ?? body.output_ResponseDesc ?? 'O pagamento M-Pesa não foi concluído.',
    };
  }

  async query(thirdPartyReference: string): Promise<QueryResult> {
    const ref = mpesaReference(thirdPartyReference);
    const params = new URLSearchParams({
      input_QueryReference: ref,
      input_ServiceProviderCode: this.creds.serviceProviderCode,
      input_ThirdPartyReference: ref,
    });
    try {
      const res = await this.fetchFn(`${this.url(QUERY)}?${params}`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, string | undefined>;
      const status = (body.output_ResponseTransactionStatus ?? '').toLowerCase();
      if (status === 'completed') return { status: 'SUCCESS' };
      if (['cancelled', 'expired', 'failed'].includes(status)) {
        return { status: 'FAILED', message: 'O pagamento não foi concluído no M-Pesa.' };
      }
      return { status: 'UNKNOWN' };
    } catch {
      return { status: 'UNKNOWN' };
    }
  }
}
