// Her commands: what she chose, how she says them, and how a transcript is matched.
//
// Pure: no DOM, no chrome.*. Each command maps to one action id the Chrome control
// port will declare. "Aliases" are what the speech model actually wrote when she
// said the command; once she confirms them they count as that command. This is the
// day-one personalisation that needs no model training.

export type Lang = 'en' | 'sw' | 'both';

export interface CommandDef { id: string; en: string; sw: string; onByDefault: boolean }

export const COMMAND_DEFS: CommandDef[] = [
  { id: 'scroll-down', en: 'Scroll down', sw: 'Shuka chini', onByDefault: true },
  { id: 'go-back', en: 'Go back', sw: 'Rudi nyuma', onByDefault: true },
  { id: 'read-page', en: 'Read this to me', sw: 'Nisomee', onByDefault: true },
  { id: 'next-tab', en: 'Next tab', sw: 'Kichupo kifuatacho', onByDefault: true },
  { id: 'pause-media', en: 'Pause the video', sw: 'Simamisha video', onByDefault: false },
  { id: 'scroll-up', en: 'Scroll up', sw: 'Panda juu', onByDefault: false },
];

export interface ChosenCommand {
  id: string;
  phrases: string[];   // what she says (her own phrase first if she added one)
  aliases: string[];   // what the model writes for her, learned from her takes
}

/** Lower case, accents stripped, punctuation gone, single spaces. */
export function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function phrasesFor(def: CommandDef, lang: Lang): string[] {
  if (lang === 'en') return [def.en];
  if (lang === 'sw') return [def.sw];
  return [def.en, def.sw];
}

/** Share of the expected words found, in order (same rule as tools/voice-test). */
export function wordMatch(expected: string, got: string): number {
  const a = normalize(expected).split(' ').filter(Boolean);
  const b = normalize(got).split(' ').filter(Boolean);
  if (!a.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i, ...Array(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.max(0, 1 - prev[b.length] / a.length);
}

/** Each word of what was heard, marked right if it is one of the expected words. */
export function markWords(expected: string, got: string): Array<{ word: string; right: boolean }> {
  const want = new Set(normalize(expected).split(' ').filter(Boolean));
  return got.trim().split(/\s+/).filter(Boolean).map((word) => ({ word, right: want.has(normalize(word)) }));
}

/**
 * The command a transcript means, or null. Exact match on a phrase or a learned
 * alias only: anything else is "not sure", and nothing runs (default to rejection).
 */
export function matchCommand(transcript: string, commands: readonly ChosenCommand[]): string | null {
  const t = normalize(transcript);
  if (!t) return null;
  for (const c of commands) {
    if (c.phrases.some((p) => normalize(p) === t) || c.aliases.some((a) => normalize(a) === t)) return c.id;
  }
  return null;
}

/**
 * Learn from a take she made while reading a known command: if the model wrote
 * something else, and that text does not already mean a different command, it
 * becomes an alias for this one.
 */
export function learnAlias(commands: ChosenCommand[], commandId: string, transcript: string): string | null {
  const t = normalize(transcript);
  const target = commands.find((c) => c.id === commandId);
  if (!t || !target) return null;
  if (matchCommand(t, commands) !== null) return null; // already understood, or means another command
  target.aliases.push(t);
  return t;
}
