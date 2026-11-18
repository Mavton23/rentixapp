// node render.mjs in.html out.png [w h]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [,, input, out, w = '1200', h = '800'] = process.argv;
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.goto('file://' + (input.startsWith('/') ? input : process.cwd() + '/' + input), { waitUntil: 'load' });
await p.waitForTimeout(300);
await p.screenshot({ path: out, omitBackground: true });
await b.close();
