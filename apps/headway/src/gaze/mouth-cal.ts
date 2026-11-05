import { INK, PAPER, MUTED, LINE, LIME, FONT, MONO } from '../shared/page-theme';

(function() {
  'use strict';

  const MOUTH_CAL_STORAGE_KEY = 'mouthCalV1';
  const MIN_SAMPLES = 20;

  type MouthStep = 'idle' | 'start' | 'open' | 'closed' | 'open-collecting' | 'open-done' | 'closed-collecting' | 'done';
  type CalOverlay = HTMLDivElement & { __keydownHandler?: (e: KeyboardEvent) => void };

  let calUI: CalOverlay | null = null;
  let currentStep: MouthStep = 'idle';
  let samples: number[] = [];

  function createCalibrationUI(): CalOverlay {
    const overlay: CalOverlay = document.createElement('div');
    overlay.id = 'mouth-cal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      background: rgba(15, 16, 13, 0.9);
      font-family: ${FONT};
    `;

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Mouth click calibration');
    panel.style.cssText = `
      box-sizing: border-box; width: min(460px, calc(100vw - 32px));
      background: ${INK}; color: ${PAPER}; border: 1px solid ${LINE};
      border-radius: 16px; padding: 28px 28px 24px; text-align: left;
    `;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;font:600 11px/1 ${MONO};letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}">
        <span style="width:8px;height:8px;border-radius:50%;background:${LIME};display:inline-block"></span><span>Headway · Mouth click</span>
      </div>
      <div id="mouth-cal-title" style="font:600 26px/1.15 ${FONT};letter-spacing:-0.03em;margin:0 0 10px;color:${PAPER}">Calibrate mouth click</div>
      <p id="mouth-cal-instructions" style="font-size:15px;line-height:1.5;margin:0 0 22px;color:${MUTED}">
        Two short captures: your mouth open wide, then closed and relaxed. Headway sets the click point between them.
      </p>
      <div id="mouth-cal-progress" style="display:none;margin:0 0 22px">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span id="mouth-cal-count" style="font:600 44px/1 ${FONT};letter-spacing:-0.03em;font-variant-numeric:tabular-nums;color:${PAPER}">0</span>
          <span style="font:500 13px/1 ${MONO};color:${MUTED}">/ ${MIN_SAMPLES} samples</span>
        </div>
        <div style="height:4px;border-radius:4px;background:rgba(238,238,230,0.14);margin-top:12px;overflow:hidden">
          <div id="mouth-cal-bar" style="height:100%;width:0;background:${PAPER};transition:width 0.1s linear"></div>
        </div>
      </div>
      <button id="mouth-cal-action" style="box-sizing:border-box;width:100%;min-height:52px;padding:0 20px;background:${LIME};color:${INK};border:none;border-radius:10px;font:600 16px/1 ${FONT};cursor:pointer">Start</button>
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid ${LINE};font:500 12px/1.4 ${MONO};color:${MUTED}">Space to capture · Esc to cancel</div>
    `;

    overlay.appendChild(panel);
    return overlay;
  }

  function updateUI(step: MouthStep, count = 0) {
    const title = document.getElementById('mouth-cal-title');
    const instructions = document.getElementById('mouth-cal-instructions');
    const progress = document.getElementById('mouth-cal-progress');
    const countEl = document.getElementById('mouth-cal-count');
    const bar = document.getElementById('mouth-cal-bar');
    const button = document.getElementById('mouth-cal-action') as HTMLButtonElement | null;

    if (!title || !instructions || !button || !progress || !countEl || !bar) return;

    countEl.textContent = String(count);
    bar.style.width = `${Math.min(100, (count / MIN_SAMPLES) * 100)}%`;
    const setBusy = (busy: boolean) => {
      button.disabled = busy;
      button.style.opacity = busy ? '0.45' : '1';
      button.style.cursor = busy ? 'not-allowed' : 'pointer';
    };

    if (step === 'start') {
      title.textContent = 'Step 1 of 2: open wide';
      instructions.textContent = 'Open your mouth wide, as if saying “aah”, and hold it. Press Space when you are ready.';
      progress.style.display = 'block';
      button.textContent = 'Capture open mouth';
      setBusy(false);
    } else if (step === 'open-collecting') {
      title.textContent = 'Keep it open';
      instructions.textContent = 'Hold still while Headway takes a reading.';
      button.textContent = 'Capturing…';
      setBusy(true);
    } else if (step === 'open-done') {
      title.textContent = 'Step 2 of 2: close and relax';
      instructions.textContent = 'Close your mouth normally and relax your face. Press Space when you are ready.';
      button.textContent = 'Capture closed mouth';
      setBusy(false);
    } else if (step === 'closed-collecting') {
      title.textContent = 'Keep it closed';
      instructions.textContent = 'Hold still while Headway takes a reading.';
      button.textContent = 'Capturing…';
      setBusy(true);
    } else if (step === 'done') {
      title.textContent = '✓ Mouth click is ready';
      instructions.textContent = 'Open your mouth wide to click whatever the pointer is resting on.';
      progress.style.display = 'none';
      button.textContent = 'Done';
      setBusy(false);
    }
  }

  function collectSamples(type: 'open' | 'closed') {
    samples = [];
    currentStep = `${type}-collecting`;
    updateUI(currentStep, 0);

    const interval = setInterval(() => {
      const ratio = window.__lastMouthRatio || 0;
      if (ratio > 0) {
        samples.push(ratio);
        updateUI(currentStep, samples.length);

        if (samples.length >= MIN_SAMPLES) {
          clearInterval(interval);
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          console.log(`[MouthCal] ${type} average: ${avg.toFixed(3)}`);

          if (type === 'open') {
            window.__mouthCalOpen = avg;
            currentStep = 'open-done';
            updateUI(currentStep);
          } else {
            window.__mouthCalClosed = avg;
            finishCalibration();
          }
        }
      }
    }, 100);

    // Store interval so we can cancel if needed
    window.__mouthCalInterval = interval;
  }

  function finishCalibration() {
    const openRatio = window.__mouthCalOpen ?? 0;
    const closedRatio = window.__mouthCalClosed ?? 0;

    // Calculate threshold at 70% between closed and open
    const threshold = closedRatio + (openRatio - closedRatio) * 0.7;

    const calibration: MouthCalibration = {
      version: 1,
      closedRatio,
      openRatio,
      threshold,
      timestamp: Date.now()
    };

    console.log('[MouthCal] Calibration complete:', calibration);

    // Save to storage
    chrome.storage.local.set({ [MOUTH_CAL_STORAGE_KEY]: calibration }, () => {
      console.log('[MouthCal] Saved to storage');
    });

    // Dispatch event to notify gaze-core
    window.dispatchEvent(new CustomEvent('mouth-cal:complete', {
      detail: calibration
    }));

    currentStep = 'done';
    updateUI(currentStep);

    setTimeout(() => {
      closeCalibration();
    }, 2000);
  }

  function startCalibration() {
    console.log('[MouthCal] Starting mouth calibration');
    window.__gazeMouthCalActive = true;

    const ui = createCalibrationUI();
    calUI = ui;
    document.body.appendChild(ui);

    const button = document.getElementById('mouth-cal-action');
    if (!button) return;

    button.addEventListener('click', () => {
      if (currentStep === 'idle' || currentStep === 'start') {
        currentStep = 'open';
        collectSamples('open');
      } else if (currentStep === 'open-done') {
        currentStep = 'closed';
        collectSamples('closed');
      } else if (currentStep === 'done') {
        closeCalibration();
      }
    });

    // Handle spacebar
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        button.click();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        closeCalibration();
      }
    };

    document.addEventListener('keydown', handleKeydown);
    ui.__keydownHandler = handleKeydown;

    currentStep = 'start';
    updateUI(currentStep);
  }

  function closeCalibration() {
    console.log('[MouthCal] Closing calibration');
    window.__gazeMouthCalActive = false;

    if (window.__mouthCalInterval) {
      clearInterval(window.__mouthCalInterval);
      window.__mouthCalInterval = null;
    }

    if (calUI) {
      if (calUI.__keydownHandler) {
        document.removeEventListener('keydown', calUI.__keydownHandler);
      }
      calUI.remove();
      calUI = null;
    }

    currentStep = 'idle';
    samples = [];
  }

  // Expose function globally
  window.startMouthCalibration = startCalibration;

  // Listen for calibration requests
  window.addEventListener('mouth-cal:start', startCalibration);

  // Keyboard shortcut: Alt+M
  document.addEventListener('keydown', (event) => {
    const code = event.code || '';
    if (event.altKey && !event.ctrlKey && !event.metaKey && code === 'KeyM') {
      event.preventDefault();
      event.stopPropagation();
      startCalibration();
    }
  }, true);

  console.log('[MouthCal] Mouth calibration module loaded. Press Alt+M to calibrate.');
})();

export {};
