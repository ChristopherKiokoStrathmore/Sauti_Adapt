/** Pure, browser agnostic face measurements for the restricted on-page demo.
 * Headway remains a separate Chrome extension. The demo cannot click other tabs.
 */
export type FaceSignals = { horizontal: number; vertical: number; mouth: number | null };
export type Landmark = [number, number, number?] | { x: number; y: number };
export type DemoFace = {
  box?: number[];
  rotation?: { angle?: { yaw?: number; pitch?: number } };
  mesh?: Landmark[];
  score?: number;
};
export type DemoCursor = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function point(v: Landmark | undefined): [number, number] | null {
  if (!v) return null;
  const x = Array.isArray(v) ? v[0] : v.x;
  const y = Array.isArray(v) ? v[1] : v.y;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

export function readFaceSignals(face: DemoFace, width: number, height: number): FaceSignals | null {
  if (!width || !height || !face || (typeof face.score === 'number' && face.score < 0.3)) return null;
  const box = face.box;
  const nose = point(face.mesh?.[1]);
  const eyeL = point(face.mesh?.[33]);
  const eyeR = point(face.mesh?.[263]);
  let cx = box && box.length >= 4 ? (box[0] + box[2] / 2) / width : NaN;
  let cy = box && box.length >= 4 ? (box[1] + box[3] / 2) / height : NaN;
  if ((!Number.isFinite(cx) || !Number.isFinite(cy)) && nose) {
    cx = nose[0] / width;
    cy = nose[1] / height;
  }
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const rotation = face.rotation?.angle;
  const eyeDistance = eyeL && eyeR ? Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]) : 0;
  const fallbackYaw = nose && eyeL && eyeR && eyeDistance > 0
    ? (nose[0] - (eyeL[0] + eyeR[0]) / 2) / eyeDistance : 0;
  const yaw = Number.isFinite(rotation?.yaw) ? rotation!.yaw! : fallbackYaw * 0.6;
  const pitch = Number.isFinite(rotation?.pitch) ? rotation!.pitch! : 0;
  // Face position complements head rotation so small turns can still move the pointer.
  const horizontal = yaw * 0.65 + (cx - 0.5) * 0.9;
  const vertical = pitch * 0.65 + (cy - 0.5) * 0.9;

  // MediaPipe FaceMesh: lip opening 13/14; lip corners 61/291.
  const top = point(face.mesh?.[13]);
  const bottom = point(face.mesh?.[14]);
  const left = point(face.mesh?.[61]);
  const right = point(face.mesh?.[291]);
  const lipWidth = left && right ? Math.hypot(left[0] - right[0], left[1] - right[1]) : 0;
  const mouth = top && bottom && lipWidth > 2 ? Math.hypot(top[0] - bottom[0], top[1] - bottom[1]) / lipWidth : null;
  return { horizontal, vertical, mouth };
}

export function cursorFromHead(
  reading: FaceSignals, neutral: FaceSignals, sensitivity = 1, mirror = false,
): DemoCursor {
  const direction = mirror ? -1 : 1;
  return {
    x: clamp(0.5 + (reading.horizontal - neutral.horizontal) * sensitivity * 2.7 * direction, 0.035, 0.965),
    y: clamp(0.5 + (reading.vertical - neutral.vertical) * sensitivity * 2.7, 0.04, 0.96),
  };
}

export function mouthThresholds(closed: number, open: number): { click: number; release: number } | null {
  if (!Number.isFinite(closed) || !Number.isFinite(open) || open - closed < 0.035) return null;
  return { click: closed + (open - closed) * 0.7, release: closed + (open - closed) * 0.25 };
}
