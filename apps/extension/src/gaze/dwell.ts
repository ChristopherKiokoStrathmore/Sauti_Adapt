import { Readability } from '@mozilla/readability';
import { formatAISummary, escapeHtml } from '../shared/format';
import { tooltipCss, tooltipHead, waitHtml, INK, PAPER, LIME, MONO } from '../shared/page-theme';
import type { RuntimeMessage, SummaryResult } from '../shared/types';
import { errorMessage } from '../shared/types';
import { SUMMARIES_ENABLED } from '../shared/features';
import { clickablesNear, closestClickable, edgeDistance } from './targets';

type DwellTarget = { element: HTMLElement; type: 'link' | 'close-button'; distance: number };
type EdgeKey = 'top' | 'bottom' | 'left' | 'right';
interface GazeJob {
  id: number;
  url: string;
  element: HTMLElement;
  type: 'youtube' | 'page';
  videoId: string | null;
  startedAt: number;
}

(function() {
  'use strict';

  const POINT_EVENT = 'gaze:point';
  const STATUS_EVENT = 'gaze:status';
  const TOOLTIP_ID = 'gaze-summary-tooltip';
  const TOOLTIP_STYLE_ID = 'gaze-summary-tooltip-styles';
  const DEBUG_DWELL = true;
  const DEFAULT_DWELL_MS = 600;
  const RECENT_WINDOW_MS = 20000;
  const MAX_RECENT_ENTRIES = 32;
  const EDGE_PAD_PX = 180;
  const EDGE_HOLD_MS = 400;
  const DEADZONE_PX = 12;
  const SNAP_REACH_PX = 42;     // pull onto a clickable whose edge is this close
  const STICKY_EDGE_PX = 24;    // keep a snapped target while within this of its edge
  const SCROLL_ZONE_ID = 'gaze-scroll-zones';
  const NAV_ZONE_WIDTH = 80; // Width of left/right navigation zones in pixels
  const DWELL_INDICATOR_ID = 'gaze-dwell-indicator';

  let gazeEnabled = false;
  let dwellThreshold = DEFAULT_DWELL_MS;
  let phase = 'ready';
  let tooltip: HTMLDivElement | null = null;
  let tooltipContent: HTMLDivElement | null = null; // Content wrapper inside tooltip
  let tooltipCloseBtn: HTMLButtonElement | null = null; // Reference to close button for magnetic snap
  let currentJob: GazeJob | null = null;
  let dwellTarget: HTMLElement | null = null;
  let dwellAccum = 0;
  let lastPointTs = performance.now();
  let recentSummaries = new Map<string, number>();
  let requestSeq = 0;
  let debugLastHref: string | null = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let effectiveX: number | null = null;
  let effectiveY: number | null = null;
  let snappedTarget: DwellTarget | null = null; // Can be link or close button
  let lastSnapLink: HTMLElement | null = null;
  let scrollZones: HTMLDivElement | null = null;
  let navZoneDwelling: 'back' | 'forward' | null = null; // Which nav zone we're dwelling in
  let navDwellStart = 0; // When nav zone dwell started
  let dwellIndicator: HTMLDivElement | null = null;
  const edgeHold: Record<EdgeKey, number> = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  };

  const processingMessage = waitHtml('Writing the summary on this device…');

  function ensureScrollZones(): HTMLDivElement | null {
    // Check if zones exist AND are in the DOM
    if (scrollZones && scrollZones.parentNode) {
      return scrollZones;
    }
    // If body doesn't exist yet, can't create zones
    if (!document.body) {
      return null;
    }
    const zones = document.createElement('div');
    scrollZones = zones;
    zones.id = SCROLL_ZONE_ID;
    zones.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
    `;

    // Each zone is a lime edge rule plus a label: the word says what dwelling there does.
    const makeZone = (id: string, edge: 'top' | 'bottom' | 'left' | 'right', label: string, size: number) => {
      const zone = document.createElement('div');
      zone.id = id;
      const horizontal = edge === 'top' || edge === 'bottom';
      zone.style.cssText = `
        position: absolute; ${edge}: 0;
        ${horizontal ? `left: 0; right: 0; height: ${size}px;` : `top: 0; bottom: 0; width: ${size}px;`}
        border-${edge}: 4px solid ${LIME};
        opacity: 0; transition: opacity 0.2s ease;
        display: flex; align-items: ${edge === 'bottom' ? 'flex-end' : horizontal ? 'flex-start' : 'center'};
        justify-content: ${edge === 'right' ? 'flex-end' : horizontal ? 'center' : 'flex-start'};
      `;
      const tag = document.createElement('span');
      tag.textContent = label;
      tag.style.cssText = `
        margin: 12px; padding: 7px 11px; border-radius: 7px;
        background: ${INK}; color: ${PAPER}; border: 1px solid rgba(238,238,230,0.16);
        font: 600 12px/1 ${MONO}; letter-spacing: 0.04em; white-space: nowrap;
      `;
      zone.appendChild(tag);
      return zone;
    };
    const topZone = makeZone('gaze-scroll-top', 'top', '↑ Scroll up', EDGE_PAD_PX);
    const bottomZone = makeZone('gaze-scroll-bottom', 'bottom', '↓ Scroll down', EDGE_PAD_PX);
    const leftZone = makeZone('gaze-nav-left', 'left', '← Back', NAV_ZONE_WIDTH);
    const rightZone = makeZone('gaze-nav-right', 'right', 'Forward →', NAV_ZONE_WIDTH);

    zones.appendChild(topZone);
    zones.appendChild(bottomZone);
    zones.appendChild(leftZone);
    zones.appendChild(rightZone);
    document.body.appendChild(zones);
    return zones;
  }

  function updateNavZoneVisibility(leftActive: boolean, rightActive: boolean) {
    if (!scrollZones) return;
    const leftZone = document.getElementById('gaze-nav-left');
    const rightZone = document.getElementById('gaze-nav-right');
    if (leftZone) {
      leftZone.style.opacity = leftActive ? '1' : '0';
    }
    if (rightZone) {
      rightZone.style.opacity = rightActive ? '1' : '0';
    }
  }

  function updateScrollZoneVisibility(topIntensity: number, bottomIntensity: number) {
    if (!scrollZones) return;
    const topZone = document.getElementById('gaze-scroll-top');
    const bottomZone = document.getElementById('gaze-scroll-bottom');
    if (topZone) {
      topZone.style.opacity = topIntensity > 0.5 ? String(Math.min(1, topIntensity)) : '0';
    }
    if (bottomZone) {
      bottomZone.style.opacity = bottomIntensity > 0.5 ? String(Math.min(1, bottomIntensity)) : '0';
    }
  }

  // There is one pointer on the page. Dwell progress is drawn as a ring around that
  // pointer (overlay.ts listens for gaze:dwell), and the element it has snapped to gets
  // a thin frame. Nutshell drew a second dot at the link's centre, which read as a
  // second pointer once both were the same colour.
  let lastProgressSent = -1;
  function sendDwellProgress(progress: number) {
    const rounded = Math.round(progress * 50) / 50;
    if (rounded === lastProgressSent) return;
    lastProgressSent = rounded;
    window.dispatchEvent(new CustomEvent('gaze:dwell', { detail: { progress: rounded } }));
  }

  function ensureDwellIndicator(): HTMLDivElement {
    if (dwellIndicator) {
      return dwellIndicator;
    }
    const frame = document.createElement('div');
    dwellIndicator = frame;
    frame.id = DWELL_INDICATOR_ID;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = `
      position: fixed;
      box-sizing: border-box;
      border: 2px solid ${LIME};
      border-radius: 8px;
      box-shadow: 0 0 0 2px ${INK};
      pointer-events: none;
      z-index: 2147483646;
      display: none;
    `;
    document.body.appendChild(frame);
    return frame;
  }

  function updateDwellIndicator(link: HTMLElement | null, progress: number) {
    const frame = ensureDwellIndicator();
    if (!link || progress <= 0) {
      frame.style.display = 'none';
      sendDwellProgress(0);
      return;
    }
    const rect = link.getBoundingClientRect();
    const pad = 4;
    frame.style.display = 'block';
    frame.style.left = `${rect.left - pad}px`;
    frame.style.top = `${rect.top - pad}px`;
    frame.style.width = `${rect.width + pad * 2}px`;
    frame.style.height = `${rect.height + pad * 2}px`;
    sendDwellProgress(progress);
  }

  /** Frame the snapped target without dwell progress, so the person sees what a click will hit. */
  function showSnapFrame(el: HTMLElement | null) {
    const frame = ensureDwellIndicator();
    if (!el) {
      frame.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    const pad = 4;
    frame.style.display = 'block';
    frame.style.left = `${rect.left - pad}px`;
    frame.style.top = `${rect.top - pad}px`;
    frame.style.width = `${rect.width + pad * 2}px`;
    frame.style.height = `${rect.height + pad * 2}px`;
  }

  function hideDwellIndicator() {
    if (dwellIndicator) {
      dwellIndicator.style.display = 'none';
    }
    sendDwellProgress(0);
  }

  function ensureTooltipStyles() {
    if (document.getElementById(TOOLTIP_STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = TOOLTIP_STYLE_ID;
    style.textContent = tooltipCss(TOOLTIP_ID, 'gaze-tooltip-close-btn');
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureTooltip(): { tip: HTMLDivElement; content: HTMLDivElement } {
    // If tooltip exists but doesn't have the content wrapper, recreate it
    if (tooltip && tooltipContent && tooltipContent.parentNode === tooltip) {
      return { tip: tooltip, content: tooltipContent };
    }

    // Remove old tooltip if it exists (for clean recreation)
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
      tooltip = null;
      tooltipContent = null;
    }

    ensureTooltipStyles();
    const tip = document.createElement('div');
    tooltip = tip;
    tip.id = TOOLTIP_ID;
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-label', 'Headway summary');
    tip.insertAdjacentHTML('afterbegin', tooltipHead);

    // Create content wrapper (so innerHTML changes don't remove close button)
    const content = document.createElement('div');
    tooltipContent = content;
    content.className = 'gaze-tooltip-content-wrapper';
    tip.appendChild(content);

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'gaze-tooltip-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (or dwell to click)';
    closeBtn.setAttribute('aria-label', 'Close summary');
    closeBtn.setAttribute('data-gaze-clickable', 'true'); // Make it work with gaze dwell
    closeBtn.setAttribute('data-is-close-button', 'true'); // Mark as close button for detection
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      hideTooltip();
      // Clear current job so tooltip doesn't reappear
      if (currentJob) {
        currentJob = null;
      }
    });
    tip.appendChild(closeBtn);
    tooltipCloseBtn = closeBtn; // Save reference for magnetic snap

    tip.addEventListener('mouseenter', () => {
      dwellAccum = 0;
    });

    document.body.appendChild(tip);
    return { tip, content };
  }

  function showTooltipForLink(link: HTMLElement | null, html: string) {
    if (!link) {
      return;
    }
    const { tip, content } = ensureTooltip();
    content.innerHTML = html;
    tip.style.display = 'block';
    tip.style.opacity = '0';
    positionTooltip(link);
    requestAnimationFrame(() => {
      tip.style.opacity = '1';
    });
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.style.opacity = '0';
    setTimeout(() => {
      if (tooltip && tooltipContent) {
        tooltip.style.display = 'none';
        tooltipContent.innerHTML = '';
      }
    }, 180);
  }

  function positionTooltip(link: HTMLElement | null) {
    if (!tooltip || !link) return;
    const rect = link.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 14;
    let top = rect.bottom + margin;
    let left = rect.left;
    const tipRect = tooltip.getBoundingClientRect();
    if (top + tipRect.height > viewportHeight - margin) {
      top = rect.top - tipRect.height - margin;
      if (top < margin) {
        top = Math.max(margin, (viewportHeight - tipRect.height) / 2);
      }
    }
    if (left + tipRect.width > viewportWidth - margin) {
      left = viewportWidth - tipRect.width - margin;
    }
    if (left < margin) {
      left = margin;
    }
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function cleanRecentSummaries() {
    if (recentSummaries.size <= MAX_RECENT_ENTRIES) {
      return;
    }
    const threshold = Date.now() - RECENT_WINDOW_MS;
    recentSummaries = new Map(Array.from(recentSummaries.entries()).filter(([_, ts]) => ts >= threshold));
  }

  function shouldSkipUrl(url: string): boolean {
    const lastTs = recentSummaries.get(url);
    if (!lastTs) return false;
    return (Date.now() - lastTs) < RECENT_WINDOW_MS;
  }

  function updateRecent(url: string) {
    recentSummaries.set(url, Date.now());
    cleanRecentSummaries();
  }

  function beep(frequency = 440, duration = 120) {
    try {
      const AudioContextCtor: typeof AudioContext | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);
      osc.start(now);
      osc.stop(now + duration / 1000 + 0.05);
      osc.onended = () => ctx.close();
    } catch (error) {
      // ignore audio errors
    }
  }

  /** Nearest clickable to (x, y): the one under the pointer, else the closest edge within reach. */
  function nearestLink(x: number, y: number, maxDistance = SNAP_REACH_PX): HTMLElement | null {
    const under = closestClickable(document.elementFromPoint(x, y));
    if (under) {
      return under;
    }
    return clickablesNear(x, y, maxDistance, 1)[0]?.element ?? null;
  }

  function nearestTarget(x: number, y: number, maxDistance = 42): DwellTarget | null {
    // Check close button first if tooltip is visible
    if (tooltipCloseBtn && tooltip && tooltip.style.display === 'block') {
      const btnRect = tooltipCloseBtn.getBoundingClientRect();
      if (btnRect && btnRect.width > 0 && btnRect.height > 0) {
        const cx = btnRect.left + btnRect.width / 2;
        const cy = btnRect.top + btnRect.height / 2;
        const dist = Math.hypot(cx - x, cy - y);
        // Use same maxDistance for consistency
        if (dist < maxDistance) {
          return { element: tooltipCloseBtn, type: 'close-button', distance: dist };
        }
      }
    }

    // Find the nearest clickable (type 'link' means any clickable target here)
    const link = nearestLink(x, y, maxDistance);
    if (link) {
      return { element: link, type: 'link', distance: edgeDistance(x, y, link.getBoundingClientRect()) };
    }

    return null;
  }

  function applyDeadzone(x: number, y: number): { x: number; y: number } {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x, y };
    }
    if (effectiveX === null || effectiveY === null) {
      effectiveX = x;
      effectiveY = y;
      return { x, y };
    }
    const dist = Math.hypot(x - effectiveX, y - effectiveY);
    if (dist < DEADZONE_PX) {
      return { x: effectiveX, y: effectiveY };
    }
    effectiveX = x;
    effectiveY = y;
    return { x, y };
  }

  function snapTarget(x: number, y: number): DwellTarget | null {
    // Check if current snapped target is still valid
    if (snappedTarget && snappedTarget.element && (!document.contains(snappedTarget.element))) {
      snappedTarget = null;
    }

    // Stay on the snapped target while the pointer is near its edge, unless the pointer
    // is now directly over a different clickable (then that one wins).
    if (snappedTarget && snappedTarget.element) {
      const rect = snappedTarget.element.getBoundingClientRect();
      if (rect && rect.width && rect.height && edgeDistance(x, y, rect) < STICKY_EDGE_PX) {
        const under = closestClickable(document.elementFromPoint(x, y));
        if (!under || under === snappedTarget.element || snappedTarget.element.contains(under)) {
          return snappedTarget;
        }
      }
      snappedTarget = null;
    }

    // Find nearest target (clickable or close button)
    const next = nearestTarget(x, y, SNAP_REACH_PX);
    if (next) {
      snappedTarget = next;
      // Also update lastSnapLink if it's a link
      if (next.type === 'link') {
        lastSnapLink = next.element;
      }
    }
    return snappedTarget;
  }

  function edgeLoop(x: number, y: number) {
    // Ensure scroll zones are created (in case body wasn't ready during init)
    ensureScrollZones();

    const now = performance.now();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const topIntensity = y < EDGE_PAD_PX ? 1 - (y / EDGE_PAD_PX) : 0;
    const bottomIntensity = y > h - EDGE_PAD_PX ? (y - (h - EDGE_PAD_PX)) / EDGE_PAD_PX : 0;
    const leftIntensity = x < EDGE_PAD_PX ? 1 - (x / EDGE_PAD_PX) : 0;
    const rightIntensity = x > w - EDGE_PAD_PX ? (x - (w - EDGE_PAD_PX)) / EDGE_PAD_PX : 0;

    const intents: Record<EdgeKey, number> = {
      top: topIntensity,
      bottom: bottomIntensity,
      left: leftIntensity,
      right: rightIntensity
    };

    for (const key of Object.keys(intents) as EdgeKey[]) {
      const intensity = intents[key];
      if (intensity > 0.65) {
        if (!edgeHold[key]) {
          edgeHold[key] = now;
        } else if (now - edgeHold[key] > EDGE_HOLD_MS) {
          if (key === 'top') {
            window.scrollBy({ top: -(120 + 360 * intensity), behavior: 'smooth' });
            beep(520, 120);
          } else if (key === 'bottom') {
            window.scrollBy({ top: 120 + 360 * intensity, behavior: 'smooth' });
            beep(420, 120);
          }
          edgeHold[key] = now;
        }
      } else {
        edgeHold[key] = 0;
      }
    }

    updateScrollZoneVisibility(topIntensity, bottomIntensity);
  }

  function synthClick(target: Element | null, button = 0) {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const clientX = clamp(lastPointerX, rect.left, rect.right);
    const clientY = clamp(lastPointerY, rect.top, rect.bottom);
    if (target instanceof HTMLElement) {
      try {
        target.focus({ preventScroll: true });
      } catch (error) {
        // ignore focus errors
      }
    }
    const downInit = {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button,
      buttons: button === 2 ? 2 : 1
    };
    const upInit = {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button,
      buttons: 0
    };

    ['pointerover', 'pointerenter', 'mousemove', 'pointerdown', 'mousedown'].forEach((type) => {
      target.dispatchEvent(new MouseEvent(type, downInit));
    });
    ['mouseup', 'pointerup', 'click'].forEach((type) => {
      target.dispatchEvent(new MouseEvent(type, upInit));
    });
    if (button === 2) {
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: 2
      }));
    }
  }

  function handlePointEvent(event: CustomEvent<GazePointDetail>) {
    if (!gazeEnabled || phase !== 'live') {
      return;
    }
    const detail: Partial<GazePointDetail> = event.detail || {};
    if (typeof detail.x !== 'number' || typeof detail.y !== 'number') {
      return;
    }
    if (!Number.isFinite(detail.x) || !Number.isFinite(detail.y)) {
      return;
    }
    const rawX = clamp(detail.x, 0, window.innerWidth - 1);
    const rawY = clamp(detail.y, 0, window.innerHeight - 1);
    lastPointerX = rawX;
    lastPointerY = rawY;
    edgeLoop(rawX, rawY);

    const { x, y } = applyDeadzone(rawX, rawY);

    const ts = typeof detail.ts === 'number' ? detail.ts : performance.now();

    // Check if in navigation zones (left = back, right = forward)
    const inLeftZone = rawX < NAV_ZONE_WIDTH;
    const inRightZone = rawX > (window.innerWidth - NAV_ZONE_WIDTH);

    // Update navigation zone visibility
    updateNavZoneVisibility(inLeftZone, inRightZone);

    // Track navigation zone dwelling
    if (inLeftZone && navZoneDwelling !== 'back') {
      navZoneDwelling = 'back';
      navDwellStart = ts;
    } else if (inRightZone && navZoneDwelling !== 'forward') {
      navZoneDwelling = 'forward';
      navDwellStart = ts;
    } else if (!inLeftZone && !inRightZone) {
      navZoneDwelling = null;
      navDwellStart = 0;
    }
    const delta = Math.max(0, Math.min(500, ts - lastPointTs));
    lastPointTs = ts;

    const target = snapTarget(x, y);
    const targetElement = target ? target.element : null;

    if (target && target.type === 'link') {
      lastSnapLink = target.element;
    } else if (!target) {
      lastSnapLink = null;
    }

    if (DEBUG_DWELL) {
      const href = (target && target.type === 'link' && target.element instanceof HTMLAnchorElement && target.element.href) ? target.element.href : null;
      const label = target ? (target.type === 'close-button' ? '[CLOSE BUTTON]' : href) : null;
      if (label !== debugLastHref) {
        console.debug('[GazeDwell] target:', label);
        debugLastHref = label;
      }
    }

    // Dwell exists to open a summary. With summaries off it does nothing; the frame
    // still shows which target a mouth click will hit.
    if (!SUMMARIES_ENABLED) {
      dwellTarget = null;
      dwellAccum = 0;
      showSnapFrame(targetElement);
      return;
    }

    if (targetElement !== dwellTarget) {
      dwellTarget = targetElement;
      dwellAccum = 0;
      hideDwellIndicator();
    }

    if (!target || !targetElement) {
      hideDwellIndicator();
      return;
    }

    dwellAccum += delta;
    const progress = Math.min(1, dwellAccum / dwellThreshold);
    updateDwellIndicator(targetElement, progress);

    if (dwellAccum >= dwellThreshold) {
      dwellAccum = 0;
      hideDwellIndicator();

      if (target.type === 'close-button') {
        // Close the tooltip
        hideTooltip();
        if (currentJob) {
          currentJob = null;
        }
      } else if (target.type === 'link') {
        // Trigger summary
        triggerSummary(target.element);
      }
    }
  }

  function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  function triggerSummary(element: HTMLElement) {
    // Links can also be role="link" elements; only real anchors carry an href to summarize.
    const link = element as HTMLAnchorElement;
    if (!link || !link.href) {
      return;
    }
    const url = normalizeUrl(link.href);
    if (!url) {
      return;
    }
    if (currentJob && currentJob.url === url) {
      return;
    }
    if (shouldSkipUrl(url)) {
      return;
    }

    updateRecent(url);
    cancelActiveJob('replaced_by_new_link');

    requestSeq += 1;
    const requestId = requestSeq;
    const host = safeHostname(url);
    const isYouTube = isYouTubeUrl(host);
    const videoId = isYouTube ? extractYouTubeVideoId(url) : null;

    currentJob = {
      id: requestId,
      url,
      element: link,
      type: isYouTube ? 'youtube' : 'page',
      videoId,
      startedAt: Date.now()
    };

    showTooltipForLink(link, processingMessage);

    if (isYouTube && videoId) {
      handleYouTubeSummary(url, videoId, requestId);
      return;
    }

    handlePageSummary(url, link, requestId).catch((error) => {
      console.error('[GazeDwell] Summary failed:', error);
      if (currentJob && currentJob.id === requestId) {
        renderError('Unable to summarize this page.');
        clearCurrentJob();
      }
    });
  }

  function cancelActiveJob(reason: string) {
    if (!currentJob) {
      return;
    }
    if (currentJob.type === 'youtube' && currentJob.videoId) {
      try {
        chrome.runtime.sendMessage({
          action: 'ABORT_YOUTUBE_SUMMARY',
          videoId: currentJob.videoId,
          reason
        });
      } catch (error) {
        console.warn('[GazeDwell] Failed to send abort message:', error);
      }
    }
    currentJob = null;
    hideTooltip();
  }

  async function handleYouTubeSummary(url: string, videoId: string, requestId: number) {
    try {
      const response = await sendMessagePromise<SummaryResult>({
        action: 'GET_YOUTUBE_SUMMARY',
        videoId,
        url
      });
      if (!currentJob || currentJob.id !== requestId) {
        return;
      }
      if (!response) {
        renderError('No response from background.');
        clearCurrentJob();
        return;
      }
      if (response.status === 'complete' && response.summary) {
        renderFinalSummary(response.summary);
        clearCurrentJob();
        return;
      }
      if (response.status === 'aborted') {
        renderError('Summary cancelled.');
        clearCurrentJob();
        return;
      }
      if (response.status === 'error') {
        const message = response.message || response.error || 'Summary failed.';
        renderError(message);
        clearCurrentJob();
        return;
      }
    } catch (error) {
      if (currentJob && currentJob.id === requestId) {
        renderError(errorMessage(error, 'Summary failed.'));
        clearCurrentJob();
      }
    }
  }

  async function handlePageSummary(url: string, link: HTMLElement, requestId: number) {
    const fetchResponse = await sendMessagePromise<{ html?: string; error?: string }>({ type: 'FETCH_CONTENT', url });
    if (currentJob && currentJob.id !== requestId) {
      return;
    }
    if (!fetchResponse || fetchResponse.error) {
      const message = fetchResponse && fetchResponse.error ? fetchResponse.error : 'Unable to fetch page content.';
      renderError(message);
      clearCurrentJob();
      return;
    }

    const { title, textContent } = extractContent(fetchResponse.html ?? '', url, link);
    renderProcessing();

    const summaryResponse = await sendMessagePromise<SummaryResult>({
      type: 'SUMMARIZE_CONTENT',
      url,
      title,
      textContent
    });

    if (!currentJob || currentJob.id !== requestId) {
      return;
    }

    if (!summaryResponse || summaryResponse.status === 'error') {
      const message = summaryResponse && summaryResponse.error ? summaryResponse.error : 'Failed to summarize content.';
      renderError(message);
      clearCurrentJob();
      return;
    }

    if (summaryResponse.status === 'aborted') {
      renderError('Summary cancelled.');
      clearCurrentJob();
      return;
    }

    if (summaryResponse.status === 'complete' && summaryResponse.summary) {
      renderFinalSummary(summaryResponse.summary);
      clearCurrentJob();
      return;
    }

    renderError('Summary unavailable.');
    clearCurrentJob();
  }

  function renderProcessing() {
    if (currentJob) {
      showTooltipForLink(currentJob.element, processingMessage);
    }
  }

  function renderFinalSummary(summary: string) {
    if (!currentJob) return;
    const html = formatAISummary(summary || '');
    showTooltipForLink(currentJob.element, html);
  }

  function renderStreamUpdate(html: string) {
    if (!currentJob) return;
    showTooltipForLink(currentJob.element, html);
  }

  function renderError(message: string) {
    if (!currentJob) return;
    const safe = escapeHtml(message || 'Something went wrong.');
    const html = `<p class="hw-tip-error">${safe}</p>`;
    showTooltipForLink(currentJob.element, html);
  }

  function clearCurrentJob() {
    currentJob = null;
  }

  function extractContent(html: string, url: string, link: HTMLElement): { title: string; textContent: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const clone = doc.cloneNode(true) as Document;
    let title = doc.title || link.textContent || url;
    let textContent = '';

    try {
      const reader = new Readability(clone);
      const article = reader.parse();
      if (article && article.textContent && article.textContent.trim().length > 120) {
        title = article.title || title;
        textContent = article.textContent;
      }
    } catch (error) {
      console.warn('[GazeDwell] Readability parse failed:', error);
    }

    if (!textContent || textContent.trim().length < 80) {
      const fallback = doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
        doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
      textContent = fallback || link.textContent || 'No extractable content available.';
    }

    return { title, textContent };
  }

  function normalizeUrl(url: string): string | null {
    try {
      return new URL(url, window.location.href).toString();
    } catch (error) {
      return null;
    }
  }

  function safeHostname(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (error) {
      return '';
    }
  }

  function isYouTubeUrl(hostname: string): boolean {
    if (!hostname) return false;
    return hostname.includes('youtube.com') || hostname === 'youtu.be' || hostname.endsWith('.youtu.be');
  }

  function extractYouTubeVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'youtu.be' || parsed.hostname.endsWith('.youtu.be')) {
        const segments = parsed.pathname.split('/').filter(Boolean);
        return segments[0] || null;
      }
      if (parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts[1] || parts[0] || null;
      }
      if (parsed.pathname.startsWith('/live/')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        return parts[1] || parts[0] || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  function sendMessagePromise<T>(payload: RuntimeMessage): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(payload, (response: T | undefined) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || 'Unknown runtime error'));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function handleRuntimeMessage(message: RuntimeMessage) {
    if (!currentJob) {
      return;
    }
    if (message.type === 'STREAMING_UPDATE') {
      if (message.url && message.url === currentJob.url) {
        renderStreamUpdate(message.content ?? '');
      }
    }
    if (message.type === 'PROCESSING_STATUS') {
      if (message.url && currentJob && message.url === currentJob.url && message.status === 'started') {
        renderProcessing();
      }
    }
  }

  function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== 'local') return;
    if (changes.gazeEnabled) {
      gazeEnabled = Boolean(changes.gazeEnabled.newValue);
      if (!gazeEnabled) {
        cancelActiveJob('feature_disabled');
      }
    }
    if (changes.gazeDwellMs) {
      const value = changes.gazeDwellMs.newValue;
      if (typeof value === 'number' && value >= 200) {
        dwellThreshold = value;
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && currentJob) {
      event.preventDefault();
      cancelActiveJob('user_cancelled');
    }
  }

  function handleScroll() {
    if (currentJob && currentJob.element) {
      positionTooltip(currentJob.element);
    }
  }

  window.addEventListener('blink:click', (event) => {
    const button = event && event.detail && event.detail.button === 'right' ? 2 : 0;
    const target = lastSnapLink || nearestLink(lastPointerX, lastPointerY) || document.elementFromPoint(lastPointerX, lastPointerY);
    if (!target) {
      beep(280, 140);
      return;
    }
    synthClick(target, button);
    beep(button === 2 ? 320 : 560, 150);
  });

  // Smile-to-click: trigger click on magnetically snapped target when user smiles
  window.addEventListener('smile:click', (event) => {
    // Priority 1: Check if dwelling in navigation zone
    if (navZoneDwelling) {
      const now = performance.now();
      const dwellDuration = now - navDwellStart;

      // Require at least 300ms dwell before confirming navigation
      if (dwellDuration >= 300) {
        if (navZoneDwelling === 'back') {
          window.history.back();
          beep(400, 100); // Low beep for back
          console.debug('[GazeDwell] Navigate BACK via mouth click');
        } else if (navZoneDwelling === 'forward') {
          window.history.forward();
          beep(800, 100); // High beep for forward
          console.debug('[GazeDwell] Navigate FORWARD via mouth click');
        }
        navZoneDwelling = null;
        navDwellStart = 0;
        return;
      }
    }

    // Priority 2: Click on snapped target or nearest link
    const target = lastSnapLink || nearestLink(lastPointerX, lastPointerY) || document.elementFromPoint(lastPointerX, lastPointerY);
    if (!target) {
      beep(280, 140);  // Error beep if no target
      return;
    }
    synthClick(target, 0);  // Left click only (button = 0)
    beep(660, 150);  // Higher pitch beep for smile click (distinguishable from blink)
    console.debug(`[GazeDwell] Smile click executed on:`, target);
  });

  function init() {
    ensureTooltipStyles();
    ensureScrollZones();
    window.addEventListener(POINT_EVENT, handlePointEvent);
    window.addEventListener(STATUS_EVENT, (event) => {
      const detail: Partial<GazeStatusDetail> = event.detail || {};
      phase = detail.phase || phase;
      if (phase !== 'live') {
        dwellAccum = 0;
      }
    });
    window.addEventListener('gaze:calibration-started', () => {
      // Forcibly hide tooltip during calibration (both active and completed)
      cancelActiveJob('calibration_started');
      hideTooltip();
      console.debug('[GazeDwell] Tooltip forcibly hidden for calibration');
    });
    window.addEventListener('gaze:calibration-stopped', () => {
      // Tooltip will naturally reappear when user looks at links
      console.debug('[GazeDwell] Calibration ended, tooltip can reappear');
    });
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    chrome.storage.onChanged.addListener(handleStorageChange);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    chrome.storage.local.get(['gazeEnabled', 'gazeDwellMs'], (result) => {
      gazeEnabled = Boolean(result && result.gazeEnabled);
      const dwell = result && typeof result.gazeDwellMs === 'number' ? result.gazeDwellMs : DEFAULT_DWELL_MS;
      dwellThreshold = dwell >= 200 ? dwell : DEFAULT_DWELL_MS;
    });
  }



  init();
})();

export {};
