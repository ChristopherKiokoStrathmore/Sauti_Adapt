'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cursorFromHead, readFaceSignals, type DemoFace, type FaceSignals } from '@/lib/headway-demo';
import { MouthGesture, mouthThresholds } from '../../headway/src/gaze/mouth-gesture';
import { adaptiveAlpha, MOTION_PRESETS, type Steadiness } from '../../headway/src/gaze/motion';
import { closestSnapIndex, headDirection, MOUTH_CLICK_COOLDOWN_MS, nextSnapIndex, SNAP_MIN_INTERVAL_MS, type SnapDirection } from '@/lib/headway-snap';

type Phase = 'off' | 'requesting' | 'loading' | 'active' | 'paused' | 'error';
type ClickMode = 'dwell' | 'mouth';
type NavigationMode = 'snap' | 'free';
type HumanLike = { load: () => Promise<unknown>; detect: (video: HTMLVideoElement) => Promise<{ face?: DemoFace[] }> };
type HumanConstructor = new (config: Record<string, unknown>) => HumanLike;
declare global { interface Window { __HeadwayHumanConstructor?: HumanConstructor } }

type HeadwayState = {
  phase: Phase;
  message: string;
  detected: boolean;
  clickMode: ClickMode;
  navigationMode: NavigationMode;
  sensitivity: number;
  steadiness: Steadiness;
  calibration: string;
  start: () => Promise<void>;
  stop: () => void;
  togglePause: () => void;
  recenter: () => void;
  beginMouthCalibration: () => void;
  setClickMode: (value: ClickMode) => void;
  setNavigationMode: (value: NavigationMode) => void;
  setSensitivity: (value: number) => void;
  setSteadiness: (value: Steadiness) => void;
};

const HeadwayContext = createContext<HeadwayState | null>(null);
export function useHeadway() {
  const value = useContext(HeadwayContext);
  if (!value) throw new Error('HeadwayProvider must be mounted');
  return value;
}

function ensureHuman(): Promise<HumanConstructor> {
  if (window.__HeadwayHumanConstructor) return Promise.resolve(window.__HeadwayHumanConstructor);
  return new Promise((resolve, reject) => {
    // Remove an old failed loader before retrying. Loading the module itself is
    // asynchronous, so script.onerror alone cannot capture evaluation errors.
    document.querySelector<HTMLScriptElement>('script[data-headway-human]')?.remove();
    const tag = document.createElement('script');
    tag.src = '/headway-demo/loader.js';
    tag.type = 'module';
    tag.dataset.headwayHuman = 'true';

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('headway-human-ready', finished);
      window.removeEventListener('headway-human-error', failed);
    };
    const fail = (reason: string) => {
      cleanup();
      tag.remove();
      reject(new Error(reason));
    };
    const finished = () => {
      const ctor = window.__HeadwayHumanConstructor;
      if (typeof ctor !== 'function') {
        fail('Headway model finished loading but no constructor was available.');
        return;
      }
      cleanup();
      resolve(ctor);
    };
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      fail('Unable to load the Headway face model: ' + (detail || 'unknown module error'));
    };
    const timeout = window.setTimeout(() => fail('Headway model loading timed out. Check the browser console and retry.'), 45_000);
    window.addEventListener('headway-human-ready', finished, { once: true });
    window.addEventListener('headway-human-error', failed, { once: true });
    tag.onerror = () => fail('Headway model loader could not be fetched.');
    document.head.appendChild(tag);
  });
}

const SAFE_SELECTORS = 'button, a[href], summary, [data-headway-action], .aw-radio, label[for], .aw-form input[type="text"], .aw-form input[type="radio"], .aw-form input[type="checkbox"]';

function permittedTarget(element: HTMLElement): boolean {
  // The website must never control admin pages or unrelated browser tabs.
  if (window.location.pathname !== '/' && window.location.pathname !== '/workspace') return false;
  if (!element.isConnected || element.closest('[data-headway-ignore], [hidden], [inert]')) return false;
  if (element.matches(':disabled, [aria-disabled="true"]')) return false;
  if (element.matches('input') && !element.closest('.aw-form')) return false;
  if (element.matches('input[type="radio"], input[type="checkbox"]') && element.closest('label')) return false;
  const details = element.closest('details:not([open])');
  if (details && !element.matches('summary') && !element.closest('summary')) return false;
  if (element.matches('a')) {
    const href = element.getAttribute('href');
    if (!href || element.hasAttribute('download') || href.startsWith('javascript:')) return false;
    try {
      if (new URL(href, window.location.href).origin !== window.location.origin) return false;
    } catch { return false; }
  }
  const name = (element.getAttribute('aria-label') || element.textContent || '').trim().toLowerCase();
  if (/delete|remove|purchase|checkout|pay now|sign out|logout|start recording|stop recording|enable camera|grant permission|confirm consent/.test(name)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) return false;
  const rect = element.getBoundingClientRect();
  return rect.width >= 10 && rect.height >= 10;
}

