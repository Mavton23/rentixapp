import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import * as G from './gen.mjs';
const OUT = 'out/rentix-identidade';
const svg = (n) => readFileSync(`${OUT}/svg/${n}.svg`, 'utf8');
const img = (s, style = '') => `<img style="${style}" src="data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}">`;
const pngImg = (p, style = '') => `<img style="${style}" src="data:image/png;base64,${readFileSync(p).toString('base64')}">`;
const fontsDir = `file://${process.cwd()}/node_modules/@fontsource/poppins/files`;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const cmyk = (h) => { const [r, g, b] = hexRgb(h).map((v) => v / 255); const k = 1 - Math.max(r, g, b); if (k === 1) return '0 0 0 100'; return [r, g, b].map((v) => Math.round(((1 - v - k) / (1 - k)) * 100)).concat(Math.round(k * 100)).join(' '); };

const colors = [
  ['Azul-marinho', '#0F2A44', 'Cor principal: logótipo, títulos, fundos escuros.', '#fff'],
  ['Azul', '#1D5FE6', 'Botões, ligações e os prédios do símbolo.', '#fff'],
  ['Turquesa', '#16C6C0', 'Acento: ponto do i e ponta do telhado. Usar pouco.', '#0F2A44'],
  ['Cinza-claro', '#F2F4F7', 'Fundos claros e áreas de apoio.', '#0F2A44'],
  ['Ardósia', '#5B6B7F', 'Slogan e texto secundário.', '#fff'],
];

const page = (body, cls = '') => `<section class="page ${cls}">${body}</section>`;
const head = (t, s) => `<h2>${t}</h2>${s ? `<p class="lead">${s}</p>` : ''}`;

const wrong = [
  ['transform:scaleX(1.35)', 'Não deformar'],
  ['filter:hue-rotate(140deg)', 'Não mudar as cores'],
  ['transform:rotate(-12deg)', 'Não rodar'],
  ['filter:drop-shadow(6px 8px 4px rgba(0,0,0,.45))', 'Sem sombras nem efeitos'],
];

