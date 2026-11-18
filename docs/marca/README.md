# Identidade visual do Rentix

- `Rentix-manual-de-marca.pdf`: conceito, versões, área de proteção, cores, tipografia, usos incorretos e ícones.
- `svg/`: todos os logótipos em vetor (cores, negativo, azul-marinho e branco; horizontal, vertical, símbolo, logotipo; slogan em PT e EN).

| Cor | HEX |
|---|---|
| Azul-marinho | `#0F2A44` |
| Azul | `#1D5FE6` |
| Turquesa (acento) | `#16C6C0` |
| Cinza-claro | `#F2F4F7` |
| Ardósia (texto secundário) | `#5B6B7F` |

Letra da marca: **Poppins** (SemiBold no logótipo, Medium no slogan).

## Onde a marca está aplicada

- `apps/web/public/brand/`: logótipos usados pelo componente `Logo` (`apps/web/src/components/brand.tsx`).
- `apps/web/src/app/`: `favicon.ico`, `icon.svg`, `apple-icon.png`, `opengraph-image.png`, `twitter-image.png`, `manifest.ts`.
- `apps/web/public/icon-*.png`: ícones da aplicação instalada (Android).
- `apps/api/src/modules/subscriptions/rentix-logo.ts`: logótipo nas faturas do Rentix.

## Regenerar

O símbolo é desenhado em código (`gerador/gen.mjs`); o texto é convertido em curvas a partir da Poppins, por isso os SVG não dependem de fontes instaladas.

```bash
cd docs/marca/gerador
npm install
npm run gerar   # precisa do Google Chrome em /usr/bin/google-chrome
```

Os ficheiros saem em `gerador/out/rentix-identidade/`; copiar depois para os destinos acima.
