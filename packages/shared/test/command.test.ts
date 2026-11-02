import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_LABELS, commandToUtterance } from '../src/index.ts';
import { clampClipMs, DEFAULT_MAX_CLIP_MS } from '../src/audio.ts';
import { isReadAloudUtterance } from '../src/speak.ts';

test('accepted known intention maps to official grammar', () => {
  assert.equal(commandToUtterance({status:'accepted', intent:'SCROLL_DOWN', language:'sw-KE', confidence:.9, model_version:'1', reason:null}), 'scroll down');
});
test('uncertain and unknown intents NEVER execute', () => {
  const base = {language:'en-KE', confidence:.8, model_version:'1', reason:null} as const;
  assert.equal(commandToUtterance({...base, status:'rejected', intent:'SCROLL_DOWN'}), null);
  assert.equal(commandToUtterance({...base, status:'accepted', intent:'UNKNOWN'}), null);
});
test('labels describe read-aloud and settings-only undo', () => {
  assert.equal(COMMAND_LABELS.READ_PAGE.en, 'Read this page aloud');
  assert.match(COMMAND_LABELS.UNDO.en, /setting/i);
  assert.equal(isReadAloudUtterance('read this'), true);
  assert.equal(isReadAloudUtterance('undo'), false);
});
test('clip length stays within the configurable bounds', () => {
  assert.equal(clampClipMs(Number.NaN), DEFAULT_MAX_CLIP_MS);
  assert.equal(clampClipMs(5000), 5000);
  assert.equal(clampClipMs(10), 500);
  assert.equal(clampClipMs(999999), 30000);
});
