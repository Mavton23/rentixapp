'use client';

import { tx } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import { intlLocale } from '@rentix/shared';
import { currentLocale } from '@/i18n/runtime';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { FileCategory, FileOwnerType } from '@rentix/shared';
import type { ApiClient } from '@/lib/api';
import { staffApi } from '@/lib/clients';
import { cn, instantDate } from '@/lib/format';
import { Button } from './ui/button';
import { Panel } from './ui/display';
import { Select } from './ui/form';

export interface FileRow {
  id: string;
  ownerType: FileOwnerType;
  ownerId: string;
  category: FileCategory;
  visibility: 'PRIVATE' | 'PUBLIC';
  sharedWithTenant: boolean;
  filename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string | null;
  createdAt: string;
}

export const fileCategoryLabel: Record<FileCategory, string> = {
  ID_DOCUMENT: 'Documento de identificação',
  CONTRACT: 'Contrato',
  PHOTO: 'Fotografia',
  RECEIPT: 'Comprovativo',
  COVER: 'Capa',
  OTHER: 'Outro',
};

export const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const IMAGES = 'image/jpeg,image/png,image/webp';

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: 1 })} MB`;
}

type BlobClient = Pick<ApiClient<never>, 'blob' | 'download'>;

/** Miniatura de uma imagem privada (pedido autenticado → endereço local temporário). */
export function AuthedThumb({
  client,
  path,
  className,
  alt,
}: {
  client: BlobClient;
  path: string;
  className?: string;
  alt: string;
}) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    client
      .blob(path)
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, path]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={t.label(alt)} className={className} />
  ) : (
    <span className={cn('block animate-pulse bg-line', className)} />
  );
}

/** Abre um ficheiro privado num separador novo. */
export async function openFile(client: BlobClient, path: string, body?: unknown) {
  // O separador abre-se já (os browsers bloqueiam janelas abertas depois de um pedido).
  const w = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await client.blob(path, body));
    if (w) w.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    w?.close();
    toast.error(err instanceof Error ? err.message : tx("Não foi possível abrir o ficheiro"));
  }
}

/**
 * Documentos e fotografias de um inquilino, contrato ou imóvel. Envio por botão ou arrastando
 * para o painel; imagens ficam sem metadados (a API remove a localização GPS).
 */
export function FilesPanel({
  ownerType,
  ownerId,
  categories,
  canEdit,
  allowShare = false,
  title = 'Documentos',
  description,
  imagesOnly = false,
}: {
  ownerType: FileOwnerType;
  ownerId: string;
  categories: FileCategory[];
  canEdit: boolean;
  allowShare?: boolean;
  title?: string;
  description?: string;
  imagesOnly?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const key = ['files', ownerType, ownerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => staffApi.get<FileRow[]>('/files', { ownerType, ownerId }),
  });
  const [category, setCategory] = useState<FileCategory>(categories[0]!);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(files: File[]) {
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    let ok = 0;
    for (const [i, f] of files.entries()) {
      const form = new FormData();
      form.set('ownerType', ownerType);
      form.set('ownerId', ownerId);
      form.set('category', category);
      form.set('file', f);
      try {
        await staffApi.upload('/files', form);
        ok++;
      } catch (err) {
        toast.error(
          `${f.name}: ${err instanceof Error ? err.message : t('não foi possível enviar')}`,
        );
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    if (ok) toast.success(ok === 1 ? t('Ficheiro enviado') : t('{ok} ficheiros enviados', { ok }));
    await qc.invalidateQueries({ queryKey: key });
    if (ownerType === 'LISTING') await qc.invalidateQueries({ queryKey: ['my-listings'] });
  }

  async function toggleShare(f: FileRow) {
    try {
      await staffApi.patch(`/files/${f.id}`, { sharedWithTenant: !f.sharedWithTenant });
      toast.success(
        f.sharedWithTenant
          ? t('Deixou de estar visível no portal')
          : t('Visível para o inquilino no portal'),
      );
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível alterar'));
    }
  }

  async function remove(f: FileRow) {
    if (!confirm(t('Apagar "{filename}"? Não é possível recuperar.', { filename: f.filename })))
      return;
    try {
      await staffApi.delete(`/files/${f.id}`);
      toast.success(t('Ficheiro apagado'));
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Não foi possível apagar'));
    }
  }

  const contentPath = (f: FileRow) => `/files/${f.id}/content`;
  return (
    <Panel
      title={t.label(title)}
      actions={
        canEdit && (
          <div className="flex items-center gap-2">
            {categories.length > 1 && (
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as FileCategory)}
                aria-label={t('Tipo de documento')}
                className="h-8 w-auto text-sm"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {t.label(fileCategoryLabel[c])}
                  </option>
                ))}
              </Select>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => input.current?.click()}
              loading={!!progress}
            >
              <Upload aria-hidden />{' '}
              {progress
                ? t('A enviar {0} de {total}', {
                    '0': progress.done + 1 > progress.total ? progress.total : progress.done + 1,
                    total: progress.total,
                  })
                : 'Enviar'}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept={imagesOnly ? IMAGES : ACCEPT}
              onChange={(e) => {
                void send([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </div>
        )
      }
    >
      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(false);
          void send([...e.dataTransfer.files]);
        }}
        className={cn('transition-colors', dragging && 'bg-brand-soft')}
      >
        {description && (
          <p className="border-b border-line px-5 py-2.5 text-sm text-ink-soft">
            {t.label(description)}
          </p>
        )}
        {!q.data ? (
          <p className="px-5 py-6 text-center text-ink-faint">{t('A carregar…')}</p>
        ) : q.data.length === 0 ? (
          <p className="px-5 py-8 text-center text-ink-soft">
            {canEdit
              ? imagesOnly
                ? t('Arraste fotografias para aqui ou use Enviar.')
                : t('Arraste ficheiros para aqui ou use Enviar. PDF, JPEG, PNG ou WebP.')
              : t('Sem documentos.')}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-2.5">
                {f.contentType.startsWith('image/') ? (
                  <AuthedThumb
                    client={staffApi}
                    path={contentPath(f)}
                    alt=""
                    className="size-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded bg-paper text-ink-soft">
                    <FileText className="size-5" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <button
                    className="block max-w-full truncate text-left font-medium hover:text-brand"
                    onClick={() => openFile(staffApi, contentPath(f))}
                  >
                    {t.label(f.filename)}
                  </button>
                  <span className="block text-xs text-ink-faint">
                    {t.label(fileCategoryLabel[f.category])}, {t.label(fileSize(f.size))},{' '}
                    {instantDate(f.createdAt)}
                    {f.sharedWithTenant && (
                      <span className="text-brand">{t(', no portal do inquilino')}</span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {allowShare && canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleShare(f)}
                      aria-pressed={f.sharedWithTenant}
                      title={t('Mostrar no portal do inquilino')}
                    >
                      <Eye aria-hidden className={f.sharedWithTenant ? 'text-brand' : ''} />
                      <span className="hidden sm:inline">
                        {f.sharedWithTenant ? 'Partilhado' : 'Partilhar'}
                      </span>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("Descarregar {0}", { "0": f.filename })}
                    onClick={() => staffApi.download(`${contentPath(f)}?download=1`, f.filename)}
                  >
                    <Download aria-hidden />
                  </Button>
                  {canEdit && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("Apagar {0}", { "0": f.filename })}
                      onClick={() => remove(f)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
