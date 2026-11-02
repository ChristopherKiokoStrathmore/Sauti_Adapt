'use client';
import { useEffect, useRef, useState } from 'react';
import { COMMAND_LABELS, commandToUtterance, validRecognition, type Intent, type Language, type Recognition } from '@sauti/shared';
import { startRecording, type RecordingSession } from '@sauti/shared/audio';
import { createController } from '@toolkit/controller/createController.js';
import { createDomReceiver } from '@toolkit/controller/web/dom-receiver.js';

const INTENT_OPTIONS: Intent[] = ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'READ_PAGE', 'UNDO', 'UNKNOWN'];
const TEST_COMMANDS = ['scroll down', 'scroll up', 'read this', 'bigger text', 'undo'];

type ToolkitController = ReturnType<typeof createController>;

export function SautiDashboard() {
  const [profileId, setProfileId] = useState('');
  const sessionId = useRef('');
  const [accessCode, setAccessCode] = useState('');
  const [language, setLanguage] = useState<Language>('en-KE');
  const [intent, setIntent] = useState<Intent>('SCROLL_DOWN');
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<'enroll'|'recognize'>('recognize');
  const [state, setState] = useState<'idle'|'listening'|'processing'>('idle');
  const [status, setStatus] = useState('Connect the microphone or test the toolkit with text.');
  const [prediction, setPrediction] = useState<Recognition | null>(null);
  const recording = useRef<RecordingSession | null>(null);
  const controller = useRef<ToolkitController | null>(null);
  useEffect(() => {
    const id = window.localStorage.getItem('sauti-demo-profile') || crypto.randomUUID();
    window.localStorage.setItem('sauti-demo-profile', id);
    setProfileId(id);
    sessionId.current = crypto.randomUUID();
    if ('serviceWorker' in navigator) { void navigator.serviceWorker.register('/sw.js').catch(() => undefined); }
    const root = document.getElementById('controlled-site');
    if (root) controller.current = createController({
      control: createDomReceiver(root, { scrollTarget: root }),
      operator: { abilityModel: { supportAreas: ['motor'] } }
    });
    return () => { recording.current?.cancel(); controller.current = null; };
  }, []);

  async function runToolkit(utterance: string) {
    if (!controller.current) { setStatus('Controller has not initialized.'); return; }
    const result = await controller.current.handle(utterance);
    setStatus(result.say + (result.pending ? ' Use the confirmation controls if needed.' : ''));
  }

  async function processAudio(audio: Blob) {
    const form = new FormData();
    form.append('audio', audio, 'utterance.wav');
    form.append('profile_id', profileId);
    form.append('language', language);
    if (mode === 'enroll') {
      form.append('intent', intent);
      form.append('session_id', sessionId.current);
      form.append('consent', String(consent));
    }
    const response = await fetch(mode === 'enroll' ? '/api/enroll' : '/api/recognize', {
      method: 'POST', headers: { 'x-sauti-demo-code': accessCode }, body: form, cache: 'no-store'
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
    if (mode === 'enroll') {
      setStatus(`Recorded ${intent} in ${language}. Clip ID: ${body.recording_id}. Keep audio private.`);
      return;
    }
    if (!validRecognition(body)) throw new Error('Invalid recognition contract returned by API.');
    setPrediction(body);
    const utterance = commandToUtterance(body);
    if (!utterance) { setStatus(`No action taken: ${body.reason || 'Unknown or uncertain speech.'}`); return; }
    await runToolkit(utterance);
  }

  async function toggleRecording() {
    if (state === 'processing') return;
    if (state === 'listening') {
      setState('processing');
      const active = recording.current;
      recording.current = null;
      if (!active) return;
      try { await processAudio(await active.stop()); }
      catch (e) { setStatus(`Could not process audio: ${e instanceof Error ? e.message : 'unknown error'}`); }
      finally { setState('idle'); }
      return;
    }
    if (!profileId || !accessCode.trim()) { setStatus('Set your demo access code first.'); return; }
    if (mode === 'enroll' && !consent) { setStatus('Explicit consent is required to store enrollment recordings.'); return; }
    try {
      recording.current = await startRecording();
      setPrediction(null);
      setState('listening');
      setStatus('Recording. Speak one command, then select Stop and process.');
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Microphone unavailable.'); }
  }

  return <main className="container">
    <header className="hero"><h1>Sauti Adapt</h1>
      <p>Personalized Kenyan English and Kiswahili speech control, integrated into the official AI4A11y Controller.</p>
      <p className="muted">Team 4 engineering prototype • Co-designer first • No claim of validated accuracy</p>
    </header>
    <div className="grid">
      <section className="panel stack" aria-label="Voice setup">
        <h2>1. Voice profile and enrollment</h2>
        <p className="muted">This is a private prototype. Do not upload a person's voice without their informed consent.</p>
        <div className="field"><label htmlFor="profile">Private profile identifier</label><input id="profile" readOnly value={profileId}/></div>
        <div className="field"><label htmlFor="code">Demo access code</label><input id="code" type="password" autoComplete="off" value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="Local team code"/></div>
        <div className="field"><label htmlFor="language">Language</label><select id="language" value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en-KE">Kenyan English</option><option value="sw-KE">Kiswahili</option></select></div>
        <div className="field"><label htmlFor="mode">Task</label><select id="mode" value={mode} onChange={e => setMode(e.target.value as 'enroll'|'recognize')}><option value="recognize">Recognize and act</option><option value="enroll">Record an enrollment example</option></select></div>
        {mode === 'enroll' && <>
          <div className="field"><label htmlFor="intent">Intended command</label><select id="intent" value={intent} onChange={e => setIntent(e.target.value as Intent)}>{INTENT_OPTIONS.map(i => <option key={i} value={i}>{COMMAND_LABELS[i][language === 'sw-KE' ? 'sw' : 'en']}</option>)}</select></div>
          <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/> I have explained and obtained explicit consent to record and retain this voice sample.</label>
          <p className="muted">A fresh recording session begins when you reload this page. Collect separate sessions for validation.</p>
        </>}
        <button type="button" aria-pressed={state === 'listening'} disabled={state === 'processing'} onClick={toggleRecording}>{state === 'listening' ? '■ Stop and process voice' : state === 'processing' ? 'Processing…' : '🎙 Start voice recording'}</button>
        <div role="status" aria-live="polite" className="status">{status}</div>
        {prediction && <small>Last recognition: {prediction.intent} • {prediction.status} • {prediction.confidence === null ? 'unscored' : prediction.confidence.toFixed(3)} • {prediction.model_version}</small>}
      </section>
      <section className="panel stack">
        <h2>2. Test the official Controller</h2>
        <p>These buttons prove the toolkit can control the real webpage <strong>without pretending the AI model is trained.</strong></p>
        <div className="controls">{TEST_COMMANDS.map(c => <button type="button" className="secondary" key={c} onClick={() => void runToolkit(c)}>{c}</button>)}</div>
        <div id="controlled-site" className="content" aria-label="Demo article under toolkit control">
          <h3>Welcome to the accessible demo</h3>
          <p>Here is a real application surface. The official toolkit's ControlPort is responsible for actions here.</p>
          <h3>Our goal</h3>
          <p>The co-designer should use preferred speech to navigate in English or Kiswahili.</p>
          <h3>Accessibility matters</h3>
          <p>The person chooses commands. We reject uncertain predictions. We show feedback in a screen reader compatible region.</p>
          <p>Use the buttons above, then start training a private personalized speech profile.</p>
        </div>
        <div className="notice"><strong>Real inference:</strong> The backend starts in fail closed mode and rejects voice commands until a validated personal model has been trained and activated.</div>
      </section>
    </div>
    <footer><p className="muted">This prototype does not control unrelated applications. The separately packaged browser extension adds cross site support with explicit browser permissions.</p></footer>
  </main>;
}
