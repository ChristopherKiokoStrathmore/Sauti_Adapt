// In-page half of the harness: what she can act on (affordances) and the actions
// themselves. Runs in the agent content script, only on sites she enabled.
// Sends nothing anywhere; the side panel asks, this answers.

import type { Affordance, AffordanceKind } from './local.ts';

const SELECTOR = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]', '[contenteditable="true"]',
].join(',');
const MAX = 150;

const ids = new WeakMap<Element, string>();
const byId = new Map<string, WeakRef<Element>>();
let counter = 0;

function idOf(el: Element): string {
  let id = ids.get(el);
  if (!id) {
    id = 'h' + (++counter);
    ids.set(el, id);
    byId.set(id, new WeakRef(el));
    el.setAttribute('data-headway-id', id);
  }
  return id;
}

export function elementFor(id: string): HTMLElement | null {
  const el = byId.get(id)?.deref();
  return el instanceof HTMLElement && el.isConnected ? el : null;
}

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

export function accessibleName(el: HTMLElement): string {
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = clean(labelledBy.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' '));
    if (t) return t;
  }
  // Editable areas: what is inside is her own writing, never their name.
  if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
    const wrap = el.closest('label');
    return clean(wrap?.textContent && wrap !== el ? wrap.textContent : el.getAttribute('title') || el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || 'Text box');
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type)) return clean(el.value) || el.type;
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const wrap = el.closest('label');
    const label = clean(forLabel?.textContent || wrap?.textContent);
    if (label) return label;
    return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'));
  }
  const text = clean(el.innerText || el.textContent);
  if (text) return text;
  const img = el.querySelector('img[alt]');
  return clean(img?.getAttribute('alt') || el.getAttribute('title'));
}

export function kindOf(el: HTMLElement): AffordanceKind {
  const role = el.getAttribute('role');
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (t === 'password') return 'password';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
    if (t === 'number' || t === 'tel' || el.inputMode === 'numeric' || el.autocomplete === 'one-time-code') return 'number';
    return 'textbox';
  }
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return 'textbox';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLAnchorElement || role === 'link') return 'link';
  if (el instanceof HTMLButtonElement || role === 'button' || el.tagName === 'SUMMARY') return 'button';
  if (role === 'tab') return 'tab';
  if (role === 'checkbox') return 'checkbox';
  if (role === 'radio') return 'radio';
  return 'other';
}

export function isSubmit(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement) return !!el.form && (el.type === 'submit' || !el.getAttribute('type'));
  if (el instanceof HTMLInputElement) return !!el.form && (el.type === 'submit' || el.type === 'image');
  return false;
}

export interface PageSnapshot { title: string; elements: Affordance[]; focused: { id: string; kind: AffordanceKind } | null }

export function snapshot(): PageSnapshot {
  const all = [...document.querySelectorAll<HTMLElement>(SELECTOR)].filter(visible);
  const inView = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  all.sort((a, b) => Number(inView(b)) - Number(inView(a)));
  const elements: Affordance[] = [];
  for (const el of all) {
    const name = accessibleName(el).slice(0, 80);
    if (!name) continue;
    elements.push({ id: idOf(el), kind: kindOf(el), name, submit: isSubmit(el) });
    if (elements.length >= MAX) break;
  }
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && active !== document.body && active.matches(SELECTOR)
    ? { id: idOf(active), kind: kindOf(active) } : null;
  return { title: document.title.slice(0, 200), elements, focused };
}

// ---------------------------------------------------------------- actions

export type PageResult = { ok: true; detail: string; kind?: AffordanceKind; name?: string } | { ok: false; reason: string };

function bring(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

export function click(id: string): PageResult {
  const el = elementFor(id);
  if (!el) return { ok: false, reason: 'That item is no longer on the page.' };
  if ((el as HTMLButtonElement).disabled) return { ok: false, reason: `"${accessibleName(el)}" is switched off on this page.` };
  bring(el);
  el.click();
  return { ok: true, detail: `Pressed "${accessibleName(el)}".`, name: accessibleName(el) };
}

export function focus(id: string): PageResult {
  const el = elementFor(id);
  if (!el) return { ok: false, reason: 'That item is no longer on the page.' };
  bring(el);
  return { ok: true, detail: `On "${accessibleName(el)}".`, kind: kindOf(el), name: accessibleName(el) };
}

/** Type into a field by id, or into the field she is on. Never into a password field. */
export function type(text: string, id?: string): PageResult {
  const target = id ? elementFor(id) : document.activeElement;
  if (!(target instanceof HTMLElement)) return { ok: false, reason: 'Choose a field first: say "click" and its name.' };
  const kind = kindOf(target);
  if (kind === 'password') return { ok: false, reason: 'Passwords are not typed by voice.' };
  if (!['textbox', 'number'].includes(kind)) return { ok: false, reason: 'Choose a text field first: say "click" and its name.' };
  bring(target);
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    // The native setter keeps frameworks (React, Vue) in sync with the new value.
    const proto = target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(target, text);
  } else {
    target.textContent = text;
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, detail: 'typed', kind, name: accessibleName(target) };
}

