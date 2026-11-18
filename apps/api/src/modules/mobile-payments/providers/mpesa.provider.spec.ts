import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { mpesaAmount, mpesaBearer, mpesaMsisdn, mpesaReference, MpesaVodacomProvider } from './mpesa.provider';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
/** O portal M-Pesa entrega a chave pública em base64 sem cabeçalhos. */
const portalPublicKey = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
  .replace(/\s+/g, '');

const creds = { apiKey: 'chave-api-teste', publicKey: portalPublicKey, serviceProviderCode: '171717', environment: 'sandbox' as const };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('M-Pesa Vodacom', () => {
  it('cifra a API Key com a Public Key (RSA PKCS#1 v1.5)', () => {
    const token = mpesaBearer(creds.apiKey, portalPublicKey);
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(token, 'base64'));
    expect(plain.toString()).toBe(creds.apiKey);
  });

  it('formata valores, números e referências', () => {
    expect(mpesaAmount(150000)).toBe('1500');
    expect(mpesaAmount(150050)).toBe('1500.50');
    expect(mpesaMsisdn('+258841234567')).toBe('258841234567');
    expect(mpesaReference('FT 2026/000123')).toBe('FT2026000123');
  });

  it('envia o pedido C2B e interpreta INS-0 como sucesso', async () => {
    const { fn, calls } = fakeFetch(201, {
      output_ResponseCode: 'INS-0',
      output_TransactionID: 'TX123',
      output_ConversationID: 'CONV1',
    });
    const p = new MpesaVodacomProvider(creds, fn);
    const r = await p.collect({ msisdn: '+258841234567', amount: 250000, reference: 'FT 2026/000002', thirdPartyReference: 'RXABC123' });

    expect(r).toEqual({ status: 'SUCCESS', transactionId: 'TX123', conversationId: 'CONV1' });
    expect(calls[0]!.url).toBe('https://api.sandbox.vm.co.mz:18352/ipg/v1x/c2bPayment/singleStage/');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      input_TransactionReference: 'FT2026000002',
      input_CustomerMSISDN: '258841234567',
      input_Amount: '2500',
      input_ThirdPartyReference: 'RXABC123',
      input_ServiceProviderCode: '171717',
    });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer [A-Za-z0-9+/=]+$/);
  });

  it('saldo insuficiente dá falha com mensagem em português', async () => {
    const { fn } = fakeFetch(422, { output_ResponseCode: 'INS-2006', output_ResponseDesc: 'Insufficient balance' });
    const r = await new MpesaVodacomProvider(creds, fn).collect({ msisdn: '+258841234567', amount: 100, reference: 'X', thirdPartyReference: 'Y' });
    expect(r).toEqual({ status: 'FAILED', code: 'INS-2006', message: 'Saldo insuficiente na conta M-Pesa.' });
  });

  it('sem resposta (rede/timeout) fica pendente para consulta posterior', async () => {
    const fn = (async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;
    const r = await new MpesaVodacomProvider(creds, fn).collect({ msisdn: '+258841234567', amount: 100, reference: 'X', thirdPartyReference: 'Y' });
    expect(r.status).toBe('PENDING');
  });

  it('consulta de estado', async () => {
    const { fn, calls } = fakeFetch(200, { output_ResponseCode: 'INS-0', output_ResponseTransactionStatus: 'Completed' });
    const r = await new MpesaVodacomProvider(creds, fn).query('RXABC123');
    expect(r.status).toBe('SUCCESS');
    expect(calls[0]!.url).toContain(':18353/ipg/v1x/queryTransactionStatus/?input_QueryReference=RXABC123');
  });
});
