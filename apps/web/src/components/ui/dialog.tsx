'use client';

import { useT } from '@/i18n/client';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-navy/40" />
        <D.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-[14px] bg-surface p-5 shadow-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-panel sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="font-display text-lg font-semibold text-ink">
                {t.label(title)}
              </D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-ink-soft">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{t.label(title)}</D.Description>
              )}
            </div>
            <D.Close
              className="rounded p-1 text-ink-faint hover:bg-paper hover:text-ink"
              aria-label={t('Fechar')}
            >
              <X className="size-5" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
