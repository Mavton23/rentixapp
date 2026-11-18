'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  COMPONENT_STATUSES,
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  type ComponentStatus,
  type IncidentImpact,
  type IncidentStatus,
} from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { revalidateSite } from '@/lib/revalidate';
import type { StatusIncident, StatusResponse } from '@/lib/site-types';
import { componentStatusLabel, incidentImpactLabel, incidentStatusLabel, overallStatusText } from '@/i18n/extras';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

const tone = (s: ComponentStatus) => (s === 'OPERATIONAL' ? 'paid' : s === 'MAJOR_OUTAGE' ? 'overdue' : 'due');

export default function AdminStatusPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-status'], queryFn: () => staffApi.get<StatusResponse>('/status') });
  const [newComponent, setNewComponent] = useState('');
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [updating, setUpdating] = useState<StatusIncident | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-status'] });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      revalidateSite();
      toast.success(ok);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível concluir');
    }
  };

  if (!q.data) return <LoadingRows rows={6} />;
  const s = q.data;

  return (
    <>
      <PageHeader
        title="Estado do serviço"
        description={overallStatusText[s.overall]}
        actions={
          <>
            <Button asChild variant="secondary"><a href="/estado" target="_blank" rel="noreferrer">Ver página pública</a></Button>
            <Button onClick={() => setIncidentOpen(true)}>Registar incidente</Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Componentes">
          <ul className="divide-y divide-line">
            {s.components.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="font-medium">{c.name}</span>
                <span className="flex items-center gap-2">
                  <Select
                    value={c.status}
                    onChange={(e) => run(() => staffApi.patch(`/admin/status/components/${c.id}`, { status: e.target.value }), 'Estado atualizado')}
                    aria-label={`Estado de ${c.name}`}
                    className="h-8 w-48 text-sm"
                  >
                    {COMPONENT_STATUSES.map((st) => <option key={st} value={st}>{componentStatusLabel[st]}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" aria-label={`Remover ${c.name}`}
                    onClick={() => confirm(`Remover "${c.name}"?`) && run(() => staffApi.delete(`/admin/status/components/${c.id}`), 'Componente removido')}>
                    Remover
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2 border-t border-line px-5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newComponent.trim()) return;
              void run(() => staffApi.post('/admin/status/components', { name: newComponent.trim(), sortOrder: s.components.length }), 'Componente criado').then(() => setNewComponent(''));
            }}
          >
            <Input value={newComponent} onChange={(e) => setNewComponent(e.target.value)} placeholder="Ex.: Pagamentos M-Pesa" aria-label="Novo componente" className="h-9" />
            <Button type="submit" size="sm" variant="secondary">Criar</Button>
          </form>
        </Panel>

        <Panel title="Incidentes em curso">
          {s.activeIncidents.length === 0 ? (
            <p className="px-5 py-6 text-center text-ink-soft">Sem incidentes em curso.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.activeIncidents.map((i) => (
                <li key={i.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{i.title}</p>
                      <p className="text-sm text-ink-soft">{incidentImpactLabel[i.impact]}{i.components.length > 0 && `, ${i.components.map((c) => c.name).join(', ')}`}</p>
                    </div>
                    <Badge tone="due">{incidentStatusLabel[i.status]}</Badge>
                  </div>
                  <p className="mt-2 text-sm">{i.updates[0]?.message}</p>
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => setUpdating(i)}>Publicar atualização</Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <NewIncidentDialog open={incidentOpen} onOpenChange={setIncidentOpen} components={s.components} onDone={refresh} />
      <UpdateDialog incident={updating} onOpenChange={(o) => !o && setUpdating(null)} onDone={refresh} />
    </>
  );
}

function NewIncidentDialog({ open, onOpenChange, components, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; components: StatusResponse['components']; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<IncidentImpact>('MINOR');
  const [message, setMessage] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [componentStatus, setComponentStatus] = useState<ComponentStatus>('DEGRADED');
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await staffApi.post('/admin/status/incidents', { title, impact, message, componentIds: ids, componentStatus });
      revalidateSite();
      toast.success('Incidente publicado');
      onDone();
      onOpenChange(false);
      setTitle('');
      setMessage('');
      setIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível publicar');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Registar incidente" description="Fica visível de imediato na página pública.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Título">{(p) => <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Atrasos na confirmação de pagamentos M-Pesa" {...p} />}</Field>
        <Field label="Impacto">
          {(p) => (
            <Select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)} {...p}>
              {INCIDENT_IMPACTS.map((x) => <option key={x} value={x}>{incidentImpactLabel[x]}</option>)}
            </Select>
          )}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Componentes afetados</legend>
          <div className="flex flex-wrap gap-3">
            {components.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="size-4 accent-brand" checked={ids.includes(c.id)} onChange={(e) => setIds(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        {ids.length > 0 && (
          <Field label="Estado dos componentes afetados">
            {(p) => (
              <Select value={componentStatus} onChange={(e) => setComponentStatus(e.target.value as ComponentStatus)} {...p}>
                {COMPONENT_STATUSES.filter((x) => x !== 'OPERATIONAL').map((x) => <option key={x} value={x}>{componentStatusLabel[x]}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Primeira mensagem">{(p) => <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Estamos a investigar…" {...p} />}</Field>
        <Button type="submit" loading={saving}>Publicar incidente</Button>
      </form>
    </Dialog>
  );
}

function UpdateDialog({ incident, onOpenChange, onDone }: { incident: StatusIncident | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [status, setStatus] = useState<IncidentStatus>('IDENTIFIED');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!incident) return;
    setSaving(true);
    try {
      await staffApi.post(`/admin/status/incidents/${incident.id}/updates`, { status, message });
      revalidateSite();
      toast.success(status === 'RESOLVED' ? 'Incidente resolvido' : 'Atualização publicada');
      setMessage('');
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível publicar');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={!!incident} onOpenChange={onOpenChange} title="Publicar atualização" description={incident?.title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Novo estado" hint="Resolvido repõe os componentes afetados.">
          {(p) => (
            <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)} {...p}>
              {INCIDENT_STATUSES.filter((x) => x !== 'INVESTIGATING').map((x) => <option key={x} value={x}>{incidentStatusLabel[x]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Mensagem">{(p) => <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} {...p} />}</Field>
        <Button type="submit" loading={saving}>Publicar</Button>
      </form>
    </Dialog>
  );
}
