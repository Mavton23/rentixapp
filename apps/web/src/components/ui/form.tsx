'use client';

import { useT } from '@/i18n/client';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/format';

const control =
  'w-full rounded-control border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-ink-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/15 aria-[invalid=true]:border-overdue disabled:bg-paper disabled:text-ink-faint';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, 'h-10', className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-24 py-2', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          control,
          'h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9',
          className,
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237b8794' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);

/** Campo de valor em dinheiro: escreve-se como texto ("15 000,00") e converte-se no envio. */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { currency?: string }
>(function MoneyInput({ className, currency = 'MT', ...props }, ref) {
  const t = useT();
  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn('money pr-12 text-right', className)}
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-faint">
        {t.label(currency)}
      </span>
    </div>
  );
});

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  optional?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
}

/** Rótulo + controlo + mensagem de ajuda ou erro, com ligações de acessibilidade. */
export function Field({ label, error, hint, className, optional, children }: FieldProps) {
  const t = useT();
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {t.label(label)}
        {optional && <span className="font-normal text-ink-faint"> {t('(opcional)')}</span>}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-overdue">
          {t(error)}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  const t = useT();
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-control border border-overdue/30 bg-overdue-soft px-3 py-2 text-sm text-overdue"
    >
      {message ? t(message) : message}
    </div>
  );
}
