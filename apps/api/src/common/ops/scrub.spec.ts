import { scrubEvent, scrubText } from './scrub';

describe('limpeza de dados pessoais para o Sentry', () => {
  it('texto', () => {
    expect(scrubText('Falha ao enviar SMS para +258 84 123 4567 (ana.sitoe@exemplo.co.mz)')).toBe('Falha ao enviar SMS para [telefone] ([email])');
    expect(scrubText('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF_123')).toBe('token [token]');
    expect(scrubText('convite 3fQ9x_Lr8KkPz2mYtW7vB1nC4dE6gH0jS5aU')).toBe('convite [token]');
    // Ids internos e valores pequenos ficam (servem para diagnosticar).
    expect(scrubText('fatura 0b7e6c1a-2f4d-4a9b-8c3e-5d6f7a8b9c0d de 15000 MTn')).toBe('fatura 0b7e6c1a-2f4d-4a9b-8c3e-5d6f7a8b9c0d de 15000 MTn');
  });

  it('evento: corpo, cookies, credenciais e utilizador', () => {
    const e = scrubEvent({
      type: undefined,
      message: 'erro para 841234567',
      request: {
        url: 'https://rentix.co.mz/api/v1/auth/member-invites/3fQ9x_Lr8KkPz2mYtW7vB1nC4dE6gH0jS5aU',
        data: { password: 'x' },
        cookies: { rtx_rt: 'y' },
        headers: { authorization: 'Bearer z', cookie: 'rtx_rt=y', 'user-agent': 'Chrome', 'x-request-id': 'abc' },
      },
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
      extra: { payerPhone: '+258841234567', amount: 1500, note: 'ligar para 84 123 4567' },
    });
    expect(e.message).toBe('erro para [telefone]');
    expect(e.request).toEqual({
      url: 'https://rentix.co.mz/api/v1/auth/member-invites/[token]',
      headers: { 'user-agent': 'Chrome', 'x-request-id': 'abc' },
    });
    expect(e.user).toEqual({ id: 'u1' });
    expect(e.extra).toEqual({ payerPhone: '[removido]', amount: 1500, note: 'ligar para [telefone]' });
  });
});
