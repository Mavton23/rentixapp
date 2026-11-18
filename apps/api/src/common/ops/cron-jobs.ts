/** As tarefas agendadas da API, com o horário e o intervalo máximo aceitável entre execuções. */
export const CRON_JOBS = {
  'billing-daily': { label: 'Faturação diária (rendas, multas, lembretes)', schedule: '0 6 * * *', timezone: 'Africa/Maputo', maxGapMinutes: 26 * 60, maxRuntimeMinutes: 30 },
  'subscriptions-lifecycle': { label: 'Subscrições (renovações, atrasos, fim dos testes)', schedule: '0 7 * * *', timezone: 'Africa/Maputo', maxGapMinutes: 26 * 60, maxRuntimeMinutes: 30 },
  'notifications-dispatch': { label: 'Envio de emails e SMS', schedule: '* * * * *', timezone: 'UTC', maxGapMinutes: 5, maxRuntimeMinutes: 5 },
  'mobile-payments-sweep': { label: 'Pagamentos móveis pendentes', schedule: '* * * * *', timezone: 'UTC', maxGapMinutes: 5, maxRuntimeMinutes: 5 },
  'subscription-payments-sweep': { label: 'Pagamentos de subscrições pendentes', schedule: '* * * * *', timezone: 'UTC', maxGapMinutes: 5, maxRuntimeMinutes: 5 },
  'marketplace-expire': { label: 'Expiração de anúncios', schedule: '0 * * * *', timezone: 'UTC', maxGapMinutes: 90, maxRuntimeMinutes: 10 },
  'ops-watch': { label: 'Vigilância (alertas de negócio)', schedule: '*/15 * * * *', timezone: 'UTC', maxGapMinutes: 40, maxRuntimeMinutes: 5 },
} as const;

export type CronJobName = keyof typeof CRON_JOBS;
