'use client';
import { useEffect, useRef, useState } from 'react';
import { COMMAND_LABELS, commandToUtterance, validRecognition, type Intent, type Language, type Recognition } from '@sauti/shared';
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { isReadAloudUtterance, speakText, stopSpeaking } from '@sauti/shared/speak';
import { createController } from '@toolkit/controller/createController.js';
import { createDomReceiver } from '@toolkit/controller/web/dom-receiver.js';
import { CONTROLLER_CSS } from '@toolkit/controller/web/ui.js';

const INTENT_OPTIONS: Intent[] = ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'READ_PAGE', 'UNDO', 'UNKNOWN'];
const TEST_COMMANDS = [
  { utterance: 'scroll down', label: 'scroll down' },
  { utterance: 'scroll up', label: 'scroll up' },
  { utterance: 'read this', label: 'Read this page aloud' },
  { utterance: 'bigger text', label: 'bigger text' },
  { utterance: 'undo', label: 'Undo last setting' },
];

type ToolkitController = ReturnType<typeof createController>;

export function SautiDashboard() {
  const [profileId, setProfileId] = useState('');
  const sessionId = useRef('');
  const [sessionShown, setSessionShown] = useState('');
  const [userId, setUserId] = useState('');
  const [userToken, setUserToken] = useState('');
  const [language, setLanguage] = useState<Language>('en-KE');
  const [intent, setIntent] = useState<Intent>('SCROLL_DOWN');
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<'enroll'|'recognize'>('recognize');
  const [sessionRole, setSessionRole] = useState<'train'|'calibration'|'test'>('train');
  const [chosen, setChosen] = useState<Intent[]>(['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'READ_PAGE', 'UNDO']);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [state, setState] = useState<'idle'|'listening'|'processing'>('idle');
  const [listenMethod, setListenMethod] = useState<'toggle'|'separate'>('toggle');
  const [autoStop, setAutoStop] = useState(true);
  const [maxSeconds, setMaxSeconds] = useState('5');
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState('The microphone stays off until you press the recording button.');
  const [prediction, setPrediction] = useState<Recognition | null>(null);
  const recording = useRef<RecordingSession | null>(null);
  const busy = useRef(false);
  const speakGen = useRef(0);
  const controller = useRef<ToolkitController | null>(null);
  useEffect(() => {
    const id = window.localStorage.getItem('sauti-demo-profile') || crypto.randomUUID();
    window.localStorage.setItem('sauti-demo-profile', id);
    setProfileId(id);
    sessionId.current = crypto.randomUUID();
    setSessionShown(sessionId.current);
    if ('serviceWorker' in navigator) { void navigator.serviceWorker.register('/sw.js').catch(() => undefined); }
    const root = document.getElementById('controlled-site');
    if (root) controller.current = createController({
      control: createDomReceiver(root, { scrollTarget: root }),
      // createController.js defaults `operator = null`, so tsc infers null and drops the JSDoc.
      // The implementation reads operator.abilityModel (see createController.js).
      // @ts-expect-error upstream JS default hides the documented operator object type
      operator: { abilityModel: { supportAreas: ['motor'] } }
    });
    return () => { recording.current?.cancel(); stopSpeaking(); controller.current = null; };
  }, []);

  function silence() {
    speakGen.current += 1;
    stopSpeaking();
    setSpeaking(false);
  }

  async function runToolkit(utterance: string) {
    const gen = ++speakGen.current;
    stopSpeaking();
    setSpeaking(false);
    if (!controller.current) { setStatus('Controller has not initialized.'); return; }
    const result = await controller.current.handle(utterance);
    // `pending` is only present on the confirmation branch of handle().
    const pending = 'pending' in result && result.pending;
    const text = String(result.say || '') + (pending ? ' Use the confirmation controls if needed.' : '');
    setStatus(text);
    if (!isReadAloudUtterance(utterance) || result.ok === false) return;
    const started = speakText(String(result.say || ''), language, {
      onend: () => { if (speakGen.current === gen) setSpeaking(false); },
      onerror: () => { if (speakGen.current === gen) setSpeaking(false); },
    });
    if (speakGen.current === gen) setSpeaking(started);
    if (!started) setStatus(text + ' Speech playback is not available in this browser. The text stays on screen and is not uploaded.');
  }

  async function processAudio(audio: Blob) {
    const form = new FormData();
    form.append('audio', audio, 'utterance.wav');
    form.append('profile_id', profileId);
    form.append('language', language);
    if (mode === 'enroll') {
      form.append('intent', intent);
      form.append('session_id', sessionId.current);
      form.append('session_role', sessionRole);
      form.append('consent', String(consent));
    }
    const response = await fetch(mode === 'enroll' ? '/api/enroll' : '/api/recognize', {
      method: 'POST', headers: { 'x-sauti-user': userId.trim(), 'x-sauti-user-token': userToken }, body: form, cache: 'no-store'
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

  async function finishRecording() {
    if (busy.current) return;
    const active = recording.current;
    if (!active) return;
    busy.current = true;
    recording.current = null;
    setState('processing');
    try { await processAudio(await active.stop()); }
    catch (e) { setStatus(`Could not process audio: ${e instanceof Error ? e.message : 'unknown error'}`); }
    finally { busy.current = false; setState('idle'); }
  }

  async function beginRecording() {
    if (busy.current || recording.current) return;
    if (!profileId || !userId.trim() || !userToken.trim()) { setStatus('Enter your personal user ID and access token first.'); return; }
    if (mode === 'enroll' && !consent) { setStatus('Explicit consent is required to store enrollment recordings.'); return; }
    if (mode === 'enroll' && intent !== 'UNKNOWN' && !chosen.includes(intent)) { setStatus('Choose this command before recording it.'); return; }
    silence();
    const maxDurationMs = clampClipMs(Number(maxSeconds) * 1000);
    try {
      recording.current = await startRecording({
        maxDurationMs,
        autoStop,
        onAutoStop: () => { void finishRecording(); },
      });
      setPrediction(null);
      setState('listening');
      setStatus(autoStop
        ? `Listening, because you pressed the button. It stops after ${maxDurationMs / 1000} seconds, or when you stop it.`
        : 'Listening, because you pressed the button. Select Stop when the command is finished. The server still rejects over-long clips.');
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Microphone unavailable.'); }
  }

  return <main className="container">
    <style data-aa-upstream-css="">{CONTROLLER_CSS}</style>
    <header className="hero"><h1>Sauti Adapt</h1>
      <p>Kenyan English and Kiswahili commands reach the official AI4A11y Controller only when the prototype accepts them.</p>
      <p className="muted">The running app freezes facebook/wav2vec2-base and keeps one prototype per command and language. It does not fine-tune the encoder. Notebook experiments are not wired in. No accuracy is claimed.</p>
    </header>
    <div className="grid">
      <section className="panel stack" aria-label="Voice setup">
        <h2>1. Voice profile and enrollment</h2>
        <p className="muted">This is a private prototype. Do not upload a person's voice without their informed consent.</p>
        <div className="field"><label htmlFor="profile">Private profile identifier</label><input id="profile" readOnly value={profileId}/></div>
        <div className="field"><label htmlFor="user">Personal user ID</label><input id="user" autoComplete="off" value={userId} onChange={e => setUserId(e.target.value)} placeholder="Your account UUID"/></div>
        <div className="field"><label htmlFor="code">Personal access token</label><input id="code" type="password" autoComplete="off" value={userToken} onChange={e => setUserToken(e.target.value)} placeholder="Not saved in the browser"/></div>
        <div className="field"><label htmlFor="language">Language</label><select id="language" value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="en-KE">Kenyan English</option><option value="sw-KE">Kiswahili</option></select></div>
        <div className="field"><label htmlFor="mode">Task</label><select id="mode" value={mode} onChange={e => setMode(e.target.value as 'enroll'|'recognize')}><option value="recognize">Recognize and act</option><option value="enroll">Record an enrollment example</option></select></div>
        {mode === 'enroll' && <>
          <fieldset className="stack"><legend>Commands this person chose</legend>
            {INTENT_OPTIONS.filter(i => i !== 'UNKNOWN').map(i => <label key={i}><input type="checkbox" checked={chosen.includes(i)} onChange={e => { setChosen(current => e.target.checked ? [...current, i] : current.filter(x => x !== i)); if (!e.target.checked && intent === i) setIntent('UNKNOWN'); }}/> {COMMAND_LABELS[i][language === 'sw-KE' ? 'sw' : 'en']}</label>)}
          </fieldset>
          <div className="field"><label htmlFor="intent">This clip</label><select id="intent" value={intent} onChange={e => setIntent(e.target.value as Intent)}>{[...chosen, 'UNKNOWN' as Intent].map(i => <option key={i} value={i}>{COMMAND_LABELS[i][language === 'sw-KE' ? 'sw' : 'en']}</option>)}</select></div>
          <div className="field"><label htmlFor="role">Recording session</label><select id="role" value={sessionRole} onChange={e => setSessionRole(e.target.value as 'train'|'calibration'|'test')}><option value="train">Training session</option><option value="calibration">Calibration session</option><option value="test">Untouched test session</option></select></div>
          <div className="field"><label htmlFor="session">Session identifier</label><input id="session" readOnly value={sessionShown}/></div>
          <button type="button" className="secondary" onClick={() => { const id = crypto.randomUUID(); sessionId.current = id; setSessionShown(id); setStatus('Started a new recording session. Earlier clips stay in their own session.'); }}>Start a new recording session</button>
          <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/> I have explained this recording, and the person consents to store this voice clip until they delete it.</label>
          <p className="muted">Clips stay in private server storage outside this git repository. Use a separate session for calibration and another for the untouched test. Unknown speech is recorded on purpose so uncertain clips can be rejected.</p>
        </>}
        <div className="field"><label htmlFor="listen">Listen control</label><select id="listen" value={listenMethod} onChange={e => setListenMethod(e.target.value as 'toggle'|'separate')}><option value="toggle">One toggle button</option><option value="separate">Separate start and stop</option></select></div>
        <div className="field"><label htmlFor="maxsec">Maximum clip length (seconds)</label><input id="maxsec" type="number" min={0.5} max={30} step={0.5} value={maxSeconds} onChange={e => setMaxSeconds(e.target.value)}/></div>
        <label><input type="checkbox" checked={autoStop} onChange={e => setAutoStop(e.target.checked)}/> Stop automatically at the time limit</label>
        <p className="muted">Defaults are one toggle and a 5 second auto-stop. Agree the final length and control with the participant. The server still rejects clips longer than SAUTI_MAX_CLIP_SECONDS (default 5). The microphone stays off until you press the button. Enrollment still requires the consent checkbox.</p>
        {listenMethod === 'toggle'
          ? <button type="button" aria-pressed={state === 'listening'} disabled={state === 'processing'} onClick={() => { if (state === 'listening') void finishRecording(); else void beginRecording(); }}>{state === 'listening' ? '■ Stop and process voice' : state === 'processing' ? 'Processing…' : '🎙 Start voice recording'}</button>
          : <><button type="button" disabled={state !== 'idle'} onClick={() => void beginRecording()}>🎙 Start voice recording</button><button type="button" disabled={state !== 'listening'} onClick={() => void finishRecording()}>■ Stop and process voice</button></>}
        <button type="button" className="secondary" disabled={!speaking} onClick={silence}>Stop speaking</button>
        <label><input type="checkbox" checked={deleteArmed} onChange={e => setDeleteArmed(e.target.checked)}/> I want every recording and model for this profile deleted.</label>
        <button type="button" className="secondary" disabled={!deleteArmed || !userId.trim() || !userToken.trim()} onClick={() => {
          void (async () => {
            const response = await fetch(`/api/profile?profile_id=${encodeURIComponent(profileId)}`, { method: 'DELETE', headers: { 'x-sauti-user': userId.trim(), 'x-sauti-user-token': userToken } });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) { setStatus(body.detail || body.error || 'Deletion failed.'); return; }
            setDeleteArmed(false);
            setStatus(body.deleted ? `Deleted ${body.recordings_removed} recording(s). They will not be used again.` : 'No stored recordings were found for this profile.');
          })();
        }}>Delete this voice profile</button>
        <div role="status" aria-live="polite" className="status">{status}</div>
        {prediction && <small>Last recognition: {prediction.intent} • {prediction.status} • {prediction.confidence === null ? 'unscored' : prediction.confidence.toFixed(3)} • {prediction.model_version}</small>}
      </section>
      <section className="panel stack">
        <h2>2. Test the official Controller</h2>
        <p>These buttons prove the toolkit can control the real webpage <strong>without pretending the AI model is trained.</strong></p>
        <div className="controls">{TEST_COMMANDS.map(c => <button type="button" className="secondary" key={c.utterance} onClick={() => void runToolkit(c.utterance)}>{c.label}</button>)}</div>
        <p className="muted">Read this page aloud uses the browser speechSynthesis voice for the text already on screen. That speech is not recorded or uploaded. Stop speaking cancels it. Undo last setting reverses the last display setting only, such as text size. It does not undo scrolling or Back.</p>
        <button type="button" className="secondary" disabled={!speaking} onClick={silence}>Stop speaking</button>
        <div id="controlled-site" className="content" aria-label="Demo article under toolkit control">
          <h3>Welcome to the accessible demo</h3>
          <p>Here is a real application surface. The official toolkit's ControlPort is responsible for actions here.</p>
          <h3>Our goal</h3>
          <p>The co-designer should use preferred speech to navigate in English or Kiswahili.</p>
          <h3>Accessibility matters</h3>
          <p>The person chooses commands. We reject uncertain predictions. We show feedback in a screen reader compatible region.</p>
          <p>Use the buttons above, then start training a private personalized speech profile.</p>
          <h3>A longer page</h3>
          <p>This extra section exists so scroll commands have a real distance to move inside the article. It is demonstration copy, not a recording and not a personal story.</p>
          <p>Kenyan English and Kiswahili commands stay on the allowlist. Uncertain speech does nothing.</p>
          <p>Text size, contrast, and motion settings are applied on this article by the toolkit DOM receiver.</p>
          <p>The end of the article is here, below the fold of this panel.</p>
        </div>
        <div className="notice"><strong>Fail closed:</strong> Mock mode rejects every recording. An activated personal model is frozen-encoder prototypes, not a fine-tuned network. Passing its private checks is not an accuracy claim.</div>
      </section>
    </div>
    <footer><p className="muted">This prototype does not control unrelated applications. The separately packaged browser extension adds cross site support with explicit browser permissions.</p></footer>
  </main>;
}