/** Pick an option in a select, or tick/untick a checkbox or radio. */
export function choose(id: string, option?: string, check?: boolean): PageResult {
  const el = elementFor(id);
  if (!el) return { ok: false, reason: 'That item is no longer on the page.' };
  bring(el);
  if (el instanceof HTMLSelectElement) {
    const want = (option || '').toLowerCase().trim();
    const opt = [...el.options].find((o) => o.text.toLowerCase().trim() === want) ?? [...el.options].find((o) => want && o.text.toLowerCase().includes(want));
    if (!opt) return { ok: false, reason: `No option "${option}" in "${accessibleName(el)}".` };
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, detail: `Chose "${opt.text.trim()}".`, name: accessibleName(el) };
  }
  // Tick / untick: say the state she asked for, and only click if it differs.
  const box = el instanceof HTMLInputElement ? el : null;
  const isOn = () => (box ? box.checked : el.getAttribute('aria-checked') === 'true');
  const name = accessibleName(el);
  if (check !== undefined && isOn() === check) return { ok: true, detail: `"${name}" is already ${check ? 'ticked' : 'not ticked'}.`, name };
  el.click();
  return { ok: true, detail: `"${name}" is now ${isOn() ? 'ticked' : 'not ticked'}.`, name };
}

// ---------------------------------------------------------------- numbered choices on the page

const BADGE_ATTR = 'data-headway-badge';

export function showBadges(idsInOrder: string[]): PageResult {
  clearBadges();
  idsInOrder.forEach((id, i) => {
    const el = elementFor(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = document.createElement('div');
    b.setAttribute(BADGE_ATTR, '');
    b.textContent = String(i + 1);
    Object.assign(b.style, {
      position: 'absolute', left: `${r.left + scrollX - 6}px`, top: `${r.top + scrollY - 6}px`, zIndex: '2147483647',
      minWidth: '34px', height: '34px', padding: '0 8px', borderRadius: '10px', display: 'grid', placeItems: 'center',
      background: '#0f100d', color: '#c8f031', border: '3px solid #c8f031', font: '700 20px/1 system-ui, sans-serif',
      pointerEvents: 'none', boxShadow: '0 0 0 2px #0f100d',
    });
    el.style.outline = '3px solid #c8f031';
    el.style.outlineOffset = '3px';
    el.setAttribute('data-headway-outlined', '');
    document.body.appendChild(b);
  });
  idsInOrder[0] && elementFor(idsInOrder[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return { ok: true, detail: 'numbered' };
}

export function clearBadges(): PageResult {
  document.querySelectorAll(`[${BADGE_ATTR}]`).forEach((b) => b.remove());
  document.querySelectorAll<HTMLElement>('[data-headway-outlined]').forEach((el) => {
    el.style.outline = ''; el.style.outlineOffset = ''; el.removeAttribute('data-headway-outlined');
  });
  return { ok: true, detail: 'cleared' };
}

/** "Choose Nairobi": pick that option in the dropdown she is on, or the one dropdown that has it. */
export function chooseOption(option: string): PageResult {
  const want = option.toLowerCase().trim();
  if (!want) return { ok: false, reason: 'Say which option.' };
  const has = (s: HTMLSelectElement) => [...s.options].some((o) => o.text.toLowerCase().trim() === want);
  const active = document.activeElement;
  const selects = [...document.querySelectorAll<HTMLSelectElement>('select')].filter(visible).filter(has);
  const target = active instanceof HTMLSelectElement && has(active) ? active : selects.length === 1 ? selects[0] : null;
  if (!target) return { ok: false, reason: selects.length > 1 ? 'Several lists have that option: say "click" and the list first.' : 'none' };
  return choose(idOf(target), option);
}
