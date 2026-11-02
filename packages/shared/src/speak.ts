/** Local speechSynthesis playback. This module does not record audio or upload it. */

export function isReadAloudUtterance(utterance: string): boolean {
  return utterance.trim().toLowerCase() === 'read this';
}

export function stopSpeaking(): void {
  globalThis.speechSynthesis?.cancel();
}

export function speakText(
  text: string,
  lang: string,
  hooks?: { onend?: () => void; onerror?: () => void },
): boolean {
  const trimmed = text.trim();
  const synth = globalThis.speechSynthesis;
  if (!trimmed || !synth || typeof SpeechSynthesisUtterance !== 'function') return false;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = lang === 'sw-KE' ? 'sw' : 'en-KE';
  utterance.onend = () => hooks?.onend?.();
  utterance.onerror = () => hooks?.onerror?.();
  const start = () => synth.speak(utterance);
  // Some browsers drop speak() that runs in the same turn as cancel().
  if (typeof setTimeout === 'function') setTimeout(start, 0);
  else start();
  return true;
}
