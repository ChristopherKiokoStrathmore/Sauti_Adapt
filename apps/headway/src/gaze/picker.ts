/**
 * Precision picker (Research/001, solution C).
 *
 * When a mouth click lands between two or more small targets that are about equally
 * close, Headway does not guess. It numbers those targets on the page and shows the
 * same numbers as large tiles near the pointer; the person picks a tile with the
 * head pointer and a mouth click. Each tile is far larger and further apart than the
 * originals, so it is easy to hit.
 *
 * This stands in for a magnifier: a content script cannot render a live, clickable
 * zoomed copy of the page, but it can offer the same choice at a usable size.
 */
import { describeTarget } from './targets';
import { INK, PAPER, MUTED, LINE, LIME, FONT, MONO } from '../shared/page-theme';

const ROOT_ID = 'headway-picker';
const AUTO_CLOSE_MS = 15000;

let root: HTMLDivElement | null = null;
let badges: HTMLDivElement[] = [];
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export function isPickerOpen(): boolean {
  return !!root;
}

export function isInPicker(el: Element | null): boolean {
  return !!(root && el && root.contains(el));
}

export function closePicker() {
  root?.remove();
  root = null;
  badges.forEach((b) => b.remove());
  badges = [];
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  keyHandler = null;
}

function badge(n: number, rect: DOMRect): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = String(n);
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `
    position: fixed; z-index: 2147483646; pointer-events: none;
    left: ${Math.max(2, rect.left - 4)}px; top: ${Math.max(2, rect.top - 4)}px;
    min-width: 22px; height: 22px; padding: 0 5px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    background: ${LIME}; color: ${INK}; border: 2px solid ${INK}; border-radius: 6px;
    font: 700 12px/1 ${MONO};
  `;
  const outline = document.createElement('div');
  outline.style.cssText = `
    position: fixed; z-index: 2147483645; pointer-events: none; box-sizing: border-box;
    left: ${rect.left - 3}px; top: ${rect.top - 3}px; width: ${rect.width + 6}px; height: ${rect.height + 6}px;
    border: 2px solid ${LIME}; border-radius: 6px; box-shadow: 0 0 0 2px ${INK};
  `;
  document.documentElement.appendChild(outline);
  badges.push(outline);
  return el;
}

/**
 * Show the picker for `targets` (nearest first) around (x, y). `onChoose` runs with
 * the chosen element; the picker is already closed by then.
 */
export function openPicker(targets: HTMLElement[], x: number, y: number, onChoose: (el: HTMLElement) => void) {
  closePicker();
  const chosen = targets.slice(0, 6);
  if (!chosen.length) return;

  chosen.forEach((el, i) => {
    const b = badge(i + 1, el.getBoundingClientRect());
    document.documentElement.appendChild(b);
    badges.push(b);
  });

  const panel = document.createElement('div');
  root = panel;
  panel.id = ROOT_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Choose what to click');
  const cols = chosen.length > 2 ? 2 : 1;
  panel.style.cssText = `
    position: fixed; z-index: 2147483647; box-sizing: border-box;
    width: ${cols === 2 ? 440 : 260}px; max-width: calc(100vw - 24px);
    padding: 14px; border-radius: 14px;
    background: ${INK}; color: ${PAPER}; border: 1px solid ${LINE};
    font-family: ${FONT};
  `;

  const head = document.createElement('div');
  head.style.cssText = `display:flex;align-items:center;gap:8px;margin:0 0 12px;font:600 11px/1 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${MUTED}`;
  head.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${LIME};display:inline-block"></span><span>Which one?</span>`;
  panel.appendChild(head);

  const grid = document.createElement('div');
  grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px`;
  panel.appendChild(grid);

  const tileCss = `
    box-sizing:border-box; min-height:72px; padding:12px 14px; margin:0;
    display:flex; align-items:center; gap:12px; text-align:left; cursor:pointer;
    background:#171814; color:${PAPER}; border:1px solid ${LINE}; border-radius:10px;
    font:600 15px/1.25 ${FONT};
  `;
  chosen.forEach((el, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.style.cssText = tileCss;
    tile.innerHTML = `<span style="flex:none;min-width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:7px;background:${LIME};color:${INK};font:700 14px/1 ${MONO}">${i + 1}</span>`;
    const label = document.createElement('span');
    label.textContent = describeTarget(el);
    tile.appendChild(label);
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePicker();
      onChoose(el);
    });
    grid.appendChild(tile);
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.style.cssText = tileCss + `justify-content:center;color:${MUTED};grid-column:1 / -1;min-height:56px`;
  cancel.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closePicker();
  });
  grid.appendChild(cancel);

  document.documentElement.appendChild(panel);

  // Place it next to the group of numbered targets without covering any of them:
  // below if there is room, else above, else beside; always fully on screen.
  const box = panel.getBoundingClientRect();
  const rects = chosen.map((el) => el.getBoundingClientRect());
  const group = {
    left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
    top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom))
  };
  const gap = 20;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitX = (l: number) => Math.max(12, Math.min(l, vw - box.width - 12));
  const fitY = (t: number) => Math.max(12, Math.min(t, vh - box.height - 12));
  let left: number;
  let top: number;
  if (group.bottom + gap + box.height <= vh - 12) {
    top = group.bottom + gap;
    left = fitX(x - box.width / 2);
  } else if (group.top - gap - box.height >= 12) {
    top = group.top - gap - box.height;
    left = fitX(x - box.width / 2);
  } else {
    top = fitY(y - box.height / 2);
    left = group.right + gap + box.width <= vw - 12 ? group.right + gap : fitX(group.left - gap - box.width);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePicker();
    }
  };
  document.addEventListener('keydown', keyHandler, true);
  closeTimer = setTimeout(closePicker, AUTO_CLOSE_MS);
}
