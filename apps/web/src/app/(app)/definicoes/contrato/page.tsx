'use client';

import { useT } from '@/i18n/client';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { unknownTemplateVariables } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { useCanManage } from '@/lib/session';
import { instantDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, ErrorState, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { FormError } from '@/components/ui/form';
import { openFile } from '@/components/files-panel';

interface TemplateResponse {
  template: string;
  isDefault: boolean;
  updatedAt: string | null;
  defaultTemplate: string;
  variables: readonly { key: string; label: string; example: string }[];
}

export default function ContractTemplatePage() {
  const q = useQuery({
    queryKey: ['contract-template'],
    queryFn: () => staffApi.get<TemplateResponse>('/organization/contract-template'),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={10} />;
  return <Editor key={q.data.updatedAt ?? 'default'} data={q.data} />;
}

function Editor({ data }: { data: TemplateResponse }) {
  const tr = useT();
  const qc = useQueryClient();
  const canEdit = useCanManage();
  const [text, setText] = useState(data.template);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const unknown = unknownTemplateVariables(text);
  const dirty = text !== data.template;

  /** Insere {{variável}} onde está o cursor. */
  function insert(key: string) {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el) return setText((t) => t + token);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = text.slice(0, a) + token + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  }

  async function save() {
    setSaving(true);
    try {
      await staffApi.put('/organization/contract-template', { template: text });
      toast.success(tr('Modelo guardado. Os próximos contratos em PDF já o usam.'));
      await qc.invalidateQueries({ queryKey: ['contract-template'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr('Não foi possível guardar'));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm(tr('Voltar ao modelo base do Rentix? As suas alterações ao modelo perdem-se.')))
      return;
    await staffApi.delete('/organization/contract-template');
    toast.success(tr('Modelo base reposto'));
    await qc.invalidateQueries({ queryKey: ['contract-template'] });
  }

  return (
    <>
      <PageHeader
        back={{ href: '/definicoes', label: tr('Definições') }}
        title={tr('Modelo de contrato')}
        description={tr(
          'O texto usado para gerar o contrato de arrendamento em PDF, a partir da página de cada contrato.',
        )}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                openFile(staffApi, '/organization/contract-template/preview', { template: text })
              }
              disabled={unknown.length > 0}
            >
              {tr('Pré-visualizar PDF')}
            </Button>
            {canEdit && (
              <Button onClick={save} loading={saving} disabled={!dirty || unknown.length > 0}>
                {tr('Guardar')}
              </Button>
            )}
          </>
        }
      />
      <p className="mb-6 rounded-panel border border-due/30 bg-due-soft px-4 py-3 text-sm">
        {tr(
          'O modelo base é um ponto de partida, não aconselhamento jurídico. Reveja-o com um jurista e adapte-o ao seu caso antes de o usar com inquilinos.',
        )}
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel
          title={
            <span className="flex items-center gap-2">
              {tr('Texto')}
              {data.isDefault ? (
                <Badge>{tr('Modelo base')}</Badge>
              ) : (
                <Badge tone="brand">{tr('Personalizado')}</Badge>
              )}
            </span>
          }
          actions={
            canEdit && !data.isDefault ? (
              <Button size="sm" variant="ghost" onClick={reset}>
                {tr('Repor modelo base')}
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-3 p-5">
            {unknown.length > 0 && (
              <FormError
                message={tr('Variáveis que não existem: {0}', {
                  '0': unknown.map((u) => `{{${u}}}`).join(', '),
                })}
              />
            )}
            <textarea
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={!canEdit}
              spellCheck
              lang="pt"
              aria-label={tr('Texto do modelo de contrato')}
              className="min-h-[36rem] w-full resize-y rounded-control border border-line-strong bg-surface p-4 font-mono text-[13px] leading-relaxed focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <p className="text-xs text-ink-faint">
              {tr(
                '# título · ## secção · - alínea · **negrito** · linha em branco entre parágrafos · [assinaturas] para o bloco de assinaturas.{0}',
                { '0': data.updatedAt && tr(" Alterado a {0}.", { '0': instantDate(data.updatedAt) }) },
              )}
            </p>
          </div>
        </Panel>
        <Panel title={tr('Variáveis')}>
          <p className="border-b border-line px-5 py-2.5 text-sm text-ink-soft">
            {tr('{0} Dados em falta ficam com um traço para preencher à mão.', {
              '0': canEdit
                ? tr("Clique para inserir onde está o cursor.")
                : tr("Preenchidas com os dados do contrato."),
            })}
          </p>
          <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
            {data.variables.map((v) => (
              <li key={v.key}>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => insert(v.key)}
                  className="block w-full px-5 py-2 text-left hover:bg-paper disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="block text-sm">{tr.label(v.label)}</span>
                  <code className="block text-xs text-brand">{`{{${v.key}}}`}</code>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
