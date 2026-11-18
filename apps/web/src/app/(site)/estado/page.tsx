import { getLocale, getT } from '@/i18n/server';
import { notFound } from 'next/navigation';
import { intlLocale, type ComponentStatus, type Locale } from '@rentix/shared';
import { apiGet, getFeatures } from '@/lib/server-api';
import type { StatusIncident, StatusResponse } from '@/lib/site-types';
import { cn } from '@/lib/format';
import {
  componentStatusLabel,
  incidentImpactLabel,
  incidentStatusLabel,
  overallStatusText,
} from '@/i18n/extras';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Estado do serviço') };
}

const TONE: Record<ComponentStatus, { dot: string; band: string }> = {
  OPERATIONAL: { dot: 'bg-paid', band: 'bg-paid text-white' },
  DEGRADED: { dot: 'bg-due', band: 'bg-due text-white' },
  PARTIAL_OUTAGE: { dot: 'bg-due', band: 'bg-due text-white' },
  MAJOR_OUTAGE: { dot: 'bg-overdue', band: 'bg-overdue text-white' },
};

const when = (iso: string, locale: Locale = 'pt') =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Maputo',
  }).format(new Date(iso));

export default async function StatusPage() {
  const t = await getT();
  const locale = await getLocale();
  if (!(await getFeatures()).STATUS_PAGE) notFound();
  const s = await apiGet<StatusResponse>('/status', 30);

  return (
    <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
      <h1 className="text-[36px]">{t('Estado do serviço')}</h1>
      {!s ? (
        <p className={cn('mt-8 rounded-panel px-5 py-4 font-medium', TONE.MAJOR_OUTAGE.band)}>
          {t('Não foi possível contactar o serviço. Estamos a verificar.')}
        </p>
      ) : (
        <>
          <p
            role="status"
            className={cn('mt-8 rounded-panel px-5 py-4 text-lg font-medium', TONE[s.overall].band)}
          >
            {t.label(overallStatusText[s.overall])}
          </p>

          {s.activeIncidents.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl">{t('Incidentes em curso')}</h2>
              <div className="mt-4 space-y-4">
                {s.activeIncidents.map((i) => (
                  <Incident key={i.id} incident={i} />
                ))}
              </div>
            </section>
          )}

          {s.components.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl">{t('Serviços')}</h2>
              <ul className="mt-4 divide-y divide-line rounded-panel border border-line">
                {s.components.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <span>
                      <span className="font-medium">{t.label(c.name)}</span>
                      {c.description && (
                        <span className="block text-sm text-ink-soft">
                          {t.label(c.description)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-sm whitespace-nowrap">
                      <span
                        className={cn('size-2.5 rounded-full', TONE[c.status].dot)}
                        aria-hidden
                      />
                      {t.label(componentStatusLabel[c.status])}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-10">
            <h2 className="text-xl">{t('Últimos 30 dias')}</h2>
            {s.recentIncidents.length === 0 ? (
              <p className="mt-3 text-ink-soft">{t('Sem incidentes registados.')}</p>
            ) : (
              <div className="mt-4 space-y-4">
                {s.recentIncidents.map((i) => (
                  <Incident key={i.id} incident={i} />
                ))}
              </div>
            )}
          </section>
          <p className="mt-10 text-sm text-ink-faint">
            {t('Atualizado a {when}', { when: when(s.generatedAt, locale) })}
          </p>
        </>
      )}
    </div>
  );
}

async function Incident({ incident: i }: { incident: StatusIncident }) {
  const t = await getT();
  const locale = await getLocale();
  return (
    <article className="rounded-panel border border-line p-5">
      <h3 className="text-lg">{t.label(i.title)}</h3>
      <p className="text-sm text-ink-soft">
        {t.label(incidentImpactLabel[i.impact])}
        {i.components.length > 0 &&
          t(', afeta {0}', { '0': i.components.map((c) => c.name).join(', ') })}
      </p>
      <ol className="mt-4 space-y-3 border-l border-line pl-4">
        {i.updates.map((u) => (
          <li key={u.id}>
            <p className="text-sm">
              <span className="font-medium">{t.label(incidentStatusLabel[u.status])}</span>
              <span className="text-ink-faint">, {t.label(when(u.createdAt, locale))}</span>
            </p>
            <p className="text-ink-soft">{t.label(u.message)}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
