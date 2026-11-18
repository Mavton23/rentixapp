'use client';

import { useT } from '@/i18n/client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MobileMethod } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { ApiError } from '@/lib/api';
import { Button } from './ui/button';
import { Badge, LoadingRows, Panel } from './ui/display';
import { Field, FormError, Input, Select, Textarea } from './ui/form';

interface GatewayView {
  gateway: 'MPESA_VODACOM' | 'SIMULATOR';
  enabled: boolean;
  methods: MobileMethod[];
  hasCredentials: boolean;
  publicInfo: {
    serviceProviderCode?: string;
    environment?: 'sandbox' | 'production';
    apiKeyHint?: string | null;
  };
}
interface GatewaysResponse {
  gateways: GatewayView[];
  availableMethods: MobileMethod[];
  simulatorAllowed: boolean;
}

/** Definições → pagamentos por telemóvel. O dinheiro entra diretamente na conta M-Pesa do senhorio. */
export function PaymentGatewaysPanel({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const q = useQuery({
    queryKey: ['payment-gateways'],
    queryFn: () => staffApi.get<GatewaysResponse>('/payment-gateways'),
  });
  if (q.isError) return null; // papéis sem acesso não veem este painel
  return (
    <Panel title={t('Pagamentos por telemóvel')}>
      {!q.data ? (
        <LoadingRows rows={3} />
      ) : (
        <div className="flex flex-col divide-y divide-line">
          <p className="px-5 py-4 text-sm text-ink-soft">
            {t(
              'Com uma ligação ativa, os inquilinos pagam pelo portal e recebem o pedido de PIN no telemóvel. O pagamento é confirmado e o recibo emitido sem intervenção. O dinheiro entra diretamente na sua conta: o Rentix nunca o retém.',
            )}
          </p>
          <MpesaForm
            view={q.data.gateways.find((g) => g.gateway === 'MPESA_VODACOM')!}
            canEdit={canEdit}
          />
          {q.data.simulatorAllowed && (
            <SimulatorForm
              view={q.data.gateways.find((g) => g.gateway === 'SIMULATOR')!}
              canEdit={canEdit}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

function MpesaForm({ view, canEdit }: { view: GatewayView; canEdit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(view.enabled);
  const [environment, setEnvironment] = useState(view.publicInfo.environment ?? 'sandbox');
  const [code, setCode] = useState(view.publicInfo.serviceProviderCode ?? '');
  const [apiKey, setApiKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await staffApi.put('/payment-gateways/mpesa', {
        enabled,
        environment,
        serviceProviderCode: code.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(publicKey.trim() ? { publicKey: publicKey.trim() } : {}),
      });
      setApiKey('');
      setPublicKey('');
      await qc.invalidateQueries({ queryKey: ['payment-gateways'] });
      toast.success(t('Ligação M-Pesa guardada'));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (Object.values(err.fieldErrors)[0] ?? err.message)
          : t('Não foi possível guardar'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 px-5 py-5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{t('M-Pesa (Vodacom)')}</h3>
        {view.enabled ? (
          <Badge tone="paid">{t('Ativo')}</Badge>
        ) : view.hasCredentials ? (
          <Badge>{t('Desligado')}</Badge>
        ) : (
          <Badge>{t('Por configurar')}</Badge>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        {t(
          'Precisa de uma conta empresarial M-Pesa e de acesso ao portal de programador da Vodacom (developer.mpesa.vm.co.mz), onde obtém a API Key, a Public Key e o código de serviço.',
        )}
      </p>
      <FormError message={t.label(error)} />
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('Código de serviço')} hint={t('Service Provider Code, ex.: 171717')}>
          {(p) => (
            <Input
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              {...p}
            />
          )}
        </Field>
        <Field label={t('Ambiente')} hint={t('Teste primeiro no sandbox.')}>
          {(p) => (
            <Select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')}
              {...p}
            >
              <option value="sandbox">{t('Sandbox (testes)')}</option>
              <option value="production">{t('Produção')}</option>
            </Select>
          )}
        </Field>
        <Field
          label={t('API Key')}
          hint={
            view.hasCredentials
              ? t('Guardada ({0}). Preencha só para mudar.', {
                  '0': view.publicInfo.apiKeyHint ?? '',
                })
              : undefined
          }
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              {...p}
            />
          )}
        </Field>
        <Field
          label={t('Public Key')}
          hint={
            view.hasCredentials
              ? t('Guardada. Preencha só para mudar.')
              : t('Copie a chave completa do portal.')
          }
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea
              rows={3}
              className="font-mono text-xs"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              {...p}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 accent-brand"
          />
          {t('Aceitar pagamentos M-Pesa pelo portal')}
        </label>
      </fieldset>
      {canEdit && (
        <Button type="submit" variant="secondary" loading={saving} className="self-start">
          {t('Guardar ligação M-Pesa')}
        </Button>
      )}
    </form>
  );
}

function SimulatorForm({ view, canEdit }: { view: GatewayView; canEdit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  async function toggle(enabled: boolean) {
    setSaving(true);
    try {
      await staffApi.put('/payment-gateways/simulator', { enabled, methods: ['MPESA', 'EMOLA'] });
      await qc.invalidateQueries({ queryKey: ['payment-gateways'] });
      toast.success(enabled ? t('Simulador ligado') : t('Simulador desligado'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível alterar'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 bg-due-soft/40 px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold">
          {t('Simulador de M-Pesa e e-Mola')}
        </h3>
        {view.enabled ? <Badge tone="due">{t('Ligado')}</Badge> : <Badge>{t('Desligado')}</Badge>}
      </div>
      <p className="text-sm text-ink-soft">
        {t(
          'Para experimentar o fluxo completo sem conta de programador. Não movimenta dinheiro e não existe em produção. Números terminados em 0001 simulam saldo insuficiente, 0002 cancelamento e 0003 falta de resposta.',
        )}
      </p>
      {canEdit && (
        <Button
          variant="secondary"
          loading={saving}
          className="self-start"
          onClick={() => toggle(!view.enabled)}
        >
          {view.enabled ? t('Desligar simulador') : t('Ligar simulador')}
        </Button>
      )}
    </div>
  );
}
