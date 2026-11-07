/** Rebuilds Headway when dist is missing or older than any file in src/ or manifest.json. */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { HEADWAY_ROOT } from './lib.mjs';

function newest(dir) {
  let t = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    t = Math.max(t, entry.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

const built = join(HEADWAY_ROOT, 'dist', 'sidepanel.js');
const srcTime = Math.max(newest(join(HEADWAY_ROOT, 'src')), statSync(join(HEADWAY_ROOT, 'manifest.json')).mtimeMs);
if (!existsSync(built) || statSync(built).mtimeMs < srcTime) {
  console.log('[e2e] dist is missing or older than src: running npm run build');
  execFileSync('npm', ['run', 'build'], { cwd: HEADWAY_ROOT, stdio: 'inherit' });
} else {
  console.log('[e2e] dist is up to date');
}
