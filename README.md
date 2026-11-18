# Rentix

Plataforma de gestão de arrendamentos para proprietários e imobiliárias, pensada para Moçambique e preparada para outros mercados.

Este repositório é um **monorepo** (pnpm + Turborepo):

| Pasta | O quê |
|---|---|
| `apps/api` | API em NestJS 11 + Prisma 7 + PostgreSQL |
| `apps/web` | Frontend em Next.js 16 — painel da equipa e portal do inquilino |
| `packages/shared` | Enums, schemas Zod, dinheiro, telefones e datas — partilhados pela API e pelo frontend |

## Arrancar em desenvolvimento

Requisitos: Node 22+, pnpm 10+, Docker (ou um PostgreSQL 16 local).

```bash
pnpm install
docker compose up -d                 # PostgreSQL
cp apps/api/.env.example apps/api/.env
# gerar os dois segredos JWT e colá-los no .env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

pnpm --filter @rentix/shared build
pnpm --filter @rentix/api db:migrate      # cria as tabelas
pnpm --filter @rentix/api db:seed -- --demo
pnpm dev                                  # API (4000) + frontend (3000)
```

- Aplicação: http://localhost:3000 (equipa) e http://localhost:3000/portal (inquilinos)
- API: http://localhost:4000/api/v1
- Documentação interativa (Swagger): http://localhost:4000/api/v1/docs
- Conta demo: `demo@rentix.co.mz` / `Demo12345`

## Frontend (`apps/web`)

- Next.js (App Router) + TypeScript, Tailwind CSS 4, componentes próprios sobre Radix, TanStack Query, react-hook-form com os schemas Zod de `@rentix/shared` (a validação no browser é a mesma da API).
- O Next.js encaminha `/api/v1/*` para a API (`API_URL`), por isso browser e API ficam no mesmo domínio: sem CORS e cookies de sessão first-party.
- O access token fica só em memória; ao recarregar a página a sessão é restaurada pelo cookie httpOnly.
- Textos e rótulos em português de Moçambique (`src/i18n/pt.ts`); valores com `formatMoney` (`15 000,00 MTn`).

| Área | Rotas |
|---|---|
| Entrada | `/entrar`, `/criar-conta`, `/recuperar-senha`, `/redefinir-senha`, `/convite-equipa` |
| Equipa | `/painel`, `/imoveis`, `/inquilinos`, `/contratos`, `/faturas`, `/pagamentos`, `/relatorios`, `/definicoes`, `/definicoes/plano`, `/definicoes/contrato`, `/recibo/[id]` (imprimir/PDF) |
| Portal do inquilino | `/portal/entrar`, `/portal/convite`, `/portal`, `/portal/faturas`, `/portal/pagamentos`, `/portal/contrato` |
| Site público (com `CMS`/`BLOG`/`STATUS_PAGE`) | `/`, `/funcionalidades`, `/sobre`, `/contactos`, `/blog`, `/blog/[slug]`, `/estado` |
| Marketplace (com `MARKETPLACE`) | `/marketplace`, `/marketplace/[id]`, `/marketplace/meus-anuncios`, `/marketplace/interesses` |
| Administração da plataforma | `/admin` (resumo e indicadores), `/admin/organizacoes`, `/admin/faturacao`, `/admin/planos`, `/admin/marketplace`, `/admin/blog`, `/admin/site`, `/admin/mensagens`, `/admin/testemunhos`, `/admin/estado` |

## Testes

```bash
pnpm test        # unitários (shared + regras de faturação)
pnpm test:e2e    # e2e contra PostgreSQL real (base rentix_test, recriada a cada execução)
```

Os e2e cobrem: autenticação e rotação de tokens, deteção de reutilização de refresh tokens, rate limiting, isolamento entre organizações, papéis, limites dos planos, contratos (incluindo pedidos simultâneos), faturação idempotente, multas, pagamentos parciais/simultâneos/idempotentes, estornos, o portal do inquilino, pagamentos móveis, as funcionalidades extra, subscrições (teste, mudança de plano com crédito, renovação, atraso, descida para o Grátis), administração da plataforma e convites de equipa.

