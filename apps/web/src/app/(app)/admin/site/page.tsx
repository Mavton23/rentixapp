'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CONTACT_ITEM_TYPES, type SiteContentKey } from '@rentix/shared';
import { staffApi } from '@/lib/clients';
import { revalidateSite } from '@/lib/revalidate';
import { ApiError } from '@/lib/api';
import type { AboutContent, ContactContent, FeaturesContent, SiteContentResponse } from '@/lib/site-types';
import { Button } from '@/components/ui/button';
import { FilterTabs, LoadingRows, PageHeader, Panel } from '@/components/ui/display';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';

const CONTACT_TYPE_LABEL: Record<(typeof CONTACT_ITEM_TYPES)[number], string> = {
  email: 'Email',
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  address: 'Morada',
  hours: 'Horário',
};

/** Idioma do conteúdo em edição (cada idioma é guardado à parte). */
const ContentLang = createContext<'pt' | 'en'>('pt');

export default function AdminSitePage() {
  const [key, setKey] = useState<SiteContentKey>('about');
  const [lang, setLang] = useState<'pt' | 'en'>('pt');
  return (
    <>
      <PageHeader title="Conteúdo do site" description="Textos das páginas Sobre, Contactos e Funcionalidades." />
      <Panel>
        <FilterTabs<SiteContentKey>
          value={key}
          onChange={setKey}
          options={[{ value: 'about', label: 'Sobre' }, { value: 'features', label: 'Funcionalidades' }, { value: 'contact', label: 'Contactos' }]}
        />
        <div className="border-b border-line px-5 py-3">
          <FilterTabs<'pt' | 'en'>
            value={lang}
            onChange={setLang}
            options={[{ value: 'pt', label: 'Português' }, { value: 'en', label: 'English' }]}
          />
        </div>
        <ContentLang.Provider value={lang}>
          <ContentLoader key={`${key}-${lang}`} contentKey={key} />
        </ContentLang.Provider>
      </Panel>
    </>
  );
}

function ContentLoader({ contentKey }: { contentKey: SiteContentKey }) {
  const lang = useContext(ContentLang);
  const q = useQuery({ queryKey: ['site-content', contentKey, lang], queryFn: () => staffApi.get<SiteContentResponse<unknown>>(`/site/content/${contentKey}?locale=${lang}`) });
  if (!q.data) return <LoadingRows rows={6} />;
  if (contentKey === 'about') return <AboutEditor initial={q.data.data as AboutContent} />;
  if (contentKey === 'contact') return <ContactEditor initial={q.data.data as ContactContent} />;
  return <FeaturesEditor initial={q.data.data as FeaturesContent} />;
}

function useSave(key: SiteContentKey) {
  const lang = useContext(ContentLang);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(data: unknown) {
    setSaving(true);
    setError(null);
    try {
      await staffApi.put(`/admin/site/content/${key}?locale=${lang}`, data);
      revalidateSite();
      toast.success('Conteúdo publicado');
      qc.invalidateQueries({ queryKey: ['site-content', key, lang] });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        setError(Object.entries(err.fieldErrors).map(([f, m]) => `${f}: ${m}`).join('; '));
      } else setError(err instanceof Error ? err.message : 'Não foi possível guardar');
    } finally {
      setSaving(false);
    }
  }
  return { save, saving, error };
}

/** Lista editável com acrescentar, remover e reordenar. */
function Repeater<T>({
  items,
  onChange,
  blank,
  addLabel,
  render,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  addLabel: string;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
}) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-control border border-line p-4">
          <div className="mb-2 flex justify-end gap-1">
            <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp /></Button>
            <Button type="button" size="icon" variant="ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Descer"><ArrowDown /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 /></Button>
          </div>
          {render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => onChange([...items, blank])}>
        <Plus aria-hidden /> {addLabel}
      </Button>
    </div>
  );
}

