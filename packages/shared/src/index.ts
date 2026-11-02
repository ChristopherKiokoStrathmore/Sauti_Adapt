/** Intent contract shared between PWA, Chrome extension, and Python service. */
export const INTENTS = [
  'SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'READ_PAGE', 'UNDO', 'UNKNOWN'
] as const;
export type Intent = (typeof INTENTS)[number];
export type Language = 'en-KE' | 'sw-KE';
export type Recognition = {
  status: 'accepted' | 'rejected';
  intent: Intent;
  language: Language | null;
  confidence: number | null;
  model_version: string | null;
  reason: string | null;
};

/** These are known supported phrases in the OFFICIAL controller grammar. */
export const TOOLKIT_UTTERANCE: Readonly<Record<Exclude<Intent, 'UNKNOWN'>, string>> = {
  SCROLL_DOWN: 'scroll down',
  SCROLL_UP: 'scroll up',
  GO_BACK: 'go back',
  READ_PAGE: 'read this',
  UNDO: 'undo'
};
export const COMMAND_LABELS: Record<Intent, { en: string; sw: string }> = {
  SCROLL_DOWN: { en: 'Scroll down', sw: 'Shuka chini' },
  SCROLL_UP: { en: 'Scroll up', sw: 'Panda juu' },
  GO_BACK: { en: 'Go back', sw: 'Rudi nyuma' },
  READ_PAGE: { en: 'Read this page aloud', sw: 'Soma ukurasa kwa sauti' },
  UNDO: { en: 'Undo last setting', sw: 'Tengua mpangilio' },
  UNKNOWN: { en: 'Unknown speech', sw: 'Sauti isiyotambuliwa' }
};

export function validRecognition(x: unknown): x is Recognition {
  if (!x || typeof x !== 'object') return false;
  const y = x as Partial<Recognition>;
  return (y.status === 'accepted' || y.status === 'rejected')
    && typeof y.intent === 'string' && INTENTS.includes(y.intent as Intent)
    && (y.confidence === null || (typeof y.confidence === 'number' && Number.isFinite(y.confidence) && y.confidence >= 0 && y.confidence <= 1))
    && (y.language === null || y.language === 'en-KE' || y.language === 'sw-KE')
    && (y.model_version === null || typeof y.model_version === 'string')
    && (y.reason === null || typeof y.reason === 'string');
}

export function commandToUtterance(prediction: Recognition): string | null {
  if (!validRecognition(prediction) || prediction.status !== 'accepted') return null;
  if (prediction.intent === 'UNKNOWN') return null;
  return TOOLKIT_UTTERANCE[prediction.intent] ?? null;
}
