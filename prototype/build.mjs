// Prototipi tek bir HTML dosyası olarak derler. Oyun kuralları game-core'dan gelir.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [join(here, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  logLevel: 'warning',
});
const code = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(join(here, 'template.html'), 'utf8');
if (!template.includes('<script id="app"></script>')) throw new Error('şablonda uygulama yeri bulunamadı');
const html = template.replace('<script id="app"></script>', () => `<script>${code}</script>`);

mkdirSync(join(here, 'dist'), { recursive: true });
const out = join(here, 'dist', 'canavar-avi-prototip.html');
writeFileSync(out, html, 'utf8');
console.log(`Prototip hazır: ${out} (${(html.length / 1024).toFixed(0)} KB)`);