## Conceitos do domínio

- **Organização** — o cliente da plataforma (proprietário individual ou imobiliária). Um utilizador pode pertencer a várias, com um papel em cada uma: `OWNER`, `MANAGER`, `ACCOUNTANT`, `VIEWER`.
- **Imóvel → Unidades** — uma casa tem uma unidade; um prédio tem várias (Flat 1A, Loja R/C…). Os contratos são feitos sobre unidades.
- **Inquilino** — ficha por organização. A mesma pessoa pode ser inquilina de várias organizações e usa **uma só conta** no portal.
- **Contrato** — renda, moeda, dia de cobrança, caução, multa e tolerância. Só um contrato ativo por unidade (garantido na base de dados).
- **Faturas** — geradas automaticamente todos os dias às 06:00 (hora de Maputo): renda mensal, caução, multa (uma por fatura em atraso) e faturas avulsas. Numeração sequencial `FT 2026/000001`.
- **Pagamentos** — registados contra uma fatura (parciais permitidos), com recibo `RC 2026/000001`. Nunca são apagados: são estornados.
- **Notificações** — email + SMS, gravadas numa caixa de saída e enviadas por um worker com novas tentativas. Lembrete antes do vencimento, aviso de atraso, multa e recibo.

## Convenções da API

- Prefixo `/api/v1`. Autenticação com `Authorization: Bearer <accessToken>` (15 min). O refresh token vai num cookie httpOnly e roda a cada uso.
- **Dinheiro em centavos inteiros**: 1 500,00 MT → `150000`. Nunca floats.
- **Datas** de calendário como `AAAA-MM-DD`, no fuso da organização (por omissão `Africa/Maputo`).
- **Telefones** guardados em E.164 (`+258841234567`); aceita-se `84 123 4567`.
- **Erros**: `{ "error": { "code": "LEASE_UNIT_OCCUPIED", "message": "...", "details": [...] }, "requestId": "..." }`. O frontend traduz pelo `code`.
- **Pagamentos**: enviar o cabeçalho `Idempotency-Key` evita duplicados quando a rede falha e o pedido é repetido.

## Pagamentos por telemóvel (M-Pesa, e-Mola)

- Cada organização liga a **sua própria** conta (Definições → Pagamentos por telemóvel). O dinheiro vai diretamente para o senhorio; o Rentix nunca o retém. As credenciais são cifradas com AES-256-GCM (`PAYMENT_CREDENTIALS_KEY`) e nunca são devolvidas pela API.
- Fluxo: o inquilino escolhe **Pagar agora** no portal (ou a equipa usa **Pedir por telemóvel** numa fatura), recebe no telemóvel o pedido de PIN, e o pagamento é confirmado, aplicado à fatura e acompanhado do recibo, tudo sem intervenção. Pedidos sem resposta são consultados de novo e expiram sozinhos.
- **Simulador** (desenvolvimento e demonstrações, desligado em produção): números terminados em `0001` simulam saldo insuficiente, `0002` cancelamento, `0003` falta de resposta; os restantes são aprovados.
- **M-Pesa (Vodacom Open API)**: cliente C2B e consulta de estado em `apps/api/src/modules/mobile-payments/providers/mpesa.provider.ts`. Foi construído a partir da documentação pública e dos SDKs da comunidade, **sem conta de teste**. Antes de produção, validar no sandbox: anfitriões/portas, cabeçalho `Origin` e a tabela de códigos `INS-*`.
- Para acrescentar e-Mola, mKesh ou um agregador: implementar `MobileMoneyProvider` (`providers/provider.ts`) e registá-lo no `GatewaysService`.

## Recibos em PDF

`GET /payments/:id/receipt.pdf` (equipa) e `GET /portal/payments/:id/receipt.pdf` (inquilino), gerados no servidor com pdfkit. Continua disponível a versão imprimível em `/recibo/[id]`.