const html = `<!doctype html><html lang="pt-MZ"><head><meta charset="utf-8"><style>
@font-face{font-family:Poppins;font-weight:400;src:url(${fontsDir}/poppins-latin-400-normal.woff)}
@font-face{font-family:Poppins;font-weight:500;src:url(${fontsDir}/poppins-latin-500-normal.woff)}
@font-face{font-family:Poppins;font-weight:600;src:url(${fontsDir}/poppins-latin-600-normal.woff)}
@font-face{font-family:Poppins;font-weight:400;src:url(${fontsDir}/poppins-latin-ext-400-normal.woff);unicode-range:U+0100-024F}
@page{size:297mm 210mm;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:Poppins;color:#0F2A44;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:297mm;height:210mm;padding:22mm 24mm;position:relative;page-break-after:always;overflow:hidden;background:#fff}
.page:after{content:attr(data-n);position:absolute;right:24mm;bottom:12mm;font-size:9pt;color:#8A97A8}
.dark{background:#0F2A44;color:#fff}
h1{font-weight:600;font-size:34pt;margin:0;letter-spacing:-.01em}
h2{font-weight:600;font-size:22pt;margin:0 0 4mm;letter-spacing:-.01em}
.lead{font-size:11pt;line-height:1.6;color:#5B6B7F;max-width:150mm;margin:0 0 10mm}
.grid{display:grid;gap:8mm}
.tile{border-radius:4mm;display:flex;min-width:0;align-items:center;justify-content:center;padding:10mm}
.light{background:#F2F4F7}.navy{background:#0F2A44}.blue{background:#1D5FE6}
.cap{font-size:9pt;color:#5B6B7F;margin-top:2.5mm}
.sw{border-radius:4mm;height:52mm;padding:6mm;display:flex;flex-direction:column;justify-content:flex-end;font-size:9.5pt;line-height:1.5}
.sw b{font-weight:600;font-size:12pt}
small{font-size:8.5pt;opacity:.85}
</style></head><body>
${page(`<div style="position:absolute;right:-30mm;bottom:-25mm;width:170mm;opacity:.07">${img(G.symbol('mono-branco').replace(/width="\d+" height="\d+"/, ''), 'width:100%')}</div>
<div style="position:absolute;left:24mm;top:62mm">${img(svg('rentix-logo-horizontal-negativo'), 'width:150mm')}
<h1 style="margin-top:22mm;font-size:26pt;font-weight:500">Manual de identidade visual</h1>
<p style="color:#B9C6D6;font-size:11pt;margin:3mm 0 0">Versão 1.0 · Novembro de 2026</p></div>`, 'dark')}

${page(`${head('A marca', 'O símbolo junta três ideias numa só forma: a letra R de Rentix, os prédios que os nossos clientes gerem e o telhado de uma casa. A perna do R é o próprio telhado, que termina em turquesa: o imóvel a render.')}
<div style="display:flex;align-items:center;gap:10mm;margin-top:6mm">
<div class="tile light" style="width:70mm;height:70mm">${img(svg('rentix-simbolo-cor'), 'width:52mm')}</div>
<div style="font-size:10.5pt;line-height:1.7;max-width:135mm">
<p style="margin:0 0 4mm"><b style="font-weight:600">Letra R.</b> A haste é o prédio mais à direita; a barriga do R abre sobre o telhado.</p>
<p style="margin:0 0 4mm"><b style="font-weight:600">Prédios.</b> Três barras a subir da esquerda para a direita: carteira que cresce.</p>
<p style="margin:0 0 4mm"><b style="font-weight:600">Imóvel.</b> O telhado e a janela de quatro vidros dizem “casa” mesmo em tamanhos pequenos.</p>
<p style="margin:0"><b style="font-weight:600">Logótipo.</b> “Rentix” em Poppins SemiBold, com o ponto do i em turquesa a repetir a ponta do telhado.</p></div></div>`)}

${page(`${head('Versões do logótipo', 'A versão horizontal é a principal. A vertical serve espaços altos ou centrados; o símbolo sozinho serve ícones, avatares e espaços muito pequenos.')}
<div class="grid" style="grid-template-columns:1.6fr 1fr;grid-template-rows:62mm 50mm">
<div><div class="tile light" style="height:100%">${img(svg('rentix-logo-horizontal-cor'), 'width:120mm')}</div><div class="cap">Horizontal com slogan, a versão principal</div></div>
<div style="grid-row:span 2"><div class="tile light" style="height:100%">${img(svg('rentix-logo-vertical-cor'), 'width:62mm')}</div><div class="cap">Vertical</div></div>
<div style="display:grid;grid-template-columns:1.6fr 1fr;gap:8mm"><div><div class="tile light" style="height:100%">${img(svg('rentix-logo-horizontal-sem-slogan-cor'), 'width:78mm')}</div><div class="cap">Sem slogan, para a aplicação e tamanhos pequenos</div></div>
<div><div class="tile light" style="height:100%">${img(svg('rentix-simbolo-cor'), 'width:30mm')}</div><div class="cap">Símbolo</div></div></div>
</div>`)}

${page(`${head('Fundos e versões a uma cor', 'Em fundos claros usa-se a versão a cores; em azul-marinho ou fotografias escuras, a versão negativa. As versões a uma cor servem carimbos, gravações, fax e impressão a preto.')}
<div class="grid" style="grid-template-columns:1fr 1fr;grid-template-rows:56mm 56mm">
<div><div class="tile light" style="height:100%">${img(svg('rentix-logo-horizontal-cor'), 'width:95mm')}</div><div class="cap">Cores, em fundo claro</div></div>
<div><div class="tile navy" style="height:100%">${img(svg('rentix-logo-horizontal-negativo'), 'width:95mm')}</div><div class="cap">Negativo, em fundo azul-marinho</div></div>
<div><div class="tile" style="height:100%;border:.3mm solid #E2E7EE">${img(svg('rentix-logo-horizontal-mono-azul'), 'width:95mm')}</div><div class="cap">Uma cor, azul-marinho</div></div>
<div><div class="tile blue" style="height:100%">${img(svg('rentix-logo-horizontal-mono-branco'), 'width:95mm')}</div><div class="cap">Uma cor, branco</div></div>
</div>`)}

${page(`${head('Área de proteção e tamanho mínimo', 'À volta do logótipo fica livre, no mínimo, a altura da barriga do R (x). Nada de texto, margens ou outros logótipos dentro dessa área.')}
<div style="display:flex;gap:16mm;align-items:center">
<div style="position:relative;padding:17mm;border:.3mm dashed #9DB3D0;background:#F2F4F7;border-radius:2mm">
<div style="outline:.3mm solid #C8D6E8">${img(svg('rentix-logo-horizontal-cor'), 'width:115mm;display:block')}</div>
${['top:4mm;left:50%', 'bottom:4mm;left:50%', 'left:5mm;top:50%', 'right:5mm;top:50%'].map((p) => `<span style="position:absolute;${p};font-size:11pt;color:#1D5FE6;font-weight:600;transform:translate(-50%,-50%)">x</span>`).join('')}
</div>
<div style="font-size:10.5pt;line-height:1.7">
<p style="margin:0 0 6mm"><b style="font-weight:600">Tamanhos mínimos</b></p>
<div style="display:flex;align-items:end;gap:8mm;margin-bottom:6mm">${img(svg('rentix-logo-horizontal-cor'), 'width:35mm')}<span class="cap">Com slogan: 35 mm / 140 px</span></div>
<div style="display:flex;align-items:end;gap:8mm;margin-bottom:6mm">${img(svg('rentix-logo-horizontal-sem-slogan-cor'), 'width:22mm')}<span class="cap">Sem slogan: 22 mm / 88 px</span></div>
<div style="display:flex;align-items:end;gap:8mm">${img(svg('rentix-simbolo-cor'), 'width:6mm')}<span class="cap">Símbolo: 6 mm / 16 px (favicon próprio, sem janela)</span></div>
</div></div>`)}

${page(`${head('Cores', 'Azul-marinho e branco fazem a maior parte do trabalho. O azul marca ações; o turquesa é um acento e nunca preenche áreas grandes.')}
<div class="grid" style="grid-template-columns:repeat(5,1fr)">
${colors.map(([n, h, d, fg]) => `<div><div class="sw" style="background:${h};color:${fg};${h === '#F2F4F7' ? 'border:.3mm solid #E2E7EE' : ''}"><b>${n}</b></div>
<div style="font-size:9pt;line-height:1.6;margin-top:3mm"><div><b style="font-weight:600">HEX</b> ${h}</div><div><b style="font-weight:600">RGB</b> ${hexRgb(h).join(' ')}</div><div><b style="font-weight:600">CMYK</b> ${cmyk(h)}</div><p class="cap" style="margin-top:2mm">${d}</p></div></div>`).join('')}
</div>
<div style="margin-top:8mm;height:9mm;border-radius:2mm;background:linear-gradient(90deg,#0F2A44 0%,#1D5FE6 55%,#16C6C0 100%)"></div>
<p class="cap">Gradiente do telhado: azul-marinho, azul, turquesa. Só no símbolo e em peças de comunicação, nunca no texto.</p>`)}

${page(`${head('Tipografia', 'Poppins é a letra da marca: geométrica, legível e gratuita (Google Fonts, licença OFL).')}
<div class="grid" style="grid-template-columns:1fr 1fr;gap:14mm">
<div><div style="font-size:52pt;font-weight:600;line-height:1">Aa</div><p style="font-weight:600;font-size:13pt;margin:4mm 0 1mm">Poppins SemiBold</p><p class="cap" style="margin:0">Logótipo, títulos e números de destaque.</p>
<p style="font-weight:600;font-size:22pt;margin:8mm 0 0;line-height:1.25">Gestão de arrendamentos sem papelada</p></div>
<div><div style="font-size:52pt;font-weight:400;line-height:1">Aa</div><p style="font-weight:500;font-size:13pt;margin:4mm 0 1mm">Poppins Regular e Medium</p><p class="cap" style="margin:0">Texto corrido, slogan (Medium, em maiúsculas espaçadas) e legendas.</p>
<p style="font-size:11pt;line-height:1.7;margin:8mm 0 0;color:#33475E">Faturas emitidas a tempo, lembretes por SMS e recibos assinados: o Rentix trata da rotina para que se possa dedicar aos inquilinos e aos imóveis.</p>
<p style="font-size:9.5pt;letter-spacing:.32em;font-weight:500;color:#5B6B7F;margin-top:8mm">GESTÃO DE IMÓVEIS</p></div></div>
<p class="cap" style="margin-top:10mm">Na aplicação, o texto da interface usa Instrument Sans, mais compacta para tabelas e formulários; Poppins fica no logótipo, no site e nas peças de comunicação.</p>`)}

${page(`${head('Usos incorretos', 'O logótipo usa-se sempre a partir dos ficheiros originais, sem alterações.')}
<div class="grid" style="grid-template-columns:repeat(4,1fr)">
${wrong.map(([st, t]) => `<div><div class="tile light" style="height:45mm;position:relative;overflow:hidden">${img(svg('rentix-logo-horizontal-sem-slogan-cor'), `width:34mm;${st}`)}<span style="position:absolute;top:3mm;right:4mm;color:#C0263E;font-size:16pt;font-weight:600">×</span></div><div class="cap">${t}</div></div>`).join('')}
<div><div class="tile" style="height:45mm;background:repeating-linear-gradient(45deg,#4FA3D9 0 6mm,#F2B84B 6mm 12mm);position:relative">${img(svg('rentix-logo-horizontal-sem-slogan-cor'), 'width:34mm')}<span style="position:absolute;top:3mm;right:4mm;color:#C0263E;font-size:16pt;font-weight:600">×</span></div><div class="cap">Não usar sobre fundos confusos</div></div>
<div><div class="tile navy" style="height:45mm;position:relative">${img(svg('rentix-logo-horizontal-sem-slogan-cor'), 'width:34mm')}<span style="position:absolute;top:3mm;right:4mm;color:#FF6B81;font-size:16pt;font-weight:600">×</span></div><div class="cap">Não usar a versão a cores em fundo escuro</div></div>
<div><div class="tile light" style="height:45mm;position:relative"><div style="display:flex;align-items:center;gap:2mm">${img(svg('rentix-simbolo-cor'), 'width:12mm')}<span style="font-family:serif;font-size:20pt">Rentix</span></div><span style="position:absolute;top:3mm;right:4mm;color:#C0263E;font-size:16pt;font-weight:600">×</span></div><div class="cap">Não reescrever com outra letra</div></div>
<div><div class="tile light" style="height:45mm;position:relative">${img(svg('rentix-logo-horizontal-sem-slogan-cor'), 'width:34mm;opacity:.35')}<span style="position:absolute;top:3mm;right:4mm;color:#C0263E;font-size:16pt;font-weight:600">×</span></div><div class="cap">Não usar transparências</div></div>
</div>`)}

${page(`${head('Ícones e aplicações', 'O ícone da aplicação é o símbolo em negativo sobre azul-marinho. Os ficheiros prontos estão na pasta favicon.')}
<div style="display:flex;gap:12mm;align-items:flex-end">
${pngImg(`${OUT}/favicon/icon-512.png`, 'width:34mm')}
${pngImg(`${OUT}/favicon/icon-192.png`, 'width:22mm')}
${pngImg(`${OUT}/favicon/favicon-48.png`, 'width:12mm;image-rendering:auto')}
${pngImg(`${OUT}/favicon/favicon-32.png`, 'width:8mm')}
<div style="flex:1"></div>
<div style="width:110mm">${pngImg(`${OUT}/social/og-image-pt.png`, 'width:100%;border-radius:3mm')}<div class="cap">Imagem de partilha (1200 × 630) para links e redes sociais</div></div>
</div>
<div style="margin-top:10mm;font-size:9.5pt;line-height:1.7;color:#33475E;columns:2;column-gap:12mm">
<p style="margin:0"><b style="font-weight:600">favicon.ico, favicon.svg</b>: separador do navegador.<br><b style="font-weight:600">apple-touch-icon.png</b>: ecrã inicial do iPhone (sem cantos: o sistema arredonda).<br><b style="font-weight:600">icon-192, icon-512</b>: Android e instalação como aplicação.<br><b style="font-weight:600">icon-maskable-512</b>: Android com máscara (círculo, gota).</p>
<p style="margin:0"><b style="font-weight:600">perfil-1080.png</b>: foto de perfil (Facebook, LinkedIn, Instagram, WhatsApp Business).<br><b style="font-weight:600">capa-1500x500.png</b>: capa de perfil.<br><b style="font-weight:600">og-image-pt / -en</b>: pré-visualização de links.</p>
</div>`)}
</body></html>`.replace(/<section class="page([^"]*)">/g, (() => { let n = 0; return (_m, c) => `<section class="page${c}" data-n="${n++ ? n : ''}">`; })());

writeFileSync('/tmp/manual.html', html);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('file:///tmp/manual.html');
await p.waitForTimeout(800);
await p.pdf({ path: `${OUT}/Rentix-manual-de-marca.pdf`, width: '297mm', height: '210mm', printBackground: true });
await b.close();
