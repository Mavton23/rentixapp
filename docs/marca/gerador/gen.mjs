import opentype from 'opentype.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const font = (w) => opentype.parse(readFileSync(`node_modules/@fontsource/poppins/files/poppins-latin-${w}-normal.woff`).buffer);
const F600 = font(600), F500 = font(500);
// Poppins latin subset has no Ã/Ó composed? check later; use latin-ext if needed
const FEXT500 = opentype.parse(readFileSync('node_modules/@fontsource/poppins/files/poppins-latin-ext-500-normal.woff').buffer);

export const C = {
  navy: '#0F2A44', blue: '#1D5FE6', blueLight: '#2F7BF5', blueDeep: '#1747C4', teal: '#16C6C0',
  gray: '#F2F4F7', slate: '#5B6B7F', white: '#FFFFFF', navyText: '#B9C6D6',
};

const nn = (v) => +v.toFixed(2);
const PD = (cmds) => cmds.map((c) => c.type === 'M' || c.type === 'L' ? `${c.type}${nn(c.x)} ${nn(c.y)}` : c.type === 'Q' ? `Q${nn(c.x1)} ${nn(c.y1)} ${nn(c.x)} ${nn(c.y)}` : c.type === 'C' ? `C${nn(c.x1)} ${nn(c.y1)} ${nn(c.x2)} ${nn(c.y2)} ${nn(c.x)} ${nn(c.y)}` : 'Z').join('');
const roofY = (x) => 80 - 0.7727 * (x - 6);
const bar = (x0, x1, t0, t1, fill) => `<polygon points="${x0},${t0} ${x1},${t1} ${x1},${roofY(x1).toFixed(2)} ${x0},${roofY(x0).toFixed(2)}" fill="${fill}"/>`;

/** Símbolo em coordenadas 0..100; conteúdo em x 6–92, y 20–86.6. */
export function mark(v = 'cor', id = 'm', { window = true } = {}) {
  const dark = v === 'negativo';
  const mono = v.startsWith('mono') ? (v === 'mono-branco' ? C.white : C.navy) : null;
  const ink = mono ?? (dark ? C.white : C.navy);
  const defs = mono ? '' : `<defs>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark ? '#6AA6FF' : C.blueLight}"/><stop offset="1" stop-color="${dark ? '#2F6BEA' : C.blueDeep}"/></linearGradient>
    <linearGradient id="${id}l" gradientUnits="userSpaceOnUse" x1="50" y1="46" x2="90" y2="86"><stop offset=".15" stop-color="${ink}"/><stop offset=".55" stop-color="${dark ? '#5FA0FF' : C.blue}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient>
  </defs>`;
  const b = mono ?? `url(#${id}b)`, l = mono ?? `url(#${id}l)`;
  return `${defs}
  ${bar(15, 24, 46, 41, b)}
  ${bar(27, 36, 26, 20, b)}
  ${bar(39, 48, 24, 24, ink)}
  <path d="M47 28.5H58A9.5 9.5 0 0 1 58 47.5H50" fill="none" stroke="${ink}" stroke-width="9"/>
  <polygon points="6,80 50,46 50,58 13,86.6" fill="${ink}"/>
  <polygon points="50,46 92,84 80,84 50,58" fill="${l}"/>
  ${window ? `<path fill="${ink}" d="M44.5 64.5h5v5h-5zM50.5 64.5h5v5h-5zM44.5 70.5h5v5h-5zM50.5 70.5h5v5h-5z"/>` : ''}`;
}
export const MARK_BOX = { x: 6, y: 20, w: 86, h: 66.6 };

function glyphs(f, text, size, x, y, tracking = 0) {
  let out = '', cx = x;
  for (const ch of text) {
    const gf = f.hasChar(ch) ? f : FEXT500;
    out += PD(gf.getPath(ch, cx, y, size, { kerning: false }).commands);
    cx += gf.getAdvanceWidth(ch, size, { kerning: false }) + tracking;
  }
  return { d: out, width: cx - x - tracking };
}

/** Logótipo "Rentix" com o ponto do i em turquesa. Devolve paths e largura (y = linha de base). */
export function wordmark(x, y, size, ink, dot = C.teal) {
  const before = F600.getPath('Rent', x, y, size);
  const wR = F600.getAdvanceWidth('Rent', size);
  const iG = F600.getPath('i', x + wR, y, size);
  // separar o ponto (contorno mais alto) do corpo do i
  const parts = []; let cur = [];
  for (const c of iG.commands) { if (c.type === 'M' && cur.length) { parts.push(cur); cur = []; } cur.push(c); }
  if (cur.length) parts.push(cur);
  const top = (cmds) => Math.min(...cmds.filter((c) => 'y' in c).map((c) => c.y));
  parts.sort((a, b) => top(a) - top(b));
  const P = PD; const _unused = (cmds) => cmds.map((c) => c.type === 'M' || c.type === 'L' ? `${c.type}${n(c.x)} ${n(c.y)}` : c.type === 'Q' ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}` : c.type === 'C' ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}` : 'Z').join('');
  const wI = F600.getAdvanceWidth('Renti', size);
  const xP = F600.getPath('x', x + wI, y, size);
  const width = F600.getAdvanceWidth('Rentix', size);
  const inkTop = -F600.getPath('Rentix', 0, 0, size).getBoundingBox().y1;
  return { inkTop, svg: `<path fill="${ink}" d="${PD(before.commands)}${P(parts[1])}${PD(xP.commands)}"/><path fill="${dot}" d="${P(parts[0])}"/>`, width, capH: size * 0.7 };
}

