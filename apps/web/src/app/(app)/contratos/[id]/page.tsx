'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { FileDown } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { isIsoDate, todayIn } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useCanManage } from '@/lib/session';
import { FilesPanel } from '@/components/files-panel';
import type { LeaseDetail } from '@/lib/types';
import { date, money, period, num } from '@/lib/format';
import { optionalString, useServerError, useZodForm } from '@/lib/forms';
import { invoiceKindLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  DetailList,
  ErrorState,
  InvoiceStatusBadge,
  LeaseStatusBadge,
  LoadingRows,
  Money,
  PageHeader,
  Panel,
} from '@/components/ui/display';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';

export default function LeasePage() {
  const t = useT();
  const canManage = useCanManage();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [terminateOpen, setTerminateOpen] = useState(false);
  const key = ['lease', id];
  const q = useQuery({ queryKey: key, queryFn: () => staffApi.get<LeaseDetail>(`/leases/${id}`) });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} />;
  const l = q.data;
  const today = todayIn();
  const isLive = l.status === 'ACTIVE' || l.status === 'DRAFT';
  const lateFee =
    l.lateFeeBps !== null
      ? t('{0}% (deste contrato)', { '0': num(l.lateFeeBps / 100) })
      : t('Definição geral');

  return (
    <>
      <PageHeader
        back={{ href: '/contratos', label: 'Contratos' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t.label(l.tenant.fullName)}
            <LeaseStatusBadge status={l.status} />
          </span>
        }
        description={
          <Link href={`/imoveis/${l.unit.property.id}`} className="hover:text-brand">
            {t.label(l.unit.property.name)}, {t.label(l.unit.label)}
          </Link>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                staffApi
                  .download(`/leases/${l.id}/contract.pdf`, 'contrato.pdf')
                  .catch((err: unknown) =>
                    toast.error(
                      err instanceof Error ? err.message : t("Não foi possível gerar o contrato"),
                    ),
                  )
              }
            >
              <FileDown aria-hidden /> {t('Contrato em PDF')}
            </Button>
            {isLive && (
              <Button variant="secondary" onClick={() => setTerminateOpen(true)}>
                {t('Terminar contrato')}
              </Button>
            )}
          </>
        }
      />

      {l.status === 'ACTIVE' && l.endDate && l.endDate >= today && (
        <p className="mb-6 rounded-control border border-due/30 bg-due-soft px-4 py-3 text-sm text-due">
          {t('Este contrato termina a {date}. A unidade fica livre no dia seguinte.', {
            date: date(l.endDate),
          })}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={t('Faturas do contrato')}>
          {l.invoices.length === 0 ? (
            <p className="px-5 py-8 text-center text-ink-soft">{t('Ainda sem faturas.')}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('Fatura')}</Th>
                  <Th className="hidden sm:table-cell">{t('Vencimento')}</Th>
                  <Th>{t('Estado')}</Th>
                  <Th className="text-right">{t('Valor')}</Th>
                </tr>
              </thead>
              <tbody>
                {l.invoices.map((i) => {
                  const overdue =
                    (i.status === 'OPEN' || i.status === 'PARTIALLY_PAID') && i.dueDate < today;
                  return (
                    <Tr key={i.id}>
                      <Td>
                        <Link href={`/faturas/${i.id}`} className="font-medium hover:text-brand">
                          {i.kind === 'RENT'
                            ? t('Renda de {period}', { period: period(i.period) })
                            : invoiceKindLabel[i.kind]}
                        </Link>
                        <span className="block text-ink-faint">{t.label(i.number)}</span>
                      </Td>
                      <Td className="hidden text-ink-soft sm:table-cell">{date(i.dueDate)}</Td>
                      <Td>
                        <InvoiceStatusBadge status={i.status} overdue={overdue} />
                      </Td>
                      <Td className="text-right">
                        <Money amount={i.amount} currency={i.currency} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title={t('Condições')}>
          <DetailList
            items={[
              {
                label: t('Renda mensal'),
                value: <span className="money">{money(l.rentAmount, l.currency)}</span>,
              },
              {
                label: t('Dia de pagamento'),
                value: t('Dia {billingDay} de cada mês', { billingDay: l.billingDay }),
              },
              { label: t('Início'), value: date(l.startDate) },
              { label: 'Fim', value: l.endDate ? date(l.endDate) : t('Sem termo') },
              {
                label: t('Caução'),
                value: l.depositAmount ? (
                  <span className="money">{money(l.depositAmount, l.currency)}</span>
                ) : (
                  t('Sem caução')
                ),
              },
              { label: t('Multa por atraso'), value: lateFee },
              {
                label: 'Inquilino',
                value: (
                  <Link href={`/inquilinos/${l.tenant.id}`} className="text-brand hover:underline">
                    {t.label(l.tenant.fullName)}
                  </Link>
                ),
              },
              { label: 'Telefone', value: l.tenant.phone },
              ...(l.terminationReason
                ? [{ label: t('Motivo do fim'), value: l.terminationReason }]
                : []),
              ...(l.notes ? [{ label: 'Notas', value: l.notes }] : []),
            ]}
          />
        </Panel>
      </div>

      <div className="mt-6">
        <FilesPanel
          ownerType="LEASE"
          ownerId={l.id}
          categories={['CONTRACT', 'RECEIPT', 'PHOTO', 'OTHER']}
          canEdit={canManage}
          allowShare
          title={t('Documentos do contrato')}
          description={t(
            'O contrato assinado, o auto de entrega com fotografias do estado da casa, adendas. Partilhe com o inquilino os que ele deve ver no portal.',
          )}
        />
      </div>

      <TerminateDialog
        open={terminateOpen}
        onOpenChange={setTerminateOpen}
        leaseId={id}
        startDate={l.startDate}
        onDone={() => qc.invalidateQueries()}
      />
    </>
  );
}

const terminateSchema = z.object({
  endDate: z.string().refine(isIsoDate, 'Data inválida'),
  reason: optionalString,
});

function TerminateDialog({
  open,
  onOpenChange,
  leaseId,
  startDate,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leaseId: string;
  startDate: string;
  onDone: () => void;
}) {
  const t = useT();
  const form = useZodForm(terminateSchema, { endDate: todayIn(), reason: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await staffApi.post(`/leases/${leaseId}/terminate`, v);
      toast.success(t('Contrato terminado'));
      onDone();
      onOpenChange(false);
    } catch (err) {
      server.handle(err);
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Terminar contrato')}
      description={t(
        'As rendas dos meses seguintes que ainda não foram pagas são anuladas. As faturas já vencidas continuam em dívida.',
      )}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field
          label={t('Último dia do contrato')}
          hint={t('Pode ser uma data futura (pré-aviso).')}
          error={errors.endDate?.message}
        >
          {(p) => <Input type="date" min={startDate} {...p} {...form.register('endDate')} />}
        </Field>
        <Field label={t('Motivo')} optional error={errors.reason?.message}>
          {(p) => <Textarea rows={2} {...p} {...form.register('reason')} />}
        </Field>
        <Button type="submit" variant="danger" loading={isSubmitting}>
          {t('Terminar contrato')}
        </Button>
      </form>
    </Dialog>
  );
}
