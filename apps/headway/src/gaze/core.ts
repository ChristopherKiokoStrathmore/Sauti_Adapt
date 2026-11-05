import type { Human, Result, Config, Point } from '@vladmandic/human';
import { MOTION_PRESETS, adaptiveAlpha, asSteadiness, clampSpeed, type Steadiness } from './motion';
import { MouthGesture, mouthThresholds } from './mouth-gesture';

type HumanConstructor = new (config?: Partial<Config>) => Human;
type ScalarFilter = (value: number, timestampMs: number) => number;
/** Human returns landmark points as tuples; older builds used objects or flat typed arrays. */
type MeshLike = ArrayLike<unknown> | Record<number, unknown> | null | undefined;
type Annotations = Partial<Record<string, unknown[]>>;
type EarSample = [number, number];

(function() {
  'use strict';

  const STATUS_EVENT = 'gaze:status';
  const POINT_EVENT = 'gaze:point';
  const GAZE_ENABLED_KEY = 'gazeEnabled';
  const HEAD_CAL_STORAGE_KEY = 'headCalV2';
  const EAR_CAL_STORAGE_KEY = 'earCalV2';
  const DEFAULT_DWELL_MS = 600;
  const HUMAN_MODULE_PATH = 'dist/human/human.esm.js';
  const HUMAN_MODELS_DIR = 'dist/human/models/';
  const POINT_THROTTLE_MS = 33;
  const HEAD_FILTER_MIN_CUTOFF = 0.4;     // Reduced from 0.8 for more smoothing
  const HEAD_FILTER_BETA = 0.0025;
  const HEAD_FILTER_D_CUTOFF = 1.0;
  const HEAD_POINTER_LERP = 0.12;         // Reduced from 0.2 for more smoothing
  const HEAD_TRANSLATION_GAIN = 1;
  const HEAD_ROTATION_INFLUENCE = 0.22;
  const HEAD_ROTATION_EDGE_GAIN = 0.35;
  const HEAD_CENTER_THRESHOLD = 0.25;
  const HEAD_EDGE_THRESHOLD = 0.7;
  const HEAD_CENTER_LERP = 0.06;
  const HEAD_EDGE_LERP = 0.10;
  const PITCH_FALLBACK_THRESHOLD = 0.32;
  const TRANSLATION_MIN_RATIO = 0.24;
  const VERTICAL_EDGE_SCALE = 1.35;
  const HEAD_YAW_SCALE = 25;
  const HEAD_PITCH_SCALE = 20;
  const BLINK_LEFT_THRESHOLD_MS = 1000;
  const BLINK_RIGHT_THRESHOLD_MS = 2000;
  const MOUTH_CALIBRATION_SAMPLES = 30;   // Samples to collect for mouth calibration
  const MOUTH_OPEN_COOLDOWN_MS = 800;     // Prevent multiple clicks from sustained open mouth
  const BLINK_RELEASE_EVENT = 'blink:released';
  const EAR_OPEN_SAMPLES_REQUIRED = 60;
  const EAR_CLOSED_COLLECTION_MS = 700;
  const EAR_STAGE_RESET_MS = 220;
  const DEFAULT_HEAD_CAL: HeadCalibration = {
    cx: 0,
    cy: 0,
    left: 0.4,
    right: 0.4,
    up: 0.3,
    down: 0.35,
    version: 2,
    ts: 0
  };
  const HEAD_MIRROR_X = -1;
  const HEAD_MIRROR_Y = 1;
  const AUTO_CENTER_ALPHA = 0.05;

  let human: Human | null = null;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let rafHandle: number | null = null;
  let videoFrameHandle: number | null = null;
  let initializationPromise: Promise<boolean> | null = null;
  let phase = 'loading';
  let lastPointTs = 0;
  let lastFaceScore = 0;
  let previewOn = true;
  let probePrinted = false;
  let headCal: HeadCalibration | null = null;
  let headFilterX: ScalarFilter | null = null;
  let headFilterY: ScalarFilter | null = null;
  let lastHeadPoint: Vec2 | null = null;
  let detectInProgress = false;
  let framesSkipped = 0;
  let detectDurations: number[] = [];
let headModeWarned = false;
let headFrameErrorLogged = false;
let headAutoCenter = { nx: 0, ny: 0, ready: false };
  let earCal: EarCalibration | null = null;
  let earCalStage: 'idle' | 'collect_open' | 'await_closed' | 'done' = 'idle';
  let earOpenSamples: EarSample[] = [];
  let earClosedSamples: EarSample[] = [];
  let earClosedStart: number | null = null;
  let blinkClosedAt: number | null = null;
  let blinkHoldEmitted = false;
  let previewFrameCount = 0;
  let lastMouthClickTime = 0;            // Track last mouth-open click for cooldown
  let lastMouthRatio = 0;                // Track mouth aspect ratio for debugging
  let mouthCalibration: MouthCalibration | null = null;  // { closedRatio, openRatio, threshold }
  let mouthCalSamples: number[] = [];    // Temporary calibration samples
  let mouthClickEnabled = false;         // Whether mouth clicking is enabled
  const mouthGesture = new MouthGesture(); // onset -> freeze, click once, re-arm on close
  let pointerSpeed = 1;                  // side panel "Pointer speed" (gazeSpeed)
  let steadiness: Steadiness = 'medium'; // side panel "Steadiness" (gazeSteadiness)

  let gazeEnabled = false;
  if (typeof window.__gazeHeadMode !== 'boolean') {
    window.__gazeHeadMode = true;
  }
  if (typeof window.__gazeHeadCalActive !== 'boolean') {
    window.__gazeHeadCalActive = false;
  }
  if (!window.__lastHeadFrame) {
    window.__lastHeadFrame = { nx: 0, ny: 0 };
  }

  window.addEventListener('gaze:preview-toggle', (event) => {
    previewOn = Boolean(event && event.detail && event.detail.on);
  });

  function computeAlpha(fc: number, dtSeconds: number): number {
    const tau = 1 / (2 * Math.PI * Math.max(1e-3, fc));
    return 1 / (1 + tau / Math.max(1e-4, dtSeconds));
  }

  /** One-Euro filter (Casiez et al.): smooths jitter at rest, follows fast moves. */
  function createOneEuroFilter(minCut = HEAD_FILTER_MIN_CUTOFF, beta = HEAD_FILTER_BETA, dCut = HEAD_FILTER_D_CUTOFF): ScalarFilter {
    let prevValue = 0;
    let prevTimestamp: number | null = null;
    let dxEstimate: number | null = null;
    let smoothed: number | null = null;
    return (value: number, timestampMs: number) => {
      if (!Number.isFinite(value) || !Number.isFinite(timestampMs)) {
        return value;
      }
      if (prevTimestamp === null) {
        prevTimestamp = timestampMs;
        prevValue = value;
        smoothed = value;
        dxEstimate = 0;
        return value;
      }
      const dt = Math.max(1e-3, (timestampMs - prevTimestamp) / 1000);
      prevTimestamp = timestampMs;
      const rawDerivative = (value - prevValue) / dt;
      prevValue = value;
      const alphaDerivative = computeAlpha(dCut, dt);
      dxEstimate = dxEstimate == null ? rawDerivative : (alphaDerivative * rawDerivative) + ((1 - alphaDerivative) * dxEstimate);
      const cutoff = minCut + beta * Math.abs(dxEstimate);
      const alpha = computeAlpha(cutoff, dt);
      smoothed = smoothed == null ? value : (alpha * value) + ((1 - alpha) * smoothed);
      return smoothed;
    };
  }

  function mapHeadLocalToXY(nx: number, ny: number, cal: HeadCalibration | null): Vec2 | null {
    if (!cal) return null;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;

    const centerX = Number.isFinite(cal.cx) ? cal.cx : 0;
    const centerY = Number.isFinite(cal.cy) ? cal.cy : 0;

    const dx = nx - centerX;
    const dy = ny - centerY;

    const leftRange = Math.max(1e-3, cal.left || 0.01);
    const rightRange = Math.max(1e-3, cal.right || 0.01);
    const upRange = Math.max(1e-3, cal.up || 0.01);
    const downRange = Math.max(1e-3, cal.down || 0.01);

    let tx;
    if (dx < 0) {
      const ratio = Math.max(-1, Math.min(0, dx / leftRange));
      tx = 0.5 + 0.5 * ratio;
    } else {
      const ratio = Math.max(0, Math.min(1, dx / rightRange));
      tx = 0.5 + 0.5 * ratio;
    }

    let ty;
    if (dy < 0) {
      const ratio = Math.max(-1, Math.min(0, dy / upRange));
      ty = 0.5 + 0.5 * ratio;
    } else {
      const ratio = Math.max(0, Math.min(1, dy / downRange));
      ty = 0.5 + 0.5 * ratio;
    }

    tx = Math.max(0, Math.min(1, tx));
    ty = Math.max(0, Math.min(1, ty));

    const viewportWidth = Math.max(1, window.innerWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || 1);

    const px = Math.max(0, Math.min(viewportWidth - 1, tx * viewportWidth));
    const py = Math.max(0, Math.min(viewportHeight - 1, ty * viewportHeight));
    return [px, py];
  }

  const LEFT_EYE_CANDIDATES = [33, 246, 161, 160, 159, 130];
  const RIGHT_EYE_CANDIDATES = [362, 466, 388, 387, 386, 359];
  const NOSE_CANDIDATES = [1, 4, 5, 6, 197, 168, 2, 94];

  function centroid(points: unknown): Vec2 | null {
    if (!Array.isArray(points) || !points.length) {
      return null;
    }
    let x = 0;
    let y = 0;
    let count = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = normalizePoint(points[i]);
      if (!p) continue;
      x += p[0];
      y += p[1];
      count += 1;
    }
    if (!count) {
      return null;
    }
    return [x / count, y / count];
  }

  function pointFromAnnotations(annotations: Annotations | null | undefined, keys: string[]): Vec2 | null {
    if (!annotations || !Array.isArray(keys)) {
      return null;
    }
    for (let i = 0; i < keys.length; i += 1) {
      const arr = annotations[keys[i]];
      const c = centroid(arr);
      if (c) return c;
    }
    return null;
  }

  function resolvePoint(mesh: MeshLike, annotations: Annotations | null | undefined, candidates: number[], annotationKeys: string[]): Vec2 | null {
    for (let i = 0; i < candidates.length; i += 1) {
      const p = pick(mesh, candidates[i]);
      if (p) {
        return p;
      }
    }
    if (annotations) {
      const annPoint = pointFromAnnotations(annotations, annotationKeys);
      if (annPoint) {
        return annPoint;
      }
    }
    return null;
  }

  // Calibrate mouth open/closed thresholds
  function calibrateMouth(): Promise<MouthCalibration> {
    return new Promise((resolve) => {
      console.log('[GazeCore] 👄 Starting mouth calibration...');

      // Step 1: Collect closed mouth samples
      mouthCalSamples = [];
      const step1Message = `Close your mouth normally and look at the screen.\nCollecting ${MOUTH_CALIBRATION_SAMPLES} samples...`;

      setTimeout(() => {
        if (mouthCalSamples.length < MOUTH_CALIBRATION_SAMPLES) {
          console.warn('[GazeCore] Not enough closed mouth samples, retrying...');
          mouthCalSamples = [];
          return calibrateMouth().then(resolve);
        }

        const closedRatio = mouthCalSamples.reduce((a, b) => a + b, 0) / mouthCalSamples.length;
        console.log(`[GazeCore] ✓ Closed mouth ratio: ${closedRatio.toFixed(3)}`);

        // Step 2: Collect open mouth samples
        mouthCalSamples = [];
        const step2Message = `Now OPEN your mouth wide!\nCollecting ${MOUTH_CALIBRATION_SAMPLES} samples...`;

        setTimeout(() => {
          if (mouthCalSamples.length < MOUTH_CALIBRATION_SAMPLES) {
            console.warn('[GazeCore] Not enough open mouth samples, retrying...');
            mouthCalSamples = [];
            return calibrateMouth().then(resolve);
          }

          const openRatio = mouthCalSamples.reduce((a, b) => a + b, 0) / mouthCalSamples.length;
          console.log(`[GazeCore] ✓ Open mouth ratio: ${openRatio.toFixed(3)}`);

          // Calculate threshold (70% between closed and open)
          const threshold = closedRatio + (openRatio - closedRatio) * 0.7;

          mouthCalibration = { closedRatio, openRatio, threshold };
          mouthCalSamples = [];

          console.log(`[GazeCore] 🎉 Mouth calibration complete!`, mouthCalibration);
          resolve(mouthCalibration);
        }, 2000);

      }, 2000);
    });
  }

  // Calculate mouth aspect ratio (MAR) for mouth-open detection
  // Returns ratio of mouth height to width (higher = more open)
  function calculateMouthRatio(annotations: Partial<Record<string, Point[]>> | null | undefined): number {
    if (!annotations) {
      if (!window.__mouthDebug1) {
        console.warn('[GazeCore] No annotations for mouth detection');
        window.__mouthDebug1 = true;
      }
      return 0;
    }

    if (!annotations.lipsUpperOuter || !annotations.lipsLowerOuter) {
      if (!window.__mouthDebug2) {
        console.warn('[GazeCore] No lip landmarks. Available:', Object.keys(annotations));
        window.__mouthDebug2 = true;
      }
      return 0;
    }

    // Get lip landmarks
    const upperLip = annotations.lipsUpperOuter;
    const lowerLip = annotations.lipsLowerOuter;

    // Debug log once
    if (!window.__mouthDebug3) {
      console.log('[GazeCore] Lip landmarks found!', {
        upperLipLength: upperLip.length,
        lowerLipLength: lowerLip.length,
        upperSample: upperLip[5],
        lowerSample: lowerLip[5]
      });
      window.__mouthDebug3 = true;
    }

    // Calculate vertical mouth opening (height)
    // Use points: top center and bottom center (middle of arrays)
    const topPoint = upperLip[Math.floor(upperLip.length / 2)];
    const bottomPoint = lowerLip[Math.floor(lowerLip.length / 2)];

    if (!topPoint || !bottomPoint) {
      if (!window.__mouthDebug4) {
        console.warn('[GazeCore] Missing center lip points');
        window.__mouthDebug4 = true;
      }
      return 0;
    }

    const mouthHeight = Math.abs(bottomPoint[1] - topPoint[1]);

    // Calculate horizontal mouth width
    // Use points: left corner (first) and right corner (last)
    const leftPoint = upperLip[0];
    const rightPoint = upperLip[upperLip.length - 1];

    if (!leftPoint || !rightPoint) {
      if (!window.__mouthDebug5) {
        console.warn('[GazeCore] Missing corner lip points');
        window.__mouthDebug5 = true;
      }
      return 0;
    }

    const mouthWidth = Math.abs(rightPoint[0] - leftPoint[0]);

    if (mouthWidth === 0) return 0;

    // Mouth Aspect Ratio (MAR)
    const mar = mouthHeight / mouthWidth;
    return mar;
  }

  function computeHeadFrame(face: FaceResult | null) {
    if (!face) {
      return null;
    }
    const mesh = face.mesh;
    if (!mesh) {
      return null;
    }
    const annotations: Annotations = face.annotations || {};
    let leftEye = resolvePoint(mesh, annotations, LEFT_EYE_CANDIDATES, ['leftEyeUpper0', 'leftEyeLower0', 'leftEyeUpper1']);
    let rightEye = resolvePoint(mesh, annotations, RIGHT_EYE_CANDIDATES, ['rightEyeUpper0', 'rightEyeLower0', 'rightEyeUpper1']);
    let noseTip = resolvePoint(mesh, annotations, NOSE_CANDIDATES, ['noseTip', 'midwayBetweenEyes']);

    if ((!leftEye || !rightEye) && face.annotations?.midwayBetweenEyes) {
      const fallback = centroid(annotations.midwayBetweenEyes);
      if (fallback) {
        if (!leftEye) {
          leftEye = [fallback[0] - 5, fallback[1]];
        }
        if (!rightEye) {
          rightEye = [fallback[0] + 5, fallback[1]];
        }
      }
    }

    if (!leftEye || !rightEye) {
      return null;
    }

    if (!noseTip) {
      noseTip = [(leftEye[0] + rightEye[0]) / 2, (leftEye[1] + rightEye[1]) / 2];
    }

    const eyeVec: Vec2 = [rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]];
    const iod = Math.hypot(eyeVec[0], eyeVec[1]);
    if (!iod || !Number.isFinite(iod)) {
      return null;
    }
    eyeVec[0] /= iod;
    eyeVec[1] /= iod;
    const vertical: Vec2 = [-eyeVec[1], eyeVec[0]];
    const center: Vec2 = [(leftEye[0] + rightEye[0]) / 2, (leftEye[1] + rightEye[1]) / 2];
    const noseVec = [noseTip[0] - center[0], noseTip[1] - center[1]];
    const u = (noseVec[0] * eyeVec[0]) + (noseVec[1] * eyeVec[1]);
    const v = (noseVec[0] * vertical[0]) + (noseVec[1] * vertical[1]);
    const normalization = Math.max(0.01, iod);
    const nx = Math.max(-1.5, Math.min(1.5, u / normalization));
    const ny = Math.max(-1.5, Math.min(1.5, v / normalization));
    return {
      nx: nx * HEAD_MIRROR_X,
      ny: ny * HEAD_MIRROR_Y,
      iod,
      center,
      leftEye,
      rightEye,
      nose: noseTip,
      ex: eyeVec,
      ey: vertical
    };
  }

  function distancePoint(a: Vec2 | null, b: Vec2 | null): number {
    if (!a || !b) return NaN;
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  function leftEAR(mesh: MeshLike): number {
    const top = pick(mesh, 159);
    const bottom = pick(mesh, 145);
    const leftCorner = pick(mesh, 33);
    const rightCorner = pick(mesh, 133);
    if (!top || !bottom || !leftCorner || !rightCorner) return NaN;
    const vertical = distancePoint(top, bottom);
    const horizontal = Math.max(1, distancePoint(leftCorner, rightCorner));
    return vertical / horizontal;
  }

  function rightEAR(mesh: MeshLike): number {
    const top = pick(mesh, 386);
    const bottom = pick(mesh, 374);
    const leftCorner = pick(mesh, 362);
    const rightCorner = pick(mesh, 263);
    if (!top || !bottom || !leftCorner || !rightCorner) return NaN;
    const vertical = distancePoint(top, bottom);
    const horizontal = Math.max(1, distancePoint(leftCorner, rightCorner));
    return vertical / horizontal;
  }

  function averageEarSamples(samples: EarSample[]): EarSample {
    if (!samples || !samples.length) {
      return [NaN, NaN];
    }
    let sumL = 0;
    let sumR = 0;
    samples.forEach(([l, r]) => {
      sumL += l;
      sumR += r;
    });
    return [sumL / samples.length, sumR / samples.length];
  }

  function finalizeEarCalibration(openAvg: EarSample, closedAvg: EarSample) {
    const [openL, openR] = openAvg;
    const [closedL, closedR] = closedAvg;
    if (!Number.isFinite(openL) || !Number.isFinite(openR) || !Number.isFinite(closedL) || !Number.isFinite(closedR)) {
      console.debug('[Blink] Unable to finalize EAR calibration; invalid averages', { openAvg, closedAvg });
      return;
    }
    const cal: EarCalibration = {
      version: 2,
      Lopen: openL,
      Ropen: openR,
      Lclosed: closedL,
      Rclosed: closedR,
      Lclose: (openL * 0.65 + closedL * 1.35) / 2,
      Rclose: (openR * 0.65 + closedR * 1.35) / 2,
      LopenTh: (openL * 0.90 + closedL * 1.10) / 2,
      RopenTh: (openR * 0.90 + closedR * 1.10) / 2,
      ts: Date.now()
    };
    earCal = cal;
    earCalStage = 'done';
    earOpenSamples = [];
    earClosedSamples = [];
    earClosedStart = null;
    storageSet({ [EAR_CAL_STORAGE_KEY]: cal });
    dispatchStatus('live', 'Blink calibration saved');
    console.debug('[Blink] EAR calibration saved', cal);
  }

  function ensureEarCalibration(mesh: MeshLike, ts: number) {
    const left = leftEAR(mesh);
    const right = rightEAR(mesh);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return;
    }
    if (earCal && earCal.version === 2) {
      earCalStage = 'done';
      return;
    }
    if (earCalStage === 'idle') {
      earCalStage = 'collect_open';
      earOpenSamples = [];
      earClosedSamples = [];
      earClosedStart = null;
      dispatchStatus('calibrating', 'Blink: keep eyes open');
      console.debug('[Blink] Starting EAR open baseline capture');
    }
    if (earCalStage === 'collect_open') {
      earOpenSamples.push([left, right]);
      if (earOpenSamples.length >= EAR_OPEN_SAMPLES_REQUIRED) {
        earCalStage = 'await_closed';
        dispatchStatus('ready', 'Blink: gently close eyes for ~1s');
        console.debug('[Blink] Open baseline captured; waiting for closed baseline');
      }
      return;
    }
    if (earCalStage === 'await_closed') {
      const openAvg = averageEarSamples(earOpenSamples);
      const shouldCaptureClosed = left < openAvg[0] * 0.7 && right < openAvg[1] * 0.7;
      if (shouldCaptureClosed) {
        earClosedSamples.push([left, right]);
        if (!earClosedStart) {
          earClosedStart = ts;
          console.debug('[Blink] Closed-eye capture started');
        }
        if (ts - earClosedStart >= EAR_CLOSED_COLLECTION_MS) {
          finalizeEarCalibration(openAvg, averageEarSamples(earClosedSamples));
        }
      } else if (earClosedStart && (ts - earClosedStart) > EAR_STAGE_RESET_MS) {
        earClosedSamples = [];
        earClosedStart = null;
      }
    }
  }

  function triggerBlinkClick(button: 'left' | 'right') {
    window.dispatchEvent(new CustomEvent('blink:click', {
      detail: { button }
    }));
  }

  function updateBlinkState(mesh: MeshLike, ts: number) {
    if (!earCal || earCal.version !== 2) {
      ensureEarCalibration(mesh, ts);
      return;
    }
    const left = leftEAR(mesh);
    const right = rightEAR(mesh);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return;
    }
    const leftClosed = left < earCal.Lclose;
    const rightClosed = right < earCal.Rclose;
    const leftOpen = left > earCal.LopenTh;
    const rightOpen = right > earCal.RopenTh;
    const bothClosed = leftClosed && rightClosed;
    if (bothClosed) {
      if (blinkClosedAt === null) {
        blinkClosedAt = ts;
        blinkHoldEmitted = false;
        window.dispatchEvent(new CustomEvent('blink:start', {
          detail: { timestamp: ts }
        }));
      }
      const duration = ts - blinkClosedAt;
      if (!blinkHoldEmitted && duration >= BLINK_LEFT_THRESHOLD_MS) {
        window.dispatchEvent(new CustomEvent('blink:hold', {
          detail: { duration }
        }));
        blinkHoldEmitted = true;
      }
    } else if (leftOpen && rightOpen && blinkClosedAt !== null) {
      const duration = ts - blinkClosedAt;
      window.dispatchEvent(new CustomEvent(BLINK_RELEASE_EVENT, {
        detail: {
          duration,
          timestamp: ts
        }
      }));
      blinkClosedAt = null;
      blinkHoldEmitted = false;
      if (!window.__gazeHeadCalActive) {
        if (duration >= BLINK_RIGHT_THRESHOLD_MS) {
          triggerBlinkClick('right');
        } else if (duration >= BLINK_LEFT_THRESHOLD_MS) {
          triggerBlinkClick('left');
        }
      }
    }
  }

  function dispatchStatus(nextPhase: string, note?: string | null) {
    phase = nextPhase;
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: { phase: nextPhase, note: note || null }
    }));
  }

  function dispatchPoint(x: number, y: number, confidence: number, ts: number) {
    window.dispatchEvent(new CustomEvent(POINT_EVENT, {
      detail: { x, y, conf: confidence, ts }
    }));
  }

  function storageGet(keys: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          resolve(result || {});
        });
      } catch (error) {
        console.warn('[GazeCore] storage.get failed:', error);
        resolve({});
      }
    });
  }

  function storageSet(payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(payload, () => resolve());
      } catch (error) {
        console.warn('[GazeCore] storage.set failed:', error);
        resolve();
      }
    });
  }

  async function ensureInitialized() {
    if (initializationPromise) {
      return initializationPromise;
    }
    initializationPromise = (async () => {
      dispatchStatus('loading', 'Loading Human.js models');
      const humanUrl = chrome.runtime.getURL(HUMAN_MODULE_PATH);
      let HumanCtor: HumanConstructor | null = null;
      try {
        // Loaded on demand from the extension so pages without head tracking never pay for it.
        const imported = await import(/* @vite-ignore */ humanUrl);
        HumanCtor = imported && imported.default ? imported.default : imported.Human || imported;
        if (typeof HumanCtor !== 'function') {
          throw new Error('Invalid Human.js export');
        }
      } catch (error) {
        console.error('[GazeCore] Failed to import Human.js bundle:', error);
        dispatchStatus('ready', 'Install gaze/human assets to enable gaze tracking');
        throw new Error('Human.js bundle not vendored. Copy dist/human.esm.js into gaze/human/human.esm.js');
      }

      const instance = new HumanCtor({
        backend: 'webgl',
        modelBasePath: chrome.runtime.getURL(HUMAN_MODELS_DIR),
        cacheSensitivity: 0,
        face: {
          enabled: true,
          detector: { enabled: true, rotation: true, return: true, maxDetected: 1 },
          mesh: { enabled: true },
          iris: { enabled: false },
          // Nutshell passed bare `false` here; Human expects `{ enabled }`. Same result: off.
          attention: { enabled: false },
          description: { enabled: false },
          emotion: { enabled: true },
          antispoof: { enabled: false },
          liveness: { enabled: false }
        },
        filter: {
          enabled: true,
          equalization: false         // Disabled for better FPS (adds 10-20ms)
          // Nutshell also set `temporalSmoothing: 0.5`, which Human 3.3.6 does not have and
          // ignored. Smoothing comes from the One-Euro filter and lerp below.
        }
      });

      human = instance;
      try {
        await instance.load();
        console.log('[GazeCore] Human.js loaded. Config:', {
          emotionEnabled: instance.config.face.emotion,
          allFaceConfig: instance.config.face
        });
      } catch (error) {
        console.error('[GazeCore] Failed to load Human.js models:', error);
        dispatchStatus('ready', 'Model load failed');
        throw error;
      }
      if (typeof instance.warmup === 'function') {
        try {
          await instance.warmup();
        } catch (error) {
          console.debug('[GazeCore] warmup skipped:', error instanceof Error ? error.message : error);
        }
      }

      await ensureVideoStream();

      if (headCal && headCal.version === 2) {
        dispatchStatus('live', 'Head pointer ready');
      } else {
        dispatchStatus('ready', 'Press Alt+H to calibrate head pointer');
      }
      startDetectionLoop();
      return true;
    })();
    return initializationPromise;
  }

  async function ensureVideoStream() {
    if (video && stream) {
      return;
    }
    const el = document.createElement('video');
    video = el;
    el.style.position = 'fixed';
    el.style.top = '-10000px';
    el.style.left = '-10000px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;
    document.body.appendChild(el);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      });
      el.srcObject = stream;
      await el.play();
    } catch (error) {
      console.error('[GazeCore] Camera access denied:', error);
      dispatchStatus('ready', 'Camera access rejected');
      throw error;
    }
  }

  function startDetectionLoop() {
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (videoFrameHandle && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(videoFrameHandle);
      videoFrameHandle = null;
    }
    const startVideo = video;
    if (!human || !startVideo) {
      return;
    }
    if (typeof startVideo.requestVideoFrameCallback === 'function') {
      const onFrame = async () => {
        const currentVideo = video;
        const detector = human;
        if (!detector || !currentVideo) {
          videoFrameHandle = null;
          return;
        }

        // Request next frame immediately (don't wait for AI inference)
        const nextVideo = video;
        if (nextVideo && typeof nextVideo.requestVideoFrameCallback === 'function') {
          videoFrameHandle = nextVideo.requestVideoFrameCallback(onFrame);
        } else {
          videoFrameHandle = null;
        }

        // Draw preview EVERY FRAME (not every 10th detection)
        // This gives smooth 30fps preview instead of 0.8fps
        previewFrameCount++;
        if (previewFrameCount % 3 === 0) {
          drawPreview(window.__lastFace || null);
        }

        // Skip this frame if previous detection still in progress
        if (detectInProgress) {
          framesSkipped++;
          return;
        }

        detectInProgress = true;
        try {
          const startTs = performance.now();
          const result = await detector.detect(currentVideo);
          recordDetectDuration(performance.now() - startTs);
          processDetection(result, startTs);
        } catch (error) {
          console.warn('[GazeCore] detect failed:', error);
        } finally {
          detectInProgress = false;
        }
      };
      videoFrameHandle = startVideo.requestVideoFrameCallback(onFrame);
    } else {
      const step = async () => {
        const currentVideo = video;
        const detector = human;
        if (!detector || !currentVideo) {
          rafHandle = null;
          return;
        }

        // Request next frame immediately (don't wait for AI inference)
        if (video && human) {
          rafHandle = requestAnimationFrame(step);
        } else {
          rafHandle = null;
        }

        // Draw preview EVERY FRAME (not every 10th detection)
        previewFrameCount++;
        if (previewFrameCount % 3 === 0) {
          drawPreview(window.__lastFace || null);
        }

        // Skip this frame if previous detection still in progress
        if (detectInProgress) {
          framesSkipped++;
          return;
        }

        try {
          if (currentVideo.readyState >= 2) {
            detectInProgress = true;
            const startTs = performance.now();
            const result = await detector.detect(currentVideo);
            recordDetectDuration(performance.now() - startTs);
            processDetection(result, startTs);
            detectInProgress = false;
          }
        } catch (error) {
          console.warn('[GazeCore] detect failed:', error);
          detectInProgress = false;
        }
      };
      rafHandle = requestAnimationFrame(step);
    }
  }

  function recordDetectDuration(duration: number) {
    detectDurations.push(duration);
    if (detectDurations.length > 30) {
      detectDurations.shift();
    }
    if (detectDurations.length === 30) {
      const avg = detectDurations.reduce((a, b) => a + b, 0) / detectDurations.length;
      console.debug(`[GazeCore] detect() avg: ${avg.toFixed(1)}ms, frames skipped: ${framesSkipped}`);
      detectDurations.length = 0;
      framesSkipped = 0;
    }
  }

  function processDetection(result: Result, ts: number) {
    const face = result && result.face && result.face[0] ? result.face[0] : null;

    // Preview now drawn in frame callback for smooth 10fps (not here at 0.8fps)

    if (!face) {
      headFilterX = null;
      headFilterY = null;
      lastHeadPoint = null;
      headAutoCenter = { nx: headCal && headCal.cx || 0, ny: headCal && headCal.cy || 0, ready: Boolean(headCal) };
      window.__lastFace = null;
      window.__lastHeadFrame = null;
      return;
    }

    window.__lastFace = face;

    const yawRad = Number(face.rotation && face.rotation.angle ? face.rotation.angle.yaw : 0);
    const pitchRad = Number(face.rotation && face.rotation.angle ? face.rotation.angle.pitch : 0);
    const yawDeg = yawRad * (180 / Math.PI);
    const pitchDeg = pitchRad * (180 / Math.PI);

    // Debug: Log rotation data once to check if it's being populated
    if (!window.__rotationLogged) {
      console.debug('[GazeCore] Rotation data:', {
        hasRotation: !!face.rotation,
        hasAngle: !!(face.rotation && face.rotation.angle),
        yawRad, pitchRad, yawDeg, pitchDeg,
        fullRotation: face.rotation
      });
      window.__rotationLogged = true;
    }

    let headFrame = null;
    try {
      headFrame = computeHeadFrame(face);
    } catch (error) {
      if (!headFrameErrorLogged) {
        console.debug('[GazeCore] head-frame compute failed:', error);
        headFrameErrorLogged = true;
      }
      headFrame = null;
    }

    // Always store yawDeg/pitchDeg for preview display, even if headFrame computation fails
    if (headFrame) {
      headFrameErrorLogged = false;
      window.__lastHeadFrame = { nx: headFrame.nx, ny: headFrame.ny, yawDeg, pitchDeg };
      window.dispatchEvent(new CustomEvent('head:frame', {
        detail: { nx: headFrame.nx, ny: headFrame.ny, yawDeg, pitchDeg, ts }
      }));
    } else {
      // Still store rotation data for preview, just no position data
      window.__lastHeadFrame = { nx: 0, ny: 0, yawDeg, pitchDeg };
    }

    // Blink detection disabled - was causing issues and not accurate enough
    // if (Array.isArray(face.mesh)) {
    //   if (!earCal) {
    //     ensureEarCalibration(face.mesh, ts);
    //   } else {
    //     updateBlinkState(face.mesh, ts);
    //   }
    // }

    // Mouth-open detection for click (more reliable than emotion detection)
    if (face.annotations && !window.__gazeHeadCalActive) {
      const mouthRatio = calculateMouthRatio(face.annotations);
      lastMouthRatio = mouthRatio;
      window.__lastMouthRatio = mouthRatio;  // Store globally for preview display and calibration

      // Only detect clicks if calibrated, enabled, and NOT calibrating
      if (mouthCalibration && mouthClickEnabled && !window.__gazeMouthCalActive) {
        const threshold = mouthCalibration.threshold;
        const thresholds = mouthThresholds(mouthCalibration);

        // Debug log mouth ratio - log every 100 frames to see patterns
        if (!window.__mouthFrameCount) window.__mouthFrameCount = 0;
        window.__mouthFrameCount++;
        if (window.__mouthFrameCount % 100 === 0) {
          console.log(`[GazeCore] Mouth stats: MAR=${mouthRatio.toFixed(3)}, threshold=${threshold.toFixed(3)}, calibration=`, mouthCalibration);
        }

        // Research/001, B: freeze on onset, click once, re-arm only after the mouth closes.
        // (Nutshell clicked again every 800 ms while the mouth stayed open.)
        for (const evt of mouthGesture.update(mouthRatio, thresholds, ts)) {
          if (evt === 'onset') {
            window.dispatchEvent(new CustomEvent('mouth:onset', { detail: { ts } }));
          } else if (evt === 'click' && (ts - lastMouthClickTime) > MOUTH_OPEN_COOLDOWN_MS) {
            lastMouthClickTime = ts;
            window.dispatchEvent(new CustomEvent('smile:click', { detail: { mouthRatio, ts } }));
            console.log(`[GazeCore] Mouth click: MAR ${mouthRatio.toFixed(3)} > ${threshold.toFixed(3)}`);
          } else if (evt === 'release' || evt === 'timeout') {
            window.dispatchEvent(new CustomEvent('mouth:release', { detail: { ts } }));
          }
        }
      }
    }

    if (!probePrinted) {
      probeFace(face);
      probePrinted = true;
    }

    lastFaceScore = typeof face.score === 'number' ? face.score : 0.8;
    const now = ts;
    let confidence = Math.min(1, Math.max(0, lastFaceScore));
    let point: Vec2 | null = null;
    let fromHead = false;

    if (window.__gazeHeadMode) {
      if (headFrame) {
        if (!headFilterX || !headFilterY) {
          const preset = MOTION_PRESETS[steadiness];
          headFilterX = createOneEuroFilter(preset.minCutoff, preset.beta);
          headFilterY = createOneEuroFilter(preset.minCutoff, preset.beta);
          lastHeadPoint = null;
        }
        const filterX = headFilterX;
        const filterY = headFilterY;
        let activeCal: HeadCalibration;
        if (headCal && headCal.version === 2) {
          if (headAutoCenter.ready) {
            headAutoCenter.ready = false;
          }
          activeCal = headCal;
        } else {
          if (!headAutoCenter.ready) {
            headAutoCenter = { nx: headFrame.nx, ny: headFrame.ny, ready: true };
          } else {
            headAutoCenter.nx += (headFrame.nx - headAutoCenter.nx) * AUTO_CENTER_ALPHA;
            headAutoCenter.ny += (headFrame.ny - headAutoCenter.ny) * AUTO_CENTER_ALPHA;
          }
          activeCal = {
            ...DEFAULT_HEAD_CAL,
            cx: headAutoCenter.nx,
            cy: headAutoCenter.ny
          };
        }
        const yawNorm = Math.max(-1, Math.min(1, yawDeg / HEAD_YAW_SCALE));
        const pitchNorm = Math.max(-1, Math.min(1, pitchDeg / HEAD_PITCH_SCALE));
        const centerNx = activeCal.cx || 0;
        const centerNy = activeCal.cy || 0;
        const leftRange = Math.max(1e-3, activeCal.left || 0.01);
        const rightRange = Math.max(1e-3, activeCal.right || 0.01);
        const upRange = Math.max(1e-3, activeCal.up || 0.01);
        const downRange = Math.max(1e-3, activeCal.down || 0.01);

        const offsetNx = headFrame.nx - centerNx;
        const offsetNy = headFrame.ny - centerNy;

        let normX = offsetNx < 0 ? offsetNx / leftRange : offsetNx / rightRange;
        const normYTrans = offsetNy < 0 ? offsetNy / upRange : offsetNy / downRange;
        let normY = (pitchDeg / HEAD_PITCH_SCALE) + normYTrans * 0.35;

        const translationRatioX = Math.abs(offsetNx) / (offsetNx < 0 ? leftRange : rightRange);
        const translationRatioY = Math.abs(offsetNy) / (offsetNy < 0 ? upRange : downRange);

        if (Math.abs(normX) < 1) {
          normX += yawNorm * HEAD_ROTATION_INFLUENCE * (1 - Math.min(1, Math.abs(normX)));
        }
        if (Math.abs(normY) < 1) {
          normY += pitchNorm * (HEAD_ROTATION_INFLUENCE * 0.6) * (1 - Math.min(1, Math.abs(normY)));
        }

        if (Math.abs(normY) > HEAD_EDGE_THRESHOLD && translationRatioY < TRANSLATION_MIN_RATIO && Math.abs(pitchNorm) > PITCH_FALLBACK_THRESHOLD) {
          const edgeBlend = HEAD_ROTATION_EDGE_GAIN * Math.sign(pitchNorm);
          normY = Math.max(-1.4, Math.min(1.4, normY + edgeBlend));
        }

        // Pointer speed: below 1 the same head turn moves the pointer less (finer aim,
        // more head movement to reach the edges); above 1 it moves further.
        normX *= pointerSpeed;
        normY *= pointerSpeed;

        normX = Math.max(-1.2, Math.min(1.2, normX));
        normY = Math.max(-1.4, Math.min(1.4, normY));

        const scaledUpRange = upRange * (normY < 0 ? VERTICAL_EDGE_SCALE : 1);
        const scaledDownRange = downRange * (normY > 0 ? VERTICAL_EDGE_SCALE : 1);

        const targetNx = normX < 0 ? centerNx + normX * leftRange : centerNx + normX * rightRange;
        const targetNy = normY < 0 ? centerNy + normY * scaledUpRange : centerNy + normY * scaledDownRange;
        const mapped = mapHeadLocalToXY(targetNx, targetNy, activeCal);
        if (mapped) {
          const filteredX = filterX(mapped[0], ts);
          const filteredY = filterY(mapped[1], ts);
          let finalX = Number.isFinite(filteredX) ? filteredX : mapped[0];
          let finalY = Number.isFinite(filteredY) ? filteredY : mapped[1];
          // Follow rate grows with the distance still to cover (Research/001, D): big head
          // moves arrive quickly instead of trailing and overshooting; small corrections
          // stay smooth. Nutshell used a fixed 6-12 %.
          if (lastHeadPoint) {
            const remaining = Math.hypot(finalX - lastHeadPoint[0], finalY - lastHeadPoint[1]);
            const smoothingAlpha = adaptiveAlpha(remaining, MOTION_PRESETS[steadiness]);
            finalX = lastHeadPoint[0] + smoothingAlpha * (finalX - lastHeadPoint[0]);
            finalY = lastHeadPoint[1] + smoothingAlpha * (finalY - lastHeadPoint[1]);
            lastHeadPoint[0] = finalX;
            lastHeadPoint[1] = finalY;
          } else {
            lastHeadPoint = [finalX, finalY];
          }
          point = [finalX, finalY];
          confidence = Math.max(confidence, 0.9);
          fromHead = true;
          if (!headCal && !headModeWarned) {
            dispatchStatus('live', 'Head pointer (Alt+H to refine)');
            headModeWarned = true;
          } else if (headCal) {
            headModeWarned = false;
          }
        }
      } else if (!headModeWarned) {
        dispatchStatus('ready', 'Need face landmarks for head pointer');
        headModeWarned = true;
      }
    } else {
      headFilterX = null;
      headFilterY = null;
      lastHeadPoint = null;
      headModeWarned = false;
      headFrameErrorLogged = false;
    }
    if (!point) {
      return;
    }

   if (window.__gazeHeadCalActive) {
     lastPointTs = now;
     return;
   }

    // While a mouth click is in progress the pointer holds still (Research/001, B).
    if (mouthGesture.frozen) {
      return;
    }

    if (now - lastPointTs >= POINT_THROTTLE_MS) {
      lastPointTs = now;
      dispatchPoint(point[0], point[1], confidence, now);
    }
  }

  function normalizePoint(point: unknown): Vec2 | null {
    if (!point) return null;
    if (Array.isArray(point) || ArrayBuffer.isView(point)) {
      const list = point as ArrayLike<number>;
      const x = list[0];
      const y = list[1];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return [x, y];
      }
      return null;
    }
    if (typeof point === 'object' && point) {
      const obj = point as { x?: unknown; y?: unknown; 0?: unknown; 1?: unknown };
      const x = Number(obj.x ?? obj[0]);
      const y = Number(obj.y ?? obj[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return [x, y];
      }
    }
    return null;
  }

  function pick(meshInput: MeshLike, idx: number): Vec2 | null {
    if (!meshInput || idx < 0) {
      return null;
    }
    const mesh = meshInput as ArrayLike<unknown> & Record<number, unknown>;
    if (Array.isArray(mesh)) {
      if (idx < mesh.length) {
        const direct = normalizePoint(mesh[idx]);
        if (direct) {
          return direct;
        }
      }
      if (typeof mesh[0] === 'number') {
        const base = idx * 3;
        if (base + 1 < mesh.length) {
          const x = mesh[base] as number;
          const y = mesh[base + 1] as number;
          if (Number.isFinite(x) && Number.isFinite(y)) {
            return [x, y];
          }
        }
      }
      return null;
    }
    if (ArrayBuffer.isView(mesh) && typeof mesh[0] === 'number') {
      const flat = mesh as unknown as ArrayLike<number>;
      const base = idx * 3;
      if (base + 1 < flat.length) {
        const x = flat[base];
        const y = flat[base + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return [x, y];
        }
      }
      return null;
    }
    const raw = mesh[idx];
    return normalizePoint(raw);
  }

  function drawPreview(face: FaceResult | null) {
    if (!previewOn) {
      return;
    }
    const canvas = document.getElementById('gaze-cam') as HTMLCanvasElement | null;
    if (!canvas || canvas.style.display !== 'block') {
      return;
    }
    // Throttling now done in frame callback (every 3rd frame)
    // No need to throttle here anymore
    const ctx = canvas.getContext('2d');
    if (!ctx || !video) {
      return;
    }
    const vw = video.videoWidth || canvas.width || 320;
    const vh = video.videoHeight || canvas.height || 240;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -vw, 0, vw, vh);
    ctx.restore();

    if (!face) {
      return;
    }

    // Draw face box
    if (face.box) {
      const box = face.box;
      const x = Math.max(0, Math.min(vw, box[0]));
      const y = Math.max(0, Math.min(vh, box[1]));
      const w = Math.max(1, box[2]);
      const h = Math.max(1, box[3]);
      ctx.strokeStyle = 'rgba(0,255,180,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vw - x - w, y, w, h);
    }

    // Draw head tracking points
    const headFrame = window.__lastHeadFrame;
    if (headFrame && Array.isArray(face.mesh) && face.mesh.length) {
      // Get eye centers
      const leftEye = resolvePoint(face.mesh, face.annotations, LEFT_EYE_CANDIDATES, ['leftEyeUpper0', 'leftEyeLower0']);
      const rightEye = resolvePoint(face.mesh, face.annotations, RIGHT_EYE_CANDIDATES, ['rightEyeUpper0', 'rightEyeLower0']);
      const nose = resolvePoint(face.mesh, face.annotations, NOSE_CANDIDATES, ['noseTip']);

      const drawPoint = (pt: Vec2 | null, color: string, radius: number) => {
        if (!pt) return;
        let px = pt[0];
        let py = pt[1];
        if (Math.abs(px) <= 1 && Math.abs(py) <= 1) {
          px = (px + 0.5) * vw;
          py = (py + 0.5) * vh;
        }
        if (Number.isFinite(px) && Number.isFinite(py)) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(vw - px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      // Draw landmarks
      drawPoint(leftEye, 'rgba(0,150,255,0.8)', 4);
      drawPoint(rightEye, 'rgba(0,150,255,0.8)', 4);
      drawPoint(nose, 'rgba(0,255,100,0.9)', 5);

      // Draw debug text with rotation angles
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 16px monospace';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      // headFrame is window.__lastHeadFrame from line 1026

      // Debug: Log what we're trying to display (only once)
      if (!window.__displayDebugLogged) {
        console.debug('[GazeCore] Preview display data:', {
          headFrame,
          hasYaw: 'yawDeg' in (headFrame || {}),
          hasPitch: 'pitchDeg' in (headFrame || {}),
          yawValue: headFrame?.yawDeg,
          pitchValue: headFrame?.pitchDeg
        });
        window.__displayDebugLogged = true;
      }

      const yawDeg = (headFrame && typeof headFrame.yawDeg === 'number') ? headFrame.yawDeg : 0;
      const pitchDeg = (headFrame && typeof headFrame.pitchDeg === 'number') ? headFrame.pitchDeg : 0;
      // Hidden for now: Yaw/Pitch display
      // ctx.fillText(`Yaw: ${yawDeg.toFixed(1)}°`, 10, 24);
      // ctx.fillText(`Pitch: ${pitchDeg.toFixed(1)}°`, 10, 48);

      // Display mouth-open ratio for debugging
      const mouthRatio = window.__lastMouthRatio || 0;
      const threshold = mouthCalibration ? mouthCalibration.threshold : 0.5;
      const isMouthOpen = mouthCalibration && mouthClickEnabled && mouthRatio > threshold;
      const calibrated = mouthCalibration ? '✓' : '✗';
      const enabled = mouthClickEnabled ? '' : ' (OFF)';

      if (!mouthClickEnabled) {
        ctx.fillStyle = 'rgba(150,150,150,0.95)'; // Gray when disabled
      } else if (isMouthOpen) {
        ctx.fillStyle = 'rgba(0,255,100,1)'; // Green when clicking
      } else if (mouthCalibration) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; // White when calibrated
      } else {
        ctx.fillStyle = 'rgba(255,100,100,0.95)'; // Red when not calibrated
      }

      ctx.fillText(`Mouth${calibrated}: ${(mouthRatio * 100).toFixed(0)}%${isMouthOpen ? ' CLICK!' : ''}${enabled}`, 10, 24);
      ctx.shadowBlur = 0;
    } else if (headFrame) {
      // Draw rotation even without face mesh landmarks
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 16px monospace';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      const yawDeg = typeof headFrame.yawDeg === 'number' ? headFrame.yawDeg : 0;
      const pitchDeg = typeof headFrame.pitchDeg === 'number' ? headFrame.pitchDeg : 0;
      // Hidden for now: Yaw/Pitch display
      // ctx.fillText(`Yaw: ${yawDeg.toFixed(1)}°`, 10, 24);
      // ctx.fillText(`Pitch: ${pitchDeg.toFixed(1)}°`, 10, 48);

      // Display mouth-open ratio for debugging
      const mouthRatio = window.__lastMouthRatio || 0;
      const threshold = mouthCalibration ? mouthCalibration.threshold : 0.5;
      const isMouthOpen = mouthCalibration && mouthClickEnabled && mouthRatio > threshold;
      const calibrated = mouthCalibration ? '✓' : '✗';
      const enabled = mouthClickEnabled ? '' : ' (OFF)';

      if (!mouthClickEnabled) {
        ctx.fillStyle = 'rgba(150,150,150,0.95)'; // Gray when disabled
      } else if (isMouthOpen) {
        ctx.fillStyle = 'rgba(0,255,100,1)'; // Green when clicking
      } else if (mouthCalibration) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; // White when calibrated
      } else {
        ctx.fillStyle = 'rgba(255,100,100,0.95)'; // Red when not calibrated
      }

      ctx.fillText(`Mouth${calibrated}: ${(mouthRatio * 100).toFixed(0)}%${isMouthOpen ? ' CLICK!' : ''}${enabled}`, 10, 24);
      ctx.shadowBlur = 0;
    }
  }

  function probeFace(face: FaceResult) {
    try {
      const annotationKeys = Object.keys(face.annotations || {}).slice(0, 20);
      console.debug('[GazeCore] face keys:', Object.keys(face));
      console.debug('[GazeCore] annotations keys:', annotationKeys);
      console.debug('[GazeCore] mesh length:', Array.isArray(face.mesh) ? face.mesh.length : 'n/a');
      console.debug('[GazeCore] rotation angle:', face.rotation && face.rotation.angle);
    } catch (error) {
      console.debug('[GazeCore] probeFace failed:', error);
    }
  }

  function teardown() {
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    if (videoFrameHandle && video && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(videoFrameHandle);
      videoFrameHandle = null;
    }
    if (stream) {
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop());
      stream = null;
    }
    if (video && video.parentElement) {
      video.srcObject = null;
      video.parentElement.removeChild(video);
      video = null;
    }

    // Reset initialization state so re-enabling works properly
    initializationPromise = null;
    human = null;
    detectInProgress = false;

    // Reset detection tracking
    framesSkipped = 0;
    detectDurations = [];
    probePrinted = false;
  }

  function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string) {
    if (areaName !== 'local') return;
    if (changes[GAZE_ENABLED_KEY]) {
      gazeEnabled = Boolean(changes[GAZE_ENABLED_KEY].newValue);
      if (gazeEnabled) {
        dispatchStatus('loading', 'Initializing...');
        ensureInitialized().catch(() => {});
      } else {
        // Disable head tracking
        teardown();
        dispatchStatus('ready', 'Disabled');
      }
    }
    if (changes[HEAD_CAL_STORAGE_KEY]) {
      headCal = changes[HEAD_CAL_STORAGE_KEY].newValue || null;
      headFilterX = null;
      headFilterY = null;
      lastHeadPoint = null;
      headModeWarned = false;
      headAutoCenter = { nx: headCal && headCal.cx || 0, ny: headCal && headCal.cy || 0, ready: Boolean(headCal) };
      if (headCal) {
        const centerX = Math.round((window.innerWidth || 1) / 2);
        const centerY = Math.round((window.innerHeight || 1) / 2);
        lastHeadPoint = [centerX, centerY];
        lastPointTs = performance.now();
        dispatchPoint(centerX, centerY, 0.9, lastPointTs);
      }
    } else if (changes.headCalV1) {
      console.debug('[GazeCore] Ignoring legacy head calibration; please recalibrate.');
    }
    if (changes[EAR_CAL_STORAGE_KEY] && changes[EAR_CAL_STORAGE_KEY].newValue) {
      earCal = changes[EAR_CAL_STORAGE_KEY].newValue;
      earCalStage = earCal && earCal.version === 2 ? 'done' : 'idle';
    } else if (changes.earCalV1 && changes.earCalV1.newValue) {
      console.debug('[GazeCore] Ignoring legacy blink calibration; will rebuild.');
    }
    if (changes.gazeSpeed) {
      pointerSpeed = clampSpeed(changes.gazeSpeed.newValue);
    }
    if (changes.gazeSteadiness) {
      steadiness = asSteadiness(changes.gazeSteadiness.newValue);
      headFilterX = null; // rebuilt with the new preset on the next frame
      headFilterY = null;
    }
    if (changes.mouthClickEnabled) {
      mouthGesture.reset();
      mouthClickEnabled = changes.mouthClickEnabled.newValue || false;
      console.log('[GazeCore] Mouth click enabled changed to:', mouthClickEnabled);
    }
  }

  function handleVisibilityChange() {
    // no-op; head filters automatically reset when face is lost
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener('beforeunload', teardown);

  window.addEventListener('head:calibrated', (event) => {
    if (!event.detail) return;
    headCal = event.detail;
    headFilterX = null;
    headFilterY = null;
    lastHeadPoint = null;
    headModeWarned = false;
    headAutoCenter = { nx: headCal && headCal.cx || 0, ny: headCal && headCal.cy || 0, ready: true };
    const centerX = Math.round((window.innerWidth || 1) / 2);
    const centerY = Math.round((window.innerHeight || 1) / 2);
    lastHeadPoint = [centerX, centerY];
    lastPointTs = performance.now();
    dispatchPoint(centerX, centerY, 0.95, lastPointTs);
  });

  (() => {
    const canvas = document.getElementById('gaze-cam');
    if (canvas && canvas.style.display === 'block') {
      previewOn = true;
    }
  })();

  // Listen for mouth calibration completion
  window.addEventListener('mouth-cal:complete', (event) => {
    const cal = event.detail;
    console.log('[GazeCore] Mouth calibration received:', cal);
    mouthCalibration = cal;
  });

  storageGet([GAZE_ENABLED_KEY, HEAD_CAL_STORAGE_KEY, EAR_CAL_STORAGE_KEY, 'mouthCalV1', 'mouthClickEnabled', 'headCalV1', 'earCalV1', 'gazeSpeed', 'gazeSteadiness']).then((store) => {
    pointerSpeed = clampSpeed(store.gazeSpeed);
    steadiness = asSteadiness(store.gazeSteadiness);
    if (store[HEAD_CAL_STORAGE_KEY]) {
      headCal = store[HEAD_CAL_STORAGE_KEY] as HeadCalibration;
      headModeWarned = false;
      headFrameErrorLogged = false;
      headFilterX = null;
      headFilterY = null;
      lastHeadPoint = null;
      headAutoCenter = { nx: headCal && headCal.cx || 0, ny: headCal && headCal.cy || 0, ready: Boolean(headCal) };
      const centerX = Math.round((window.innerWidth || 1) / 2);
      const centerY = Math.round((window.innerHeight || 1) / 2);
      lastHeadPoint = [centerX, centerY];
      lastPointTs = performance.now();
      dispatchPoint(centerX, centerY, 0.9, lastPointTs);
    } else if (store.headCalV1) {
      console.debug('[GazeCore] Legacy head calibration detected; run Alt+H to refresh.');
    }

    if (store[EAR_CAL_STORAGE_KEY]) {
      earCal = store[EAR_CAL_STORAGE_KEY] as EarCalibration;
      earCalStage = earCal && earCal.version === 2 ? 'done' : 'idle';
    }

    if (store.mouthCalV1) {
      mouthCalibration = store.mouthCalV1 as MouthCalibration;
      console.log('[GazeCore] Loaded mouth calibration:', mouthCalibration);
    }

    if (typeof store.mouthClickEnabled === 'boolean') {
      mouthClickEnabled = store.mouthClickEnabled;
      console.log('[GazeCore] Mouth click enabled:', mouthClickEnabled);
    }

    if (typeof store[GAZE_ENABLED_KEY] === 'boolean') {
      gazeEnabled = store[GAZE_ENABLED_KEY];
    } else {
      gazeEnabled = false;
      storageSet({ [GAZE_ENABLED_KEY]: false });
    }

    if (gazeEnabled) {
      ensureInitialized().catch(() => {});
    } else {
      dispatchStatus('ready', 'Turn on the head pointer to start');
    }
  });
})();

export {};
