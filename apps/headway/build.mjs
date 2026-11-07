// Builds Headway into dist/. The manifest stays at the extension root and points
// into dist/, so "Load unpacked" on this folder works after one build.
import { build, context } from 'esbuild';
import { cp, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);
// The package does not export package.json; its main entry lives in <pkg>/dist/.
const humanPkg = dirname(dirname(require.resolve('@vladmandic/human')));
// The official AI4A11y toolkit, pinned by scripts/bootstrap_toolkit.py. Headway bundles
// it (voice profile storage goes through its Librarian), never a copy of it.
const toolkitDir = join(root, '../../vendor/ai4a11y-toolkit/toolkit');
if (!existsSync(join(toolkitDir, 'index.js'))) {
  console.error('Headway: the AI4A11y toolkit is missing. Run `python scripts/bootstrap_toolkit.py` from the repo root.');
  process.exit(1);
}

// Exactly the models Human fetches with the config in src/gaze/core.ts: face detector,
// mesh and emotion, plus Human's default body and hand models. Checked by watching the
// network on a live page. Nutshell also shipped iris, faceres, antispoof, liveness and
// centernet (~14 MB), which that config never loads. If you enable one in core.ts, add it here.
const HUMAN_MODELS = [
  'blazeface', 'facemesh', 'emotion',
  'movenet-lightning', 'handtrack', 'handlandmark-lite'
];

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  gaze: 'src/gaze/index.ts',
  'youtube-bridge': 'src/youtube/bridge.ts',
  'youtube-caption-handler': 'src/youtube/caption-handler.ts',
  'twitter-interceptor': 'src/twitter/interceptor.ts',
  sidepanel: 'src/sidepanel/sidepanel.ts',
  'agent-content': 'src/agent/controller-content.ts',
  onboarding: 'src/onboarding/onboarding.ts',
  'mic-permission': 'src/onboarding/mic-permission.ts'
};

const options = {
  entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, join(root, file)])),
  outdir: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome128',
  sourcemap: 'linked',
  legalComments: 'eof',
  logLevel: 'info',
  alias: { '@ai4a11y/toolkit': toolkitDir, '@toolkit': join(root, '../../vendor/ai4a11y-toolkit') }
};

async function copyStatic() {
  await mkdir(join(out, 'human', 'models'), { recursive: true });
  await mkdir(join(out, 'fonts'), { recursive: true });
  await copyFile(join(root, 'src/sidepanel/sidepanel.html'), join(out, 'sidepanel.html'));
  await copyFile(join(root, 'src/sidepanel/sidepanel.css'), join(out, 'sidepanel.css'));
  for (const f of ['onboarding.html', 'onboarding.css', 'mic-permission.html']) await copyFile(join(root, 'src/onboarding', f), join(out, f));
  await copyFile(join(root, 'src/gaze/overlay.css'), join(out, 'gaze-overlay.css'));
  await cp(join(root, 'assets/fonts'), join(out, 'fonts'), { recursive: true });
  // Human.js stays a separate ES module: content scripts import it on demand so pages
  // without head tracking never load ~2 MB of TensorFlow.
  await copyFile(join(humanPkg, 'dist/human.esm.js'), join(out, 'human/human.esm.js'));
  const available = new Set(await readdir(join(humanPkg, 'models')));
  for (const model of HUMAN_MODELS) {
    for (const ext of ['.json', '.bin']) {
      const file = model + ext;
      if (available.has(file)) await copyFile(join(humanPkg, 'models', file), join(out, 'human/models', file));
    }
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyStatic();

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Headway: watching src/ (static files copied once; rerun for HTML/CSS changes)');
} else {
  await build(options);
  console.log('Headway built:', out);
}
