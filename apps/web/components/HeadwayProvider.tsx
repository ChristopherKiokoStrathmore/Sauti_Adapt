'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cursorFromHead, readFaceSignals, type DemoFace, type FaceSignals } from '@/lib/headway-demo';
import { MouthGesture, mouthThresholds } from '../../headway/src/gaze/mouth-gesture';
import { adaptiveAlpha, MOTION_PRESETS, type Steadiness } from '../../headway/src/gaze/motion';

type Phase = 'off' | 'requesting' | 'loading' | 'active' | 'paused' | 'error';
type ClickMode = 'dwell' | 'mouth';
type HumanLike = { load: () => Promise<unknown>; detect: (video: HTMLVideoElement) => Promise<{ face?: DemoFace[] }> };
type HumanConstructor = new (config: Record<string, unknown>) => HumanLike;
declare global { interface Window { __HeadwayHumanConstructor?: HumanConstructor } }

type HeadwayState = {
  phase: Phase;
  message: string;
  detected: boolean;
  clickMode: ClickMode;
  sensitivity: number;
  steadiness: Steadiness;
  calibration: string;
  start: () => Promise<void>;
  stop: () => void;
  togglePause: () => void;
  recenter: () => void;
  beginMouthCalibration: () => void;
  setClickMode: (value: ClickMode) => void;
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
    const prior = document.querySelector<HTMLScriptElement>('script[data-headway-human]');
    if (prior) prior.remove();
    const tag = document.createElement('script');
    tag.src = '/headway-demo/loader.js';
    tag.type = 'module';
    tag.dataset.headwayHuman = 'true';
    const finished = () => {
      window.removeEventListener('headway-human-ready', finished);
      resolve(window.__HeadwayHumanConstructor!);
    };
    window.addEventListener('headway-human-ready', finished, { once: true });
    tag.onerror = () => {
      window.removeEventListener('headway-human-ready', finished);
      tag.remove();
      reject(new Error('Headway face tracking assets could not be loaded.'));
    };
    document.head.appendChild(tag);
  });
}

