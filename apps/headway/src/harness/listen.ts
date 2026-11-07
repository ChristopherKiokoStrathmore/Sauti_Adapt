// One spoken instruction, at her pace: records until she has been quiet for her own
// end-of-speech wait (from voice onboarding), or until she presses again, or her
// longest utterance. Returns a 16 kHz mono 16-bit WAV for the speech API.

import { MicRecorder } from '../voice/recorder.ts';
import { RATE } from '../voice/analysis.ts';

export interface ListenSettings { endOfSpeechMs: number; maxUtteranceMs: number; noSpeechTimeoutMs: number; floorDb: number }

export const DEFAULT_LISTEN: ListenSettings = { endOfSpeechMs: 2500, maxUtteranceMs: 30000, noSpeechTimeoutMs: 12000, floorDb: -60 };

export class Listener {
  private mic = new MicRecorder();
  private stopNow: (() => void) | null = null;
  get active() { return !!this.stopNow; }

  /** Open the mic (the permission was granted once, during onboarding). */
  async open(): Promise<void> { if (!this.mic.isOpen) await this.mic.open(); }

  /** Ends the current recording early (her press). */
  finish() { this.stopNow?.(); }

  /** Stop and drop the recording; the microphone is released either way. */
  cancel() { const stop = this.stopNow; this.stopNow = null; if (stop) stop(); else this.mic.close(); }

  async listen(s: ListenSettings, onTick?: (quietMs: number, heard: boolean, elapsedMs: number) => void): Promise<{ wav: Blob; heard: boolean; seconds: number }> {
    await this.open();
    const samples = await new Promise<Float32Array>((resolve) => {
      let heard = false, quiet = 0, last = performance.now();
      const started = last;
      // The microphone is closed after every instruction: no light left on, nothing kept listening.
      const done = () => { this.mic.onLevel = null; this.stopNow = null; void this.mic.stop().then((x) => { this.mic.close(); resolve(x); }); };
      this.stopNow = done;
      this.mic.onLevel = ({ db }) => {
        const now = performance.now(), dt = now - last; last = now;
        if (db >= s.floorDb + 10) { heard = true; quiet = 0; } else if (db < s.floorDb + 6) quiet += dt;
        const elapsed = now - started;
        onTick?.(heard ? quiet : 0, heard, elapsed);
        if ((heard && quiet >= s.endOfSpeechMs) || (!heard && elapsed >= s.noSpeechTimeoutMs) || elapsed >= s.maxUtteranceMs) done();
      };
      this.mic.start();
    });
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    return { wav: toWav(samples), heard: peak > Math.pow(10, (s.floorDb + 10) / 20), seconds: samples.length / RATE };
  }
}

export function toWav(samples: Float32Array): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) data.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); data.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, RATE, true); data.setUint32(28, RATE * 2, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true);
  str(36, 'data'); data.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] || 0)) * 32767, true);
  return new Blob([data.buffer], { type: 'audio/wav' });
}
