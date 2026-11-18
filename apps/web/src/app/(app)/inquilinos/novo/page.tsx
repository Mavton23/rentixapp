'use client';

import { useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { staffApi } from '@/lib/clients';
import { PageHeader, Panel } from '@/components/ui/display';
import { TenantForm } from '@/components/tenant-form';

export default function NewTenantPage() {
  const tr = useT();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader
        title={tr('Novo inquilino')}
        back={{ href: '/inquilinos', label: 'Inquilinos' }}
      />
      <Panel className="p-5 sm:p-7">
        <TenantForm
          submitLabel={tr('Registar inquilino')}
          onSubmit={async (v) => {
            const t = await staffApi.post<{ id: string }>('/tenants', v);
            await qc.invalidateQueries({ queryKey: ['/tenants'] });
            toast.success(tr("Inquilino registado"));
            router.push(`/inquilinos/${t.id}`);
          }}
        />
      </Panel>
    </>
  );
}
