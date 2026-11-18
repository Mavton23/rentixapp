# Roadmap da refatoração

## ✅ Fase 1 — Fundação da API (esta entrega)

- Monorepo pnpm + Turborepo com pacote `@rentix/shared` (schemas Zod usados pela API e pelo frontend).
- Novo modelo de dados multi-organização: organizações e membros com papéis, imóveis com unidades, inquilinos por organização com conta única no portal, contratos, faturas, pagamentos, contadores de numeração, notificações (outbox), auditoria, sessões, planos.
- Segurança: segredos JWT separados para equipa e inquilinos, access tokens curtos, refresh tokens rotativos em cookie httpOnly com deteção de reutilização, rate limiting, validação estrita (campos desconhecidos descartados), mensagens de login que não revelam se o email existe, helmet, CORS por lista, logs sem tokens.
- Faturação automática idempotente, multas únicas, lembretes e avisos de atraso por email e SMS.
- Pagamentos com bloqueio de linha, idempotência, recibos sequenciais e estornos.
- Portal do inquilino: convite, login por email ou telefone, resumo, contratos, faturas, pagamentos.
- Painel com ocupação, faturado vs. cobrado, dívidas e próximos vencimentos.
- 12 testes unitários (API) + 7 (shared) + 33 testes e2e contra PostgreSQL real. CI no GitHub Actions.

**Correspondência com o código antigo**

| Antigo | Novo |
|---|---|
| `Manager` (gestor + admin na mesma tabela) | `User` + `Membership` (papel por organização) + `platformRole` |
| `Property.tenantId @unique` | `Property` → `Unit` → `Lease` (histórico completo) |
| `Tenant.email/binum @unique` globais | únicos por organização; `TenantAccount` liga a mesma pessoa em várias |
| `Payment` com `status: string` e multas em float | `Invoice` + `Payment` em centavos, estados enum, multa como fatura própria |
| `FineSettings` | campos na `Organization` (+ sobreposição por contrato) |
| `NotificationLog` | `Notification` (outbox com tentativas) |

## ✅ Fase 2 — Frontend Next.js (`apps/web`)

- Painel da equipa: painel do mês (cobrado vs. faturado, atrasos, ocupação), imóveis com unidades, inquilinos (com convite para o portal), contratos (criação, condições, terminar), faturas (filtros, registar pagamento parcial com Idempotency-Key, anular), pagamentos (filtros, estornos), recibo imprimível/PDF, definições (cobrança, equipa e papéis, plano).
- Portal do inquilino, pensado para telemóvel: convite, entrada por telefone ou email, valor em dívida, faturas, pagamentos e contrato.
- Identidade visual a partir do logótipo (azul e azul-marinho), tipografia Bricolage Grotesque + Instrument Sans, responsivo até 360 px, foco visível e movimento reduzido respeitado.
- Verificado com um fluxo completo num browser real (entrar, criar contrato, registar pagamento, recibo, convite e portal no telemóvel).

**Ainda por fazer nesta área:** site institucional (fica com o CMS, fase 4), segundo idioma (inglês), testes automáticos de interface no CI.

## ✅ Fase 3 — Pagamentos móveis e documentos

- Arquitetura de fornecedores (`MobileMoneyProvider`) com ligação **por organização** e credenciais cifradas.
- Simulador completo (sucesso, saldo insuficiente, cancelamento, sem resposta) para desenvolver e demonstrar sem contas.
- Cliente M-Pesa Vodacom (C2B síncrono + consulta de estado), com testes unitários contra pedidos simulados.
- Portal: **Pagar agora** com escolha da carteira pelo prefixo do número, espera pela confirmação e recibo no fim. Equipa: **Pedir por telemóvel**.
- Confirmação idempotente, bloqueio da fatura, proteção contra pedidos duplicados, varrimento de pendentes, caso "dinheiro recebido mas fatura já paga" marcado para revisão.
- Recibos em PDF no servidor (equipa e inquilino), com "total pago até à data" calculado à data do recibo.
- SMS/WhatsApp via Twilio (opcional).

**Para ir para produção com dinheiro real**
1. Abrir conta M-Pesa empresarial e registar-se em developer.mpesa.vm.co.mz.
2. Em Definições, colar API Key, Public Key e código de serviço com o ambiente **Sandbox** e testar.
3. Confirmar no sandbox os detalhes assinalados em `mpesa.provider.ts`; mudar para **Produção**.
4. e-Mola e mKesh: a Movitel/Tmcel não têm portal público equivalente. O caminho mais simples é um agregador (ex.: PaySuite, e2Payments, pawaPay) através de um novo `MobileMoneyProvider`.

**Ainda por fazer:** webhooks/callbacks assíncronos (se o fornecedor escolhido os usar), contratos de arrendamento em PDF a partir de modelos, upload de documentos (S3), gateway SMS local.

## ✅ Fase 4 — Funcionalidades extra (atrás de feature flags)

Todas portadas para o novo modelo e **desligadas por omissão** (`FEATURES` no `.env`):

