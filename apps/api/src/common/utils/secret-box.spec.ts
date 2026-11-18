import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  it('cifra e decifra; o texto cifrado não contém o original', () => {
    const box = new SecretBox(randomBytes(32).toString('base64'));
    const enc = box.encrypt('{"apiKey":"segredo-123"}');
    expect(enc).not.toContain('segredo');
    expect(box.decrypt(enc)).toBe('{"apiKey":"segredo-123"}');
  });

  it('rejeita dados adulterados ou outra chave', () => {
    const box = new SecretBox('uma-chave-qualquer-com-mais-de-32-caracteres');
    const enc = box.encrypt('x');
    expect(() => new SecretBox('outra-chave-qualquer-com-mais-de-32-caracteres').decrypt(enc)).toThrow();
    const parts = enc.split(':');
    parts[3] = Buffer.from('y').toString('base64url');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });
});
