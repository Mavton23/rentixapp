import { ResendChannel, TwilioChannel } from './channels';

describe('TwilioChannel', () => {
  it('envia SMS pela API REST com autenticação básica', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 });
    }) as unknown as typeof fetch;
    const ch = new TwilioChannel('AC1', 'tok', '+15005550006', 'sms', fetchFn);
    const r = await ch.send({ to: '+258841234567', body: 'Olá' });

    expect(r.providerMessageId).toBe('SM123');
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    const body = calls[0]!.init.body as URLSearchParams;
    expect(body.get('To')).toBe('+258841234567');
    expect(body.get('From')).toBe('+15005550006');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
  });

  it('WhatsApp usa o prefixo whatsapp: e erros são lançados para nova tentativa', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ code: 21211, message: 'Invalid To' }), { status: 400 })) as unknown as typeof fetch;
    const ch = new TwilioChannel('AC1', 'tok', 'whatsapp:+14155238886', 'whatsapp', fetchFn);
    await expect(ch.send({ to: '+258841234567', body: 'x' })).rejects.toThrow('21211');
  });
});

describe('ResendChannel', () => {
  const mk = (responses: Response[]) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  };

  it('envia pela API REST com Bearer, remetente e chave de idempotência', async () => {
    const { calls, fetchFn } = mk([new Response(JSON.stringify({ id: 're_123' }), { status: 200 })]);
    const ch = new ResendChannel('re_key', 'Rentix <no-reply@rentix.co.mz>', fetchFn);
    const r = await ch.send({ to: 'a@b.co.mz', subject: 'Olá', body: 'Texto', idempotencyKey: 'n-1' });

    expect(r.providerMessageId).toBe('re_123');
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_key');
    expect(headers['Idempotency-Key']).toBe('n-1');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      from: 'Rentix <no-reply@rentix.co.mz>',
      to: ['a@b.co.mz'],
      subject: 'Olá',
      text: 'Texto',
    });
  });

  it('usa "Rentix" como assunto por omissão e não envia chave de idempotência se não existir', async () => {
    const { calls, fetchFn } = mk([new Response(JSON.stringify({ id: 're_1' }), { status: 200 })]);
    await new ResendChannel('k', 'x@y.z', fetchFn).send({ to: 'a@b.c', body: 'x' });
    expect(JSON.parse(calls[0]!.init.body as string).subject).toBe('Rentix');
    expect((calls[0]!.init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });

  it('lança erro com o código do Resend para a fila tentar de novo', async () => {
    const { fetchFn } = mk([new Response(JSON.stringify({ name: 'validation_error', message: 'Invalid `to`' }), { status: 422 })]);
    await expect(new ResendChannel('k', 'x@y.z', fetchFn).send({ to: 'x', body: 'x' })).rejects.toThrow('Resend 422 (validation_error): Invalid `to`');
  });

  it('repete uma vez quando o Resend limita o ritmo (429 com Retry-After curto)', async () => {
    const { calls, fetchFn } = mk([
      new Response('{}', { status: 429, headers: { 'retry-after': '1' } }),
      new Response(JSON.stringify({ id: 're_2' }), { status: 200 }),
    ]);
    const ch = new ResendChannel('k', 'x@y.z', fetchFn, 1_500);
    await expect(ch.send({ to: 'a@b.c', body: 'x' })).resolves.toEqual({ providerMessageId: 're_2' });
    expect(calls).toHaveLength(2);
  });

  it('não espera por um Retry-After longo: falha e deixa a fila reagendar', async () => {
    const { calls, fetchFn } = mk([new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'Too many' }), { status: 429, headers: { 'retry-after': '60' } })]);
    await expect(new ResendChannel('k', 'x@y.z', fetchFn).send({ to: 'a@b.c', body: 'x' })).rejects.toThrow('429');
    expect(calls).toHaveLength(1);
  });
});
