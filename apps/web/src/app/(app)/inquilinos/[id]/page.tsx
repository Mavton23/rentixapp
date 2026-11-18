'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { useCanManage } from '@/lib/session';
import { FilesPanel } from '@/components/files-panel';
import type { InvoiceListItem, Paginated, TenantDetail } from '@/lib/types';
import { date, money } from '@/lib/format';
import { idDocumentLabel, maritalStatusLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Badge,
  DetailList,
  ErrorState,
  InvoiceStatusBadge,
  LeaseStatusBadge,
  LoadingRows,
  Money,
  PageHeader,
  Panel,
} from '@/components/ui/display';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { TenantForm } from '@/components/tenant-form';

export default function TenantPage() {
  const tr = useT();
  const canManage = useCanManage();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const key = ['tenant', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => staffApi.get<TenantDetail>(`/tenants/${id}`),
  });
  const invoices = useQuery({
    queryKey: ['/invoices', { tenantId: id }],
    queryFn: () =>
      staffApi.get<Paginated<InvoiceListItem>>('/invoices', { tenantId: id, pageSize: 12 }),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} />;
  const t = q.data;
  const active = t.leases.find((l) => l.status === 'ACTIVE');

  async function invite() {
    setInviting(true);
    try {
      await staffApi.post(`/tenants/${id}/invite`);
      toast.success(
        t.email ? tr('Convite enviado por SMS e email') : tr('Convite enviado por SMS'),
      );
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('Não foi possível enviar o convite'));
    } finally {
      setInviting(false);
    }
  }

  async function archive() {
    if (
      !confirm(
        tr('Arquivar {fullName}? O histórico de contratos e pagamentos mantém-se.', {
          fullName: t.fullName,
        }),
      )
    )
      return;
    try {
      await staffApi.delete(`/tenants/${id}`);
      await qc.invalidateQueries({ queryKey: ['/tenants'] });
      toast.success(tr('Inquilino arquivado'));
      router.push('/inquilinos');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('Não foi possível arquivar'));
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/inquilinos', label: 'Inquilinos' }}
        title={tr.label(t.fullName)}
        description={
          <>
            {tr.label(t.phone)}
            {t.email && <>, {tr.label(t.email)}</>}
          </>
        }
        actions={
          <>
            {!active && (
              <Button asChild>
                <Link href={`/contratos/novo?inquilino=${t.id}`}>
                  <Plus aria-hidden /> {tr('Criar contrato')}
                </Link>
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={invite}
              loading={inviting}
              title={tr('Enviar acesso ao portal do inquilino')}
            >
              <Send aria-hidden />{' '}
              {t.portalEnabled ? tr('Reenviar convite') : tr('Convidar para o portal')}
            </Button>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden /> {tr('Editar')}
            </Button>
            <Button variant="ghost" onClick={archive}>
              <Archive aria-hidden /> {tr('Arquivar')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Panel
            title={tr('Faturas')}
            actions={
              <Link
                href={`/faturas?inquilino=${t.id}`}
                className="text-sm text-brand hover:underline"
              >
                {tr('Ver todas')}
              </Link>
            }
          >
            {!invoices.data ? (
              <LoadingRows rows={3} />
            ) : invoices.data.data.length === 0 ? (
              <p className="px-5 py-8 text-center text-ink-soft">{tr('Sem faturas.')}</p>
            ) : (
              <Table>
                <tbody>
                  {invoices.data.data.map((i) => (
                    <Tr key={i.id}>
                      <Td>
                        <Link href={`/faturas/${i.id}`} className="font-medium hover:text-brand">
                          {tr.label(i.description)}
                        </Link>
                        <span className="block text-ink-faint">
                          {tr('{number}, vence {date}', {
                            number: i.number,
                            date: date(i.dueDate),
                          })}
                        </span>
                      </Td>
                      <Td>
                        <InvoiceStatusBadge status={i.status} overdue={i.isOverdue} />
                      </Td>
                      <Td className="text-right">
                        <Money amount={i.amount} currency={i.currency} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title={tr('Contratos')}>
            {t.leases.length === 0 ? (
              <p className="px-5 py-8 text-center text-ink-soft">{tr('Sem contratos.')}</p>
            ) : (
              <Table>
                <tbody>
                  {t.leases.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <Link href={`/contratos/${l.id}`} className="font-medium hover:text-brand">
                          {tr.label(l.unit.property.name)}, {tr.label(l.unit.label)}
                        </Link>
                        <span className="block text-ink-faint">
                          {tr('desde {date}{1}', {
                            date: date(l.startDate),
                            '1': l.endDate && tr(" até {0}", { '0': date(l.endDate) }),
                          })}
                        </span>
                      </Td>
                      <Td>
                        <LeaseStatusBadge status={l.status} />
                      </Td>
                      <Td className="text-right">
                        <Money amount={l.rentAmount} currency={l.currency} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
          <FilesPanel
            ownerType="TENANT"
            ownerId={t.id}
            categories={['ID_DOCUMENT', 'CONTRACT', 'RECEIPT', 'OTHER']}
            canEdit={canManage}
            allowShare
            description={tr(
              'Cópia do BI, comprovativos, declarações. Os que partilhar ficam visíveis para o inquilino no portal.',
            )}
          />
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <div className="px-5 py-4">
              <p className="text-sm text-ink-faint">{tr('Em dívida')}</p>
              <p
                className={`money mt-1 text-3xl font-semibold ${t.balance > 0 ? 'text-ink' : 'text-paid'}`}
              >
                {money(t.balance)}
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                {tr('Portal do inquilino:')}{' '}
                {t.portalEnabled ? (
                  <Badge tone="paid">{tr('Ativo')}</Badge>
                ) : (
                  <Badge>{tr('Sem acesso')}</Badge>
                )}
              </p>
            </div>
          </Panel>
          <Panel title={tr('Ficha')}>
            <DetailList
              items={[
                { label: idDocumentLabel[t.idDocumentType], value: t.idDocumentNumber },
                { label: 'NUIT', value: t.nuit },
                { label: tr('Data de nascimento'), value: t.birthDate ? date(t.birthDate) : null },
                {
                  label: tr('Estado civil'),
                  value: t.maritalStatus ? maritalStatusLabel[t.maritalStatus] : null,
                },
                { label: tr('Profissão'), value: t.occupation },
                { label: 'Empregador', value: t.employer },
                {
                  label: tr('Emergência'),
                  value: t.emergencyContactName
                    ? `${t.emergencyContactName} ${t.emergencyContactPhone ?? ''}`
                    : null,
                },
                { label: 'Notas', value: t.notes },
              ]}
            />
          </Panel>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title={tr('Editar inquilino')}>
        <TenantForm
          submitLabel={tr('Guardar alterações')}
          defaults={{
            fullName: t.fullName,
            phone: t.phone,
            email: t.email ?? '',
            idDocumentType: t.idDocumentType,
            idDocumentNumber: t.idDocumentNumber,
            nuit: t.nuit ?? '',
            birthDate: t.birthDate ? t.birthDate.slice(0, 10) : '',
            maritalStatus: t.maritalStatus ?? '',
            occupation: t.occupation ?? '',
            employer: t.employer ?? '',
            emergencyContactName: t.emergencyContactName ?? '',
            emergencyContactPhone: t.emergencyContactPhone ?? '',
            notes: t.notes ?? '',
            locale: t.locale ?? '',
          }}
          onSubmit={async (v) => {
            await staffApi.patch(`/tenants/${id}`, v);
            await qc.invalidateQueries({ queryKey: key });
            toast.success(tr("Alterações guardadas"));
            setEditOpen(false);
          }}
        />
      </Dialog>
    </>
  );
}
