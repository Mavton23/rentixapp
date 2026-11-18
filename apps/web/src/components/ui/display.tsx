'use client';

import { useT } from '@/i18n/client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { InvoiceStatus, LeaseStatus, PaymentStatus, UnitStatus } from '@rentix/shared';
import { cn, money } from '@/lib/format';
import {
  invoiceStatusLabel,
  leaseStatusLabel,
  paymentStatusLabel,
  unitStatusLabel,
} from '@/i18n/pt';

type Tone = 'paid' | 'due' | 'overdue' | 'brand' | 'neutral';

const toneClass: Record<Tone, string> = {
  paid: 'bg-paid-soft text-paid',
  due: 'bg-due-soft text-due',
  overdue: 'bg-overdue-soft text-overdue',
  brand: 'bg-brand-soft text-brand-strong',
  neutral: 'bg-paper text-ink-soft border border-line',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function InvoiceStatusBadge({
  status,
  overdue,
}: {
  status: InvoiceStatus;
  overdue?: boolean;
}) {
  const t = useT();
  if (overdue && status !== 'PAID' && status !== 'VOID')
    return <Badge tone="overdue">{t('Em atraso')}</Badge>;
  const tone: Record<InvoiceStatus, Tone> = {
    OPEN: 'brand',
    PARTIALLY_PAID: 'due',
    PAID: 'paid',
    VOID: 'neutral',
  };
  return <Badge tone={tone[status]}>{t.label(invoiceStatusLabel[status])}</Badge>;
}

export function LeaseStatusBadge({ status }: { status: LeaseStatus }) {
  const t = useT();
  const tone: Record<LeaseStatus, Tone> = {
    DRAFT: 'neutral',
    ACTIVE: 'paid',
    ENDED: 'neutral',
    TERMINATED: 'neutral',
  };
  return <Badge tone={tone[status]}>{t.label(leaseStatusLabel[status])}</Badge>;
}

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  const t = useT();
  const tone: Record<UnitStatus, Tone> = {
    AVAILABLE: 'brand',
    OCCUPIED: 'paid',
    MAINTENANCE: 'due',
    UNAVAILABLE: 'neutral',
  };
  return <Badge tone={tone[status]}>{t.label(unitStatusLabel[status])}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const t = useT();
  const tone: Record<PaymentStatus, Tone> = {
    PENDING: 'due',
    CONFIRMED: 'paid',
    FAILED: 'overdue',
    REVERSED: 'neutral',
  };
  return <Badge tone={tone[status]}>{t.label(paymentStatusLabel[status])}</Badge>;
}

export function Money({
  amount,
  currency = 'MZN',
  className,
}: {
  amount: number;
  currency?: string;
  className?: string;
}) {
  return <span className={cn('money', className)}>{money(amount, currency)}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  const t = useT();
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      {typeof title === 'string' && <title>{t('{title} · Rentix', { title })}</title>}
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-2 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t.label(back.label)}
          </Link>
        )}
        <h1 className="text-2xl text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-panel border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title && <h2 className="text-base">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Lista de pares rótulo/valor para fichas de detalhe. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  const t = useT();
  return (
    <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-sm text-ink-faint">{t.label(it.label)}</dt>
          <dd className="mt-0.5 break-words text-ink">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-display text-lg text-ink">{t.label(title)}</p>
      {description && <p className="mt-1 max-w-md text-ink-soft">{t.label(description)}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-line/70', className)} />;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  const t = useT();
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label={t('A carregar')}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const message = error instanceof Error ? error.message : t('Não foi possível carregar os dados.');
  return (
    <div role="alert" className="px-5 py-10 text-center">
      <p className="text-ink">{t.label(message)}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 text-sm font-medium text-brand hover:underline">
          {t('Tentar de novo')}
        </button>
      )}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const t = useT();
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-soft">
      <span>
        {t('Página {page} de {totalPages} · {total} registos', { page, totalPages, total })}
      </span>
      <div className="flex gap-1">
        <button
          className="rounded p-1.5 hover:bg-paper disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('Página anterior')}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          className="rounded p-1.5 hover:bg-paper disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label={t('Página seguinte')}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Separadores simples para filtros (ex.: estado das faturas). */
export function FilterTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const t = useT();
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-3">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2.5 text-sm whitespace-nowrap',
            value === o.value
              ? 'border-brand font-medium text-ink'
              : 'border-transparent text-ink-soft hover:text-ink',
          )}
        >
          {t.label(o.label)}
        </button>
      ))}
    </div>
  );
}