- **Site público** renderizado no servidor (bom para SEO): página inicial, Funcionalidades, Sobre, Contactos (com proteção anti-spam), editáveis na administração.
- **Blog** com categorias, rascunhos, destaque, campos SEO e editor Markdown com pré-visualização.
- **Marketplace** entre organizações: anúncios com moderação, pedidos de interesse (contactos só partilhados após aceitação), denúncias, contagem de visitas, expiração e renovação.
- **Testemunhos** enviados em Definições e moderados antes de aparecer na página inicial.
- **Página de estado** com componentes, incidentes e atualizações; resolver um incidente repõe os componentes.
- **Administração da plataforma** (`/admin`, `SUPER_ADMIN`), com filas de trabalho e o script `admin:promote`.
- Testes e2e para todas as áreas e para o comportamento com as flags desligadas (404).

**Ainda por fazer:** upload de imagens (hoje são endereços https), mapa nos anúncios, alertas de novos anúncios por email.

## ✅ Fase 5 — Plataforma (primeira parte)

- **Subscrições:** teste de 30 dias do Profissional, mudança de plano com crédito proporcional, descidas agendadas, renovação com fatura 7 dias antes, 7 dias de tolerância e passagem automática para o Grátis (sem apagar dados).
- **Faturação do Rentix:** faturas numeradas `RTX`, pagamento por M-Pesa/e-Mola para a conta do Rentix ou por transferência, fatura-recibo em PDF, avisos por email/SMS.
- **Administração:** indicadores (receita mensal recorrente, testes a terminar), organizações (uso, equipa, atividade, oferecer/prolongar plano, suspender/reativar), faturas (registar transferências, anular), planos (preços e limites).
- **Convites de equipa** por email para quem ainda não tem conta.
- Planos base garantidos por migração; script de administrador compilado para produção; Dockerfiles corrigidos (build da API sem base de dados, `API_URL` do frontend no build) e `docker-compose.prod.yml`.
- 18 testes e2e novos e 14 testes unitários das regras das subscrições.

**Por fazer antes de cobrar a sério:**
1. Conta M-Pesa empresarial do Rentix e teste no sandbox (o mesmo cliente das organizações).
2. Preços finais e dados fiscais (`PLATFORM_COMPANY_*`); confirmar com um contabilista o formato da fatura (IVA, série).
3. Testar os Dockerfiles num ambiente com acesso ao Docker Hub (aqui só foi possível reproduzir os passos sem Docker).

## ✅ Fase 6 — Relatórios, ficheiros e contratos

- **Relatórios:** faturado, cobrado, taxa de cobrança, dívida, 12 meses, por imóvel e dívidas por antiguidade.
- **Exportações Excel** para o contabilista (faturas, pagamentos, inquilinos, dívidas), com auditoria.
- **Ficheiros:** armazenamento local ou S3, verificação do tipo real, fotografias sem GPS, partilha com o inquilino no portal, fotografias dos anúncios e capas do blog por envio.
- **Contratos em PDF** a partir de um modelo editável por organização, com valores por extenso e modelo base para Moçambique (a rever por um jurista).
- 12 testes e2e novos e testes unitários (extenso, PDF do contrato, deteção de ficheiros).

## ✅ Fase 7, parte 1 — Fiabilidade

- **Sentry** na API e no frontend, com limpeza de dados pessoais testada (emails, telefones, NUIT, tokens, cookies).
- **Crons vigiados:** registo de cada execução, check-ins no Sentry, alerta à 3.ª falha seguida dos crons de minuto.
- **Saúde da plataforma** (`/admin/saude`) e vigilância a cada 15 min: pagamentos presos, mensagens em fila ou a falhar, backups atrasados.
- **Neon:** ligação pooled para a app e direta para migrações; PITR do Neon + `pg_dump` cifrado diário noutro fornecedor + cópia semanal dos ficheiros.
- **Teste de reposição mensal** automático numa ramificação temporária do Neon (migrações, contagens e integridade dos pagamentos).
- **Runbook** com os cenários de recuperação (RPO 5 min, RTO 2 h).
- **Limite de armazenamento** por plano e **exportação completa** dos dados da organização.

**Por fazer na configuração:** criar o projeto Neon (Launch), o bucket de backups, os projetos Sentry, os segredos do GitHub e o monitor externo (passos em `docs/RUNBOOK.md`); fazer um primeiro `workflow_dispatch` de cada job.

## ✅ Fase 7, parte 2 — Inglês

- Interface completa em inglês (gestão, portal do inquilino, site, entrada), com escolha por utilizador, por inquilino e por organização; contas novas no idioma do browser.
- Erros e validação da API no idioma do pedido.
- Emails e SMS no idioma de quem recebe; faturas, recibos e Excel traduzidos; modelo de contrato base em inglês e valores por extenso em inglês.
- Telefones internacionais (libphonenumber), país, moeda dos novos contratos e fuso horário nas Definições.
- Conteúdo do site (CMS) em português e inglês.
- `pnpm i18n:check` na CI para não ficarem textos por traduzir.

## Depois

- e-Mola e mKesh através de um agregador.
- Assinatura eletrónica do contrato (hoje: imprimir, assinar e enviar a cópia digitalizada).
