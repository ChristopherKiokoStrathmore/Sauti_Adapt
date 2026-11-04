'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COMMAND_LABELS, commandToUtterance, validRecognition, type Intent, type Language, type Recognition } from '@sauti/shared';
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { isReadAloudUtterance, speakText, stopSpeaking } from '@sauti/shared/speak';
import { CONTROLLER_CSS } from '@toolkit/controller/web/ui.js';
import { createController, createDomReceiver } from '@sauti/shared/controller';
import { capReadPort } from '@sauti/shared/page-text';

const COMMANDS: Intent[] = ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'READ_PAGE', 'UNDO'];
const STEPS = ['Your preferences', 'Your permission', 'Voice samples', 'Check recognition', 'Connect extension'] as const;
const TEST_COMMANDS = [
  { utterance: 'scroll down', label: 'scroll down' },
  { utterance: 'scroll up', label: 'scroll up' },
  { utterance: 'read this', label: 'Read this page aloud' },
  { utterance: "what's on screen", label: "What's on screen" },
  { utterance: 'bigger text', label: 'bigger text' },
  { utterance: 'undo', label: 'Undo last setting' },
];
type Step = 1 | 2 | 3 | 4 | 5;
type SessionRole = 'train' | 'calibration' | 'test';
type RecordMode = 'enroll' | 'recognize';
type ToolkitController = ReturnType<typeof createController>;

function labelFor(intent: Intent, language: Language) {
  return COMMAND_LABELS[intent][language === 'sw-KE' ? 'sw' : 'en'];
}

function sampleTarget(role: SessionRole, intent: Intent) {
  if (intent === 'UNKNOWN') return role === 'train' ? 0 : 5;
  return role === 'train' ? 3 : 2;
}

function sampleKey(role: SessionRole, language: Language, intent: Intent) {
  return [role, language, intent].join('|');
}

function Icon({ children, tone = 'violet' }: { children: ReactNode; tone?: 'violet' | 'blue' | 'green' }) {
  return <span className={'icon-tile icon-' + tone} aria-hidden="true">{children}</span>;
}

