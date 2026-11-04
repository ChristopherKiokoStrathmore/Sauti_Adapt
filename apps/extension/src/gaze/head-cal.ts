import { INK, PAPER, MUTED, LINE, LIME, FONT, MONO } from '../shared/page-theme';

(function() {
  'use strict';

  if (window.__gazeHeadCalInitialized) {
    return;
  }
  window.__gazeHeadCalInitialized = true;

  const HEAD_CAL_STORAGE_KEY = 'headCalV2';
  const MIN_RANGE_HORIZONTAL = 0.24;
  const MIN_RANGE_VERTICAL = 0.22;
  const MIN_SAMPLES_PER_STEP = 4;         // Reduced from 8 for easier calibration
  const MAX_SAMPLES_PER_STEP = 120;
  const CAPTURE_TIMEOUT_MS = 1500;        // Increased from 1200ms for more capture time
  const BLINK_CONFIRM_DURATION = 900; // ms

  if (typeof window.__gazeHeadCalActive !== 'boolean') {
    window.__gazeHeadCalActive = false;
  }

  const STEPS = [
    { label: 'Face the centre', hint: 'Sit comfortably with your head relaxed, then press Space.' },
    { label: 'Turn left', hint: 'Turn your head gently to the left, as far as is comfortable, then press Space.' },
    { label: 'Turn right', hint: 'Turn your head gently to the right, then press Space.' },
    { label: 'Tilt up', hint: 'Nod up a little, then press Space.' },
    { label: 'Tilt down', hint: 'Nod down a little, then press Space.' },
    { label: 'Back to centre', hint: 'Return to your resting position and press Space to finish.' }
  ];

  interface CalUI { root: HTMLDivElement; title: HTMLDivElement; hint: HTMLDivElement; footer: HTMLDivElement; begin: HTMLButtonElement }
  let ui: CalUI | null = null;
  let active = false;
  let waitingToStart = false;
  let capturing = false;
  let stepIndex = 0;
  let stepSamples: HeadPose[][] = [];
  let poseAverages: (HeadPose | undefined)[] = [];
  let calibration: HeadCalibration = { cx: 0, cy: 0, left: 0, right: 0, up: 0, down: 0, version: 2, ts: 0 };
  let captureListener: ((event: CustomEvent<HeadFrame & { ts: number }>) => void) | null = null;
  let captureTimer: ReturnType<typeof setTimeout> | null = null;
  let captureRaf: number | null = null;

  function ensureUI(): CalUI {
    if (ui) return ui;
    const root = document.createElement('div');
    root.id = 'gaze-head-cal';
    root.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(15, 16, 13, 0.9);
      pointer-events: auto;
    `;

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Head pointer calibration');
    panel.style.cssText = `
      box-sizing: border-box;
      width: min(440px, calc(100vw - 32px));
      padding: 28px 28px 24px;
      border-radius: 16px;
      background: ${INK};
      color: ${PAPER};
      border: 1px solid ${LINE};
      font-family: ${FONT};
      text-align: left;
      pointer-events: auto;
    `;

    const eyebrow = document.createElement('div');
    eyebrow.style.cssText = `display: flex; align-items: center; gap: 8px; margin-bottom: 18px; font: 600 11px/1 ${MONO}; letter-spacing: 0.08em; text-transform: uppercase; color: ${MUTED};`;
    eyebrow.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${LIME};display:inline-block"></span><span>Headway · Head pointer</span>`;

    const titleEl = document.createElement('div');
    titleEl.style.cssText = `font: 600 26px/1.15 ${FONT}; margin-bottom: 10px; color: ${PAPER}; letter-spacing: -0.03em;`;
    const hintEl = document.createElement('div');
    hintEl.style.cssText = `font-size: 15px; color: ${MUTED}; margin-bottom: 22px; line-height: 1.5;`;

    const beginBtn = document.createElement('button');
    beginBtn.textContent = 'Begin calibration';
    beginBtn.style.cssText = `
      box-sizing: border-box;
      width: 100%;
      min-height: 52px;
      padding: 0 20px;
      font: 600 16px/1 ${FONT};
      color: ${INK};
      background: ${LIME};
      border: none;
      border-radius: 10px;
      cursor: pointer;
      margin-bottom: 18px;
      display: none;
    `;
    beginBtn.onmouseover = () => { beginBtn.style.background = '#d4f650'; };
    beginBtn.onmouseout = () => { beginBtn.style.background = LIME; };
    beginBtn.onclick = handleBeginClick;

    const footerEl = document.createElement('div');
    footerEl.style.cssText = `font: 500 12px/1.4 ${MONO}; color: ${MUTED}; padding-top: 14px; border-top: 1px solid ${LINE};`;

    panel.appendChild(eyebrow);
    panel.appendChild(titleEl);
    panel.appendChild(hintEl);
    panel.appendChild(beginBtn);
    panel.appendChild(footerEl);
    root.appendChild(panel);
    document.documentElement.appendChild(root);
    ui = { root, title: titleEl, hint: hintEl, footer: footerEl, begin: beginBtn };
    return ui;
  }

  function setUIVisible(visible: boolean) {
    ensureUI().root.style.display = visible ? 'flex' : 'none';
  }

  function updateUI(message: string, hint?: string, footer?: string, showButton = false) {
    const { title: titleEl, hint: hintEl, footer: footerEl, begin: beginBtn } = ensureUI();
    titleEl.textContent = message;
    hintEl.textContent = hint || '';
    footerEl.textContent = footer || 'Space or a long blink (1 s+) to capture · Esc to cancel';

    if (showButton) {
      beginBtn.style.display = 'inline-block';
      footerEl.textContent = 'Press Esc to cancel';
    } else {
      beginBtn.style.display = 'none';
    }
  }

  function handleBeginClick() {
    waitingToStart = false;
    beginActualCalibration();
  }

  function beginActualCalibration() {
    stepIndex = 0;
    updateUI(`Step 1 / ${STEPS.length}: ${STEPS[0].label}`, STEPS[0].hint);
    const centerX = Math.round((window.innerWidth || 1) / 2);
    const centerY = Math.round((window.innerHeight || 1) / 2);
    window.dispatchEvent(new CustomEvent('gaze:status', {
      detail: { phase: 'calibrating', note: 'center' }
    }));
    const now = performance.now();
    window.dispatchEvent(new CustomEvent('gaze:point', {
      detail: { x: centerX, y: centerY, conf: 0.95, ts: now }
    }));
    console.log('[HeadCal] Calibration steps started');
  }

  function stopCapture() {
    capturing = false;
    if (captureListener) {
      window.removeEventListener('head:frame', captureListener);
      captureListener = null;
    }
    if (captureTimer) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
    if (captureRaf) {
      cancelAnimationFrame(captureRaf);
      captureRaf = null;
    }
  }

  function resetSamples() {
    stepSamples = STEPS.map(() => []);
  }

  function startCalibration() {
    if (active) return;
    active = true;
    waitingToStart = true;
    window.__gazeHeadCalActive = true;
    stepIndex = 0;
    calibration = {
      cx: 0,
      cy: 0,
      left: 0,
      right: 0,
      up: 0,
      down: 0,
      version: 2,
      ts: Date.now()
    };
    resetSamples();
    poseAverages = new Array(STEPS.length);
    setUIVisible(true);
    updateUI(
      'Calibrate the head pointer',
      'Six quick poses: centre, left, right, up, down, then centre again. Hold each one and press Space.',
      'Press Esc to cancel',
      true  // Show button
    );

    // Dispatch event to hide tooltip and pointer during calibration
    window.dispatchEvent(new CustomEvent('gaze:calibration-started'));

    console.log('[HeadCal] Waiting for user to click begin');
  }

  function stopCalibration(message?: string) {
    if (!active) return;
    active = false;
    waitingToStart = false;
    window.__gazeHeadCalActive = false;
    stopCapture();
    setUIVisible(false);

    // Dispatch event to restore tooltip and pointer after calibration
    window.dispatchEvent(new CustomEvent('gaze:calibration-stopped'));

    if (message) {
      console.log('[HeadCal]', message);
    }
  }

  function averageSamples(samples: HeadPose[]): HeadPose {
    if (!samples.length) return { nx: NaN, ny: NaN };
    const sum = samples.reduce((acc, cur) => {
      acc.nx += cur.nx;
      acc.ny += cur.ny;
      return acc;
    }, { nx: 0, ny: 0 });
    const count = samples.length || 1;
    return {
      nx: sum.nx / count,
      ny: sum.ny / count
    };
  }

  function collectSamplesForCurrentStep(): Promise<HeadPose[]> {
    return new Promise((resolve) => {
      stopCapture();
      capturing = true;
      const samples: HeadPose[] = [];
      const step = STEPS[stepIndex];
      const start = performance.now();
      const hintEl = ensureUI().hint;
      hintEl.textContent = `${step.label}: capturing…`;

      const appendSample = (frame: HeadFrame | null | undefined) => {
        if (!frame) return;
        const { nx, ny } = frame;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
        const last = samples[samples.length - 1];
        if (last && Math.abs(last.nx - nx) < 1e-4 && Math.abs(last.ny - ny) < 1e-4) {
          return;
        }
        samples.push({ nx, ny });
        if (samples.length >= MIN_SAMPLES_PER_STEP) {
          hintEl.textContent = `${step.label}: captured ${samples.length}`;
        }
      };

      if (window.__lastHeadFrame) {
        appendSample(window.__lastHeadFrame);
      }

      const tick = () => {
        if (!capturing) return;
        appendSample(window.__lastHeadFrame);
        if (samples.length >= MAX_SAMPLES_PER_STEP) {
          stopCapture();
          resolve(samples);
          return;
        }
        if (performance.now() - start >= CAPTURE_TIMEOUT_MS) {
          stopCapture();
          resolve(samples);
          return;
        }
        captureRaf = requestAnimationFrame(tick);
      };

      captureRaf = requestAnimationFrame(tick);
      captureTimer = setTimeout(() => {
        stopCapture();
        resolve(samples);
      }, CAPTURE_TIMEOUT_MS + 16);
    });
  }

  async function confirmStep() {
    if (!active || capturing) return;
    const step = STEPS[stepIndex];
    const samples = await collectSamplesForCurrentStep();
    if (!samples || samples.length < MIN_SAMPLES_PER_STEP) {
      updateUI(`Step ${stepIndex + 1} / ${STEPS.length}: ${step.label}`, `Only captured ${samples.length || 0} frames. Hold steady and press Space again.`);
      return;
    }

    stepSamples[stepIndex] = samples;
    const middleRange = Math.floor(samples.length * 0.35);
    const sorted = samples.slice().sort((a, b) => a.nx - b.nx || a.ny - b.ny);
    const trimmed = sorted.slice(middleRange, sorted.length - middleRange);
    const usable = trimmed.length >= MIN_SAMPLES_PER_STEP ? trimmed : samples;
    const avg = averageSamples(usable);
    poseAverages[stepIndex] = avg;

    switch (stepIndex) {
      case 0:
        calibration.cx = avg.nx;
        calibration.cy = avg.ny;
        break;
      case 1:
        calibration.left = Math.max(1e-3, (calibration.cx || 0) - avg.nx);
        calibration.poseLeft = avg;
        break;
      case 2:
        calibration.right = Math.max(1e-3, avg.nx - (calibration.cx || 0));
        calibration.poseRight = avg;
        break;
      case 3:
        calibration.up = Math.max(1e-3, (calibration.cy || 0) - avg.ny);
        calibration.poseUp = avg;
        break;
      case 4:
        calibration.down = Math.max(1e-3, avg.ny - (calibration.cy || 0));
        calibration.poseDown = avg;
        break;
      case 5:
        calibration.cx = avg.nx;
        calibration.cy = avg.ny;
        calibration.poseCenter = avg;
        break;
      default:
        break;
    }

    stepIndex += 1;
    if (stepIndex >= STEPS.length) {
      finalizeCalibration();
    } else {
      const nextStep = STEPS[stepIndex];
      updateUI(`Step ${stepIndex + 1} / ${STEPS.length}: ${nextStep.label}`, nextStep.hint);
    }
  }

  function finalizeCalibration() {
    const centerPrimary = poseAverages[0] || { nx: calibration.cx, ny: calibration.cy };
    const centerFinal = poseAverages[5] || centerPrimary;
    const leftAvg = poseAverages[1] || centerPrimary;
    const rightAvg = poseAverages[2] || centerPrimary;
    const upAvg = poseAverages[3] || centerPrimary;
    const downAvg = poseAverages[4] || centerPrimary;

    const finalCenter = {
      nx: Number.isFinite(centerFinal.nx) ? centerFinal.nx : centerPrimary.nx || 0,
      ny: Number.isFinite(centerFinal.ny) ? centerFinal.ny : centerPrimary.ny || 0
    };

    calibration.cx = finalCenter.nx;
    calibration.cy = finalCenter.ny;
    calibration.poseCenter = finalCenter;
    calibration.poseLeft = calibration.poseLeft || leftAvg;
    calibration.poseRight = calibration.poseRight || rightAvg;
    calibration.poseUp = calibration.poseUp || upAvg;
    calibration.poseDown = calibration.poseDown || downAvg;

    const leftRange = Number.isFinite(leftAvg.nx) ? Math.max(MIN_RANGE_HORIZONTAL, Math.abs(finalCenter.nx - leftAvg.nx)) : MIN_RANGE_HORIZONTAL;
    const rightRange = Number.isFinite(rightAvg.nx) ? Math.max(MIN_RANGE_HORIZONTAL, Math.abs(rightAvg.nx - finalCenter.nx)) : MIN_RANGE_HORIZONTAL;
    const upRange = Number.isFinite(upAvg.ny) ? Math.max(MIN_RANGE_VERTICAL, Math.abs(finalCenter.ny - upAvg.ny)) : MIN_RANGE_VERTICAL;
    const downRange = Number.isFinite(downAvg.ny) ? Math.max(MIN_RANGE_VERTICAL, Math.abs(downAvg.ny - finalCenter.ny)) : MIN_RANGE_VERTICAL;

    calibration.left = leftRange;
    calibration.right = rightRange;
    calibration.up = upRange;
    calibration.down = downRange;
    calibration.ts = Date.now();
    try {
      chrome.storage.local.set({ [HEAD_CAL_STORAGE_KEY]: calibration }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[HeadCal] storage set failed:', chrome.runtime.lastError.message);
          stopCalibration('Storage unavailable');
          return;
        }
        console.log('[HeadCal] Saved calibration', calibration);
        updateUI('✓ Calibration saved', 'The pointer now follows your head. Alt+N turns it on or off.');
        window.dispatchEvent(new CustomEvent('head:calibrated', { detail: calibration }));
        window.dispatchEvent(new CustomEvent('gaze:status', {
          detail: { phase: 'live', note: 'head-cal saved' }
        }));
        setTimeout(() => stopCalibration('Completed'), 900);
      });
    } catch (error) {
      console.warn('[HeadCal] calibration persistence failed:', error);
      stopCalibration('Storage unavailable');
    }
  }

  function handleBlinkRelease(event: CustomEvent<{ duration: number }>) {
    if (!active) return;
    if (!event.detail || typeof event.detail.duration !== 'number') return;
    if (event.detail.duration >= BLINK_CONFIRM_DURATION) {
      confirmStep().catch((error) => console.warn('[HeadCal] capture failed:', error));
    }
  }

  function handleHeadFrame(event: CustomEvent<HeadFrame & { ts: number }>) {
    if (!event.detail) return;
    const { nx, ny, yaw, pitch } = event.detail;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    const previous = window.__lastHeadFrame;
    const keep = (next: number | undefined, prior: number | undefined) =>
      Number.isFinite(next) ? next : (Number.isFinite(prior) ? prior : 0);
    window.__lastHeadFrame = {
      nx,
      ny,
      yaw: keep(yaw, previous?.yaw),
      pitch: keep(pitch, previous?.pitch)
    };
  }

  document.addEventListener('keydown', (event) => {
    const code = event.code || event.key;
    if (event.altKey && !event.ctrlKey && !event.metaKey && code === 'KeyH') {
      event.preventDefault();
      if (active) {
        stopCalibration('Cancelled');
      } else {
        startCalibration();
      }
      return;
    }
    if (!active) return;
    if (event.key === ' ') {
      event.preventDefault();
      // Ignore SPACE when waiting for user to click begin button
      if (waitingToStart) return;
      confirmStep().catch((error) => console.warn('[HeadCal] capture failed:', error));
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      stopCalibration('Cancelled via Escape');
    }
  }, true);

  window.addEventListener('head:frame', handleHeadFrame);
  window.addEventListener('blink:released', handleBlinkRelease);
})();

export {};
