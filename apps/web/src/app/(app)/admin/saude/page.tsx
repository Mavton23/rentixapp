'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Clock, TriangleAlert } from 'lucide-react';
import { staffApi } from '@/lib/clients';
import { cn } from '@/lib/format';
import { Badge, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';

type Level = 'ok' | 'warning' | 'critical';
interface OpsEvent {
  id: string;
  kind: string;
  status: 'OK' | 'FAILED';
  details: Record<string, unknown> | null;
  createdAt: string;
}
interface Health {
  status: Level;
  checks: { key: string; label: string; status: Level; detail: string }[];
  crons: {
    name: string;
    label: string;
    schedule: string;
    timezone: string;
    lastFinishedAt: string | null;
    lastStatus: string | null;
    lastDurationMs: number | null;
    lastResult: unknown;
    lastError: string | null;
    consecutiveFailures: number;
    runs: number;
    overdue: boolean;
  }[];
  payments: { stuckMobile: number; stuckSubscriptions: number };
  notifications: { queuedOver15min: number; lastHour: { sent: number; failed: number } };
  backups: { lastDump: OpsEvent | null; lastRestoreTest: OpsEvent | null; lastFiles: OpsEvent | null };
  monitoring: { sentry: boolean };
}

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('pt-MZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Maputo' }).format(new Date(iso)) : 'nunca';

const SCHEDULE: Record<string, string> = {
  '* * * * *': 'a cada minuto',
  '*/15 * * * *': 'a cada 15 min',
  '0 * * * *': 'de hora a hora',
  '0 6 * * *': 'todos os dias às 06:00',
  '0 7 * * *': 'todos os dias às 07:00',
};

const ICON = { ok: CircleCheck, warning: TriangleAlert, critical: CircleAlert };
const TONE = { ok: 'text-paid', warning: 'text-due', critical: 'text-overdue' };

const LABELS: Record<string, string> = {
  sent: 'enviadas',
  changed: 'alteradas',
  expired: 'expirados',
  confirmed: 'confirmados',
  failed: 'falhados',
  invoices: 'faturas',
  penalties: 'multas',
  reminders: 'lembretes',
  tables: 'tabelas',
  files: 'ficheiros',
  migrations: 'migrações',
};
const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toLocaleString('pt-MZ', { maximumFractionDigits: 1 })} GB`
  : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toLocaleString('pt-MZ', { maximumFractionDigits: 1 })} MB`
  : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Resumo legível de um resultado: "1,8 MB, 39 tabelas". Zeros e chaves técnicas são omitidos. */
function resultText(r: unknown): string {
  if (r === null || r === undefined) return '';
  if (typeof r === 'number') return r > 0 ? r.toLocaleString('pt-MZ') : '';
  if (typeof r !== 'object') return String(r);
  return Object.entries(r as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([k, v]) => (k === 'bytes' ? fmtBytes(v as number) : `${(v as number).toLocaleString('pt-MZ')} ${LABELS[k] ?? k}`))
    .join(', ');
}

function BackupRow({ label, e, expected }: { label: string; e: OpsEvent | null; expected: string }) {
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-ink-soft">{expected}</p>
        {e?.details && <p className="text-xs text-ink-faint">{resultText(e.details)}</p>}
      </div>
      <div className="shrink-0 text-right">
        {e ? <Badge tone={e.status === 'OK' ? 'paid' : 'overdue'}>{e.status === 'OK' ? 'Bem-sucedido' : 'Falhou'}</Badge> : <Badge>Sem registo</Badge>}
        <p className="mt-1 text-xs text-ink-faint">{e ? when(e.createdAt) : ''}</p>
      </div>
    </li>
  );
}

