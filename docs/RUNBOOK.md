# Runbook de operações do Rentix

O que fazer quando algo corre mal, e como está montada a proteção dos dados.
Mantenha este documento atualizado e leia-o **antes** de precisar dele.

## Objetivos

| | Objetivo | Como |
|---|---|---|
| Dados que podemos perder (RPO) | **5 minutos** | Recuperação para um momento anterior do Neon (registo contínuo de alterações) |
| Tempo para voltar a funcionar (RTO) | **2 horas** | Restauro no Neon (minutos); com o Neon indisponível, `pg_dump` noutro fornecedor |
| Cópia fora do Neon | diária, 35 dias + mensais 13 meses | `pg_dump` cifrado (GitHub Actions → bucket de cópias) |
| Ficheiros | semanal, apagados guardados 90 dias | `rclone` para o bucket de cópias |
| Prova de que funciona | mensal | Teste de reposição numa ramificação do Neon |

Tudo isto aparece em **Administração → Saúde**, com o último resultado de cada cópia.

## Configuração (uma vez)

1. **Neon**
   - Plano **Launch** ou superior, com a janela de histórico em pelo menos **7 dias** (Project settings → Storage). No plano Free a janela é de só 6 horas.
   - `DATABASE_URL` da API: a ligação **com pool** (endereço com `-pooler`).
   - `DIRECT_DATABASE_URL`: a ligação **direta** (sem `-pooler`), usada pelas migrações (`prisma migrate deploy`) e pelos backups.
   - Proteja a ramificação de produção (Branches → Protect).
2. **Bucket de cópias** num fornecedor diferente do das fotografias/documentos (ex.: Backblaze B2 ou AWS, se os ficheiros estão no Cloudflare R2), com regras de ciclo de vida:
   - `db/daily/` apagar ao fim de 35 dias; `db/monthly/` ao fim de 400 dias; `files/removed-*` ao fim de 90 dias.
   - Credenciais só com permissão de escrita e leitura nesse bucket.
3. **Frase de cifra** (`BACKUP_PASSPHRASE`): gerar (`openssl rand -base64 32`), guardar no GitHub **e** num gestor de senhas fora do GitHub. Sem ela, os dumps não servem para nada.
4. **GitHub → Settings → Secrets**: todos os segredos listados no topo de `.github/workflows/backup.yml`, e a variável `PG_MAJOR` com a versão do Postgres do Neon.
5. **API**: `OPS_TOKEN` (`openssl rand -hex 24`), igual ao segredo do GitHub.
6. **Sentry**: dois projetos (API e web).
   - API: `SENTRY_DSN`. Web: `NEXT_PUBLIC_SENTRY_DSN` no build e `SENTRY_DSN` em execução. Para source maps: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` no build.
   - Os crons aparecem sozinhos em **Crons** (`rentix-billing-daily`, …) no primeiro check-in. Configure o alerta de "check-in falhado/em falta" para email ou SMS.
   - Regra de alerta para eventos com a etiqueta `check` (vêm da vigilância de 15 em 15 minutos).
7. **Monitorização externa** (Better Stack, UptimeRobot…): pedir `https://<domínio>/api/v1/health/ready` a cada minuto e o site `/`; alertar ao fim de 2 falhas.

## Cenários

### Apagou-se ou estragou-se dados (erro humano, migração má, bug)

1. Descobrir **quando** aconteceu (auditoria em `audit_logs`, Sentry, Saúde).
2. No Neon, **criar uma ramificação desse momento** (antes do problema) e consultá-la, sem tocar na produção:
   ```bash
   neon branches create --name antes-do-erro --parent 2026-11-16T09:30:00Z
   neon connection-string antes-do-erro
   ```
