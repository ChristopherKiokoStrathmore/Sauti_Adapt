import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHA = '7cf5006dbab9e328fadf54b654147c6bca44113d';

test('hand-written Controller types match the pinned toolkit signatures', () => {
  const declarations = readFileSync(resolve(root, 'packages/shared/src/toolkit-modules.d.ts'), 'utf8');
  assert.match(declarations, new RegExp(SHA));
  const vendor = resolve(root, 'vendor/ai4a11y-toolkit');
  if (existsSync(resolve(vendor, '.git'))) {
    const head = execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(head, SHA);
  } else {
    // Files were vendored in the repository. The parent's Git HEAD is NOT
    // the upstream toolkit revision; lock critical JS modules by Git blob SHA.
    const blob = (file: string) => {
      const bytes = readFileSync(resolve(vendor, file));
      return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    };
    assert.equal(blob('controller/createController.js'), '3d18addc3e7c31e015b017e68a1338df82cfb00f');
    assert.equal(blob('controller/web/dom-receiver.js'), 'addcdc9783631e9e494b73b521d76a22dd743776');
  }
  const controller = readFileSync(resolve(root, 'vendor/ai4a11y-toolkit/controller/createController.js'), 'utf8');
  const receiver = readFileSync(resolve(root, 'vendor/ai4a11y-toolkit/controller/web/dom-receiver.js'), 'utf8');
  const create = controller.match(/export function createController\(\{([^}]*)\}/);
  const dom = receiver.match(/export function createDomReceiver\(root, \{([^}]*)\}/);
  assert.ok(create, 'createController signature changed');
  assert.ok(dom, 'createDomReceiver signature changed');
  for (const name of ['control', 'llm', 'operator', 'rawToTask']) {
    assert.match(create[1], new RegExp(`\\b${name}\\b`));
    assert.match(declarations, new RegExp(`\\b${name}\\??:`));
  }
  for (const name of ['platform', 'scrollTarget']) {
    assert.match(dom[1], new RegExp(`\\b${name}\\b`));
    assert.match(declarations, new RegExp(`\\b${name}\\??:`));
  }
  assert.match(controller, /export function createController/);
  assert.match(receiver, /export function createDomReceiver/);
});