/** Estado das tarefas agendadas, filas, pagamentos e cópias de segurança. */
export default function PlatformHealthPage() {
  const q = useQuery({ queryKey: ['admin-ops-health'], queryFn: () => staffApi.get<Health>('/admin/ops/health'), refetchInterval: 60_000 });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={8} />;
  const h = q.data;
  const Icon = ICON[h.status];

  return (
    <>
      <PageHeader title="Saúde da plataforma" description="Atualiza a cada minuto. Os problemas também são enviados ao Sentry." />
      <div className={cn('mb-6 flex items-start gap-3 rounded-panel border px-5 py-4', h.status === 'ok' ? 'border-paid/30 bg-paid-soft' : h.status === 'warning' ? 'border-due/30 bg-due-soft' : 'border-overdue/30 bg-overdue-soft')}>
        <Icon className={cn('mt-0.5 size-5 shrink-0', TONE[h.status])} aria-hidden />
        <div>
          <p className="font-medium">{h.status === 'ok' ? 'Tudo a funcionar' : `${h.checks.length} ${h.checks.length === 1 ? 'problema' : 'problemas'}`}</p>
          {h.checks.length > 0 && (
            <ul className="mt-1 text-sm">
              {h.checks.map((c) => (
                <li key={c.key}>
                  <span className="font-medium">{c.label}:</span> {c.detail}
                </li>
              ))}
            </ul>
          )}
          {!h.monitoring.sentry && <p className="mt-1 text-sm text-ink-soft">O Sentry não está configurado (SENTRY_DSN): os alertas só aparecem aqui.</p>}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <Panel title="Tarefas agendadas">
          <Table>
            <thead>
              <tr>
                <Th>Tarefa</Th>
                <Th>Última execução</Th>
                <Th className="hidden md:table-cell">Resultado</Th>
              </tr>
            </thead>
            <tbody>
              {h.crons.map((c) => {
                const level: Level | 'idle' = c.lastStatus === 'FAILED' ? 'critical' : c.overdue && c.runs > 0 ? 'critical' : c.runs === 0 ? 'idle' : 'ok';
                const I = level === 'idle' ? Clock : ICON[level];
                const levelLabel = { ok: 'a funcionar', critical: 'com problemas', idle: 'ainda não correu', warning: 'atenção' }[level];
                return (
                  <Tr key={c.name}>
                    <Td>
                      <span className="flex items-start gap-2">
                        <I className={cn('mt-0.5 size-4 shrink-0', level === 'idle' ? 'text-ink-faint' : TONE[level])} aria-label={levelLabel} />
                        <span>
                          <span className="font-medium">{c.label}</span>
                          <span className="block text-ink-faint">{SCHEDULE[c.schedule] ?? c.schedule}</span>
                        </span>
                      </span>
                    </Td>
                    <Td>
                      {c.runs === 0 ? 'Ainda não correu' : when(c.lastFinishedAt)}
                      {c.lastDurationMs !== null && c.runs > 0 && <span className="block text-ink-faint">{(c.lastDurationMs / 1000).toLocaleString('pt-MZ', { maximumFractionDigits: 1 })} s</span>}
                    </Td>
                    <Td className="hidden md:table-cell">
                      {c.lastStatus === 'FAILED' ? (
                        <span className="text-overdue">{c.lastError}</span>
                      ) : (
                        <span className="text-ink-soft">{resultText(c.lastResult) || (c.runs > 0 ? 'Nada a fazer' : '—')}</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Cópias de segurança">
            <ul className="divide-y divide-line">
              <BackupRow label="Cópia diária da base de dados" e={h.backups.lastDump} expected="pg_dump para armazenamento fora do Neon, todos os dias" />
              <BackupRow label="Teste de reposição" e={h.backups.lastRestoreTest} expected="Ramificação do Neon reposta e verificada, todos os meses" />
              <BackupRow label="Cópia dos ficheiros" e={h.backups.lastFiles} expected="Ficheiros copiados para outro armazenamento, todas as semanas" />
            </ul>
          </Panel>
          <Panel title="Filas e pagamentos">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 text-sm">
              <div>
                <dt className="text-ink-soft">Mensagens enviadas (1 h)</dt>
                <dd className="money text-xl font-semibold">{h.notifications.lastHour.sent}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Mensagens falhadas (1 h)</dt>
                <dd className={cn('money text-xl font-semibold', h.notifications.lastHour.failed > 0 && 'text-overdue')}>{h.notifications.lastHour.failed}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">À espera há mais de 15 min</dt>
                <dd className={cn('money text-xl font-semibold', h.notifications.queuedOver15min > 0 && 'text-due')}>{h.notifications.queuedOver15min}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Pagamentos móveis presos</dt>
                <dd className={cn('money text-xl font-semibold', h.payments.stuckMobile + h.payments.stuckSubscriptions > 0 && 'text-due')}>
                  {h.payments.stuckMobile + h.payments.stuckSubscriptions}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
