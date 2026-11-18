import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import pngToIco from 'png-to-ico';
import * as G from './gen.mjs';

const OUT = 'out/rentix-identidade';
const dirs = ['svg', 'png', 'favicon', 'social', 'cores'];
for (const d of dirs) mkdirSync(`${OUT}/${d}`, { recursive: true });

const files = {};
const put = (name, svg) => { writeFileSync(`${OUT}/svg/${name}.svg`, svg); files[name] = svg; };
for (const v of ['cor', 'negativo', 'mono-azul', 'mono-branco']) {
  put(`rentix-logo-horizontal-${v}`, G.horizontal(v));
  put(`rentix-logo-horizontal-sem-slogan-${v}`, G.horizontal(v, ''));
  put(`rentix-logo-vertical-${v}`, G.vertical(v));
  put(`rentix-simbolo-${v}`, G.symbol(v));
  put(`rentix-logotipo-${v}`, G.logotype(v));
}
put('rentix-logo-horizontal-en-cor', G.horizontal('cor', 'PROPERTY MANAGEMENT'));
put('rentix-logo-horizontal-en-negativo', G.horizontal('negativo', 'PROPERTY MANAGEMENT'));
put('rentix-icone-app', G.appIcon());
const favSvg = G.appIcon({ simple: true });
writeFileSync(`${OUT}/favicon/favicon.svg`, favSvg);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const dim = (svg) => { const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return [+m[1], +m[2]]; };
export async function png(svg, w, h, out, bg = 'transparent') {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${bg}"><img style="display:block;width:${w}px;height:${h}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
  await page.waitForTimeout(50);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent' });
}
for (const [name, svg] of Object.entries(files)) {
  const [vw, vh] = dim(svg);
  const w = name.includes('simbolo') || name.includes('icone') ? 1024 : 2000;
  await png(svg, w, Math.round((w * vh) / vw), `${OUT}/png/${name}.png`);
}
// favicons e ícones de app
for (const s of [16, 32, 48]) await png(favSvg, s, s, `${OUT}/favicon/favicon-${s}.png`);
writeFileSync(`${OUT}/favicon/favicon.ico`, await pngToIco([16, 32, 48].map((s) => `${OUT}/favicon/favicon-${s}.png`)));
const square = G.appIcon({ rounded: false });
await png(square, 180, 180, `${OUT}/favicon/apple-touch-icon.png`);
await png(G.appIcon(), 192, 192, `${OUT}/favicon/icon-192.png`);
await png(G.appIcon(), 512, 512, `${OUT}/favicon/icon-512.png`);
await png(G.appIcon({ maskable: true }), 512, 512, `${OUT}/favicon/icon-maskable-512.png`);
writeFileSync(`${OUT}/favicon/site.webmanifest`, JSON.stringify({
  name: 'Rentix', short_name: 'Rentix', description: 'Gestão de imóveis e arrendamentos',
  start_url: '/', display: 'standalone', background_color: '#F2F4F7', theme_color: '#0F2A44',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2) + '\n');

// redes sociais
const neg = files['rentix-logo-horizontal-negativo'];
const b64 = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const social = (w, h, inner) => `<html><head><style>@font-face{font-family:P;src:url(file://${process.cwd()}/node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff)}body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:P;background:radial-gradient(120% 120% at 100% 0%,#173F66 0%,#0F2A44 55%,#0B2036 100%);position:relative}</style></head><body>${inner}</body></html>`;
const deco = (w, h) => `<svg style="position:absolute;right:-90px;bottom:-60px;opacity:.08" width="${h * 0.95}" height="${h * 0.95}" viewBox="0 0 100 100">${G.mark('mono-branco', 'd')}</svg>`;
async function html(content, w, h, out) {
  writeFileSync('/tmp/social.html', content);
  await page.setViewportSize({ width: w, height: h });
  await page.goto('file:///tmp/social.html');
  await page.waitForTimeout(200);
  await page.screenshot({ path: out });
}
await html(social(1200, 630, `${deco(1200, 630)}<div style="position:absolute;left:90px;top:170px"><img src="${b64(neg)}" style="width:560px"><p style="color:#B9C6D6;font-size:30px;line-height:1.4;margin:48px 0 0;max-width:780px">Imóveis, inquilinos, rendas e pagamentos<br>num só lugar.</p></div>`), 1200, 630, `${OUT}/social/og-image-pt.png`);
await html(social(1200, 630, `${deco(1200, 630)}<div style="position:absolute;left:90px;top:170px"><img src="${b64(files['rentix-logo-horizontal-en-negativo'])}" style="width:560px"><p style="color:#B9C6D6;font-size:30px;line-height:1.4;margin:48px 0 0;max-width:780px">Properties, tenants, rent and payments<br>in one place.</p></div>`), 1200, 630, `${OUT}/social/og-image-en.png`);
await html(social(1500, 500, `${deco(1500, 500)}<div style="position:absolute;left:110px;top:150px"><img src="${b64(neg)}" style="width:520px"></div>`), 1500, 500, `${OUT}/social/capa-1500x500.png`);
await png(square, 1080, 1080, `${OUT}/social/perfil-1080.png`);
await browser.close();
console.log('ok', Object.keys(files).length, 'svg');