## SMS e WhatsApp

`SMS_PROVIDER=twilio` / `WHATSAPP_PROVIDER=twilio` com `TWILIO_*` no `.env`. Por omissão as mensagens só são escritas no log. Para um gateway SMS local, implementar `MessageChannel` em `apps/api/src/modules/notifications/channels.ts`.

## Funcionalidades extra (feature flags)

Blog, CMS (páginas Sobre/Contactos/Funcionalidades e formulário de contacto), marketplace de anúncios, página de estado e testemunhos ficam **desligados por omissão**, para o produto principal ter o foco todo.

```bash
# apps/api/.env
FEATURES=BLOG,CMS,MARKETPLACE,STATUS_PAGE,TESTIMONIALS
CONTACT_INBOX=equipa@rentix.co.mz   # recebe as mensagens do formulário de contacto
```

- Na API, as rotas usam `@RequireFeature('BLOG')` e respondem 404 com a flag desligada. O frontend consulta `GET /api/v1/features` e esconde menus e páginas.
- Com `CMS` desligado, `/` vai direto para `/painel` (sem site institucional).
- O marketplace é entre organizações: anúncios passam por moderação, os contactos só são revelados quando o anunciante aceita o interesse, há denúncias e expiração automática (cron de hora a hora).
- As fotografias de anúncios e capas de artigos são **endereços https** por agora; o upload (S3) fica para depois.

**Administração da plataforma.** A área `/admin` só aparece a utilizadores com `platformRole = SUPER_ADMIN`:

```bash
pnpm --filter @rentix/api admin:promote -- pessoa@exemplo.co.mz          # promover
pnpm --filter @rentix/api admin:promote -- pessoa@exemplo.co.mz --revoke # retirar
```

Em produção (sem `tsx`), no contentor da API: `node dist/cli/promote-admin.js pessoa@exemplo.co.mz`. A pessoa tem de entrar de novo para a sessão refletir o papel. Quando a administração publica um artigo, conteúdo, testemunho ou incidente, o site público é refeito de imediato (`POST /revalidate`, que confirma o papel junto da API); fora disso, as páginas públicas ficam em cache 30–60 s.

## Subscrições e faturação do Rentix

Cada organização tem uma subscrição. As regras estão em `apps/api/src/modules/subscriptions/subscription.logic.ts` (com testes unitários):

- **Teste:** quem se regista tem 30 dias do Profissional (`TRIAL_PLAN_CODE`, `TRIAL_DAYS`). Organizações criadas depois pela mesma pessoa começam no Grátis.
- **Escolher ou subir de plano:** cria uma fatura `RTX 2026/000001`; o período começa quando é paga. A meio de um período pago, desconta-se o tempo não usado.
- **Descer de plano ou não renovar:** fica agendado para o fim do período já pago (pode ser desfeito).
- **Renovação:** a fatura sai 7 dias antes do fim. Sem pagamento, a conta fica 7 dias "em atraso" com o mesmo plano e depois passa para o **Grátis**. Nunca se apagam dados: acima dos limites, só fica bloqueado acrescentar.
- **Pagamento:** por M-Pesa/e-Mola para a conta do Rentix (`PLATFORM_PAYMENT_GATEWAY`, separado das contas das organizações) ou por transferência (`PLATFORM_BANK_DETAILS`), que a administração regista em `/admin/faturacao`. Paga, a fatura serve de fatura-recibo (PDF).
- **Cron diário** às 07:00 (Maputo): renovações, atrasos, fim dos testes e avisos por email (e SMS nos casos urgentes).

A administração (`/admin/organizacoes`) pode oferecer ou prolongar um plano, suspender uma organização (a equipa deixa de trabalhar, o portal dos inquilinos continua) e editar preços e limites em `/admin/planos`. Os três planos base são criados por uma migração, por isso existem em qualquer base de dados.

