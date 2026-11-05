import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const built = existsSync(join(root, 'dist', 'background.js'));

test('manifest sits at the extension root and is MV3 Headway', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Headway');
});

test('no permission is requested that the code does not use', () => {
  // debugger: real clicks for sites that ignore synthetic ones (Research/001, E)
  assert.deepEqual([...manifest.permissions].sort(), ['debugger', 'scripting', 'sidePanel', 'storage', 'tabs']);
});

test('every icon the manifest names exists', () => {
  for (const file of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)] as string[]) {
    assert.ok(existsSync(join(root, file)), file);
  }
});

test('every built file the manifest names exists', { skip: !built && 'run npm run build first' }, () => {
  const files: string[] = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...manifest.content_scripts.flatMap((cs: { js: string[] }) => cs.js)
  ];
  for (const entry of manifest.web_accessible_resources) {
    for (const res of entry.resources as string[]) {
      if (res.endsWith('/*')) {
        const dir = join(root, res.slice(0, -2));
        assert.ok(existsSync(dir) && readdirSync(dir).length > 0, `${res} is empty`);
      } else {
        files.push(res);
      }
    }
  }
  for (const file of files) assert.ok(existsSync(join(root, file)), file);
});

test('the side panel loads only local files', { skip: !built && 'run npm run build first' }, () => {
  const html = readFileSync(join(root, 'dist', 'sidepanel.html'), 'utf8');
  assert.ok(!/(src|href)="https?:/.test(html.replace(/xmlns="[^"]*"/g, '')), 'remote asset in side panel');
});
