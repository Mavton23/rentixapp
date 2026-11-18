import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifra simétrica AES-256-GCM para segredos guardados na base de dados
 * (credenciais M-Pesa de cada organização). Formato: "v1:<iv>:<tag>:<dados>" em base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyMaterial: string) {
    const raw = Buffer.from(keyMaterial, 'base64');
    // Aceita uma chave de 32 bytes em base64; qualquer outro texto é derivado com SHA-256.
    this.key = raw.length === 32 ? raw : createHash('sha256').update(keyMaterial).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de segredo inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