export function SautiDashboard() {
  const [step, setStep] = useState<Step>(1);
  const [profileId, setProfileId] = useState('');
  const [sessionShown, setSessionShown] = useState('');
  const [userId, setUserId] = useState('');
  const [userToken, setUserToken] = useState('');
  const [language, setLanguage] = useState<Language>('en-KE');
  const [intent, setIntent] = useState<Intent>('SCROLL_DOWN');
  const [sessionRole, setSessionRole] = useState<SessionRole>('train');
  const [chosen, setChosen] = useState<Intent[]>(COMMANDS);
  const [consent, setConsent] = useState(false);
  const [improvementConsent, setImprovementConsent] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [listenMethod, setListenMethod] = useState<'toggle' | 'separate'>('toggle');
  const [autoStop, setAutoStop] = useState(true);
  const [maxSeconds, setMaxSeconds] = useState('5');
  const [state, setState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [prediction, setPrediction] = useState<Recognition | null>(null);
  const [backendConfigured, setBackendConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState('The microphone stays off until you press Start recording.');
  const sessionId = useRef('');
  const recording = useRef<RecordingSession | null>(null);
  const recordMode = useRef<RecordMode>('enroll');
  const busy = useRef(false);
  const speakGen = useRef(0);
  const controller = useRef<ToolkitController | null>(null);
  const liveCreds = useRef({ userId: '', token: '' });
  const speechBind = useRef({ href: '', userId: '', token: '' });
  liveCreds.current = { userId, token: userToken };

  const intentOptions = useMemo(() => [...chosen, 'UNKNOWN' as Intent], [chosen]);
  const target = sampleTarget(sessionRole, intent);
  const saved = counts[sampleKey(sessionRole, language, intent)] || 0;
  const permissionReady = Boolean(userId.trim() && userToken.trim() && consent);

  useEffect(() => {
    const id = window.localStorage.getItem('sauti-demo-profile') || crypto.randomUUID();
    window.localStorage.setItem('sauti-demo-profile', id);
    setProfileId(id);
    sessionId.current = crypto.randomUUID();
    setSessionShown(sessionId.current);
    void fetch('/api/health', { cache: 'no-store' })
      .then(response => response.json())
      .then(body => setBackendConfigured(Boolean(body.speech_api_configured)))
      .catch(() => setBackendConfigured(false));
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const root = document.getElementById('controlled-site');
    if (root) controller.current = createController({
      control: capReadPort(createDomReceiver(root, { scrollTarget: root }), root),
      operator: { abilityModel: { supportAreas: ['motor'] } },
    });
    return () => { recording.current?.cancel(); stopSpeaking(); controller.current = null; };
  }, []);

  function silence() {
    speakGen.current += 1;
    stopSpeaking();
    setSpeaking(false);
  }

  function goTo(next: Step) {
    recording.current?.cancel();
    recording.current = null;
    busy.current = false;
    setState('idle');
    setStep(next);
  }

  function newSession(message = true) {
    const id = crypto.randomUUID();
    sessionId.current = id;
    setSessionShown(id);
    if (message) setStatus('A new recording session is ready. Earlier clips stay in their original session.');
  }

  async function runToolkit(utterance: string) {
    const gen = ++speakGen.current;
    stopSpeaking();
    setSpeaking(false);
    if (!controller.current) { setStatus('Controller has not initialized.'); return; }
    const result = await controller.current.handle(utterance);
    const pending = 'pending' in result && result.pending;
    const text = String(result.say || '') + (pending ? ' Use the confirmation controls if needed.' : '');
    setStatus(text);
    if (!isReadAloudUtterance(utterance) || result.ok === false) return;
    const started = speakText(String(result.say || ''), language, {
      onend: () => { if (speakGen.current === gen) setSpeaking(false); },
      onerror: () => { if (speakGen.current === gen) setSpeaking(false); },
    });
    if (speakGen.current === gen) setSpeaking(started);
    if (!started) setStatus(text + ' Speech playback is unavailable. The text stays on screen and is not uploaded.');
  }

  async function processAudio(audio: Blob) {
    const mode = recordMode.current;
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
      method: 'POST',
      headers: { 'x-sauti-user': userId.trim(), 'x-sauti-user-token': userToken },
      body: form,
      cache: 'no-store',
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail || body.error || 'Request failed.');
    if (mode === 'enroll') {
      const key = sampleKey(sessionRole, language, intent);
      setCounts(current => ({ ...current, [key]: (current[key] || 0) + 1 }));
      setStatus('Voice sample saved privately for ' + labelFor(intent, language) + '. Record a fresh example when ready.');
      return;
    }
    if (!validRecognition(body)) throw new Error('Invalid recognition contract returned by API.');
    setPrediction(body);
    const utterance = commandToUtterance(body);
    if (!utterance) {
      setStatus('No action taken: ' + (body.reason || 'Unknown or uncertain speech.') + ' Nothing was spoken.');
      return;
    }
    if (window.location.href !== speechBind.current.href) {
      setStatus('The page changed while speech was processing. No action was taken.');
      return;
    }
    if (liveCreds.current.userId.trim() !== speechBind.current.userId || liveCreds.current.token !== speechBind.current.token) {
      setStatus('Sign-in changed while speech was processing. No action was taken.');
      return;
    }
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
    catch (error) { setStatus('Could not process audio: ' + (error instanceof Error ? error.message : 'unknown error')); }
    finally { busy.current = false; setState('idle'); }
  }

  async function beginRecording(mode: RecordMode) {
    if (busy.current || recording.current) return;
    if (!profileId || !userId.trim() || !userToken.trim()) {
      setStatus('Open Your permission and enter your personal user ID and access token first.');
      return;
    }
    if (mode === 'enroll' && !consent) {
      setStatus('Explicit permission is required before a voice sample can be stored.');
      return;
    }
    recordMode.current = mode;
    speechBind.current = { href: window.location.href, userId: userId.trim(), token: userToken };
    silence();
    const maxDurationMs = clampClipMs(Number(maxSeconds) * 1000);
    try {
      recording.current = await startRecording({ maxDurationMs, autoStop, onAutoStop: () => { void finishRecording(); } });
      setPrediction(null);
      setState('listening');
      setStatus(autoStop
        ? 'Listening because you pressed the button. Recording stops after ' + maxDurationMs / 1000 + ' seconds or when you stop it.'
        : 'Listening because you pressed the button. Select Stop when the phrase is finished.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Microphone unavailable.');
    }
  }

  function RecordingButtons({ mode }: { mode: RecordMode }) {
    if (listenMethod === 'toggle') {
      return <button type="button" className={'record-button ' + (state === 'listening' ? 'is-listening' : '')} aria-pressed={state === 'listening'} disabled={state === 'processing'} onClick={() => {
        if (state === 'listening') void finishRecording(); else void beginRecording(mode);
      }}><span aria-hidden="true">{state === 'listening' ? '■' : '●'}</span>{state === 'listening' ? 'Stop and process voice' : state === 'processing' ? 'Processing…' : 'Start voice recording'}</button>;
    }
    return <div className="record-actions"><button type="button" className="record-button" disabled={state !== 'idle'} onClick={() => void beginRecording(mode)}>● Start voice recording</button><button type="button" className="soft-button" disabled={state !== 'listening'} onClick={() => void finishRecording()}>■ Stop and process voice</button></div>;
  }

  async function deleteProfile() {
    const response = await fetch('/api/profile?profile_id=' + encodeURIComponent(profileId), {
      method: 'DELETE',
      headers: { 'x-sauti-user': userId.trim(), 'x-sauti-user-token': userToken },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setStatus(body.detail || body.error || 'Deletion failed.'); return; }
    setDeleteArmed(false);
    setCounts({});
    setPrediction(null);
    setStatus(body.deleted ? 'Deleted ' + body.recordings_removed + ' recording(s) and the private model for this profile.' : 'No stored recordings were found.');
  }

  async function copyExtensionSetup() {
    try {
      await navigator.clipboard.writeText('Sauti Adapt profile: ' + profileId + '\\nPWA origin: ' + window.location.origin);
      setStatus('Profile ID and this website address copied. Paste them into the browser extension setup.');
    } catch {
      setStatus('Copy was unavailable. Use the profile ID shown in Your voice, your choice.');
    }
  }

  return <main className="app-shell">
    <style data-aa-upstream-css="">{CONTROLLER_CSS}</style>
    <header className="topbar">
      <a href="#main-onboarding" className="brand" aria-label="Sauti Adapt home"><span className="brand-mark" aria-hidden="true">✚</span><span>Sauti Adapt</span></a>
      <span className="concept-badge">Research prototype</span>
      <button className="profile-button" type="button" onClick={() => goTo(2)}><span aria-hidden="true">●</span> My voice profile</button>
    </header>

    <section className="intro" aria-labelledby="page-title">
      <p className="eyebrow">Personalized voice accessibility</p>
      <h1 id="page-title">Set up Sauti to understand your voice</h1>
      <p>Choose useful commands. Record at your pace. Test recognition before connecting the extension.</p>
    </section>

    <div id="main-onboarding" className="onboarding-layout">
      <nav className="stepper-card" aria-label="Onboarding steps">
        <ol>{STEPS.map((item, index) => {
          const number = (index + 1) as Step;
          const complete = number < step;
          return <li key={item} className={number === step ? 'active' : complete ? 'complete' : ''}><button type="button" aria-current={number === step ? 'step' : undefined} onClick={() => goTo(number)}><span className="step-number">{complete ? '✓' : number}</span><span>{item}</span></button></li>;
        })}</ol>
        <div className="helper-illustration" aria-hidden="true"><div className="voice-waves">)))</div><div className="helper-person"><span className="helper-head"/><span className="helper-body"/><span className="helper-laptop">●</span></div></div>
        <p className="helper-copy">You can pause setup at any time.</p>
      </nav>

      <section className="main-card">
        <div hidden={step !== 1}>
          <div className="section-heading"><Icon>⚙</Icon><div><p className="step-kicker">Step 1 of 5</p><h2>Your preferences</h2></div></div>
          <p className="lead-copy">Choose the language, commands, and recording control that feel useful and comfortable.</p>
          <fieldset className="choice-group"><legend>Language</legend><div className="segmented"><button type="button" className={language === 'en-KE' ? 'selected' : ''} aria-pressed={language === 'en-KE'} onClick={() => setLanguage('en-KE')}>English</button><button type="button" className={language === 'sw-KE' ? 'selected' : ''} aria-pressed={language === 'sw-KE'} onClick={() => setLanguage('sw-KE')}>Kiswahili</button></div></fieldset>
          <fieldset className="choice-group command-grid"><legend>Commands to practise</legend>{COMMANDS.map(command => <label className={chosen.includes(command) ? 'command-choice selected' : 'command-choice'} key={command}><input type="checkbox" checked={chosen.includes(command)} onChange={event => {
            setChosen(current => event.target.checked ? [...current, command] : current.filter(item => item !== command));
            if (!event.target.checked && intent === command) setIntent('UNKNOWN');
          }}/><span className="command-check">✓</span><span>{labelFor(command, language)}</span></label>)}</fieldset>
          <div className="settings-grid"><div className="field"><label htmlFor="listen">Recording control</label><select id="listen" value={listenMethod} onChange={event => setListenMethod(event.target.value as 'toggle' | 'separate')}><option value="toggle">One start and stop button</option><option value="separate">Separate start and stop buttons</option></select></div><div className="field"><label htmlFor="maxsec">Clip length</label><select id="maxsec" value={maxSeconds} onChange={event => setMaxSeconds(event.target.value)}><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="8">8 seconds</option></select></div></div>
          <label className="check-row"><input type="checkbox" checked={autoStop} onChange={event => setAutoStop(event.target.checked)}/><span><strong>Stop automatically</strong><small>Recording ends at the selected clip length.</small></span></label>
          <div className="card-actions"><button type="button" onClick={() => goTo(2)}>Save and continue <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => setStatus('Your preferences remain on this screen until you continue.')}>Pause setup</button></div>
        </div>

        <div hidden={step !== 2}>
          <div className="section-heading"><Icon tone="green">✓</Icon><div><p className="step-kicker">Step 2 of 5</p><h2>Your permission</h2></div></div>
          <p className="lead-copy">Your voice is personal data. Sauti stores a clip only after you deliberately start recording and give permission.</p>
          <div className="field"><label htmlFor="user">Personal user ID</label><input id="user" autoComplete="off" value={userId} onChange={event => setUserId(event.target.value)} placeholder="Your account UUID"/></div>
          <div className="field"><label htmlFor="code">Personal access token</label><input id="code" type="password" autoComplete="off" value={userToken} onChange={event => setUserToken(event.target.value)} placeholder="Not saved in this browser"/></div>
          <label className="permission-card"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span><strong>Store the voice samples I deliberately record</strong><small>Samples are sent to the private speech service and linked to this profile. You can delete the profile later.</small></span></label>
          <label className="permission-card secondary-permission"><input type="checkbox" checked={improvementConsent} onChange={event => setImprovementConsent(event.target.checked)}/><span><strong>Consider recordings I approve for a future model update</strong><small>This does not switch models automatically. A new version must pass separate checks before activation.</small></span></label>
          {!permissionReady && <p className="inline-note">Add your personal credentials and storage permission before recording.</p>}
          <div className="card-actions"><button type="button" disabled={!permissionReady} onClick={() => goTo(3)}>Continue to voice samples <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => goTo(1)}>Back</button></div>
        </div>

        <div hidden={step !== 3}>
          <div className="section-heading"><Icon>●</Icon><div><p className="step-kicker">Step 3 of 5</p><h2>Teach Sauti your voice</h2></div></div>
          <div className="segmented language-switch"><button type="button" className={language === 'en-KE' ? 'selected' : ''} aria-pressed={language === 'en-KE'} onClick={() => setLanguage('en-KE')}>English</button><button type="button" className={language === 'sw-KE' ? 'selected' : ''} aria-pressed={language === 'sw-KE'} onClick={() => setLanguage('sw-KE')}>Kiswahili</button></div>
          <div className="field"><label htmlFor="intent">Command to practise</label><select id="intent" value={intent} onChange={event => setIntent(event.target.value as Intent)}>{intentOptions.map(command => <option key={command} value={command}>{labelFor(command, language)}</option>)}</select></div>
          <div className="phrase-card"><span aria-hidden="true">◖))</span><strong>{labelFor(intent, language)}</strong></div>
          <p className="comfort-copy">Use a phrase that feels comfortable to you.</p>
          <div className="sample-row"><strong>{target ? 'Example ' + Math.min(saved + 1, target) + ' of ' + target : 'Optional training example'}</strong><div className="sample-dots" aria-label={saved + ' of ' + target + ' saved'}>{Array.from({ length: Math.max(target, 1) }, (_, index) => <span className={index < saved ? 'done' : index === saved ? 'current' : ''} key={index}/>)}</div></div>
          <RecordingButtons mode="enroll"/>
          <div className="record-secondary"><button className="soft-button" type="button" disabled>▶ Listen</button><button className="soft-button" type="button" onClick={() => setStatus('Record a fresh example. Existing samples remain stored in their session.')}>↻ Record again</button></div>
          <p className="break-copy">Take a break whenever you need.</p>
          <details className="advanced-settings"><summary>Session settings</summary><div className="settings-grid"><div className="field"><label htmlFor="role">Recording session</label><select id="role" value={sessionRole} onChange={event => { setSessionRole(event.target.value as SessionRole); newSession(false); }}><option value="train">Training</option><option value="calibration">Calibration</option><option value="test">Untouched test</option></select></div><div className="field"><label htmlFor="session">Session ID</label><input id="session" readOnly value={sessionShown}/></div></div><button type="button" className="soft-button" onClick={() => newSession()}>Start a new recording session</button><p>Use different sessions for training, calibration, and the untouched test. Include unrelated speech under Unknown speech.</p></details>
          <div className="card-actions"><button type="button" onClick={() => goTo(4)}>Check recognition <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => setStatus('Setup paused. Your saved samples remain in private storage.')}>Pause setup</button></div>
        </div>

        <div hidden={step !== 4}>
          <div className="section-heading"><Icon tone="blue">✓</Icon><div><p className="step-kicker">Step 4 of 5</p><h2>Check recognition</h2></div></div>
          <p className="lead-copy">Try a fresh command. Sauti acts only when the personal model accepts it. Uncertain speech does nothing.</p>
          <RecordingButtons mode="recognize"/>
          {prediction && <div className={'prediction-card ' + prediction.status}><span className="prediction-icon">{prediction.status === 'accepted' ? '✓' : '!'}</span><div><strong>{prediction.status === 'accepted' ? labelFor(prediction.intent, language) : 'Command rejected safely'}</strong><small>{prediction.reason || 'Accepted by the active personal model.'}</small></div></div>}
          <div className="toolkit-check">
            <div className="toolkit-heading"><Icon>AI</Icon><div><h3>AI4A11y Toolkit check</h3><p>Test the official Controller directly while the personal model is being prepared.</p></div></div>
            <div className="controls">{TEST_COMMANDS.map(command => <button type="button" className="soft-button" key={command.utterance} onClick={() => void runToolkit(command.utterance)}>{command.label}</button>)}</div>
            <button type="button" className="text-button" disabled={!speaking} onClick={silence}>Stop speaking</button>
            <div id="controlled-site" className="content" aria-label="Demo article under toolkit control"><h3>Welcome to the accessible demo</h3><p>Here is a real application surface. The official toolkit Controller is responsible for actions here.</p><h3>Our goal</h3><p>The co-designer uses preferred speech to navigate in Kenyan English or Kiswahili.</p><h3>Accessibility matters</h3><p>The person chooses commands. Uncertain predictions are rejected and feedback stays available to screen readers.</p><h3>A longer page</h3><p>This section gives scroll commands a real distance to move inside the article.</p><p>Text size, contrast, and motion settings are applied here by the toolkit DOM receiver.</p><p>The end of the demo article is below this line.</p></div>
          </div>
          <div className="card-actions"><button type="button" onClick={() => goTo(5)}>Continue to extension <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => goTo(3)}>Back to samples</button></div>
        </div>

        <div hidden={step !== 5}>
          <div className="section-heading"><Icon>✚</Icon><div><p className="step-kicker">Step 5 of 5</p><h2>Connect the browser extension</h2></div></div>
          <p className="lead-copy">The extension uses the same private profile on websites you explicitly permit.</p>
          <div className="connection-box"><div className="extension-window" aria-hidden="true"><span/><span/><span/><strong>✚</strong></div><div><strong>Profile ready to share with the extension</strong><p>Copy the profile ID and this website address, then paste them into the Sauti Adapt extension.</p></div></div>
          <ol className="extension-steps"><li>Build and load the extension from <code>apps/extension/dist</code>.</li><li>Open its side panel and paste this PWA origin and profile ID.</li><li>Enter the same personal user ID and token.</li><li>Enable only the website you want Sauti to control.</li></ol>
          <button type="button" onClick={() => void copyExtensionSetup()}>Copy extension setup</button>
          <p className="inline-note">The website cannot confirm an unpacked extension is installed. Connection is completed in the extension side panel.</p>
          <div className="card-actions"><button type="button" className="soft-button" onClick={() => goTo(4)}>Run another recognition check</button><button className="text-button" type="button" onClick={() => goTo(1)}>Review setup</button></div>
        </div>
      </section>

      <aside className="side-stack">
        <section className="side-card privacy-card">
          <h2>Your voice, your choice</h2>
          <div className="privacy-summary"><Icon>▰</Icon><p>Private recordings linked to your profile</p></div>
          <div className="field compact"><label htmlFor="profile">Private profile ID</label><div className="copy-field"><input id="profile" readOnly value={profileId}/><button type="button" aria-label="Copy profile ID" onClick={() => void navigator.clipboard.writeText(profileId).then(() => setStatus('Profile ID copied.')).catch(() => setStatus('Copy was unavailable.'))}>⧉</button></div></div>
          <p className="privacy-note">{improvementConsent ? 'Approved recordings may support the next validated profile.' : 'Future model improvement is off until you choose it.'}</p>
          <p className="validation-note">New model versions must be tested before activation.</p>
          <label className="delete-check"><input type="checkbox" checked={deleteArmed} onChange={event => setDeleteArmed(event.target.checked)}/> Confirm profile deletion</label>
          <button type="button" className="delete-button" disabled={!deleteArmed || !userId.trim() || !userToken.trim()} onClick={() => void deleteProfile()}>Delete my voice data</button>
        </section>
        <section className="side-card status-card">
          <h2>Connection status</h2>
          <div className="status-row"><span aria-hidden="true">●</span><strong>Speech service</strong><span className={'state-pill ' + (backendConfigured ? 'ready' : 'pending')}>{backendConfigured === null ? 'Checking' : backendConfigured ? 'Configured' : 'Preview only'}</span></div>
          <div className="status-row"><span aria-hidden="true">●</span><strong>Voice profile</strong><span className={'state-pill ' + (saved > 0 ? 'ready' : 'pending')}>{saved > 0 ? 'In progress' : 'Not started'}</span></div>
          <div className="status-row"><span aria-hidden="true">●</span><strong>Recognition check</strong><span className={'state-pill ' + (prediction?.status === 'accepted' ? 'ready' : 'pending')}>{prediction?.status === 'accepted' ? 'Accepted' : 'Pending'}</span></div>
          <div className="status-row"><span aria-hidden="true">●</span><strong>Browser extension</strong><span className="state-pill neutral">Not confirmed</span></div>
          <button type="button" className="soft-button full-width" disabled={!prediction} onClick={() => goTo(5)}>Connect extension</button>
          <small>Available after you run a recognition check.</small>
        </section>
      </aside>
    </div>

    <div role="status" aria-live="polite" className="global-status">{status}</div>

    <section className="after-onboarding" aria-labelledby="after-title">
      <div className="after-title"><span className="after-icon" aria-hidden="true">▣</span><h2 id="after-title">After onboarding</h2></div>
      <div className="flow-card"><Icon tone="blue">▰</Icon><div><strong>Personal voice profile</strong><span>Recognizes your chosen commands</span></div></div><span className="flow-arrow" aria-hidden="true">→</span>
      <div className="flow-card"><Icon>AI</Icon><div><strong>AI4A11y Toolkit</strong><span>Handles accepted commands</span></div></div><span className="flow-arrow" aria-hidden="true">→</span>
      <div className="flow-card"><Icon>✚</Icon><div><strong>Browser extension</strong><span>Works on websites you permit</span></div></div>
      <p className="feedback-banner">Feedback you approve can support the next validated voice profile.</p>
    </section>
    <footer><p>Sauti Adapt supports access and communication. It does not diagnose or treat cerebral palsy or another medical condition.</p></footer>
  </main>;
}
