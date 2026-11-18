import Image from 'next/image';
import { cn } from '@/lib/format';

/**
 * Logótipo do Rentix (ficheiros em public/brand, gerados a partir da identidade visual).
 * inverted: versão negativa, para fundos azul-marinho. slogan: com "Gestão de imóveis".
 */
export function Logo({ className, inverted, slogan }: { className?: string; inverted?: boolean; slogan?: boolean }) {
  const file = `/brand/rentix-logo${slogan ? '-slogan' : ''}-${inverted ? 'negativo' : 'cor'}.svg`;
  const [w, h] = slogan ? [244, 61] : [244, 60];
  return (
    <Image
      src={file}
      alt="Rentix"
      width={w}
      height={h}
      unoptimized
      priority
      className={cn('h-8 w-auto select-none', className)}
      draggable={false}
    />
  );
}

/** Só o símbolo (R + prédios + telhado), para espaços pequenos. */
export function LogoMark({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <Image
      src={`/brand/rentix-simbolo-${inverted ? 'negativo' : 'cor'}.svg`}
      alt="Rentix"
      width={90}
      height={71}
      unoptimized
      className={cn('h-8 w-auto select-none', className)}
      draggable={false}
    />
  );
}
