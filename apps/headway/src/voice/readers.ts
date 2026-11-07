// The readings of one take.
//
// Sauti: the CDLI Whisper model on Modal, reached through the local voice-test
// helper (tools/voice-test/serve.py), which adds the server token. The token never
// enters the extension. If the helper is not running, the reading is unavailable
// and the page says so; nothing is invented.
//
// Standard: Chrome's built-in speech recognition, listening alongside our recorder.
// It sends audio to Google, so it only runs when the person opted in.

export const DEFAULT_SAUTI_HELPER = 'http://127.0.0.1:8790';

export type SautiModel = 'english' | 'swahili';
export type Reading = { ok: true; text: string; ms: number } | { ok: false; reason: string };

export async function sautiAvailable(helper = DEFAULT_SAUTI_HELPER): Promise<boolean> {
  try {
    const res = await fetch(`${helper}/api/config`, { signal: AbortSignal.timeout(2500) });
    const cfg = await res.json() as { configured?: boolean };
    return res.ok && cfg.configured !== false;
  } catch {
    return false;
  }
}

export async function sautiTranscribe(samples: Float32Array, model: SautiModel, helper = DEFAULT_SAUTI_HELPER): Promise<Reading> {
  const started = performance.now();
  try {
    const body = new Float32Array(samples); // plain ArrayBuffer copy for fetch
    const res = await fetch(`${helper}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Model': model },
      body: body.buffer,
      signal: AbortSignal.timeout(300_000),
    });
    const data = await res.json() as { transcript?: string; detail?: string };
    if (!res.ok) return { ok: false, reason: data.detail || `The speech helper answered ${res.status}.` };
    return { ok: true, text: (data.transcript || '').trim(), ms: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, reason: 'The Sauti helper is not running on this computer.' };
  }
}

interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}

export function standardSupported(): boolean {
  const w = globalThis as unknown as Record<string, unknown>;
  return typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function';
}

/** Chrome's standard recognition, run beside our recorder for the comparison. */
export class StandardListener {
  private rec: SpeechRecognitionLike | null = null;
  private text = '';
  private error = '';
  private ended: Promise<void> | null = null;

  start(lang: 'en' | 'sw') {
    const w = globalThis as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) { this.error = 'not-supported'; return; }
    this.text = ''; this.error = '';
    const rec = new Ctor();
    rec.lang = lang === 'sw' ? 'sw-KE' : 'en-KE';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) parts.push(e.results[i][0].transcript);
      this.text = parts.join(' ').trim();
    };
    rec.onerror = (e) => { this.error = e.error; };
    this.ended = new Promise((resolve) => { rec.onend = () => resolve(); });
    this.rec = rec;
    try { rec.start(); } catch { this.error = 'could-not-start'; }
  }

  async stop(): Promise<Reading> {
    if (!this.rec) return { ok: false, reason: 'Standard recognition is not available in this browser.' };
    const started = performance.now();
    try { this.rec.stop(); } catch { /* already stopped */ }
    await Promise.race([this.ended, new Promise((r) => setTimeout(r, 4000))]);
    this.rec = null;
    if (this.error && this.error !== 'no-speech' && !this.text) return { ok: false, reason: `Standard recognition failed (${this.error}).` };
    return { ok: true, text: this.text, ms: Math.round(performance.now() - started) };
  }
}
