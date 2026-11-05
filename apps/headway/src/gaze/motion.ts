/**
 * Pointer movement tuning (Research/001, solution D).
 *
 * Nutshell moved the pointer a fixed 6–12 % of the way to the head position each
 * frame. That is steady but lags, and lag makes people overshoot small targets.
 * Here the follow rate depends on how far the pointer is from where the head
 * points: big moves follow quickly, small corrections stay smooth.
 */

export type Steadiness = 'low' | 'medium' | 'high';

export interface MotionPreset {
  /** One-Euro filter minimum cutoff (Hz). Lower = smoother at rest. */
  minCutoff: number;
  /** One-Euro speed coefficient. Higher = less lag on fast moves. */
  beta: number;
  /** Follow rate for small corrections. */
  slowAlpha: number;
  /** Follow rate for large moves. */
  fastAlpha: number;
}

export const MOTION_PRESETS: Record<Steadiness, MotionPreset> = {
  low:    { minCutoff: 0.9,  beta: 0.006,  slowAlpha: 0.22, fastAlpha: 0.6 },
  medium: { minCutoff: 0.4,  beta: 0.0035, slowAlpha: 0.1,  fastAlpha: 0.45 },
  high:   { minCutoff: 0.25, beta: 0.002,  slowAlpha: 0.06, fastAlpha: 0.3 }
};

export const SPEED_MIN = 0.6;
export const SPEED_MAX = 1.6;

export function clampSpeed(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
}

export function asSteadiness(value: unknown): Steadiness {
  return value === 'low' || value === 'high' ? value : 'medium';
}

/**
 * How much of the remaining distance to cover this frame. Below `near` px the pointer
 * moves at `slowAlpha`; beyond `far` px at `fastAlpha`; linear in between.
 */
export function adaptiveAlpha(distancePx: number, preset: MotionPreset, near = 8, far = 160): number {
  const t = Math.min(1, Math.max(0, (distancePx - near) / (far - near)));
  return preset.slowAlpha + (preset.fastAlpha - preset.slowAlpha) * t;
}