3. Se for preciso recuperar só alguns registos: copiá-los da ramificação para a produção com SQL.
4. Se for preciso voltar a produção inteira atrás: **parar a API** (para não haver escritas), e
   ```bash
   neon branches restore main ^self@2026-11-16T09:30:00Z --preserve-under-name main-antes-do-restauro
   ```
   O endereço de ligação não muda. O estado anterior fica guardado em `main-antes-do-restauro`.
5. Voltar a ligar a API e verificar em Saúde; registar o incidente na página de estado.

### O Neon está indisponível ou perdemos o acesso à conta

1. Criar um PostgreSQL noutro fornecedor (mesma versão principal).
2. Descarregar o último dump e decifrar:
   ```bash
   aws s3 cp s3://<bucket>/db/daily/rentix-AAAAMMDD-HHMM.dump.gpg .
   gpg --decrypt -o rentix.dump rentix-AAAAMMDD-HHMM.dump.gpg   # pede a BACKUP_PASSPHRASE
   pg_restore --no-owner --no-privileges -d "$NOVO_URL" rentix.dump
   node apps/api/dist/cli/restore-check.js --url "$NOVO_URL"      # tem de dar ok
   ```
3. Apontar `DATABASE_URL` e `DIRECT_DATABASE_URL` para a nova base e reiniciar a API.
4. Perdem-se as alterações desde o último dump (até 24 h). Avisar os clientes e verificar pagamentos M-Pesa desse intervalo no portal do fornecedor.

### Perderam-se ficheiros

```bash
rclone copy dst:<bucket-copias>/files/current src:<bucket-ficheiros>          # tudo
rclone copy dst:<bucket-copias>/files/removed-AAAAMMDD/<chave> src:<bucket>/<chave>   # um ficheiro apagado
```
As chaves estão em `stored_files.storageKey`.

### A API não responde

1. `GET /api/v1/health` (processo) e `/api/v1/health/ready` (base de dados e armazenamento).
2. Sentry (erros recentes) e registos.
3. Se começou com uma versão nova: voltar à imagem anterior. As migrações são só aditivas; se uma migração tiver de ser revertida, usar o restauro do Neon acima.

### Uma tarefa agendada não corre ou falha

- Saúde mostra a última execução e o erro. O Sentry Crons alerta sozinho.
- Só **uma** réplica pode ter `CRON_ENABLED=true`.
- Todas as tarefas são seguras para repetir: a faturação, por exemplo, não duplica faturas.

### Pagamentos móveis presos em "pendente"

- O sweep de minuto a minuto consulta o fornecedor e resolve-os; ao fim de 30 min sem resposta, marca como falhado com a referência para o cliente contactar.
- Se Saúde mostrar muitos presos: ver o estado do M-Pesa e o registo de erros do fornecedor; confirmar transações no portal da Vodacom com a referência (`providerReference`).

### Um segredo foi exposto

| Segredo | Ação | Efeito |
|---|---|---|
| `JWT_STAFF_SECRET` / `JWT_TENANT_SECRET` | trocar e reiniciar | todos voltam a entrar |
| `PAYMENT_CREDENTIALS_KEY` | trocar **e** pedir às organizações que voltem a ligar o M-Pesa | as credenciais guardadas deixam de poder ser lidas |
| `OPS_TOKEN` | trocar na API e no GitHub | — |
| Chaves S3, Neon, Twilio, Resend (`RESEND_API_KEY`) | revogar no fornecedor e trocar | — |
| `BACKUP_PASSPHRASE` | trocar; os dumps antigos continuam com a antiga | guardar a antiga até expirarem |

## Teste de reposição manual

```bash
cd apps/api && pnpm build
NEON_API_KEY=… NEON_PROJECT_ID=… NEON_BRANCH_ID=… DIRECT_DATABASE_URL=… \
  node dist/cli/restore-check.js --neon
```
Cria uma ramificação de há uma hora (apagada no fim, ou sozinha ao fim de 2 horas) e verifica: migrações aplicadas, tabelas principais com dados, valores pagos das faturas iguais à soma dos pagamentos, recibos sem repetições.
