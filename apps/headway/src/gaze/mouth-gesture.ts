/**
 * Mouth-click state machine (Research/001, solution B).
 *
 * - "onset" fires as the mouth starts to open (35 % of the calibrated range): the
 *   pointer and its target freeze, so jaw movement cannot drag the click off target.
 * - "click" fires once when the mouth passes the click threshold (70 %).
 * - The mouth must close again (below 25 %) before the next click. Nutshell clicked
 *   again every 800 ms while the mouth stayed open.
 * - The freeze never lasts more than `maxFreezeMs`, so a mouth that rests open does
 *   not lock the pointer; after that the gesture must close before it can re-arm.
 */
export interface MouthThresholds { onset: number; click: number; release: number }

export function mouthThresholds(cal: { closedRatio: number; openRatio: number; threshold?: number }): MouthThresholds {
  const range = cal.openRatio - cal.closedRatio;
  return {
    onset: cal.closedRatio + range * 0.35,
    click: typeof cal.threshold === 'number' ? cal.threshold : cal.closedRatio + range * 0.7,
    release: cal.closedRatio + range * 0.25
  };
}

export type MouthEvent = 'onset' | 'click' | 'release' | 'timeout';

export class MouthGesture {
  private state: 'closed' | 'opening' | 'clicked' | 'expired' = 'closed';
  private onsetAt = 0;
  private readonly maxFreezeMs: number;

  constructor(maxFreezeMs = 1200) {
    this.maxFreezeMs = maxFreezeMs;
  }

  get frozen(): boolean {
    return this.state === 'opening' || this.state === 'clicked';
  }

  /** Feed one mouth-ratio sample; returns the events this sample produced, in order. */
  update(ratio: number, t: MouthThresholds, now: number): MouthEvent[] {
    const events: MouthEvent[] = [];
    if (ratio < t.release) {
      if (this.state === 'opening' || this.state === 'clicked') events.push('release');
      this.state = 'closed';
      return events;
    }
    if (this.state === 'closed' && ratio >= t.onset) {
      this.state = 'opening';
      this.onsetAt = now;
      events.push('onset');
    }
    if (this.state === 'opening' && ratio >= t.click) {
      this.state = 'clicked';
      events.push('click');
    }
    if ((this.state === 'opening' || this.state === 'clicked') && now - this.onsetAt > this.maxFreezeMs) {
      this.state = 'expired';
      events.push('timeout');
    }
    return events;
  }

  reset() {
    this.state = 'closed';
  }
}
