import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const toolkit = resolve(root, 'vendor/ai4a11y-toolkit');
const out = resolve(root, 'apps/extension/dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['manifest.json', 'sidepanel.html', 'icon.png']) {
  await copyFile(join(root, 'apps/extension/public', file), join(out, file));
}
for (const entry of ['background', 'content', 'sidepanel']) {
  await build({
    entryPoints: [join(root, 'apps/extension/src', `${entry}.ts`)],
    bundle: true, platform: 'browser', target: 'chrome114', format: 'iife',
    outfile: join(out, `${entry}.js`), alias: { '@toolkit': toolkit },
    logLevel: 'info', legalComments: 'none'
  });
}
console.log('Chrome extension ready:', out);
