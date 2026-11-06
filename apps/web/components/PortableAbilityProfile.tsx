'use client';
import { useEffect, useRef, useState } from 'react';
import { enableAbilityConsent, hasAbilityConsent, importPreferences, model, sharePreferences, withdrawAbilityConsent,
  type PortableModel, type ShareablePreferences } from '@/lib/ability-profile';

type Props = ShareablePreferences & { onModelUpdated: () => void };

export function PortableAbilityProfile({ onModelUpdated, ...preferences }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [shared, setShared] = useState<PortableModel | null>(null);
  const [message, setMessage] = useState('Nothing has been shared with the toolkit.');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const skipFirst = useRef(true);

  useEffect(() => {
    const consent = hasAbilityConsent();
    setEnabled(consent);
    if (!consent) return;
    void model().then(m => { setShared(m); onModelUpdated(); }).catch(() => setMessage('Saved preferences could not be loaded.'));
  // Read stored approval once; subsequent updates are handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }
    if (!enabled) return;
    let active = true;
    void sharePreferences(preferences).then(m => {
      if (!active) return;
      setShared(m);
      setMessage('Your approved accessibility preferences are synchronized with the toolkit profile in this browser.');
      onModelUpdated();
    }).catch(() => { if (active) setMessage('Could not synchronize preferences.'); });
    return () => { active = false; };
  // These are intentionally the *only* values copied; never spread a participant object.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, preferences.language, preferences.spokenGuidance, preferences.clickMethod, preferences.pointerSensitivity, preferences.pointerSteadiness]);

  async function activate() {
    setBusy(true);
    try {
      enableAbilityConsent();
      const value = await sharePreferences(preferences);
      setShared(value);
      setEnabled(true);
      setMessage('Preferences saved through the official AI4A11y Librarian.');
      onModelUpdated();
    } catch (error) {
      withdrawAbilityConsent();
      setMessage(error instanceof Error ? error.message : 'Could not save preferences');
    } finally { setBusy(false); }
  }

  function revoke() {
    withdrawAbilityConsent();
    setEnabled(false);
    setShared(null);
    setMessage('Sharing withdrawn. Local toolkit preferences have been deleted.');
    onModelUpdated();
  }

  function download() {
    if (!shared || !enabled) return;
    const blob = new Blob([JSON.stringify(shared, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sauti-ability-model.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function upload(file?: File) {
    if (!file || !enabled) return;
    setBusy(true);
    try {
      if (file.size > 12000) throw new Error('The profile file must be smaller than 12 KB.');
      const updated = await importPreferences(await file.text());
      setShared(updated);
      setMessage('Approved portable preferences imported into the official toolkit Librarian.');
      onModelUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed');
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  return <section className="portable-ability" aria-label="Portable accessibility preferences">
    <h3>My portable accessibility preferences</h3>
    <p>Optional. Share only your chosen language, spoken guidance and Headway control settings with the official AI4A11y Librarian. Voice clips, speech model data, personal identity and disability answers are never copied.</p>
    {!enabled ? <button type="button" disabled={busy} onClick={() => void activate()}>
      Share my preferences with the toolkit
    </button> : <div className="portable-actions">
      <strong>Toolkit sharing enabled for this browser</strong>
      <button type="button" disabled={busy || !shared} onClick={download}>Export portable profile</button>
      <input ref={fileRef} aria-label="Import portable profile JSON" type="file" accept=".json,application/json"
        onChange={event => { void upload(event.currentTarget.files?.[0]); }}/>
      <button type="button" disabled={busy} onClick={revoke}>Stop sharing and delete toolkit preferences</button>
    </div>}
    <p role="status" aria-live="polite">{message}</p>
    <small>Stored in this browser only. Export and import are explicit; this does not sync to other devices or upload anything to Sauti's speech backend.</small>
  </section>;
}
