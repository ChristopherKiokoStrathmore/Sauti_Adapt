// The contract between Headway's content scripts.
// Content scripts share one isolated-world `window`, so the gaze modules talk
// through these CustomEvents and a few `window.__*` fields. Typing them here
// keeps every producer and consumer honest.

type FaceResult = import('@vladmandic/human').FaceResult;
type CaptionData = import('../shared/types').CaptionData;

type Vec2 = [number, number];

interface HeadPose {
  nx: number;
  ny: number;
}

interface HeadFrame extends HeadPose {
  yaw?: number;
  pitch?: number;
  yawDeg?: number;
  pitchDeg?: number;
}

interface HeadCalibration {
  cx: number;
  cy: number;
  left: number;
  right: number;
  up: number;
  down: number;
  version: number;
  ts: number;
  poseCenter?: HeadPose;
  poseLeft?: HeadPose;
  poseRight?: HeadPose;
  poseUp?: HeadPose;
  poseDown?: HeadPose;
}

interface MouthCalibration {
  version?: number;
  closedRatio: number;
  openRatio: number;
  threshold: number;
  timestamp?: number;
}

interface EarCalibration {
  version: number;
  Lopen: number;
  Ropen: number;
  Lclosed: number;
  Rclosed: number;
  Lclose: number;
  Rclose: number;
  LopenTh: number;
  RopenTh: number;
  ts: number;
}

interface GazeStatusDetail {
  phase: string;
  note?: string | null;
}

interface GazePointDetail {
  x: number;
  y: number;
  conf?: number;
  ts?: number;
}

interface WindowEventMap {
  'gaze:status': CustomEvent<GazeStatusDetail>;
  'gaze:point': CustomEvent<GazePointDetail>;
  'gaze:preview-toggle': CustomEvent<{ on: boolean }>;
  'gaze:dwell': CustomEvent<{ progress: number }>;
  'gaze:calibration-started': CustomEvent<undefined>;
  'gaze:calibration-stopped': CustomEvent<undefined>;
  'head:frame': CustomEvent<HeadFrame & { ts: number }>;
  'head:calibrated': CustomEvent<HeadCalibration>;
  'blink:start': CustomEvent<{ timestamp: number }>;
  'blink:hold': CustomEvent<{ duration: number }>;
  'blink:released': CustomEvent<{ duration: number; timestamp: number }>;
  'blink:click': CustomEvent<{ button: 'left' | 'right' }>;
  'smile:click': CustomEvent<{ mouthRatio: number; ts: number }>;
  'mouth:onset': CustomEvent<{ ts: number }>;
  'mouth:release': CustomEvent<{ ts: number }>;
  'mouth-cal:start': Event;
  'mouth-cal:complete': CustomEvent<MouthCalibration>;
  'youtube-captions-ready': CustomEvent<{ videoId: string; captionCount: number }>;
  'yt-captions-available': CustomEvent<{ videoId: string; captionCount: number }>;
}

interface Window {
  // gaze state shared between gaze modules
  __gazeHeadMode?: boolean;
  __gazeHeadCalActive?: boolean;
  __gazeMouthCalActive?: boolean;
  __gazeOverlayInitialized?: boolean;
  __gazeHeadCalInitialized?: boolean;
  __lastHeadFrame?: HeadFrame | null;
  __lastFace?: FaceResult | null;
  __lastMouthRatio?: number;
  __mouthCalOpen?: number;
  __mouthCalClosed?: number;
  __mouthCalInterval?: ReturnType<typeof setInterval> | null;
  __mouthFrameCount?: number;
  // one-shot debug latches
  __mouthDebug1?: boolean;
  __mouthDebug2?: boolean;
  __mouthDebug3?: boolean;
  __mouthDebug4?: boolean;
  __mouthDebug5?: boolean;
  __rotationLogged?: boolean;
  __displayDebugLogged?: boolean;
  startMouthCalibration?: () => void;

  // YouTube bridge (isolated world) and caption handler (page world)
  getYouTubeCaptions?: (videoId: string) => Promise<CaptionData | null>;
  hasYouTubeCaptions?: (videoId: string) => Promise<boolean>;
  __ytGetCaptions?: (videoId: string) => unknown;
  __ytHasCaptions?: (videoId: string) => boolean;
  __ytClearCache?: () => void;

  // Twitter interceptor (page world)
  __hoverTwitterInterceptorInstalled?: boolean;
}

declare module '*.css';
