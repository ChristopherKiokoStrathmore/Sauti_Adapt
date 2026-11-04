'use client';

import { useEffect, useRef, useState } from 'react';
import { startRecording, type RecordingSession } from '@sauti/shared/audio';

type Overview = {
  online: boolean;
  mode: string;
  enrollmentEnabled: boolean;
  comparisonEnabled: boolean;
  apiConfigured: boolean;
};
type Comparison = {
  model: string;
  status: string;
  intent?: string | null;
  transcript?: string | null;
  error?: string | null;
  wer?: number | null;
  cer?: number | null;
  correct_intent?: boolean | null;
  load_and_inference_seconds?: number | null;
};
const COMMANDS = [
  ['SCROLL_DOWN', 'Scroll down'],
  ['SCROLL_UP', 'Scroll up'],
  ['GO_BACK', 'Go back'],
  ['READ_PAGE', 'Read page'],
  ['UNDO', 'Undo'],
  ['UNKNOWN', 'Other speech'],
];

export function SautiAdmin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profileId, setProfileId] = useState('');
  const [model, setModel] = useState('all');
  const [language, setLanguage] = useState('en-KE');
  const [intent, setIntent] = useState('SCROLL_DOWN');
  const [reference, setReference] = useState('');
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [message, setMessage] = useState('Record a fresh example to compare speech models without executing browser commands.');
  const [results, setResults] = useState<Comparison[]>([]);
  const recording = useRef<RecordingSession | null>(null);
  const busy = useRef(false);

  async function refresh() {
    const [healthResponse, participantResponse] = await Promise.all([
      fetch('/api/admin/status', { cache: 'no-store' }),
      fetch('/api/participant', { cache: 'no-store' }),
    ]);
    if (healthResponse.ok) setOverview(await healthResponse.json());
    if (participantResponse.ok) {
      const participant = await participantResponse.json();
      setProfileId(participant.authenticated && typeof participant.profile_id === 'string' ? participant.profile_id : '');
    }
  }

  useEffect(() => {
    void refresh().catch(() => setMessage('Operational status is unavailable.'));
    return () => recording.current?.cancel();
  }, []);

  const canCompare = overview?.comparisonEnabled === true && Boolean(profileId) && consent;

  async function toggleRecording() {
    if (busy.current) return;
    if (recording.current) {
      const active = recording.current;
      recording.current = null;
      busy.current = true;
      setStage('processing');
      try {
        const audio = await active.stop();
        const body = new FormData();
        body.append('audio', audio, 'model-comparison.wav');
        body.append('profile_id', profileId);
        body.append('language', language);
        body.append('model', model);
        body.append('expected_intent', intent);
        body.append('reference', reference.trim());
        body.append('compare_consent', 'true');
        const response = await fetch('/api/compare', { method: 'POST', body, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || 'Comparison is unavailable.');
        if (!Array.isArray(data.results) || data.executed_action !== false) throw new Error('Unexpected comparison response.');
        setResults(data.results as Comparison[]);
        setMessage('Comparison complete. No command was executed, and this clip was not stored.');
      } catch (error) {
        setResults([]);
        setMessage(error instanceof Error ? error.message : 'Unable to compare the recording.');
      } finally {
        busy.current = false;
        setStage('idle');
      }
      return;
    }
    if (!canCompare) {
      setMessage('Comparison requires an enabled model service, your own voice profile and explicit consent.');
      return;
    }
    try {
      recording.current = await startRecording({ maxDurationMs: 5000, autoStop: false });
      setResults([]);
      setStage('listening');
      setMessage('Listening. Say the selected command, then press Stop and compare.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Microphone is unavailable.');
    }
  }

  return <main className="admin-shell">
    <header className="topbar">
      <a className="brand" href="/"><span aria-hidden="true" className="brand-mark">✚</span><span>Sauti Adapt</span></a>
      <span className="concept-badge">Research dashboard</span>
      <a className="admin-back-link" href="/">Participant experience</a>
    </header>
    <section className="admin-hero">
      <p className="eyebrow">Research operations</p>
      <h1>Speech model laboratory</h1>
      <p>Service readiness and controlled model comparison, separate from participant onboarding.</p>
      <p className="admin-public-note">This page is public. It does not show participant lists, stored recordings, credentials or private models. Comparisons use only your own browser's voice profile.</p>
    </section>
    <div className="admin-grid">
      <section className="main-card admin-panel" aria-label="Service overview">
        <div className="admin-panel-heading"><h2>Service overview</h2><button className="soft-button" type="button" onClick={() => void refresh().catch(() => setMessage('Unable to refresh status.'))}>Refresh</button></div>
        <div className="admin-stats">
          <div className="admin-stat"><span>Speech API</span><strong>{overview === null ? 'Checking' : overview.online ? 'Online' : 'Unavailable'}</strong></div>
          <div className="admin-stat"><span>Speech mode</span><strong>{overview?.mode || 'Checking'}</strong></div>
          <div className="admin-stat"><span>Voice enrollment</span><strong>{overview === null ? 'Checking' : overview.enrollmentEnabled ? 'Enabled' : 'Disabled'}</strong></div>
          <div className="admin-stat"><span>Model comparison</span><strong>{overview === null ? 'Checking' : overview.comparisonEnabled ? 'Enabled' : 'Not enabled'}</strong></div>
        </div>
        <p className="admin-muted">Service availability does not establish model accuracy. Personalized models require training and validation before they can control a browser.</p>
      </section>

      <section className="main-card admin-panel" aria-label="Model comparison laboratory">
        <h2>Compare speech models</h2>
        <p className="lead-copy">Experimental evaluation only. A recording here never executes a browser action.</p>
        <div className="settings-grid">
          <div className="field"><label htmlFor="lab-model">Model</label><select id="lab-model" value={model} onChange={e => setModel(e.target.value)}>
            <option value="all">Compare all three</option><option value="prototype">Personalized Wav2Vec2</option>
            <option value="english">CDLI Kenyan English Whisper</option><option value="swahili">CDLI Kenyan Kiswahili Whisper</option>
          </select></div>
          <div className="field"><label htmlFor="lab-language">Spoken language</label><select id="lab-language" value={language} onChange={e => setLanguage(e.target.value)}>
            <option value="en-KE">English</option><option value="sw-KE">Kiswahili</option><option value="mixed">English and Kiswahili mixed</option>
          </select></div>
        </div>
        <div className="settings-grid">
          <div className="field"><label htmlFor="lab-intent">Expected command</label><select id="lab-intent" value={intent} onChange={e => setIntent(e.target.value)}>
            {COMMANDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></div>
          <div className="field"><label htmlFor="lab-transcript">Correct transcript (optional)</label><input id="lab-transcript" value={reference} maxLength={280} onChange={e => setReference(e.target.value)} placeholder="What was spoken?"/></div>
        </div>
        <label className="permission-card"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span><strong>I agree to a one time model comparison of my recording</strong><small>The recording is processed only for comparison, not retained or used to execute commands.</small></span></label>
        {!profileId && <p className="inline-note">Open the <a href="/">participant onboarding</a> on this device to create a private voice profile before trying the model lab.</p>}
        {overview && !overview.comparisonEnabled && <p className="inline-note">The cloud comparison service is not enabled. Model selection is visible for research planning, but requests cannot run until the backend models are deployed and approved.</p>}
        <button className="record-button" type="button" disabled={stage === 'processing' || (stage === 'idle' && !canCompare)} onClick={() => void toggleRecording()}>
          {stage === 'listening' ? '■ Stop and compare' : stage === 'processing' ? 'Processing…' : '● Start model comparison'}
        </button>
        <p role="status" className="admin-feedback">{message}</p>
        {results.length > 0 && <section className="admin-results" aria-label="Model comparison results">
          <h3>Results</h3>
          {results.map((row, index) => <div className="model-result" key={row.model + index}>
            <strong>{row.model}</strong>
            <p>Status: {row.status} · Intent: {row.intent || 'None'}</p>
            {row.transcript && <p>Transcript: {row.transcript}</p>}
            {row.error && <p>Unavailable: {row.error}</p>}
            {typeof row.wer === 'number' && <p>Word error rate: {(row.wer * 100).toFixed(1)}%</p>}
            {typeof row.cer === 'number' && <p>Character error rate: {(row.cer * 100).toFixed(1)}%</p>}
            {typeof row.correct_intent === 'boolean' && <p>Command match: {row.correct_intent ? 'Yes' : 'No'}</p>}
            {typeof row.load_and_inference_seconds === 'number' && <p>Load and inference: {row.load_and_inference_seconds.toFixed(1)}s</p>}
          </div>)}
        </section>}
      </section>
    </div>
  </main>;
}