**Convites de equipa:** em Definições, um email sem conta no Rentix recebe um convite (válido 7 dias) para criar a conta em `/convite-equipa`. Os convites pendentes contam para o limite de pessoas do plano.

## Relatórios e exportações

`/relatorios` (proprietário, gestor e contabilista): faturado e cobrado no período, taxa de cobrança das faturas que venceram, dívida em aberto, evolução dos últimos 12 meses, resultado por imóvel e dívidas por antiguidade (por vencer, 1–30, 31–60, 61–90 e mais de 90 dias).

Exportações em Excel (`GET /reports/export/{invoices|payments|tenants|aging}?from&to`) prontas para o contabilista: cabeçalho na primeira linha, filtros, valores como números e datas como datas, linha de totais com fórmulas e uma folha "Informação" com a organização e o período. Cada exportação fica na auditoria (`report.exported`).

## Ficheiros

Documentos dos inquilinos (BI, comprovativos), dos contratos (contrato assinado, auto de entrega) e dos imóveis, e fotografias dos anúncios e capas do blog.

- **Armazenamento:** `STORAGE_DRIVER=local` (pasta `STORAGE_DIR`) ou `s3` (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO). O bucket fica privado: é a API que serve os ficheiros, depois de verificar a organização.
- **Segurança:** o tipo é confirmado pelos primeiros bytes (só PDF, JPEG, PNG e WebP), o nome é limpo, e os ficheiros são servidos com `nosniff` e `CSP: sandbox`. Limite por ficheiro em `UPLOAD_MAX_MB`.
- **Fotografias:** endireitadas, reduzidas a 2400 px e **sem metadados** (os telemóveis gravam a localização GPS).
- **Partilha:** documentos do inquilino e do contrato podem ser mostrados ao inquilino no portal ("Partilhar").
- **Públicos:** só as imagens dos anúncios e do blog (`/api/v1/public/files/:id`). Mudar as fotografias de um anúncio devolve-o à revisão.

## Contratos de arrendamento em PDF

Cada organização tem um modelo (`/definicoes/contrato`) em Markdown simples (`#`, `##`, `-`, `**negrito**`, `[assinaturas]`) com variáveis como `{{inquilino.nome}}` ou `{{contrato.renda_extenso}}` (valores por extenso: "vinte e cinco mil meticais"). O botão "Contrato em PDF" na página do contrato preenche o modelo com os dados reais; dados em falta ficam com um traço para preencher à mão, e cada página tem espaço para as rubricas.

O modelo base é um **ponto de partida, não aconselhamento jurídico**: deve ser revisto por um jurista.

## Fiabilidade

- **Erros:** Sentry na API e no frontend, ligado só com `SENTRY_DSN`. Os eventos saem sem dados pessoais: só o id do utilizador, a organização, a rota e o `request_id` (o mesmo dos logs). Os logs também não guardam a query string.
- **Tarefas agendadas:** cada cron fica registado (`cron_jobs`) e, com Sentry, envia check-ins: o Sentry avisa se uma tarefa falhar ou deixar de correr.
- **Saúde da plataforma:** `/admin/saude` mostra crons, cópias de segurança, mensagens e pagamentos presos; os mesmos problemas são enviados ao Sentry a cada 15 min.
- **Prontidão:** `GET /api/v1/health/ready` verifica a base de dados e o armazenamento (503 se falhar). É o endereço para o monitor externo.
- **Backups:** `.github/workflows/backup.yml` faz `pg_dump` cifrado diário para armazenamento fora do Neon, cópia semanal dos ficheiros e, todos os meses, um teste de reposição numa ramificação temporária do Neon (`apps/api/src/cli/restore-check.ts`).
- **Limite de armazenamento** por plano (`maxStorageMb`, em `/admin/planos`).
- **Exportação completa:** o proprietário descarrega um ZIP com todos os dados em Excel e todos os ficheiros (`/definicoes`).

