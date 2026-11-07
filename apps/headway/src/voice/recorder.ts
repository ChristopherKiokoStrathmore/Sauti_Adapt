// Microphone capture for calibration: raw voice, 16 kHz mono Float32.
//
// Echo cancellation, noise suppression and automatic gain are switched OFF: they
// reshape pauses and loudness, which are exactly what calibration measures. Audio
// stays in this page's memory until the caller decides what to do with it.

import { RATE } from './analysis.ts';

export interface LiveLevel { db: number; ms: number }

export class MicRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private startedAt = 0;
  onLevel: ((level: LiveLevel) => void) | null = null;

  /** Ask for the microphone (the browser shows its prompt the first time). */
  async open(deviceId?: string): Promise<string> {
    if (this.stream) this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor keeps this to one file (no worklet module to load); the cost is
    // fine for a calibration page that records a few seconds at a time.
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const db = rms > 1e-5 ? 20 * Math.log10(rms) : -100;
      if (this.recording) this.chunks.push(new Float32Array(input));
      this.onLevel?.({ db, ms: this.recording ? performance.now() - this.startedAt : 0 });
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
    return this.stream.getAudioTracks()[0]?.label ?? '';
  }

  get isOpen() { return !!this.stream; }
  get deviceId() { return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? ''; }
  get isRecording() { return this.recording; }

  start() {
    if (!this.ctx) throw new Error('Microphone is not open');
    void this.ctx.resume();
    this.chunks = [];
    this.startedAt = performance.now();
    this.recording = true;
  }

  /** Stop and return the take at 16 kHz. */
  async stop(): Promise<Float32Array> {
    this.recording = false;
    const rate = this.ctx?.sampleRate ?? RATE;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const raw = new Float32Array(total);
    let at = 0;
    for (const c of this.chunks) { raw.set(c, at); at += c.length; }
    this.chunks = [];
    return resample(raw, rate);
  }

  close() {
    this.recording = false;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null; this.ctx = null; this.node = null; this.source = null;
  }
}

/** Resample with the browser's own filter (OfflineAudioContext), not a naive decimation. */
export async function resample(samples: Float32Array, fromRate: number): Promise<Float32Array> {
  if (fromRate === RATE || samples.length === 0) return samples;
  const length = Math.max(1, Math.round((samples.length * RATE) / fromRate));
  const offline = new OfflineAudioContext(1, length, RATE);
  const buffer = offline.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
