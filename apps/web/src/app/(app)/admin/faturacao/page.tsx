'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { SubscriptionInvoiceStatus } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useDebounced } from '@/lib/queries';
import type { AdminInvoice, AdminInvoicePage } from '@/lib/platform-types';
import { instantDate, money } from '@/lib/format';
import { cycleLabel, platformInvoiceKindLabel, platformInvoiceStatusLabel } from '@/i18n/platform';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, FilterTabs, LoadingRows, PageHeader, Pagination, Panel } from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { SearchBox } from '@/components/search-box';
import { MarkPaidDialog } from '@/components/admin/mark-paid-dialog';

type Filter = SubscriptionInvoiceStatus | 'ALL';

export default function AdminBillingPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Filter>('OPEN');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<AdminInvoice | null>(null);
  const debounced = useDebounced(search);
  const q = useQuery({
    queryKey: ['admin-invoices', status, debounced, page],
    queryFn: () => staffApi.get<AdminInvoicePage>('/admin/billing/invoices', { status: status === 'ALL' ? undefined : status, search: debounced || undefined, page }),
  });
  const refresh = () => qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('admin-') });

  async function voidInvoice(i: AdminInvoice) {
    const reason = prompt(`Anular a fatura ${i.number}? Indique o motivo:`)?.trim();
    if (!reason) return;
    try {
      await staffApi.post(`/admin/billing/invoices/${i.id}/void`, { reason });
      toast.success('Fatura anulada');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível anular');
    }
  }

  return (
    <>
      <PageHeader title="Faturação" description="Faturas do Rentix às organizações. Transferências recebidas registam-se aqui." />
      <Panel>
        <FilterTabs<Filter>
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: 'OPEN', label: 'Por pagar' },
            { value: 'PAID', label: 'Pagas' },
            { value: 'VOID', label: 'Anuladas' },
            { value: 'ALL', label: 'Todas' },
          ]}
        />
        <div className="border-b border-line px-5 py-3">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Número da fatura ou organização" />
        </div>
        {!q.data ? (
          <LoadingRows />
        ) : q.data.data.length === 0 ? (
          <EmptyState title={status === 'OPEN' ? 'Nada por pagar' : 'Sem faturas'} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Fatura</Th>
                  <Th>Organização</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Estado</Th>
                  <Th className="w-0" />
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <span className="font-medium">{i.number}</span>
                      <span className="block text-ink-faint">
                        {platformInvoiceKindLabel[i.kind]}, {i.plan.name} {cycleLabel[i.billingCycle].toLowerCase()}
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/admin/organizacoes/${i.organization.id}`} className="hover:text-brand">{i.organization.name}</Link>
                    </Td>
                    <Td className="money text-right">{money(i.amount, i.currency)}</Td>
                    <Td>
                      <Badge tone={i.status === 'PAID' ? 'paid' : i.status === 'OPEN' ? 'due' : 'neutral'}>{platformInvoiceStatusLabel[i.status]}</Badge>
                      <span className="block text-xs text-ink-faint">
                        {i.status === 'PAID' ? `${instantDate(i.paidAt)}${i.paymentReference ? `, ${i.paymentReference}` : ''}` : i.status === 'OPEN' ? `até ${instantDate(i.dueDate)}` : i.voidReason}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        {i.status === 'OPEN' && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setPaying(i)}>Registar pagamento</Button>
                            <Button size="sm" variant="ghost" onClick={() => voidInvoice(i)}>Anular</Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" aria-label={`Descarregar ${i.number}`} onClick={() => staffApi.download(`/admin/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>
                          <Download aria-hidden />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination {...q.data.meta} onPage={setPage} />
          </>
        )}
      </Panel>
      <MarkPaidDialog invoice={paying} onClose={() => setPaying(null)} onDone={refresh} />
    </>
  );
}
