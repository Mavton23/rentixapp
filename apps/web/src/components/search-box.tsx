'use client';

import { useT } from '@/i18n/client';
import { Search } from 'lucide-react';
import { Input } from './ui/form';

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const t = useT();
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.label(placeholder)}
        aria-label={t.label(placeholder)}
        className="pl-9"
      />
    </div>
  );
}