function AboutEditor({ initial }: { initial: AboutContent }) {
  const [v, setV] = useState<AboutContent>(initial);
  const { save, saving, error } = useSave('about');
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(v); }} className="flex flex-col gap-6 px-5 py-5" noValidate>
      <FormError message={error} />
      <Field label="Título">{(p) => <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} {...p} />}</Field>
      <Field label="Subtítulo">{(p) => <Textarea rows={2} value={v.subtitle} onChange={(e) => setV({ ...v, subtitle: e.target.value })} {...p} />}</Field>
      <section>
        <h3 className="mb-2 font-display text-base font-semibold">Secções</h3>
        <Repeater items={v.sections} onChange={(sections) => setV({ ...v, sections })} blank={{ title: '', body: '' }} addLabel="Acrescentar secção"
          render={(s, up) => (
            <div className="flex flex-col gap-3">
              <Field label="Título da secção">{(p) => <Input value={s.title} onChange={(e) => up({ title: e.target.value })} {...p} />}</Field>
              <Field label="Texto" hint="Deixe uma linha em branco entre parágrafos.">{(p) => <Textarea rows={5} value={s.body} onChange={(e) => up({ body: e.target.value })} {...p} />}</Field>
            </div>
          )}
        />
      </section>
      <section>
        <h3 className="mb-2 font-display text-base font-semibold">Valores</h3>
        <Repeater items={v.values} onChange={(values) => setV({ ...v, values })} blank={{ title: '', description: '' }} addLabel="Acrescentar valor"
          render={(s, up) => (
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field label="Valor">{(p) => <Input value={s.title} onChange={(e) => up({ title: e.target.value })} {...p} />}</Field>
              <Field label="Descrição">{(p) => <Input value={s.description} onChange={(e) => up({ description: e.target.value })} {...p} />}</Field>
            </div>
          )}
        />
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <h3 className="font-display text-base font-semibold sm:col-span-3">Chamada final</h3>
        <Field label="Título">{(p) => <Input value={v.cta?.title ?? ''} onChange={(e) => setV({ ...v, cta: { title: e.target.value, text: v.cta?.text ?? '', buttonText: v.cta?.buttonText ?? 'Criar conta' } })} {...p} />}</Field>
        <Field label="Texto">{(p) => <Input value={v.cta?.text ?? ''} onChange={(e) => setV({ ...v, cta: { title: v.cta?.title ?? '', text: e.target.value, buttonText: v.cta?.buttonText ?? 'Criar conta' } })} {...p} />}</Field>
        <Field label="Botão">{(p) => <Input value={v.cta?.buttonText ?? ''} onChange={(e) => setV({ ...v, cta: { title: v.cta?.title ?? '', text: v.cta?.text ?? '', buttonText: e.target.value } })} {...p} />}</Field>
      </section>
      <Button type="submit" loading={saving} className="self-start">Publicar alterações</Button>
    </form>
  );
}

function FeaturesEditor({ initial }: { initial: FeaturesContent }) {
  const [intro, setIntro] = useState(initial.intro ?? '');
  const [items, setItems] = useState(initial.items.map((i) => ({ ...i, detailsText: i.details.join('\n') })));
  const { save, saving, error } = useSave('features');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ intro, items: items.map(({ detailsText, ...i }) => ({ ...i, details: detailsText.split('\n').map((d) => d.trim()).filter(Boolean) })) });
      }}
      className="flex flex-col gap-6 px-5 py-5"
      noValidate
    >
      <FormError message={error} />
      <Field label="Introdução" optional>{(p) => <Textarea rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} {...p} />}</Field>
      <Repeater items={items} onChange={setItems} blank={{ title: '', description: '', details: [], detailsText: '' }} addLabel="Acrescentar funcionalidade"
        render={(it, up) => (
          <div className="flex flex-col gap-3">
            <Field label="Nome">{(p) => <Input value={it.title} onChange={(e) => up({ title: e.target.value })} {...p} />}</Field>
            <Field label="Descrição">{(p) => <Textarea rows={2} value={it.description} onChange={(e) => up({ description: e.target.value })} {...p} />}</Field>
            <Field label="Pontos" optional hint="Um por linha.">{(p) => <Textarea rows={3} value={it.detailsText} onChange={(e) => up({ detailsText: e.target.value })} {...p} />}</Field>
          </div>
        )}
      />
      <Button type="submit" loading={saving} className="self-start">Publicar alterações</Button>
    </form>
  );
}

function ContactEditor({ initial }: { initial: ContactContent }) {
  const [intro, setIntro] = useState(initial.intro ?? '');
  const [items, setItems] = useState(initial.items.map((i) => ({ ...i, extra: i.extra ?? '' })));
  const { save, saving, error } = useSave('contact');
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save({ intro, items }); }} className="flex flex-col gap-6 px-5 py-5" noValidate>
      <FormError message={error} />
      <Field label="Introdução" optional>{(p) => <Textarea rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} {...p} />}</Field>
      <Repeater items={items} onChange={setItems} blank={{ type: 'email', label: '', value: '', extra: '' }} addLabel="Acrescentar contacto"
        render={(it, up) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo">
              {(p) => (
                <Select value={it.type} onChange={(e) => up({ type: e.target.value as (typeof CONTACT_ITEM_TYPES)[number] })} {...p}>
                  {CONTACT_ITEM_TYPES.map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABEL[t]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Rótulo">{(p) => <Input value={it.label} onChange={(e) => up({ label: e.target.value })} {...p} />}</Field>
            <Field label="Valor">{(p) => <Input value={it.value} onChange={(e) => up({ value: e.target.value })} {...p} />}</Field>
            <Field label="Nota" optional>{(p) => <Input value={it.extra} onChange={(e) => up({ extra: e.target.value })} {...p} />}</Field>
          </div>
        )}
      />
      <Button type="submit" loading={saving} className="self-start">Publicar alterações</Button>
    </form>
  );
}
