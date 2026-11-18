import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Slug com sufixo aleatório curto para evitar colisões. */
export function uniqueSlug(input: string): string {
  const base = slugify(input) || 'org';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
