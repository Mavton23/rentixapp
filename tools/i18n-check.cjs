#!/usr/bin/env node
/**
 * Verifica que todos os textos em português da interface e da API têm tradução inglesa.
 * Uso: pnpm i18n:check   (sai com erro se faltar alguma tradução)
 *
 * Procura: t('...') / tr('...') / tx('...'), mensagens de erro da API, e os valores dos
 * dicionários de rótulos (apps/web/src/i18n/*.ts). Textos com variáveis usam {nome}.
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const IGNORE = new Set(['Rentix', '%s · Rentix', 'Maputo', 'M-Pesa', 'e-Mola', 'mKesh', 'ResizeObserver loop', 'Non-Error promise rejection captured', 'Load failed', 'NetworkError when attempting to fetch resource', 'Email', 'Address', 'NUIT', 'PDF', 'WC', 'Id', 'Bytes', 'Total', 'DIRE', 'Website', 'Blog', 'Marketplace', 'Portal', 'API Key', 'Public Key', 'Menu', 'Site']);
const SKIP = /\/(generated|cli)\/|\.spec\.ts$|\/admin\/|platform-admin|\/i18n\/(server|client|runtime)|notifications\/templates\.ts|default-template\.ts|config\/env\.ts|common\/ops\/|modules\/ops\/|main\.ts|instrument\.ts|sentry|scrub\.ts/;
const ERR = /^(badRequest|notFound|forbidden|conflict|fieldError|unprocessable|unauthorized)$/;
const hasWords = (s) => /[A-Za-zÀ-ÿ]{2,}/.test(s);

function files(dir) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !SKIP.test(p)) out.push(p);
    }
  })(dir);
  return out;
}

function collect(dir, api) {
  const keys = new Map();
  const add = (k, f) => {
    if (!k || !hasWords(k) || IGNORE.has(k.trim())) return;
    if (!keys.has(k)) keys.set(k, path.relative(ROOT, f));
  };
  const tpl = (n) => n.templateSpans.reduce((s, sp, i) => s + `{${i}}` + sp.literal.text, n.head.text);
  for (const f of files(dir)) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const isLabels = /\/i18n\/(pt|extras|platform)\.ts$/.test(f);
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const name = n.expression.getText(sf);
        const a0 = n.arguments[0];
        if (/^(t|tr|tx|translator\([^)]*\))$/.test(name) && a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) add(a0.text, f);
        if (api && ERR.test(name)) {
          for (const a of n.arguments) {
            if ((ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && / /.test(a.text)) add(a.text, f);
            if (ts.isTemplateExpression(a)) add(tpl(a), f);
          }
        }
      }
      if (api && ts.isStringLiteral(n) && n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name.getText(sf) === 'message' && / /.test(n.text)) add(n.text, f);
      if (isLabels && ts.isStringLiteral(n) && n.parent && ts.isPropertyAssignment(n.parent) && n.parent.initializer === n) add(n.text, f);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return keys;
}

const shared = require(path.join(ROOT, 'packages/shared/dist/locales/en.js')).SHARED_EN;
const checks = [
  { name: 'web', dir: 'apps/web/src', dict: 'apps/web/src/i18n/en.json', api: false },
  { name: 'api', dir: 'apps/api/src', dict: 'apps/api/src/common/i18n/en.json', api: true },
];
let missing = 0;
for (const c of checks) {
  const dict = { ...shared, ...JSON.parse(fs.readFileSync(path.join(ROOT, c.dict), 'utf8')) };
  for (const [k, f] of collect(path.join(ROOT, c.dir), c.api)) {
    if (!(k in dict) && !(k.trim() in dict)) {
      if (!missing) console.log('Textos sem tradução inglesa (acrescentar ao dicionário indicado):\n');
      console.log(`  [${c.dict}] ${JSON.stringify(k)}  (${f})`);
      missing++;
    }
  }
}
if (missing) {
  console.log(`\n${missing} texto(s) sem tradução.`);
  process.exit(1);
}
console.log('Traduções completas.');