function candidateAt(x: number, y: number): HTMLElement | null {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  const candidate = element?.closest<HTMLElement>(SAFE_SELECTORS);
  return candidate && permittedTarget(candidate) ? candidate : null;
}

function snapCandidates(): HTMLElement[] {
  if (window.location.pathname !== '/' && window.location.pathname !== '/workspace') return [];
  return [...document.querySelectorAll<HTMLElement>(SAFE_SELECTORS)].filter(permittedTarget);
}

function targetLabel(element: HTMLElement): string {
  return (element.getAttribute('aria-label') || element.textContent?.trim() || 'control').slice(0, 50);
}

export function HeadwayProvider({ children }: { children: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const model = useRef<HumanLike | null>(null);
  const enabled = useRef(false);
  const paused = useRef(false);
  const startToken = useRef(0);
  const frame = useRef<number | null>(null);
  const latest = useRef<FaceSignals | null>(null);
  const center = useRef<FaceSignals | null>(null);
  const point = useRef({ x: 0.5, y: 0.5 });
  const previousFace = useRef(false);
  const target = useRef<HTMLElement | null>(null);
  const dwell = useRef({ element: null as HTMLElement | null, since: 0, fired: false });
  const lastPaint = useRef(0);
  const modeRef = useRef<ClickMode>('mouth');
  const navigationRef = useRef<NavigationMode>('snap');
  const directionArmed = useRef(true);
  const lastDirectionAt = useRef(0);
  const lastMouthClickAt = useRef(-Number.POSITIVE_INFINITY);
  const automaticMouthSamples = useRef<number[]>([]);
  const mouthBaselineReady = useRef(false);
  const speedRef = useRef(1);
  const steadyRef = useRef<Steadiness>('medium');
  const mouth = useRef(new MouthGesture());
  const mouthCalPhase = useRef<'idle' | 'closed' | 'open'>('idle');
  const mouthSamples = useRef<number[]>([]);
  const closedRatio = useRef<number | null>(null);
  const calibration = useRef<{ closedRatio: number; openRatio: number } | null>(null);

  const [phase, setPhase] = useState<Phase>('off');
  const [message, setMessage] = useState('Headway is off. Camera access has not been requested.');
  const [detected, setDetected] = useState(false);
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 });
  const [progress, setProgress] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [clickMode, setClickModeState] = useState<ClickMode>('mouth');
  const [navigationMode, setNavigationModeState] = useState<NavigationMode>('snap');
  const [sensitivity, setSensitivityState] = useState(1);
  const [steadiness, setSteadinessState] = useState<Steadiness>('medium');
  const [calibrationStatus, setCalibrationStatus] = useState('Keep your mouth relaxed briefly to set up automatic mouth selection.');

  const release = useCallback(() => {
    enabled.current = false;
    paused.current = false;
    startToken.current += 1;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    media.current?.getTracks().forEach(track => track.stop());
    media.current = null;
    if (video.current) video.current.srcObject = null;
    model.current = null;
    center.current = null;
    latest.current = null;
    previousFace.current = false;
    target.current?.classList.remove('hw-target', 'hw-snap-target');
    target.current = null;
    mouth.current.reset();
    directionArmed.current = true;
    lastDirectionAt.current = 0;
    lastMouthClickAt.current = -Number.POSITIVE_INFINITY;
    automaticMouthSamples.current = [];
    mouthBaselineReady.current = false;
    calibration.current = null;
    mouthCalPhase.current = 'idle';
    dwell.current = { element: null, since: 0, fired: false };
  }, []);

  const stop = useCallback(() => {
    release();
    setPhase('off');
    setDetected(false);
    setProgress(0);
    setMessage('Headway stopped. Camera access and tracking have ended.');
    setCalibrationStatus('Keep your mouth relaxed briefly to set up automatic mouth selection.');
  }, [release]);

  const detectLoop = useCallback(async () => {
    if (!enabled.current || !model.current || !video.current) return;
    const t = performance.now();
    try {
      if (paused.current || document.hidden || video.current.readyState < 2) return;
      const result = await model.current.detect(video.current);
      if (!enabled.current || paused.current) return;
      const faces = result.face || [];
      if (faces.length !== 1) {
        if (previousFace.current) {
          setDetected(false);
          setMessage(faces.length > 1 ? 'Multiple faces detected. Interaction paused.' : 'Face lost. Interaction paused.');
        }
        previousFace.current = false;
        dwell.current = { element: null, since: 0, fired: false };
        mouth.current.reset();
        setProgress(0);
        target.current?.classList.remove('hw-target');
        target.current = null;
        return;
      }
      const reading = readFaceSignals(faces[0], video.current.videoWidth, video.current.videoHeight);
      if (!reading) return;
      latest.current = reading;
      if (!previousFace.current) { setDetected(true); setMessage('Face detected. Headway is tracking locally.'); }
      previousFace.current = true;
      if (!center.current) center.current = reading;

      // Establish a safe starting baseline automatically. This is NOT a timed click:
      // once a closed-mouth baseline is available, opening past threshold selects
      // in the same detection frame. Manual calibration remains optional.
      if (!calibration.current && mouthCalPhase.current === 'idle' && reading.mouth !== null) {
        const values = automaticMouthSamples.current;
        values.push(reading.mouth);
        if (values.length >= 8) {
          const sorted = values.slice().sort((x, y) => x - y);
          const closed = sorted[Math.floor(sorted.length / 2)];
          automaticMouthSamples.current = [];
          if (closed < 0.5) {
            const requiredOpening = Math.max(0.055, closed * 0.3);
            // The existing gesture module clicks at 70% of the calibrated range.
            calibration.current = { closedRatio: closed, openRatio: closed + requiredOpening / 0.7 };
            mouthBaselineReady.current = true;
            mouth.current.reset();
            setCalibrationStatus('Mouth ready. Open your mouth to select the highlighted target. Close to reset.');
          } else {
            setCalibrationStatus('Relax and close your mouth briefly to establish a baseline.');
          }
        }
      }

      if (mouthCalPhase.current !== 'idle' && reading.mouth !== null) {
        mouthSamples.current.push(reading.mouth);
        if (mouthSamples.current.length >= 18) {
          const average = mouthSamples.current.reduce((x, y) => x + y, 0) / mouthSamples.current.length;
          mouthSamples.current = [];
          if (mouthCalPhase.current === 'closed') {
            closedRatio.current = average;
            mouthCalPhase.current = 'open';
            setCalibrationStatus('Now open your mouth comfortably and hold for the next samples.');
          } else {
            const closed = closedRatio.current;
            mouthCalPhase.current = 'idle';
            if (closed !== null && average - closed >= 0.035) {
              calibration.current = { closedRatio: closed, openRatio: average };
              mouthBaselineReady.current = true;
              mouth.current.reset();
              setCalibrationStatus('Manual mouth calibration complete. Open to select, close to reset.');
            } else {
              calibration.current = null;
              automaticMouthSamples.current = [];
              mouthBaselineReady.current = false;
              setCalibrationStatus('Calibration was not distinct enough. Relax your mouth and retry.');
            }
          }
        }
      }

      let current: HTMLElement | null = null;
      if (navigationRef.current === 'snap') {
        if (!target.current?.isConnected || !permittedTarget(target.current)) {
          const candidates = snapCandidates();
          const boxes = candidates.map(element => element.getBoundingClientRect());
          const initial = closestSnapIndex(boxes, window.innerWidth, window.innerHeight);
          target.current?.classList.remove('hw-target', 'hw-snap-target');
          target.current = initial >= 0 ? candidates[initial] : null;
          target.current?.classList.add('hw-target', 'hw-snap-target');
          dwell.current = { element: target.current, since: t, fired: false };
        }
        if (center.current && !mouth.current.frozen) {
          const dx = reading.horizontal - center.current.horizontal;
          const dy = reading.vertical - center.current.vertical;
          const direction = headDirection(dx, dy, speedRef.current);
          if (direction === 'neutral') directionArmed.current = true;
          if (direction && direction !== 'neutral' && directionArmed.current &&
            t - lastDirectionAt.current > SNAP_MIN_INTERVAL_MS) {
            directionArmed.current = false;
            lastDirectionAt.current = t;
            const candidates = snapCandidates();
            const boxes = candidates.map(element => element.getBoundingClientRect());
            const oldIndex = candidates.indexOf(target.current!);
            const nextIndex = nextSnapIndex(boxes, oldIndex, direction as SnapDirection);
            if (nextIndex >= 0) {
              target.current?.classList.remove('hw-target', 'hw-snap-target');
              target.current = candidates[nextIndex];
              target.current.classList.add('hw-target', 'hw-snap-target');
              target.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
              dwell.current = { element: target.current, since: t, fired: false };
              setProgress(0);
              setMessage('Magnetic target: ' + targetLabel(target.current) + '. Open mouth to select.');
            }
          }
        }
        current = target.current;
        if (current) {
          // React can replace an element's className after a button changes state.
          // Keep the magnetic target visibly locked even through such rerenders.
          current.classList.add('hw-target', 'hw-snap-target');
          const bounds = current.getBoundingClientRect();
          point.current = {
            x: Math.min(0.98, Math.max(0.02, (bounds.left + bounds.width / 2) / window.innerWidth)),
            y: Math.min(0.98, Math.max(0.02, (bounds.top + bounds.height / 2) / window.innerHeight)),
          };
        }
      } else {
        if (!mouth.current.frozen && center.current) {
          const desired = cursorFromHead(reading, center.current, speedRef.current, false);
          const dx = (desired.x - point.current.x) * window.innerWidth;
          const dy = (desired.y - point.current.y) * window.innerHeight;
          const smoothing = adaptiveAlpha(Math.hypot(dx, dy), MOTION_PRESETS[steadyRef.current]);
          point.current = {
            x: point.current.x + (desired.x - point.current.x) * smoothing,
            y: point.current.y + (desired.y - point.current.y) * smoothing,
          };
        }
        const x = Math.round(point.current.x * window.innerWidth);
        const y = Math.round(point.current.y * window.innerHeight);
        current = candidateAt(x, y);
        if (current !== target.current) {
          target.current?.classList.remove('hw-target', 'hw-snap-target');
          target.current = current;
          current?.classList.add('hw-target');
          dwell.current = { element: current, since: t, fired: false };
          setProgress(0);
        }
      }

      // Dwell is an optional alternative, never the default.
      if (modeRef.current === 'dwell' && current && !dwell.current.fired) {
        const amount = Math.min(1, (t - dwell.current.since) / 1400);
        if (amount >= 1) {
          dwell.current.fired = true;
          if (current.matches('input')) current.focus(); else current.click();
          setMessage('Selected ' + targetLabel(current) + '.');
          setProgress(0);
        } else if (t - lastPaint.current >= 65) {
          setProgress(amount);
        }
      }

      // This uses the unmodified Headway mouth state machine. It fires on opening,
      // never after a 1.4-second dwell, and requires closing before another click.
      if (modeRef.current === 'mouth' && mouthCalPhase.current === 'idle' &&
        calibration.current && reading.mouth !== null) {
        const thresholds = mouthThresholds(calibration.current);
        const actions = mouth.current.update(reading.mouth, thresholds, t);
        if (current && actions.includes('click') && t - lastMouthClickAt.current >= MOUTH_CLICK_COOLDOWN_MS) {
          lastMouthClickAt.current = t;
          if (current.matches('input')) current.focus(); else current.click();
          setMessage('Mouth selected ' + targetLabel(current) + '. Close your mouth to select again.');
        }
      }

      if (t - lastPaint.current >= 65) {
        lastPaint.current = t;
        setCursor({ ...point.current });
      }
    } catch (error) {
      if (enabled.current) {
        paused.current = true;
        setPhase('paused');
        setMessage('Tracking paused: ' + (error instanceof Error ? error.message : 'model error') + '.');
      }
    } finally {
      if (enabled.current) frame.current = requestAnimationFrame(() => { void detectLoop(); });
    }
  }, []);

  const start = useCallback(async () => {
    if (enabled.current) return;
    const token = ++startToken.current;
    setPanelCollapsed(false);
    point.current = { x: 0.5, y: 0.5 };
    setCursor({ x: 0.5, y: 0.5 });
    setProgress(0);
    setDetected(false);
    setPhase('requesting');
    setMessage('Requesting camera permission. No video is uploaded.');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable in this browser.');
      // Start fetching and parsing the model as soon as the user activates Headway,
      // while the camera permission prompt runs. Rejections are handled immediately
      // so denying camera access cannot create an unhandled rejection.
      const humanReady = ensureHuman().then(
        ctor => ({ ctor, error: null as Error | null }),
        reason => ({ ctor: null, error: reason instanceof Error ? reason : new Error(String(reason)) }),
      );
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (token !== startToken.current) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      if (!video.current) throw new Error('Camera preview unavailable.');
      video.current.srcObject = stream;
      await video.current.play();
      setPhase('loading');
      setMessage('Loading local Headway face tracking models.');
      const humanResult = await humanReady;
      if (token !== startToken.current) return;
      if (humanResult.error) throw humanResult.error;
      const Human = humanResult.ctor!;
      const instance = new Human({
        backend: 'webgl',
        modelBasePath: '/headway-demo/models/',
        cacheSensitivity: 0,
        face: {
          enabled: true,
          detector: { enabled: true, rotation: true, maxDetected: 2 },
          mesh: { enabled: true },
          iris: { enabled: false },
          emotion: { enabled: false },
          description: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
      });
      await instance.load();
      if (token !== startToken.current) return;
      model.current = instance;
      enabled.current = true;
      paused.current = false;
      setPhase('active');
      setMessage('Headway enabled. Look toward the camera to set your neutral position.');
      frame.current = requestAnimationFrame(() => { void detectLoop(); });
    } catch (error) {
      if (token !== startToken.current) return;
      release();
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'Unable to activate Headway.');
    }
  }, [detectLoop, release]);

  const togglePause = useCallback(() => {
    if (!enabled.current) return;
    paused.current = !paused.current;
    setPhase(paused.current ? 'paused' : 'active');
    setMessage(paused.current ? 'Headway paused. Camera remains on until you stop.' : 'Headway resumed.');
    dwell.current = { element: null, since: 0, fired: false };
    mouth.current.reset();
    setProgress(0);
    target.current?.classList.remove('hw-target', 'hw-snap-target');
    target.current = null;
    directionArmed.current = true;
  }, []);
  const recenter = useCallback(() => {
    if (!latest.current) { setCalibrationStatus('A single face must be visible before recalibrating.'); return; }
    center.current = latest.current;
    directionArmed.current = true;
    point.current = { x: 0.5, y: 0.5 };
    setCursor(point.current);
    setCalibrationStatus('Neutral position updated. Turn your head gently, then return to center for another step.');
  }, []);
  const beginMouthCalibration = useCallback(() => {
    if (!enabled.current || paused.current) return;
    mouthCalPhase.current = 'closed';
    mouthSamples.current = [];
    closedRatio.current = null;
    calibration.current = null;
    automaticMouthSamples.current = [];
    mouthBaselineReady.current = false;
    mouth.current.reset();
    setCalibrationStatus('Close your mouth gently and hold for the first samples.');
  }, []);
  const setNavigationMode = useCallback((value: NavigationMode) => {
    navigationRef.current = value;
    setNavigationModeState(value);
    target.current?.classList.remove('hw-target', 'hw-snap-target');
    target.current = null;
    directionArmed.current = true;
    dwell.current = { element: null, since: performance.now(), fired: false };
    mouth.current.reset();
    setProgress(0);
    setMessage(value === 'snap' ? 'Magnetic navigation active. Turn your head to change target, open mouth to select.' :
      'Free pointer active. Move your head to steer, open mouth to select.');
  }, []);
  const setClickMode = useCallback((value: ClickMode) => {
    modeRef.current = value; setClickModeState(value);
    mouth.current.reset();
    dwell.current = { element: null, since: performance.now(), fired: false };
    setProgress(0);
  }, []);
  const setSensitivity = useCallback((value: number) => {
    const next = Math.max(0.6, Math.min(1.6, value));
    speedRef.current = next; setSensitivityState(next);
  }, []);
  const setSteadiness = useCallback((value: Steadiness) => { steadyRef.current = value; setSteadinessState(value); }, []);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden && enabled.current && !paused.current) {
        paused.current = true;
        setPhase('paused');
        setMessage('Paused because the tab is hidden.');
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && enabled.current && !paused.current) togglePause();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', escape);
    window.addEventListener('pagehide', release);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [release, togglePause]);

  const ctx: HeadwayState = {
    phase, message, detected, clickMode, navigationMode, sensitivity, steadiness,
    calibration: calibrationStatus, start, stop, togglePause, recenter, beginMouthCalibration,
    setClickMode, setNavigationMode, setSensitivity, setSteadiness,
  };

  return <HeadwayContext.Provider value={ctx}>
    {children}
    <div className="hw-camera" data-headway-ignore aria-hidden={phase === 'off'}>
      <video ref={video} autoPlay muted playsInline className="hw-video" />
    </div>
    {phase !== 'off' && <section className={panelCollapsed ? "hw-panel hw-panel-collapsed" : "hw-panel"} data-headway-ignore aria-label="Headway controls">
      <div className="hw-panel-title"><strong>✚ Headway</strong><button type="button" aria-expanded={!panelCollapsed} onClick={() => setPanelCollapsed(value => !value)}>{panelCollapsed ? "Show controls" : "Minimize"}</button><span className="hw-phase">{phase}</span></div>
      <p className="hw-message" role="status" aria-live="polite">{message}</p>
      <p className="hw-face-status">{detected ? '● Face detected' : '○ Awaiting one face'}</p>
      <div className="hw-panel-actions">
        {phase === 'error' ? <button type="button" onClick={() => void start()}>Try again</button> :
          phase === 'active' || phase === 'paused' ? <>
            <button type="button" onClick={togglePause}>{phase === 'paused' ? 'Resume' : 'Pause'}</button>
            <button type="button" onClick={recenter}>Recenter</button>
          </> : null}
        <button type="button" className="hw-stop" onClick={stop}>Stop Headway</button>
      </div>
      {(phase === 'active' || phase === 'paused') && <>
        <label>Navigation mode<select aria-label="Navigation mode" value={navigationMode} onChange={event => setNavigationMode(event.target.value as NavigationMode)}>
          <option value="snap">Magnetic navigation (recommended)</option><option value="free">Free pointer</option>
        </select></label>
        <label>Click method<select aria-label="Click method" value={clickMode} onChange={event => setClickMode(event.target.value as ClickMode)}>
          <option value="mouth">Open mouth to select (default)</option><option value="dwell">Dwell (hold 1.4 seconds)</option>
        </select></label>
        <label>Pointer sensitivity <output>{sensitivity.toFixed(1)}</output>
          <input type="range" min="0.6" max="1.6" step="0.1" value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))}/>
        </label>
        <label>Pointer steadiness<select value={steadiness} onChange={event => setSteadiness(event.target.value as Steadiness)}>
          <option value="low">Responsive</option><option value="medium">Balanced</option><option value="high">Smooth</option>
        </select></label>
        {clickMode === 'mouth' && <button type="button" onClick={beginMouthCalibration} disabled={phase !== 'active'}>Calibrate mouth click</button>}
        <small role="status">{calibrationStatus}</small>
        <small>{navigationMode === 'snap' ? 'Turn head toward the next control, then return to center to move again. The purple outline indicates your selected target.' :
          'Move your head freely to steer the pointer. Switch back to magnetic navigation for easier selection.'}</small>
      </>}
      <small>Web demo only. Controls safe elements on Sauti Adapt, not other browser tabs.</small>
    </section>}
    {(phase === 'requesting' || phase === 'loading' || phase === 'active') && <div aria-hidden="true" className={phase === 'active' && detected ? 'hw-pointer' : 'hw-pointer hw-pointer-waiting'} style={{ left: (cursor.x * 100) + 'vw', top: (cursor.y * 100) + 'vh' }}>
      <span className="hw-pointer-progress" style={{ '--hw-progress': (progress * 360) + 'deg' } as React.CSSProperties}/>
    </div>}
  </HeadwayContext.Provider>;
}

export function HeadwayToggle({ compact = false }: { compact?: boolean }) {
  const { phase, start, togglePause, stop } = useHeadway();
  return <div className="hw-header-toggle" data-headway-ignore>
    <button type="button" className={compact ? "hw-toggle-button hw-toggle-compact" : "hw-toggle-button"} title="Uses your camera for local head tracking after you approve access" disabled={phase === 'loading' || phase === 'requesting'} aria-pressed={phase === 'active'} onClick={() => phase === 'off' || phase === 'error' ? void start() : togglePause()}>
      <span aria-hidden="true">◉</span> {phase === 'active' ? 'Pause Headway' : phase === 'paused' ? 'Resume Headway' : phase === 'loading' || phase === 'requesting' ? 'Starting Headway…' : 'Enable Headway'}
    </button>
    {phase !== 'off' && phase !== 'error' && <button type="button" className="hw-inline-stop" aria-label="Stop Headway and release camera" onClick={stop}>×</button>}
  </div>;
}
