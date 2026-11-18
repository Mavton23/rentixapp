'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Phone } from 'lucide-react';
import { todayIn } from '@rentix/shared';
import { portalApi } from '@/lib/clients';
import type { Paginated } from '@/lib/types';
import type { PortalInvoice, PortalMe, PortalSummary } from '@/lib/portal-types';
import { dueText, money } from '@/lib/format';
import { ErrorState, InvoiceStatusBadge, Money, Skeleton } from '@/components/ui/display';

export default function PortalHome() {
  const tr = useT();
  const me = useQuery({
    queryKey: ['portal', 'me'],
    queryFn: () => portalApi.get<PortalMe>('/portal/me'),
  });
  const summary = useQuery({
    queryKey: ['portal', 'summary'],
    queryFn: () => portalApi.get<PortalSummary>('/portal/summary'),
  });
  const invoices = useQuery({
    queryKey: ['portal', 'invoices', 'home'],
    queryFn: () => portalApi.get<Paginated<PortalInvoice>>('/portal/invoices', { pageSize: 20 }),
  });

  if (summary.isError)
    return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const today = todayIn();
  const firstName = me.data?.tenants[0]?.fullName.split(' ')[0];
  const open = invoices.data?.data.filter((i) => i.outstanding > 0) ?? [];
  const total = s?.balances[0];

  return (
    <div className="flex flex-col gap-6">
      <title>{tr('Portal do inquilino · Rentix')}</title>
      <section aria-labelledby="balance-heading">
        <p className="text-ink-soft">{firstName ? tr('Olá, {firstName}', { firstName }) : ' '}</p>
        <h1 id="balance-heading" className="mt-4 text-base font-medium text-ink-soft">
          {tr('Tem em dívida')}
        </h1>
        {!s ? (
          <Skeleton className="mt-2 h-14 w-64" />
        ) : (
          <>
            <p
              className={`money mt-1 text-[44px] leading-tight font-semibold ${s.overdueCount ? 'text-overdue' : 'text-ink'}`}
            >
              {total ? money(total.amount, total.currency) : money(0)}
            </p>
            {s.balances.slice(1).map((b) => (
              <p key={b.currency} className="money text-xl font-semibold">
                + {money(b.amount, b.currency)}
              </p>
            ))}
            <p className="mt-2 text-ink-soft">
              {s.overdueCount > 0
                ? tr('{0} em atraso.', {
                    '0':
                      s.overdueCount === 1 ? tr("Uma fatura está") : tr("{0} faturas estão", { '0': s.overdueCount }),
                  })
                : s.nextDue
                  ? tr('Próxima: {description}, {dueText}.', {
                      description: s.nextDue.description,
                      dueText: dueText(s.nextDue.dueDate, today),
                    })
                  : tr('Está tudo pago. Obrigado!')}
            </p>
          </>
        )}
      </section>

      {open.length > 0 && (
        <section className="rounded-panel border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-base">{tr('Por pagar')}</h2>
          <ul className="divide-y divide-line">
            {open.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/portal/faturas/${i.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-paper/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{tr.label(i.description)}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                      <InvoiceStatusBadge status={i.status} overdue={i.isOverdue} />
                      {tr.label(dueText(i.dueDate, today))}
                    </span>
                  </span>
                  <Money amount={i.outstanding} currency={i.currency} className="font-medium" />
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.data?.tenants.map((t) => (
        <section key={t.id} className="rounded-panel border border-line bg-surface px-4 py-4">
          <h2 className="text-base">{tr('Como pagar')}</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {tr(
              'Abra uma fatura e escolha Pagar agora, se {name} tiver o pagamento por telemóvel ativo. Também pode pagar como combinado: quando o pagamento for confirmado, o recibo aparece em Pagamentos.',
              { name: t.organization.name },
            )}
          </p>
          {t.organization.phone && (
            <a
              href={`tel:${t.organization.phone}`}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand"
            >
              <Phone className="size-4" aria-hidden />{' '}
              {tr('Ligar para {name}', { name: t.organization.name })}
            </a>
          )}
        </section>
      ))}
    </div>
  );
}
