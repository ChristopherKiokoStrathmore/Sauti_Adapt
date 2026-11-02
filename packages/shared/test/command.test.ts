import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandToUtterance } from '../src/index.ts';

test('accepted known intention maps to official grammar', () => {
  assert.equal(commandToUtterance({status:'accepted', intent:'SCROLL_DOWN', language:'sw-KE', confidence:.9, model_version:'1', reason:null}), 'scroll down');
});
test('uncertain and unknown intents NEVER execute', () => {
  const base = {language:'en-KE', confidence:.8, model_version:'1', reason:null} as const;
  assert.equal(commandToUtterance({...base, status:'rejected', intent:'SCROLL_DOWN'}), null);
  assert.equal(commandToUtterance({...base, status:'accepted', intent:'UNKNOWN'}), null);
});
