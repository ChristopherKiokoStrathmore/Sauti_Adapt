import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeDistance, isAmbiguous } from '../src/gaze/targets.ts';
import { adaptiveAlpha, MOTION_PRESETS, clampSpeed, asSteadiness } from '../src/gaze/motion.ts';
import { MouthGesture, mouthThresholds } from '../src/gaze/mouth-gesture.ts';

const skip = { left: 1100, top: 700, right: 1210, bottom: 745 }; // ~ YouTube Skip

test('edge distance is 0 anywhere over the target, not only at its centre', () => {
  assert.equal(edgeDistance(1101, 701, skip), 0);
  assert.equal(edgeDistance(1209, 744, skip), 0);
});

test('edge distance measures to the nearest edge or corner', () => {
  assert.equal(edgeDistance(1090, 720, skip), 10);
  assert.equal(edgeDistance(1213, 749, skip), 5);
});

test('two targets about equally close are ambiguous; a clear winner is not', () => {
  assert.equal(isAmbiguous([{ distance: 4 }, { distance: 9 }], 40, 12), true);
  assert.equal(isAmbiguous([{ distance: 0 }, { distance: 30 }], 40, 12), false);
  assert.equal(isAmbiguous([{ distance: 5 }], 40, 12), false);
  assert.equal(isAmbiguous([{ distance: 5 }, { distance: 50 }], 40, 12), false);
});

test('pointer follows big moves faster than small corrections', () => {
  const p = MOTION_PRESETS.medium;
  assert.equal(adaptiveAlpha(2, p), p.slowAlpha);
  assert.ok(Math.abs(adaptiveAlpha(400, p) - p.fastAlpha) < 1e-9);
  assert.ok(adaptiveAlpha(80, p) > p.slowAlpha && adaptiveAlpha(80, p) < p.fastAlpha);
});

test('speed and steadiness settings are clamped to safe values', () => {
  assert.equal(clampSpeed(5), 1.6);
  assert.equal(clampSpeed(0.1), 0.6);
  assert.equal(clampSpeed('fast'), 1);
  assert.equal(asSteadiness('high'), 'high');
  assert.equal(asSteadiness('bogus'), 'medium');
});

const cal = { closedRatio: 0.1, openRatio: 0.5, threshold: 0.38 };
const t = mouthThresholds(cal);

test('mouth: onset freezes before the click, and one opening clicks once', () => {
  const g = new MouthGesture(1200);
  assert.deepEqual(g.update(0.12, t, 0), []);
  assert.deepEqual(g.update(0.25, t, 30), ['onset']);
  assert.equal(g.frozen, true);
  assert.deepEqual(g.update(0.42, t, 60), ['click']);
  // holding the mouth open must not click again (Nutshell re-clicked every 800 ms)
  assert.deepEqual(g.update(0.45, t, 900), []);
  assert.deepEqual(g.update(0.45, t, 1100), []);
  assert.deepEqual(g.update(0.15, t, 1150), ['release']);
  assert.equal(g.frozen, false);
  assert.deepEqual(g.update(0.25, t, 1300), ['onset']);
});

test('mouth: a mouth that rests open cannot freeze the pointer for long', () => {
  const g = new MouthGesture(1200);
  g.update(0.3, t, 0);
  assert.equal(g.frozen, true);
  assert.deepEqual(g.update(0.3, t, 1300), ['timeout']);
  assert.equal(g.frozen, false);
  // stays disarmed until it closes
  assert.deepEqual(g.update(0.45, t, 1400), []);
  assert.deepEqual(g.update(0.1, t, 1500), []);
  assert.deepEqual(g.update(0.25, t, 1600), ['onset']);
});