function candidateAt(x: number, y: number): HTMLElement | null {
  // This website demo never activates admin controls or third party pages.
  if (window.location.pathname !== '/' && window.location.pathname !== '/workspace') return null;
  const node = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = node?.closest<HTMLElement>('button, a, summary, [data-headway-action], .aw-radio, .aw-form input[type="text"]');
  if (!target || !target.isConnected || target.closest('[data-headway-ignore]')) return null;
  if (target.matches(':disabled, [aria-disabled="true"]')) return null;
  if (target.matches('input') && !target.closest('.aw-form')) return null;
  if (target.closest('[hidden], [inert]')) return null;
  if (target.matches('a')) {
    const href = target.getAttribute('href');
    if (!href || href.startsWith('javascript:') || target.hasAttribute('download')) return null;
    try { if (new URL(href, window.location.href).origin !== window.location.origin) return null; } catch { return null; }
  }
  const name = (target.getAttribute('aria-label') || target.textContent || '').toLowerCase().trim();
  // Never automate data deletion, microphone recording, payments or browser permissions.
  if (/delete|remove|purchase|checkout|pay now|sign out|logout|start recording|stop recording|enable camera|grant permission|confirm consent/.test(name)) return null;
  return target;
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
  const modeRef = useRef<ClickMode>('dwell');
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
  const [clickMode, setClickModeState] = useState<ClickMode>('dwell');
  const [sensitivity, setSensitivityState] = useState(1);
  const [steadiness, setSteadinessState] = useState<Steadiness>('medium');
  const [calibrationStatus, setCalibrationStatus] = useState('Look straight at the screen to set your neutral position.');

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
    target.current?.classList.remove('hw-target');
    target.current = null;
    mouth.current.reset();
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
    setCalibrationStatus('Look straight at the screen to set your neutral position.');
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

      if (mouthCalPhase.current !== 'idle' && reading.mouth !== null) {
        mouthSamples.current.push(reading.mouth);
        if (mouthSamples.current.length >= 18) {
          const average = mouthSamples.current.reduce((a, b) => a + b, 0) / mouthSamples.current.length;
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
              mouth.current.reset();
              setCalibrationStatus('Mouth calibration complete. Open and close to select a target.');
            } else {
              calibration.current = null;
              setCalibrationStatus('Mouth opening was not distinct enough. Try calibration again.');
            }
          }
        }
      }

      if (!mouth.current.frozen && center.current) {
        const desired = cursorFromHead(reading, center.current, speedRef.current, true);
        const dx = (desired.x - point.current.x) * window.innerWidth;
        const dy = (desired.y - point.current.y) * window.innerHeight;
        const smoothing = adaptiveAlpha(Math.hypot(dx, dy), MOTION_PRESETS[steadyRef.current]);
        point.current = { x: point.current.x + (desired.x - point.current.x) * smoothing, y: point.current.y + (desired.y - point.current.y) * smoothing };
      }

      const px = Math.round(point.current.x * window.innerWidth);
      const py = Math.round(point.current.y * window.innerHeight);
      const current = candidateAt(px, py);
      if (current !== target.current) {
        target.current?.classList.remove('hw-target');
        target.current = current;
        current?.classList.add('hw-target');
        dwell.current = { element: current, since: t, fired: false };
        setProgress(0);
      }
      if (modeRef.current === 'dwell' && current && !dwell.current.fired) {
        const amount = Math.min(1, (t - dwell.current.since) / 1400);
        if (amount >= 1) {
          dwell.current.fired = true;
          if (current.matches('input')) current.focus(); else current.click();
          setMessage('Selected ' + (current.getAttribute('aria-label') || current.textContent?.trim().slice(0, 40) || 'item') + '.');
          setProgress(0);
        } else if (t - lastPaint.current >= 65) {
          setProgress(amount);
        }
      }
      if (modeRef.current === 'mouth' && calibration.current && reading.mouth !== null) {
        const thresholds = mouthThresholds(calibration.current);
        // Always accept release events, even after a target disappears or the pointer moves.
        const actions = mouth.current.update(reading.mouth, thresholds, t);
        if (current && actions.includes('click')) {
          if (current.matches('input')) current.focus(); else current.click();
          setMessage('Mouth gesture selected ' + (current.getAttribute('aria-label') || current.textContent?.trim().slice(0, 40) || 'item') + '.');
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
    setPhase('requesting');
    setMessage('Requesting camera permission. No video is uploaded.');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable in this browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (token !== startToken.current) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      if (!video.current) throw new Error('Camera preview unavailable.');
      video.current.srcObject = stream;
      await video.current.play();
      setPhase('loading');
      setMessage('Loading local Headway face tracking models.');
      const Human = await ensureHuman();
      if (token !== startToken.current) return;
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
    target.current?.classList.remove('hw-target');
    target.current = null;
  }, []);
  const recenter = useCallback(() => {
    if (!latest.current) { setCalibrationStatus('A single face must be visible before recalibrating.'); return; }
    center.current = latest.current;
    point.current = { x: 0.5, y: 0.5 };
    setCursor(point.current);
    setCalibrationStatus('Neutral head position updated. Move gently to test the pointer.');
  }, []);
  const beginMouthCalibration = useCallback(() => {
    if (!enabled.current || paused.current) return;
    mouthCalPhase.current = 'closed';
    mouthSamples.current = [];
    closedRatio.current = null;
    calibration.current = null;
    mouth.current.reset();
    setCalibrationStatus('Close your mouth gently and hold for the first samples.');
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
    phase, message, detected, clickMode, sensitivity, steadiness,
    calibration: calibrationStatus, start, stop, togglePause, recenter, beginMouthCalibration,
    setClickMode, setSensitivity, setSteadiness,
  };

  return <HeadwayContext.Provider value={ctx}>
    {children}
    <div className="hw-camera" data-headway-ignore aria-hidden={phase === 'off'}>
      <video ref={video} autoPlay muted playsInline className="hw-video" />
    </div>
    {phase !== 'off' && <section className="hw-panel" data-headway-ignore aria-label="Headway controls">
      <div className="hw-panel-title"><strong>✚ Headway</strong><span className="hw-phase">{phase}</span></div>
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
        <label>Click method<select value={clickMode} onChange={event => setClickMode(event.target.value as ClickMode)}>
          <option value="dwell">Dwell (hold 1.4 seconds)</option><option value="mouth">Mouth gesture</option>
        </select></label>
        <label>Pointer sensitivity <output>{sensitivity.toFixed(1)}</output>
          <input type="range" min="0.6" max="1.6" step="0.1" value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))}/>
        </label>
        <label>Pointer steadiness<select value={steadiness} onChange={event => setSteadiness(event.target.value as Steadiness)}>
          <option value="low">Responsive</option><option value="medium">Balanced</option><option value="high">Smooth</option>
        </select></label>
        {clickMode === 'mouth' && <button type="button" onClick={beginMouthCalibration} disabled={phase !== 'active'}>Calibrate mouth click</button>}
        <small>{calibrationStatus}</small>
      </>}
      <small>Web demo only. Controls safe elements on Sauti Adapt, not other browser tabs.</small>
    </section>}
    {phase === 'active' && detected && <div aria-hidden="true" className="hw-pointer" style={{ left: (cursor.x * 100) + 'vw', top: (cursor.y * 100) + 'vh' }}>
      <span className="hw-pointer-progress" style={{ '--hw-progress': (progress * 360) + 'deg' } as React.CSSProperties}/>
    </div>}
  </HeadwayContext.Provider>;
}

export function HeadwayToggle({ compact = false }: { compact?: boolean }) {
  const { phase, start, togglePause, stop } = useHeadway();
  return <div className="hw-header-toggle" data-headway-ignore>
    <button type="button" className={compact ? "hw-toggle-button hw-toggle-compact" : "hw-toggle-button"} disabled={phase === 'loading' || phase === 'requesting'} aria-pressed={phase === 'active'} onClick={() => phase === 'off' || phase === 'error' ? void start() : togglePause()}>
      <span aria-hidden="true">◉</span> {phase === 'active' ? 'Pause Headway' : phase === 'paused' ? 'Resume Headway' : phase === 'loading' || phase === 'requesting' ? 'Starting Headway…' : 'Enable Headway'}
    </button>
    {phase !== 'off' && phase !== 'error' && <button type="button" className="hw-inline-stop" aria-label="Stop Headway and release camera" onClick={stop}>×</button>}
  </div>;
}
