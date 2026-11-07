// Calibration takes kept on this computer, so a person never has to say a sentence
// twice: if the rules in profile.ts improve, the profile is rebuilt from these.
//
// IndexedDB in the extension's own origin. Never synced, never uploaded. Stored as
// 16-bit PCM to halve the size. "Delete my recordings" removes them all.

const DB = 'headway-voice';
const STORE = 'takes';

export interface StoredTake {
  id?: number;
  at: string;            // ISO date-time
  language: string;
  prompt: string;        // the sentence she was asked to say ('' for the room recording)
  kind: 'room' | 'speech';
  pcm: Int16Array;       // 16 kHz mono
  session?: string;      // one onboarding run, so a resumed run finds its own takes
  commandId?: string;    // onboarding: which command, which take (1–3; 3 is held out)
  take?: number;
  sauti?: string;        // what each reader heard, so the comparison can be re-run
  standard?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i] || 0)) * 32767;
  return out;
}

export function fromPcm16(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32767;
  return out;
}

export const saveTake = (take: StoredTake) => tx('readwrite', (s) => s.add(take));
export const listTakes = () => tx<StoredTake[]>('readonly', (s) => s.getAll());
export const countTakes = () => tx<number>('readonly', (s) => s.count());
export const deleteAllTakes = () => tx('readwrite', (s) => s.clear());