export function tagline(text, x, y, size, width, ink) {
  const natural = glyphs(F500, text, size, 0, 0, 0).width;
  const n = [...text].length - 1;
  const tr = n > 0 ? (width - natural) / n : 0;
  return `<path fill="${ink}" d="${glyphs(F500, text, size, x, y, tr).d}"/>`;
}

const svgDoc = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${Math.round(w * 4)}" height="${Math.round(h * 4)}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

export function horizontal(v = 'cor', tag = 'GESTÃO DE IMÓVEIS') {
  const dark = v === 'negativo';
  const mono = v.startsWith('mono') ? (v === 'mono-branco' ? C.white : C.navy) : null;
  const ink = mono ?? (dark ? C.white : C.navy);
  const s = 0.9; // escala do símbolo
  const mw = MARK_BOX.w * s, mh = MARK_BOX.h * s;
  const size = 50, gap = 9;
  const wm0 = wordmark(0, 0, size, ink);
  const tagSize = 9.6, tagGap = 13;
  const blockH = wm0.inkTop + (tag ? tagGap + tagSize * 0.72 : 0);
  const H = Math.max(mh, blockH + 2);
  const top = (H - blockH) / 2;
  const baseline = top + wm0.inkTop;
  const my = (H - mh) / 2;
  const x0 = mw + gap;
  const wm = wordmark(x0, baseline, size, ink, mono ?? C.teal);
  const tg = tag ? tagline(tag, x0 + 2, baseline + tagGap + tagSize * 0.72, tagSize, wm.width - 4, mono ?? (dark ? C.navyText : C.slate)) : '';
  const W = x0 + wm.width + 1;
  return svgDoc(W, H, `<g transform="translate(0 ${my}) scale(${s}) translate(${-MARK_BOX.x} ${-MARK_BOX.y})">${mark(v, 'h' + v)}</g>${wm.svg}${tg}`, 'Rentix');
}

export function vertical(v = 'cor', tag = 'GESTÃO DE IMÓVEIS') {
  const dark = v === 'negativo';
  const mono = v.startsWith('mono') ? (v === 'mono-branco' ? C.white : C.navy) : null;
  const ink = mono ?? (dark ? C.white : C.navy);
  const size = 44;
  const wm0 = wordmark(0, 0, size, ink);
  const W = Math.max(wm0.width, 120);
  const s = 1.1, mw = MARK_BOX.w * s, mh = MARK_BOX.h * s;
  const mx = (W - mw) / 2;
  const baseline = mh + 14 + wm0.inkTop;
  const wm = wordmark((W - wm0.width) / 2, baseline, size, ink, mono ?? C.teal);
  const tagSize = 8.4;
  const tg = tag ? tagline(tag, (W - wm0.width) / 2 + 2, baseline + 12 + tagSize * 0.72, tagSize, wm0.width - 4, mono ?? (dark ? C.navyText : C.slate)) : '';
  const H = baseline + (tag ? 12 + tagSize * 0.72 : 0) + 1;
  return svgDoc(W, H, `<g transform="translate(${mx} 0) scale(${s}) translate(${-MARK_BOX.x} ${-MARK_BOX.y})">${mark(v, 'v' + v)}</g>${wm.svg}${tg}`, 'Rentix');
}

export function symbol(v = 'cor') {
  const p = 2;
  return svgDoc(MARK_BOX.w + 2 * p, MARK_BOX.h + 2 * p, `<g transform="translate(${p - MARK_BOX.x} ${p - MARK_BOX.y})">${mark(v, 's' + v)}</g>`, 'Rentix');
}

export function logotype(v = 'cor') {
  const dark = v === 'negativo';
  const mono = v.startsWith('mono') ? (v === 'mono-branco' ? C.white : C.navy) : null;
  const ink = mono ?? (dark ? C.white : C.navy);
  const wm0 = wordmark(0, 0, 50, ink);
  const wm = wordmark(0, wm0.inkTop + 1, 50, ink, mono ?? C.teal);
  return svgDoc(wm.width + 1, wm0.inkTop + 2, wm.svg, 'Rentix');
}

/** Ícone de app: quadrado azul-marinho com o símbolo em negativo. */
export function appIcon({ rounded = true, maskable = false, simple = false } = {}) {
  const pad = maskable ? 22 : simple ? 7 : 14;
  const area = 100 - 2 * pad;
  const s = area / MARK_BOX.w;
  const ty = (100 - MARK_BOX.h * s) / 2;
  const r = rounded && !maskable ? 22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#143A5E"/><stop offset="1" stop-color="${C.navy}"/></linearGradient></defs><rect width="100" height="100" rx="${r}" fill="url(#bg)"/><g transform="translate(${pad} ${ty}) scale(${s}) translate(${-MARK_BOX.x} ${-MARK_BOX.y})">${mark('negativo', 'a', { window: !simple })}</g></svg>\n`;
}

if (process.argv[2] === 'preview') {
  mkdirSync('prev', { recursive: true });
  writeFileSync('prev/h.svg', horizontal());
  writeFileSync('prev/hn.svg', horizontal('negativo'));
  writeFileSync('prev/v.svg', vertical());
  writeFileSync('prev/hs.svg', horizontal('cor', ''));
  writeFileSync('prev/app.svg', appIcon());
  writeFileSync('prev/fav.svg', appIcon({ simple: true }));
}
