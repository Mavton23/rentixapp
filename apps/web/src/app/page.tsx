import { redirect } from 'next/navigation';

/** O site institucional (CMS) é uma funcionalidade extra; por agora a raiz leva ao painel. */
export default function Home() {
  redirect('/painel');
}