Procedimentos de recuperação, configuração e rotação de segredos: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Idiomas (português e inglês)

O português é a língua de origem: os textos escrevem-se em português no código, dentro de `t('...')`, e os dicionários traduzem para inglês. O que não tiver tradução aparece em português, nunca vazio.

- **Web:** `useT()` nos componentes cliente, `await getT()` nos componentes de servidor, `tx()` em funções auxiliares. Dicionário: `apps/web/src/i18n/en.json`. Variáveis com nome: `t('Renda de {period}', { period })`.
- **API:** as mensagens de erro e de validação saem no idioma do pedido (cookie `rtx_locale`, cabeçalho `x-locale` ou `Accept-Language`); os códigos de erro não mudam. Dicionário: `apps/api/src/common/i18n/en.json`. Validação partilhada: `packages/shared/src/locales/en.ts`.
- **Quem escolhe:** cada utilizador (menu lateral), cada inquilino (portal, ou o senhorio na ficha) e a organização (idioma por omissão, em Definições). Uma conta nova fica no idioma do browser.
- **Mensagens e documentos:** emails e SMS no idioma de quem recebe; faturas e recibos no idioma do inquilino; contrato e modelo base no idioma da organização (há modelo base em inglês); valores por extenso em inglês (`moneyToWords(..., 'en')`).
- **Formatos:** em inglês, `MZN 15,000.00` e números com ponto decimal; as datas curtas ficam `DD/MM/AAAA` nos dois idiomas.
- **Conteúdo do site (CMS):** cada página tem versão em português e em inglês, escolhida no editor da administração.
- **Verificação:** `pnpm i18n:check` lista os textos sem tradução (também corre na CI). Ao acrescentar texto novo, acrescentar a tradução ao dicionário indicado.
- A área de administração da plataforma (equipa Rentix) fica só em português.

Telefones: números de Moçambique sem indicativo continuam a ser aceites; os de outros países escrevem-se com o indicativo (`+27 82 123 4567`) e são validados com as regras de cada país (libphonenumber).

## Notas de base de dados

A migração inicial inclui, além do que o Prisma gera, regras que o Prisma não exprime: o índice parcial `leases_one_active_per_unit` (um contrato ativo por unidade) e `CHECK`s para valores monetários. Se um futuro `prisma migrate dev` propuser remover o índice `leases_one_active_per_unit`, apague essa linha da migração gerada.

## Produção

- `apps/api/Dockerfile` e `apps/web/Dockerfile` (build a partir da raiz). O contentor da API corre `prisma migrate deploy` antes de arrancar.
- O frontend precisa de `API_URL` **no build** (`--build-arg API_URL=http://api:4000`): o Next grava aí o destino do `/api/v1`.
- `docker-compose.prod.yml` levanta a pilha completa (PostgreSQL, API, web) com um ficheiro `.env.prod` baseado em `apps/api/.env.example`.
- Para cobrar as subscrições: `PLATFORM_PAYMENT_GATEWAY=mpesa` com as credenciais da conta M-Pesa do Rentix, e/ou `PLATFORM_BANK_DETAILS`. Rever os preços provisórios em `/admin/planos`.
- Definir `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true` (atrás de proxy), `RESEND_API_KEY` (com o domínio de `MAIL_FROM` verificado no Resend) e segredos JWT fortes.
- Com várias réplicas, manter `CRON_ENABLED=true` numa só. (A faturação já está protegida por locks na base de dados, mas assim evita-se trabalho repetido.)
- `GET /api/v1/health` para o balanceador; `GET /api/v1/health/ready` para o monitor externo.
- Neon: `DATABASE_URL` com a ligação pooled e `DIRECT_DATABASE_URL` com a direta (migrações). Plano Launch ou superior para ter 7 dias de histórico.
- `OPS_TOKEN`, `SENTRY_DSN` e os segredos do workflow de backups: ver `docs/RUNBOOK.md`.

Ver `docs/ROADMAP.md` para as próximas fases.
