import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

/** Token aleatório opaco (refresh tokens, convites, reset de senha). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Guardamos apenas o SHA-256 dos tokens: uma fuga da base de dados não os expõe. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Hash fictício para comparar quando o utilizador não existe:
 * o tempo de resposta fica igual e não se revela se o email está registado.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('rentix-dummy-password', BCRYPT_ROUNDS);
