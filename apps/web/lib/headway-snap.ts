/** Geometry and dead-zone rules for Sauti's website-only magnetic navigation.
 * This module does not import Chrome extension APIs or inspect a user's camera.
 */
export type SnapDirection = 'left' | 'right' | 'up' | 'down';
export type DirectionState = SnapDirection | 'neutral' | null;
export type SnapBox = { x: number; y: number; width: number; height: number };

export const SNAP_START = 0.095;
export const SNAP_RELEASE = 0.038;
export const SNAP_MIN_INTERVAL_MS = 320;
export const MOUTH_CLICK_COOLDOWN_MS = 550;

export function headDirection(dx: number, dy: number, sensitivity = 1): DirectionState {
  const factor = Math.max(0.6, Math.min(1.6, sensitivity));
  const x = dx * factor, y = dy * factor;
  if (Math.max(Math.abs(x), Math.abs(y)) <= SNAP_RELEASE) return 'neutral';
  if (Math.max(Math.abs(x), Math.abs(y)) < SNAP_START) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

function center(box: SnapBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Prefer forward direction and same row/column. Ignore any box behind the anchor. */
export function nextSnapIndex(boxes: SnapBox[], from: number, direction: SnapDirection): number {
  if (from < 0 || from >= boxes.length) return -1;
  const here = center(boxes[from]);
  let best = -1, bestScore = Number.POSITIVE_INFINITY;
  boxes.forEach((box, index) => {
    if (index === from || box.width <= 0 || box.height <= 0) return;
    const other = center(box);
    const dx = other.x - here.x, dy = other.y - here.y;
    const primary = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    if (primary <= 8) return;
    const perpendicular = direction === 'right' || direction === 'left' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + perpendicular * 1.8;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}

export function closestSnapIndex(boxes: SnapBox[], viewportWidth: number, viewportHeight: number): number {
  let best = -1, bestDistance = Number.POSITIVE_INFINITY;
  boxes.forEach((box, index) => {
    const middle = center(box);
    if (box.width <= 0 || box.height <= 0 ||
      middle.x < 0 || middle.x > viewportWidth || middle.y < 0 || middle.y > viewportHeight) return;
    const distance = (middle.x - viewportWidth / 2) ** 2 + (middle.y - viewportHeight / 2) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}
