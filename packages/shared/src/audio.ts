/** Browser PCM capture, exported as single-channel 16 kHz, 16-bit WAV. No audio is stored here. */
export type RecordingSession = { stop: () => Promise<Blob>; cancel: () => void };

function wavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  let p = 0;
  const text = (s: string) => { for (const ch of s) view.setUint8(p++, ch.charCodeAt(0)); };
  const u16 = (v: number) => { view.setUint16(p, v, true); p += 2; };
  const u32 = (v: number) => { view.setUint32(p, v, true); p += 4; };
  text('RIFF'); u32(buffer.byteLength - 8); text('WAVE');
  text('fmt '); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16);
  text('data'); u32(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(p, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
    p += 2;
  }
  return buffer;
}

export async function convertRecordedAudioToWav(blob: Blob): Promise<Blob> {
  const ac = new AudioContext();
  try {
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Blob([wavBuffer(rendered.getChannelData(0), 16000)], { type: 'audio/wav' });
  } finally { await ac.close(); }
}

export async function startRecording(): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone API unavailable. Use HTTPS or localhost.');
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder not supported by this browser.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const pieces: BlobPart[] = [];
  const recorder = new MediaRecorder(stream);
  let stopped = false;
  let cancelled = false;
  let resolveDone!: (v: Blob) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<Blob>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Cancellation may occur during unmount without a caller awaiting stop().
  void done.catch(() => undefined);
  const release = () => stream.getTracks().forEach(t => t.stop());
  recorder.ondataavailable = e => { if (e.data.size) pieces.push(e.data); };
  recorder.onerror = () => { release(); rejectDone(new Error('Audio capture failed.')); };
  recorder.onstop = () => {
    release();
    if (cancelled) { rejectDone(new Error('Recording cancelled.')); return; }
    resolveDone(new Blob(pieces, { type: recorder.mimeType }));
  };
  recorder.start();
  return {
    async stop() {
      if (!stopped) { stopped = true; recorder.stop(); }
      return convertRecordedAudioToWav(await done);
    },
    cancel() {
      cancelled = true;
      if (!stopped) { stopped = true; recorder.stop(); }
    }
  };
}
