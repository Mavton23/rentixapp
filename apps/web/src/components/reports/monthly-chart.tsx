'use client';

import { intlLocale } from '@rentix/shared';
import { currentLocale } from '@/i18n/runtime';
import { useT } from '@/i18n/client';
import { useState } from 'react';
import { cn, money, period as monthLabel } from '@/lib/format';

export interface MonthlyPoint {
  period: string;
  billed: number;
  collected: number;
}

const BILLED = '#1553e0';
const COLLECTED = '#1baf7a';
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 64 };

/** Escala "bonita" para o eixo: 0 até um máximo redondo, com 4 divisões. */
function niceMax(v: number): number {
  if (v <= 0) return 100_00;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const shortMoney = (minor: number) => {
  const v = minor / 100;
  if (v >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: 1 })} M`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: 0 })}${currentLocale() === 'en' ? 'k' : ' mil'}`;
  return v.toLocaleString(intlLocale(currentLocale()), { maximumFractionDigits: 0 });
};
const shortMonth = (p: string) =>
  new Intl.DateTimeFormat(intlLocale(currentLocale()), { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${p}-01T00:00:00Z`))
    .replace('.', '');

/** Faturado e cobrado por mês: barras lado a lado, com legenda, dica ao passar e vista em tabela. */
export function MonthlyChart({ data, currency }: { data: MonthlyPoint[]; currency: string }) {
  const tr = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(...data.flatMap((d) => [d.billed, d.collected])));
  const W = 720;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const barW = Math.min(18, (band - 10) / 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex gap-4" aria-hidden={asTable}>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: BILLED }} />
            {tr('Faturado')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COLLECTED }} />
            {tr('Cobrado')}
          </span>
        </div>
        <button className="text-brand hover:underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? tr('Ver gráfico') : tr('Ver tabela')}
        </button>
      </div>

      {asTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-soft">
              <th className="py-2 font-medium">{tr('Mês')}</th>
              <th className="py-2 text-right font-medium">{tr('Faturado')}</th>
              <th className="py-2 text-right font-medium">{tr('Cobrado')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.period} className="border-b border-line last:border-0">
                <td className="py-1.5">{tr.label(monthLabel(d.period))}</td>
                <td className="money py-1.5 text-right">{money(d.billed, currency)}</td>
                <td className="money py-1.5 text-right">{money(d.collected, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={tr('Faturado e cobrado por mês, últimos 12 meses')}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-ink-faint text-[11px]"
                >
                  {tr.label(shortMoney(t))}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = PAD.left + i * band + band / 2;
              const bars = [
                { v: d.billed, color: BILLED, x: x0 - barW - 1 },
                { v: d.collected, color: COLLECTED, x: x0 + 1 },
              ];
              return (
                <g key={d.period}>
                  {hover === i && (
                    <rect
                      x={PAD.left + i * band}
                      y={PAD.top}
                      width={band}
                      height={innerH}
                      fill="var(--color-paper)"
                    />
                  )}
                  {bars.map((b, j) => {
                    const top = y(b.v);
                    const hgt = PAD.top + innerH - top;
                    const r = Math.min(4, barW / 2, hgt);
                    // Topo arredondado, base reta sobre o eixo.
                    return hgt > 0 ? (
                      <path
                        key={j}
                        d={`M${b.x},${PAD.top + innerH} V${top + r} Q${b.x},${top} ${b.x + r},${top} H${b.x + barW - r} Q${b.x + barW},${top} ${b.x + barW},${top + r} V${PAD.top + innerH} Z`}
                        fill={b.color}
                      />
                    ) : null;
                  })}
                  <text
                    x={x0}
                    y={H - 8}
                    textAnchor="middle"
                    className={cn('text-[11px]', hover === i ? 'fill-ink' : 'fill-ink-faint')}
                  >
                    {tr.label(shortMonth(d.period))}
                  </text>
                  <rect
                    x={PAD.left + i * band}
                    y={0}
                    width={band}
                    height={H}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + innerH}
              y2={PAD.top + innerH}
              stroke="var(--color-line-strong)"
            />
          </svg>
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-control border border-line bg-surface px-3 py-2 text-sm shadow-lg"
              style={{
                left: `${((PAD.left + hover * band + band / 2) / W) * 100}%`,
                transform: `translateX(${hover > data.length / 2 ? '-105%' : '5%'})`,
              }}
            >
              <p className="font-medium">{tr.label(monthLabel(h.period))}</p>
              <p className="flex justify-between gap-4">
                <span className="text-ink-soft">{tr('Faturado')}</span>
                <span className="money">{money(h.billed, currency)}</span>
              </p>
              <p className="flex justify-between gap-4">
                <span className="text-ink-soft">{tr('Cobrado')}</span>
                <span className="money">{money(h.collected, currency)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
