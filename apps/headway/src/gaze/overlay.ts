(function() {
  'use strict';

  if (window.__gazeOverlayInitialized) {
    return;
  }
  window.__gazeOverlayInitialized = true;

  const STYLE_ID = 'gaze-overlay-style';
  const POINTER_ID = 'gaze-pointer';
  const HUD_ID = 'gaze-debug-hud';
  const PREVIEW_ID = 'gaze-cam';

  let pointerEl: HTMLDivElement | null = null;
  let hudEl: HTMLDivElement | null = null;
  let previewCanvas: HTMLCanvasElement | null = null;
  let hudVisible = true;
  let pointerVisible = true;
  let previewVisible = true;
  let statusPhase = 'loading';
  let statusNote = '';
  let lastPointTs = 0;
  let fpsEMA = 0;
  let lastConfidence: number | null = null;
  let hasPointerPosition = false;

  // Nutshell showed the HUD and an empty camera box on every page, even with tracking
  // off. Headway starts hidden and only shows them once storage says tracking is on.
  let trackingOn = false;
  injectStyles();
  ensureElements();
  setTrackingUi(false);
  chrome.storage.local.get(['gazeEnabled'], (result) => {
    setTrackingUi(result.gazeEnabled === true);
  });

  function setTrackingUi(on: boolean) {
    trackingOn = on;
    const { hud } = ensureElements();
    hud.style.display = on && hudVisible ? 'block' : 'none';
    setPreviewVisible(on);
    if (!on) {
      hasPointerPosition = false;
      setPointerVisible(false);
      pointerVisible = true; // shows again with the first point once tracking resumes
    }
  }

  document.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('gaze:status', handleStatus);
  window.addEventListener('gaze:point', handlePoint);
  window.addEventListener('gaze:dwell', (event) => {
    const progress = Math.max(0, Math.min(1, event.detail?.progress ?? 0));
    const { pointer } = ensureElements();
    pointer.classList.toggle('hw-dwelling', progress > 0);
    pointer.querySelector('.hw-ring')?.setAttribute('stroke-dashoffset', (94.25 * (1 - progress)).toFixed(2));
  });
  window.addEventListener('gaze:calibration-started', handleCalibrationStarted);
  window.addEventListener('gaze:calibration-stopped', handleCalibrationStopped);
  chrome.storage.onChanged.addListener(handleStorageChange);

  function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string) {
    if (areaName !== 'local') return;
    if (changes.gazeEnabled) {
      const enabled = Boolean(changes.gazeEnabled.newValue);
      if (!enabled) {
        fpsEMA = 0;
        lastConfidence = null;
      }
      setTrackingUi(enabled);
    }
  }

  function handleCalibrationStarted() {
    // Hide pointer during calibration so it doesn't cover instructions
    setPointerVisible(false);
    console.debug('[GazeOverlay] Pointer hidden for calibration');
  }

  function handleCalibrationStopped() {
    // Restore pointer after calibration
    setPointerVisible(true);
    console.debug('[GazeOverlay] Pointer restored after calibration');
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    try {
      const url = chrome.runtime.getURL('dist/gaze-overlay.css');
      const link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = url;
      document.documentElement.appendChild(link);
    } catch (error) {
      console.warn('[GazeOverlay] Failed to load stylesheet:', error);
    }
  }

  function ensureElements(): { hud: HTMLDivElement; pointer: HTMLDivElement; preview: HTMLCanvasElement } {
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.id = HUD_ID;
      hudEl.style.display = hudVisible ? 'block' : 'none';
      hudEl.textContent = 'Headway: loading';
      document.documentElement.appendChild(hudEl);
    }
    if (!pointerEl) {
      pointerEl = document.createElement('div');
      pointerEl.id = POINTER_ID;
      pointerEl.style.display = 'none';
      pointerEl.setAttribute('aria-hidden', 'true');
      // Dwell progress ring: circumference of r=15 is 94.25.
      pointerEl.innerHTML = '<svg viewBox="0 0 36 36"><circle class="hw-ring-track" cx="18" cy="18" r="15"/>'
        + '<circle class="hw-ring" cx="18" cy="18" r="15" stroke-dasharray="94.25" stroke-dashoffset="94.25"/></svg>';
      document.documentElement.appendChild(pointerEl);
    }
    if (!previewCanvas) {
      previewCanvas = document.createElement('canvas');
      previewCanvas.id = PREVIEW_ID;
      previewCanvas.width = 320;
      previewCanvas.height = 240;
      previewCanvas.style.display = previewVisible ? 'block' : 'none';
      document.documentElement.appendChild(previewCanvas);
      window.dispatchEvent(new CustomEvent('gaze:preview-toggle', { detail: { on: previewVisible } }));
    }
    return { hud: hudEl, pointer: pointerEl, preview: previewCanvas };
  }

  function setHudVisible(visible: boolean) {
    hudVisible = Boolean(visible);
    ensureElements().hud.style.display = hudVisible && trackingOn ? 'block' : 'none';
    if (hudVisible) {
      updateHud();
    }
  }

  function setPointerVisible(visible: boolean) {
    pointerVisible = Boolean(visible);
    ensureElements().pointer.style.display = (pointerVisible && hasPointerPosition) ? 'block' : 'none';
  }

  function setPreviewVisible(visible: boolean) {
    previewVisible = Boolean(visible);
    ensureElements().preview.style.display = previewVisible ? 'block' : 'none';
    window.dispatchEvent(new CustomEvent('gaze:preview-toggle', { detail: { on: previewVisible } }));
    updateHud();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const code = event.code || event.key;
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (code === 'KeyP') {
        event.preventDefault();
        setPointerVisible(!pointerVisible);
        console.debug('[GazeOverlay] Pointer', pointerVisible ? 'ON' : 'OFF');
        return;
      }
      if (code === 'KeyV') {
        event.preventDefault();
        setPreviewVisible(!previewVisible);
        console.debug('[GazeOverlay] Preview', previewVisible ? 'ON' : 'OFF');
        return;
      }
      if (code === 'KeyN') {
        event.preventDefault();
        window.__gazeHeadMode = !window.__gazeHeadMode;
        window.dispatchEvent(new CustomEvent('gaze:status', {
          detail: {
            phase: 'live',
            note: window.__gazeHeadMode ? 'head-pointer' : 'iris-pointer'
          }
        }));
        console.debug('[GazeOverlay] Head pointer mode', window.__gazeHeadMode ? 'ENABLED' : 'DISABLED');
        return;
      }
    }
    if (!event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (code === 'KeyH') {
        event.preventDefault();
        setHudVisible(!hudVisible);
        console.debug('[GazeOverlay] HUD', hudVisible ? 'ON' : 'OFF');
      }
    }
  }

  function handleStatus(event: CustomEvent<GazeStatusDetail>) {
    const detail: Partial<GazeStatusDetail> = event && event.detail ? event.detail : {};
    if (detail.phase) {
      statusPhase = detail.phase;
    }
    if ('note' in detail) {
      statusNote = detail.note || '';
    }
    updateHud();
  }

  function handlePoint(event: CustomEvent<GazePointDetail>) {
    if (!event || !event.detail || !trackingOn) return;
    const { x, y, conf, ts } = event.detail;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    ensureElements();

    hasPointerPosition = true;
    if (pointerVisible && pointerEl) {
      pointerEl.style.display = 'block';
      pointerEl.style.left = `${Math.round(x)}px`;
      pointerEl.style.top = `${Math.round(y)}px`;
    }

    if (typeof ts === 'number') {
      if (lastPointTs) {
        const dt = Math.max(1, ts - lastPointTs);
        const inst = 1000 / dt;
        fpsEMA = fpsEMA ? (fpsEMA * 0.8 + inst * 0.2) : inst;
      }
      lastPointTs = ts;
    } else if (lastPointTs) {
      const dt = Math.max(1, performance.now() - lastPointTs);
      const inst = 1000 / dt;
      fpsEMA = fpsEMA ? (fpsEMA * 0.8 + inst * 0.2) : inst;
      lastPointTs = performance.now();
    }

    if (typeof conf === 'number') {
      lastConfidence = conf;
    }

    updateHud();
  }

  function updateHud() {
    if (!hudEl || !hudVisible) {
      return;
    }
    const parts = [];
    if (statusPhase) {
      parts.push(`Headway: ${statusPhase}`);
    }
    if (statusNote) {
      parts.push(statusNote);
    }
    if (previewVisible) {
      parts.push('preview on');
    }
    if (fpsEMA) {
      parts.push(`${Math.round(fpsEMA)} fps`);
    }
    if (typeof lastConfidence === 'number') {
      parts.push(`conf=${lastConfidence.toFixed(2)}`);
    }
    hudEl.textContent = parts.length ? parts.join(' · ') : 'Headway: live';
  }

  ensureElements();
  updateHud();
})();

export {};
