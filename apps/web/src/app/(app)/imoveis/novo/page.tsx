'use client';

import { useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { PageHeader, Panel } from '@/components/ui/display';
import { PropertyForm } from '@/components/property-form';

export default function NewPropertyPage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader title={t('Registar imóvel')} back={{ href: '/imoveis', label: t('Imóveis') }} />
      <Panel className="p-5 sm:p-7">
        <PropertyForm
          withUnits
          submitLabel={t('Registar imóvel')}
          onSubmit={async (v) => {
            const created = await staffApi.post<{ id: string }>('/properties', {
              ...v,
              units: v.units.map((u) => ({ ...u, rentAmount: u.rentAmount ?? null })),
            });
            await qc.invalidateQueries({ queryKey: ['/properties'] });
            toast.success(t("Imóvel registado"));
            router.push(`/imoveis/${created.id}`);
          }}
        />
      </Panel>
    </>
  );
}
