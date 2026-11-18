'use client';

import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { staffApi } from '@/lib/clients';
import { useCanManage } from '@/lib/session';
import { FilesPanel } from '@/components/files-panel';
import type { PropertyDetail } from '@/lib/types';
import { moneyField, useServerError, useZodForm } from '@/lib/forms';
import { propertyTypeLabel } from '@/i18n/pt';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  DetailList,
  ErrorState,
  LoadingRows,
  Money,
  PageHeader,
  Panel,
  UnitStatusBadge,
} from '@/components/ui/display';
import { Field, FormError, Input, MoneyInput } from '@/components/ui/form';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { PropertyForm } from '@/components/property-form';

export default function PropertyPage() {
  const t = useT();
  const canManage = useCanManage();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const key = ['property', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => staffApi.get<PropertyDetail>(`/properties/${id}`),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} />;
  const p = q.data;

  async function archive() {
    if (
      !confirm(
        t('Arquivar "{name}"? Deixa de aparecer nas listas, mas o histórico mantém-se.', {
          name: p.name,
        }),
      )
    )
      return;
    try {
      await staffApi.delete(`/properties/${id}`);
      await qc.invalidateQueries({ queryKey: ['/properties'] });
      toast.success(t('Imóvel arquivado'));
      router.push('/imoveis');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível arquivar'));
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: '/imoveis', label: t('Imóveis') }}
        title={t.label(p.name)}
        description={t.label(
          [p.street, p.neighbourhood, p.city, p.province].filter(Boolean).join(', '),
        )}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden /> {t('Editar')}
            </Button>
            <Button variant="ghost" onClick={archive}>
              <Archive aria-hidden /> {t('Arquivar')}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <Panel
          title={t('Unidades')}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setUnitOpen(true)}>
              <Plus aria-hidden /> {t('Acrescentar unidade')}
            </Button>
          }
        >
          <Table>
            <thead>
              <tr>
                <Th>{t('Unidade')}</Th>
                <Th>{t('Estado')}</Th>
                <Th>{t('Inquilino')}</Th>
                <Th className="text-right">{t('Renda')}</Th>
              </tr>
            </thead>
            <tbody>
              {p.units.map((u) => {
                const lease = u.leases[0];
                return (
                  <Tr key={u.id}>
                    <Td>
                      <span className="font-medium">{t.label(u.label)}</span>
                      {(u.bedrooms !== null || u.bathrooms !== null) && (
                        <span className="block text-ink-faint">
                          {u.bedrooms !== null && `${u.bedrooms} quartos`}
                          {u.bedrooms !== null && u.bathrooms !== null && ', '}
                          {u.bathrooms !== null && `${u.bathrooms} WC`}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <UnitStatusBadge status={u.status} />
                    </Td>
                    <Td>
                      {lease ? (
                        <Link href={`/contratos/${lease.id}`} className="text-ink hover:text-brand">
                          {t.label(lease.tenant.fullName)}
                        </Link>
                      ) : u.status === 'AVAILABLE' ? (
                        <Link
                          href={`/contratos/novo?unidade=${u.id}`}
                          className="text-brand hover:underline"
                        >
                          {t('Criar contrato')}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {lease ? (
                        <Money amount={lease.rentAmount} currency={lease.currency} />
                      ) : u.rentAmount ? (
                        <Money amount={u.rentAmount} className="text-ink-faint" />
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>

        <Panel title={t('Detalhes')}>
          <DetailList
            items={[
              { label: 'Tipo', value: t.label(propertyTypeLabel[p.type]) },
              { label: 'Morada', value: p.street },
              { label: 'Bairro', value: p.neighbourhood },
              { label: 'Cidade', value: p.city },
              { label: t('Província'), value: p.province },
              { label: 'Notas', value: p.description },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-6">
        <FilesPanel
          ownerType="PROPERTY"
          ownerId={p.id}
          categories={['PHOTO', 'CONTRACT', 'OTHER']}
          canEdit={canManage}
          title={t('Fotografias e documentos')}
          description={t('Fotografias do imóvel, escritura, plantas, licenças.')}
        />
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title={t('Editar imóvel')}>
        <PropertyForm
          withUnits={false}
          submitLabel={t('Guardar alterações')}
          defaults={{
            name: p.name,
            type: p.type,
            street: p.street,
            neighbourhood: p.neighbourhood ?? '',
            city: p.city,
            province: p.province ?? '',
            description: p.description ?? '',
          }}
          onSubmit={async ({ units: _units, ...v }) => {
            await staffApi.patch(`/properties/${id}`, v);
            await qc.invalidateQueries({ queryKey: key });
            toast.success(t("Alterações guardadas"));
            setEditOpen(false);
          }}
        />
      </Dialog>

      <AddUnitDialog
        open={unitOpen}
        onOpenChange={setUnitOpen}
        propertyId={id}
        onDone={() => qc.invalidateQueries({ queryKey: key })}
      />
    </>
  );
}

const unitSchema = z.object({
  label: z.string().trim().min(1, 'Indique o nome').max(60),
  rentAmount: moneyField(),
});

function AddUnitDialog({
  open,
  onOpenChange,
  propertyId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
  onDone: () => void;
}) {
  const t = useT();
  const form = useZodForm(unitSchema, { label: '', rentAmount: '' });
  const server = useServerError(form);
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await staffApi.post(`/properties/${propertyId}/units`, {
        label: v.label,
        rentAmount: v.rentAmount ?? null,
      });
      toast.success(t('Unidade acrescentada'));
      form.reset();
      onDone();
      onOpenChange(false);
    } catch (err) {
      server.handle(err);
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('Acrescentar unidade')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormError message={t.label(server.message)} />
        <Field
          label={t('Nome')}
          hint={t('Ex.: Flat 2B, Loja 3, Anexo')}
          error={errors.label?.message}
        >
          {(p) => <Input {...p} {...form.register('label')} />}
        </Field>
        <Field label={t('Renda de referência')} optional error={errors.rentAmount?.message}>
          {(p) => <MoneyInput {...p} {...form.register('rentAmount')} />}
        </Field>
        <Button type="submit" loading={isSubmitting}>
          {t('Acrescentar unidade')}
        </Button>
      </form>
    </Dialog>
  );
}
