// What Headway understands on its own, before (or instead of) asking Gemini.
// Pure: no DOM, no chrome.*, no network. English and Kiswahili. See
// docs/harness/AGENT_V2_CONTRACT.md "Local, before Gemini".

export type AffordanceKind = 'link' | 'button' | 'textbox' | 'password' | 'number' | 'checkbox' | 'radio' | 'select' | 'tab' | 'other';
export interface Affordance { id: string; kind: AffordanceKind; name: string; submit: boolean }

export type LocalIntent =
  | { kind: 'scroll'; direction: 'up' | 'down' }
  | { kind: 'back' }
  | { kind: 'read' }
  | { kind: 'stop' }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'choice'; index: number }            // 0-based
  | { kind: 'type'; text: string; numeric: boolean }
  | { kind: 'password' }
  | { kind: 'enable-site' }
  | { kind: 'open'; url: string; site: string }  // a known site, opened without Gemini
  | { kind: 'search'; query: string }
  | { kind: 'click'; label: string; check?: boolean }  // check: tick (true) / untick (false)
  | { kind: 'none' };

export function norm(text: string): string {
  return (text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

const PHRASES: Array<[RegExp, LocalIntent]> = [
  [/^(please )?(scroll|go|move) down( please)?$|^shuka( chini)?$|^teremka( chini)?$/, { kind: 'scroll', direction: 'down' }],
  [/^(please )?(scroll|go|move) up( please)?$|^panda( juu)?$/, { kind: 'scroll', direction: 'up' }],
  [/^(go )?back$|^go back (a page|one page)$|^rudi( nyuma)?$/, { kind: 'back' }],
  [/^read (this|it|the page|this page)( to me| aloud| out)?$|^nisomee( hii| ukurasa huu)?$|^soma( hii)?$/, { kind: 'read' }],
  [/^(stop|cancel that|be quiet)$|^simama$|^nyamaza$/, { kind: 'stop' }],
  [/^(yes|yeah|yep|ok|okay|sure|do it|go ahead|confirm|yes please)$|^ndiyo$|^ndio$|^sawa$/, { kind: 'yes' }],
  [/^(no|nope|cancel|don't|do not|no thanks)$|^hapana$|^acha$|^sitaki$/, { kind: 'no' }],
  [/^(enable|allow|turn on headway (on|for)) (this )?(site|website|page)$|^wezesha (tovuti|ukurasa)( hii| huu)?$/, { kind: 'enable-site' }],
  [/^(enter|type|put in|fill in)( in)? (my )?password$|^(weka|andika) (nenosiri|nywila)( yangu)?$/, { kind: 'password' }],
];

const CHOICE_WORDS: Record<string, number> = {
  one: 0, first: 0, 'number one': 0, moja: 0, 'ya kwanza': 0, kwanza: 0,
  two: 1, second: 1, 'number two': 1, mbili: 1, 'ya pili': 1, pili: 1,
  three: 2, third: 2, 'number three': 2, tatu: 2, 'ya tatu': 2,
  '1': 0, '2': 1, '3': 2,
};

/** "two", "number two", "mbili" → 1. Used for bare picks and for "choose two" while choices are open. */
export function choiceIndex(text: string): number | null {
  const t = norm(text).replace(/^(?:number|namba|option|chaguo) /, '');
  return t in CHOICE_WORDS ? CHOICE_WORDS[t] : null;
}

// ---------------------------------------------------------------- known sites (spec §4.5)

export const KNOWN_SITES: Record<string, string> = {
  ecitizen: 'https://accounts.ecitizen.go.ke/en',
  'e citizen': 'https://accounts.ecitizen.go.ke/en',
  kra: 'https://itax.kra.go.ke/',
  itax: 'https://itax.kra.go.ke/',
  ntsa: 'https://serviceportal.ntsa.go.ke/',
  kplc: 'https://selfservice.kplc.co.ke/',
  google: 'https://www.google.com/',
  youtube: 'https://www.youtube.com/',
  wikipedia: 'https://www.wikipedia.org/',
};

export function knownSite(name: string): { site: string; url: string } | null {
  const t = norm(name).replace(/^(the )?/, '').replace(/ (website|site|page|tovuti)$/, '').replace(/\.(go|co)\.ke$/, '');
  const key = t.replace(/\./g, ' ').trim();
  return KNOWN_SITES[key] ? { site: key, url: KNOWN_SITES[key] } : null;
}

// ---------------------------------------------------------------- numbers

const EN_DIGITS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', nil: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
};
const SW_DIGITS: Record<string, string> = {
  sifuri: '0', moja: '1', mbili: '2', tatu: '3', nne: '4', tano: '5', sita: '6', saba: '7', nane: '8', tisa: '9',
};
const REPEAT: Record<string, number> = { double: 2, triple: 3 };
const digitOf = (w: string) => EN_DIGITS[w] ?? SW_DIGITS[w] ?? (/^\d$/.test(w) ? w : null);

/**
 * Spoken digits → digits, in English or Kiswahili ("one two three", "moja mbili tatu",
 * "double seven", "0 7 2 2"). Returns null when the words are not all digits.
 */
export function spokenDigits(text: string): string | null {
  const words = norm(text).replace(/-/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return null;
  let out = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w)) { out += w; continue; }
    if (REPEAT[w] && i + 1 < words.length) {
      const next = digitOf(words[i + 1]);
      if (next === null) return null;
      out += next.repeat(REPEAT[w]); i++; continue;
    }
    const d = digitOf(w);
    if (d === null) return null;
    out += d;
  }
  return out || null;
}

/** How many digits an utterance carries, spoken or written, anywhere in it. */
export function digitCount(text: string): number {
  let n = 0;
  for (const w of norm(text).split(' ')) {
    if (/^\d+$/.test(w)) n += w.length;
    else if (EN_DIGITS[w] !== undefined && !['o', 'oh', 'one'].includes(w)) n++;
    else if (SW_DIGITS[w] !== undefined && w !== 'moja') n++;
  }
  return n;
}

const SECRET_WORDS = /\b(password|passcode|passwd|pin|otp|one time|verification code|security code|id number|national id|passport number|phone number|account number|nenosiri|nywila|kitambulisho|namba ya simu|nambari ya simu|namba yangu|nambari yangu|namba ya siri)\b/;

/**
 * Should this utterance stay on this computer? Anything with four or more digits, or
 * that talks about a password, PIN, OTP or ID/phone/account number. Such words are
 * never sent to Gemini (spec §5.2), however she phrases them.
 */
export function looksSecret(text: string): boolean {
  return digitCount(text) >= 4 || SECRET_WORDS.test(norm(text));
}

// ---------------------------------------------------------------- parse

const TYPE_PREFIX = /^(?:type|write|enter|fill in|put|andika|weka)(?: in)? /;
const SAYS_PREFIX = /^(?:my (?:id number|id|national id|phone number|phone|number|otp|code|pin) is|it is|namba yangu ni|nambari yangu ni|namba ya simu ni|nambari ya simu ni) /;
const FIELD_WORDS = /^(?:my )?(?:id number|id|national id|phone number|phone|number|otp|code|pin|namba yangu|nambari yangu)(?: is| ni)? /;

export function parseLocal(utterance: string): LocalIntent {
  const t = norm(utterance);
  if (!t) return { kind: 'none' };
  for (const [re, intent] of PHRASES) if (re.test(t)) return intent;
  const pick = choiceIndex(t);
  if (pick !== null) return { kind: 'choice', index: pick };

  // Open / search
  const open = t.match(/^(?:open|go to|visit|take me to|fungua|nenda) (.+)$/);
  if (open) {
    const known = knownSite(open[1]);
    if (known) return { kind: 'open', url: known.url, site: known.site };
  }
  const search = t.match(/^(?:search(?: for)?|google|look up|tafuta) (.+)$/);
  // A web search never carries a number like an ID or phone (it would leave in the URL).
  if (search && digitCount(search[1]) < 4) return { kind: 'search', query: search[1] };

  // Typing: "type …", "write …", "andika …", "my ID number is …", "namba yangu ni …"
  const prefix = t.match(TYPE_PREFIX) ?? t.match(SAYS_PREFIX);
  if (prefix) {
    let rest = t.slice(prefix[0].length);
    rest = (rest + ' ').replace(FIELD_WORDS, '').trim();
    if (!rest) return { kind: 'none' };
    const digits = spokenDigits(rest);
    if (digits) return { kind: 'type', text: digits, numeric: true };
    // Free text: keep her casing. Cut the original by word position, not by searching for a word.
    const restWords = rest.split(' ').length;
    const originalWords = utterance.trim().split(/\s+/);
    return { kind: 'type', text: originalWords.slice(originalWords.length - restWords).join(' '), numeric: false };
  }
  const bareDigits = spokenDigits(t);
  if (bareDigits && bareDigits.length >= 4) return { kind: 'type', text: bareDigits, numeric: true };

  const tick = t.match(/^(tick|check|untick|uncheck|weka alama|ondoa alama) (?:the )?(.+?)(?: box)?$/);
  if (tick) return { kind: 'click', label: tick[2], check: !/^(untick|uncheck|ondoa)/.test(tick[1]) };
  const click = t.match(/^(?:click|press|tap|open|select|choose|pick|go to|bonyeza|gusa|fungua|chagua|nenda kwa) (?:on )?(?:the )?(.+?)(?: button| link| kitufe)?$/);
  if (click) return { kind: 'click', label: click[1] };
  return { kind: 'none' };
}

// ---------------------------------------------------------------- matching

const STOP = new Set(['the', 'a', 'an', 'on', 'button', 'link', 'please', 'kitufe', 'kiungo']);

/**
 * Elements whose name contains every word of the label as whole words. One element
 * only when its whole name is exactly what she said; otherwise every element that fits
 * comes back and she is asked. Never "first match".
 */
export function matchAffordances(label: string, items: readonly Affordance[]): Affordance[] {
  const said = norm(label);
  const exact = items.filter((a) => norm(a.name) === said);
  if (exact.length === 1) return exact;
  const want = said.split(' ').filter((w) => w && !STOP.has(w));
  if (!want.length) return [];
  const fits = items.filter((a) => {
    const set = new Set(norm(a.name).split(' '));
    return want.every((w) => set.has(w));
  });
  return fits.sort((x, y) => norm(x.name).length - norm(y.name).length);
}

// ---------------------------------------------------------------- risk

export type Risk = 'read' | 'navigate' | 'change' | 'submit' | 'secret';
// Buttons that send, pay, commit or wipe what she has done. Kiswahili included.
const SUBMIT_WORDS = /\b(pay|paybill|payment|submit|send|confirm|delete|remove|transfer|buy|purchase|checkout|place order|continue|proceed|next|save|finish|done|register|sign up|apply now|reset|clear|tuma|lipa|thibitisha|futa|nunua|wasilisha|endelea|hifadhi|kubali|maliza|sajili)\b/;

export function riskOf(a: Pick<Affordance, 'kind' | 'name' | 'submit'>): Risk {
  if (a.kind === 'password') return 'secret';
  if (a.submit || SUBMIT_WORDS.test(norm(a.name))) return 'submit';
  return 'change';
}

/** Does this action wait for her yes? Submit always (D2); otherwise her own setting. */
export function needsConfirmation(risk: Risk, confirm: 'always' | 'forms' | 'never'): boolean {
  if (risk === 'submit' || risk === 'secret') return true;
  if (risk === 'read' || risk === 'navigate') return false;
  return confirm === 'always';
}

/** Read-back for a typed value: never the whole secret or number. */
export function maskedReadBack(text: string, kind: AffordanceKind): string {
  if (kind === 'password') return `${text.length} characters entered`;
  const digits = text.replace(/\D/g, '');
  if (kind === 'number' || (digits.length >= 4 && digits.length === text.replace(/\s/g, '').length)) {
    return `number ending in ${digits.slice(-2).split('').join(' ')} entered`;
  }
  return `"${text}" entered`;
}
