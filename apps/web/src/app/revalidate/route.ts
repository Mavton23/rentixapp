import { revalidatePath } from 'next/cache';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Atualiza já o site público depois de a administração publicar alterações
 * (blog, conteúdo, testemunhos, estado), em vez de esperar que a cache expire.
 * Só um administrador da plataforma pode pedir: a API confirma o token.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return Response.json({ ok: false }, { status: 401 });
  const me = await fetch(`${API_URL}/api/v1/auth/me`, { headers: { authorization: auth }, cache: 'no-store' });
  if (!me.ok) return Response.json({ ok: false }, { status: 401 });
  const user = (await me.json()) as { platformRole?: string };
  if (user.platformRole !== 'SUPER_ADMIN') return Response.json({ ok: false }, { status: 403 });
  revalidatePath('/', 'layout');
  return Response.json({ ok: true });
}
