// Serve the same on-device Human.js face models used by the Headway extension.
// Only two face models are needed for the hackathon page demo.
// These files are copied at build time and are not hosted on a third party CDN.
// Never edit the extension source: these assets come from its existing npm dependency.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(require.resolve('@vladmandic/human')));
const target = join(webRoot, 'public', 'headway-demo');
await mkdir(join(target, 'models'), { recursive: true });
await copyFile(join(packageRoot, 'dist', 'human.js'), join(target, 'human.esm.js'));
for (const file of ['blazeface.json', 'blazeface.bin', 'facemesh.json', 'facemesh.bin']) {
  await copyFile(join(packageRoot, 'models', file), join(target, 'models', file));
}
console.log('Headway page demo: local face models prepared');
