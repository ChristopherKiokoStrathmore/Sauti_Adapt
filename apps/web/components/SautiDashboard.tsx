'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COMMAND_LABELS, commandToUtterance, validRecognition, type Intent, type Language, type Recognition } from '@sauti/shared';
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { isReadAloudUtterance, speakText, stopSpeaking } from '@sauti/shared/speak';
import { CONTROLLER_CSS } from '@toolkit/controller/web/ui.js';
import { createController, createDomReceiver } from '@sauti/shared/controller';
import { capReadPort } from '@sauti/shared/page-text';

const COMMANDS: Intent[] = ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK', 'READ_PAGE', 'UNDO'];
/** Version of the consent text below. Bump it whenever the wording changes, so each clip records what was agreed. */
const TERMS_VERSION = '2026-11-v1';
/** TEMPLATE: have a Kenyan data protection lawyer review this text and set a real contact before real users enrol. */
const TERMS_CONTACT = process.env.NEXT_PUBLIC_SAUTI_PRIVACY_CONTACT?.trim() || '';
const RETENTION_OPTIONS = [30, 90, 180, 365] as const;
const TONES = [
  { id: 'neutral', label: 'Calm', prompt: 'in your normal, calm voice' },
  { id: 'happy', label: 'Happy', prompt: 'as if you are happy or pleased' },
  { id: 'frustrated', label: 'Frustrated', prompt: 'as if you are a little frustrated' },
] as const;
type ToneId = (typeof TONES)[number]['id'];
const ROLE_LABEL: Record<'train' | 'calibration' | 'test', string> = { train: 'Training', calibration: 'Calibration', test: 'Untouched test' };
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
type ComparisonModel = 'prototype' | 'english' | 'swahili' | 'all';
type ComparisonLanguage = Language | 'mixed';
type ComparisonRow = {
  model: string;
  status: string;
  intent?: string | null;
  transcript?: string | null;
  error?: string;
  load_and_inference_seconds?: number | null;
  correct_intent?: boolean;
  wer?: number | null;
  cer?: number | null;
};
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
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState('');
  const [speechCondition, setSpeechCondition] = useState('prefer-not-to-say');
  const [language, setLanguage] = useState<Language>('en-KE');
  const [intent, setIntent] = useState<Intent>('SCROLL_DOWN');
  const [sessionRole, setSessionRole] = useState<SessionRole>('train');
  const [chosen, setChosen] = useState<Intent[]>(COMMANDS);
  const [consent, setConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number>(90);
  const [readSteps, setReadSteps] = useState(false);
  const [hasClip, setHasClip] = useState(false);
  const [pendingClip, setPendingClip] = useState<Blob | null>(null);
  const [roleSessions, setRoleSessions] = useState<Record<SessionRole, string>>({ train: '', calibration: '', test: '' });
  const [improvementConsent, setImprovementConsent] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [listenMethod, setListenMethod] = useState<'toggle' | 'separate'>('toggle');
  const [autoStop, setAutoStop] = useState(true);
  const [maxSeconds, setMaxSeconds] = useState('5');
  const [state, setState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [prediction, setPrediction] = useState<Recognition | null>(null);
  const [experimentMode, setExperimentMode] = useState(false);
  const [comparisonModel, setComparisonModel] = useState<ComparisonModel>('all');
  const [comparisonLanguage, setComparisonLanguage] = useState<ComparisonLanguage>('mixed');
  const [comparisonConsent, setComparisonConsent] = useState(false);
  const [comparisonExpected, setComparisonExpected] = useState<Intent>('SCROLL_DOWN');
  const [comparisonReference, setComparisonReference] = useState('');
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [backendConfigured, setBackendConfigured] = useState<boolean | null>(null);
  const [status, setStatus] = useState('The microphone stays off until you press Start recording.');
  const sessionId = useRef('');
  const recording = useRef<RecordingSession | null>(null);
  const recordMode = useRef<RecordMode>('enroll');
  const busy = useRef(false);
  const speakGen = useRef(0);
  const clipUrl = useRef('');
  const clipAudio = useRef<HTMLAudioElement | null>(null);
  const controller = useRef<ToolkitController | null>(null);
  const liveCreds = useRef({ userId: '', token: '' });
  const speechBind = useRef({ href: '', userId: '', token: '' });
  liveCreds.current = { userId, token: userToken };

  const intentOptions = useMemo(() => [...chosen, 'UNKNOWN' as Intent], [chosen]);
  const target = sampleTarget(sessionRole, intent);
  const saved = counts[sampleKey(sessionRole, language, intent)] || 0;
  function roleProgress(role: SessionRole) {
    const rows = chosen.map(command => ({ command, have: counts[sampleKey(role, language, command)] || 0, need: sampleTarget(role, command) }));
    const unknownNeed = sampleTarget(role, 'UNKNOWN');
    const unknownHave = counts[sampleKey(role, language, 'UNKNOWN')] || 0;
    const done = chosen.length >= 3 && rows.every(row => row.have >= row.need) && unknownHave >= unknownNeed;
    return { rows, unknownHave, unknownNeed, done };
  }
  const progress = { train: roleProgress('train'), calibration: roleProgress('calibration'), test: roleProgress('test') };
  const readyToTrain = progress.train.done && progress.calibration.done && progress.test.done;
  const trainCommand = 'python -m sauti_ml.train --profile-id ' + profileId + ' --calibration-session ' + roleSessions.calibration + ' --test-session ' + roleSessions.test;
  const nextTone = TONES[saved % TONES.length];
  const ageNumber = Number(age);
  const eligibleAge = /^\d{1,3}$/.test(age) && ageNumber >= 18 && ageNumber <= 120;
  const permissionReady = Boolean(displayName.trim() && displayName.trim().length <= 100 && eligibleAge && (accountReady || (userId.trim() && userToken.trim())) && consent && termsAccepted && TERMS_CONTACT);
  const canContinue = Boolean(displayName.trim() && displayName.trim().length <= 100 && /^\d{1,3}$/.test(age) && ageNumber > 0 && ageNumber <= 120 && termsAccepted && consent);

  useEffect(() => {
    const id = window.localStorage.getItem('sauti-demo-profile') || crypto.randomUUID();
    window.localStorage.setItem('sauti-demo-profile', id);
    setProfileId(id);
    window.sessionStorage.removeItem('sauti-pilot-account');
    void fetch('/api/participant', { cache: 'no-store' })
      .then(response => response.json())
      .then(body => {
        setAccountReady(body.authenticated === true);
        if (body.authenticated === true && typeof body.profile_id === 'string') {
          const oldProfile = window.localStorage.getItem('sauti-demo-profile');
          window.localStorage.setItem('sauti-demo-profile', body.profile_id);
          setProfileId(body.profile_id);
          if (oldProfile !== body.profile_id) { setCounts({}); window.localStorage.removeItem('sauti-counts'); }
        }
      })
      .catch(() => setAccountReady(false));
    let saved: Record<SessionRole, string> | null = null;
    try { saved = JSON.parse(window.localStorage.getItem('sauti-role-sessions') || 'null'); } catch { saved = null; }
    const fresh = (value: unknown) => (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : crypto.randomUUID());
    const sessions: Record<SessionRole, string> = { train: fresh(saved?.train), calibration: fresh(saved?.calibration), test: fresh(saved?.test) };
    window.localStorage.setItem('sauti-role-sessions', JSON.stringify(sessions));
    setRoleSessions(sessions);
    sessionId.current = sessions.train;
    setSessionShown(sessions.train);
    try { setCounts(JSON.parse(window.localStorage.getItem('sauti-counts') || '{}')); } catch { /* start fresh */ }
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
    return () => { recording.current?.cancel(); stopSpeaking(); clipAudio.current?.pause(); if (clipUrl.current) URL.revokeObjectURL(clipUrl.current); controller.current = null; };
  }, []);

  useEffect(() => { window.localStorage.setItem('sauti-counts', JSON.stringify(counts)); }, [counts]);

  /** Spoken guidance for each step, so a person never has to read to carry on. */
  function stepScript(forStep: Step): string {
    if (forStep === 1) return 'Step 1 of 5. Your preferences. Choose your language and the commands you want to practise, then press Save and continue.';
    if (forStep === 2) return 'Step 2 of 5. About you and your permission. Enter your name and age, optionally describe your speech needs, then review the voice data terms and consent before continuing.';
    if (forStep === 3) {
      const tone = TONES[saved % TONES.length];
      return target
        ? 'Step 3 of 5. Teach Sauti your voice. Example ' + Math.min(saved + 1, target) + ' of ' + target + ' for ' + labelFor(intent, language) + '. Press start, then say your phrase ' + tone.prompt + '.'
        : 'Step 3 of 5. Say something unrelated to any command, such as a name or a different sentence.';
    }
    if (forStep === 4) return 'Step 4 of 5. Check recognition. Press start and say one of your commands. Sauti only acts when it is sure.';
    return 'Step 5 of 5. Connect the browser extension, so your commands work on other websites you choose.';
  }

  function hearStep() {
    const gen = ++speakGen.current;
    stopSpeaking();
    const started = speakText(stepScript(step), language, { onend: () => { if (speakGen.current === gen) setSpeaking(false); }, onerror: () => { if (speakGen.current === gen) setSpeaking(false); } });
    setSpeaking(started);
    if (!started) setStatus('Spoken guidance is unavailable in this browser. The same words are shown on screen.');
  }

  useEffect(() => {
    if (!readSteps) return;
    const gen = ++speakGen.current;
    stopSpeaking();
    speakText(stepScript(step), language, { onend: () => { if (speakGen.current === gen) setSpeaking(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readSteps, step, saved, intent, sessionRole, language]);

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

  async function continueToVoiceSamples() {
    if (!canContinue || accountBusy) return;
    if (!eligibleAge) { goTo(3); return; }
    if (accountReady || (userId.trim() && userToken.trim())) { goTo(3); return; }
    setAccountBusy(true);
    setStatus('Creating your private voice profile securely…');
    try {
      const response = await fetch('/api/participant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ age: ageNumber, consent: true, termsVersion: TERMS_VERSION }),
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'ready') throw new Error(result.detail || result.error || 'Could not create account.');
      if (typeof result.profile_id !== 'string') throw new Error('Private profile was not created.');
      window.localStorage.setItem('sauti-demo-profile', result.profile_id);
      setProfileId(result.profile_id);
      setCounts({});
      window.localStorage.removeItem('sauti-counts');
      setAccountReady(true);
      setStatus('Your private voice profile is ready. You can start recording.');
      goTo(3);
    } catch (error) {
      setStatus('Could not set up recording: ' + (error instanceof Error ? error.message : 'Please try again.'));
    } finally { setAccountBusy(false); }
  }

  function selectRoleSession(role: SessionRole, sessions = roleSessions) {
    sessionId.current = sessions[role];
    setSessionShown(sessions[role]);
  }

  function newSession(message = true) {
    const id = crypto.randomUUID();
    const next = { ...roleSessions, [sessionRole]: id };
    setRoleSessions(next);
    setCounts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(sessionRole + '|'))));
    window.localStorage.setItem('sauti-role-sessions', JSON.stringify(next));
    sessionId.current = id;
    setSessionShown(id);
    if (message) setStatus('A new ' + ROLE_LABEL[sessionRole].toLowerCase() + ' session is ready. Earlier clips stay in their original session.');
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
    form.append('language', mode === 'recognize' && experimentMode ? comparisonLanguage : language);
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = URL.createObjectURL(audio); // stays in this browser tab. Never uploaded for playback.
    setHasClip(true);
    if (mode === 'enroll') {
      form.append('intent', intent);
      form.append('session_id', sessionId.current);
      form.append('session_role', sessionRole);
      form.append('consent', String(consent && termsAccepted && eligibleAge));
      form.append('tone', TONES[saved % TONES.length].id satisfies ToneId);
      form.append('retention_days', String(retentionDays));
      form.append('terms_version', TERMS_VERSION);
      form.append('improvement_consent', String(improvementConsent));
    }
    if (mode === 'recognize' && experimentMode) {
      form.append('model', comparisonModel);
      form.append('compare_consent', String(comparisonConsent));
      form.append('expected_intent', comparisonExpected);
      form.append('reference', comparisonReference);
    }
    const endpoint = mode === 'enroll' ? '/api/enroll'
      : experimentMode ? '/api/compare' : '/api/recognize';
    const response = await fetch(endpoint, {
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
    if (experimentMode) {
      if (!Array.isArray(body.results) || body.executed_action !== false) {
        throw new Error('Invalid comparison-only response from speech API.');
      }
      setComparisonRows(body.results as ComparisonRow[]);
      setPrediction(null);
      setStatus('Comparison completed for ' + body.results.length + ' model(s). No browser action was executed.');
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
    try {
      const audio = await active.stop();
      if (recordMode.current === 'enroll') {
        if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
        clipUrl.current = URL.createObjectURL(audio);
        setHasClip(true);
        setPendingClip(audio);
        setStatus('Recording complete. Listen to your voice, then choose Save or Record again. Nothing has been uploaded.');
      } else {
        await processAudio(audio);
      }
    } catch (error) { setStatus('Could not process audio: ' + (error instanceof Error ? error.message : 'unknown error')); }
    finally { busy.current = false; setState('idle'); }
  }

  async function savePendingClip() {
    if (!pendingClip || busy.current) return;
    busy.current = true;
    setState('processing');
    try {
      await processAudio(pendingClip);
      setPendingClip(null);
    } catch (error) {
      setStatus('The recording was not saved: ' + (error instanceof Error ? error.message : 'Try again.'));
    } finally { busy.current = false; setState('idle'); }
  }

  async function beginRecording(mode: RecordMode) {
    if (busy.current || recording.current) return;
    if (!profileId || (!accountReady && (!userId.trim() || !userToken.trim()))) {
      setStatus('Finish the previous step to set up your private account before recording.');
      return;
    }
    if (mode === 'enroll' && !eligibleAge) {
      setStatus('Recording for under 18 participants requires verified guardian consent. The research team must enable that flow first.');
      return;
    }
    if (mode === 'enroll' && !permissionReady) {
      setStatus('Complete your name, consent, and private account setup to enable recording.');
      goTo(2);
      return;
    }
    if (mode === 'recognize' && experimentMode && !permissionReady) {
      setStatus('Finish onboarding consent before comparing your voice with cloud models.');
      goTo(2);
      return;
    }
    if (mode === 'recognize' && experimentMode && !comparisonConsent) {
      setStatus('Agree to the one-time comparison before sending speech to the cloud models.');
      return;
    }
    recordMode.current = mode;
    speechBind.current = { href: window.location.href, userId: userId.trim(), token: userToken };
    silence();
    const maxDurationMs = clampClipMs(Number(maxSeconds) * 1000);
    try {
      recording.current = await startRecording({ maxDurationMs, autoStop, onAutoStop: () => { void finishRecording(); } });
      if (mode === 'enroll') {
        setPendingClip(null);
        if (clipUrl.current) { URL.revokeObjectURL(clipUrl.current); clipUrl.current = ''; }
        setHasClip(false);
      }
      setPrediction(null);
      setComparisonRows([]);
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
      }}><span aria-hidden="true">{state === 'listening' ? '■' : '●'}</span>{state === 'listening' ? (mode === 'enroll' ? 'Stop recording' : 'Stop and process voice') : state === 'processing' ? 'Processing…' : 'Start voice recording'}</button>;
    }
    return <div className="record-actions"><button type="button" className="record-button" disabled={state !== 'idle'} onClick={() => void beginRecording(mode)}>● Start voice recording</button><button type="button" className="soft-button" disabled={state !== 'listening'} onClick={() => void finishRecording()}>{mode === 'enroll' ? '■ Stop recording' : '■ Stop and process voice'}</button></div>;
  }

  function playClip() {
    if (!clipUrl.current) return;
    clipAudio.current?.pause();
    const audio = new Audio(clipUrl.current);
    clipAudio.current = audio;
    audio.onerror = () => setStatus('This browser could not play the clip back.');
    void audio.play().catch(() => setStatus('This browser blocked playback. Press Listen again.'));
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
    window.localStorage.removeItem('sauti-counts');
    if (clipUrl.current) { URL.revokeObjectURL(clipUrl.current); clipUrl.current = ''; }
    setPendingClip(null);
    setHasClip(false);
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
        <div className="hear-step"><button type="button" className="soft-button" onClick={hearStep}>🔊 Hear this step</button><button type="button" className="text-button" disabled={!speaking} onClick={silence}>Stop speaking</button></div>
        <div hidden={step !== 1}>
          <div className="section-heading"><Icon>⚙</Icon><div><p className="step-kicker">Step 1 of 5</p><h2>Your preferences</h2></div></div>
          <p className="lead-copy">Choose the language, commands, and recording control that feel useful and comfortable.</p>
          <fieldset className="choice-group"><legend>Language</legend><div className="segmented"><button type="button" className={language === 'en-KE' ? 'selected' : ''} aria-pressed={language === 'en-KE'} onClick={() => setLanguage('en-KE')}>English</button><button type="button" className={language === 'sw-KE' ? 'selected' : ''} aria-pressed={language === 'sw-KE'} onClick={() => setLanguage('sw-KE')}>Kiswahili</button></div></fieldset>
          <fieldset className="choice-group command-grid"><legend>Commands to practise</legend>{COMMANDS.map(command => <label className={chosen.includes(command) ? 'command-choice selected' : 'command-choice'} key={command}><input type="checkbox" checked={chosen.includes(command)} onChange={event => {
            setChosen(current => event.target.checked ? [...current, command] : current.filter(item => item !== command));
            if (!event.target.checked && intent === command) setIntent('UNKNOWN');
          }}/><span className="command-check">✓</span><span>{labelFor(command, language)}</span></label>)}</fieldset>
          <div className="settings-grid"><div className="field"><label htmlFor="listen">Recording control</label><select id="listen" value={listenMethod} onChange={event => setListenMethod(event.target.value as 'toggle' | 'separate')}><option value="toggle">One start and stop button</option><option value="separate">Separate start and stop buttons</option></select></div><div className="field"><label htmlFor="maxsec">Clip length</label><select id="maxsec" value={maxSeconds} onChange={event => setMaxSeconds(event.target.value)}><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="8">8 seconds</option></select></div></div>
          <label className="check-row"><input type="checkbox" checked={readSteps} onChange={event => { setReadSteps(event.target.checked); if (!event.target.checked) silence(); }}/><span><strong>Read each step aloud</strong><small>Sauti speaks the instructions for every step. Nothing is recorded while it speaks.</small></span></label>
          <label className="check-row"><input type="checkbox" checked={autoStop} onChange={event => setAutoStop(event.target.checked)}/><span><strong>Stop automatically</strong><small>Recording ends at the selected clip length.</small></span></label>
          <div className="card-actions"><button type="button" onClick={() => goTo(2)}>Save and continue <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => setStatus('Your preferences remain on this screen until you continue.')}>Pause setup</button></div>
        </div>

        <div hidden={step !== 2}>
          <div className="section-heading"><Icon tone="green">✓</Icon><div><p className="step-kicker">Step 2 of 5</p><h2>About you and your permission</h2></div></div>
          <p className="lead-copy">Your voice is personal data. Sauti stores a clip only after you deliberately start recording and give permission.</p>
          <div className="field"><label htmlFor="participant-name">Your name</label><input id="participant-name" autoComplete="name" maxLength={100} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="How should we address you?"/></div>
          <div className="field"><label htmlFor="participant-age">Your age</label><input id="participant-age" type="number" min="1" max="120" inputMode="numeric" value={age} onChange={event => setAge(event.target.value)} placeholder="Age in years"/></div>
          <div className="field"><label htmlFor="speech-condition">Speech or accessibility needs (optional)</label><select id="speech-condition" value={speechCondition} onChange={event => setSpeechCondition(event.target.value)}>
            <option value="prefer-not-to-say">Prefer not to say</option>
            <option value="cerebral-palsy">Cerebral palsy</option>
            <option value="dysarthria">Dysarthria</option>
            <option value="apraxia">Apraxia of speech</option>
            <option value="other">Other speech or motor disability</option>
            <option value="none">No diagnosed disability</option>
          </select><small>Optional and not used to decide whether Sauti can understand your voice. These answers stay in this page session and are not uploaded or saved.</small></div>
          <details className="advanced-settings"><summary>Existing pilot account (optional)</summary>
            <p>New participants receive a private account automatically. Only open this if the research team gave you an existing pilot account.</p>
            <div className="field"><label htmlFor="user">Pilot user ID</label><input id="user" autoComplete="off" value={userId} onChange={event => setUserId(event.target.value)} placeholder="Provided by the research team"/></div>
            <div className="field"><label htmlFor="code">Pilot access token</label><input id="code" type="password" autoComplete="off" value={userToken} onChange={event => setUserToken(event.target.value)} placeholder="Not saved in this browser"/></div>
          </details>
          <section className="terms-box" tabIndex={0} role="region" aria-label={'Voice data terms, version ' + TERMS_VERSION}>
            <h3>Voice data terms <small>(version {TERMS_VERSION})</small></h3>
            <p><strong>What we keep.</strong> The short voice clips you choose to record, the command each clip is for, its language and tone (calm, happy or frustrated), and your profile ID.</p>
            <p><strong>Why.</strong> To build and evaluate your personal command recognizer and run your approved commands. Separate optional permission covers future improvements; we do not use clips for advertising or sell voice recordings.</p>
            <p><strong>How long.</strong> Each clip is scheduled for deletion after the selected period, subject to the retention sweep. Your personal model remains until you delete your profile. You may withdraw consent and request deletion sooner.</p>
            <p><strong>Where.</strong> Clips are encrypted in private storage. Ask the project team where its current server is hosted and whether cross border transfers apply before giving consent.</p>
            <p><strong>Your rights.</strong> You can see, correct or delete your data, and withdraw this permission at any time using Delete my voice data. You may also complain to the Office of the Data Protection Commissioner.</p>
            <p><strong>Contact.</strong> {TERMS_CONTACT || 'No privacy contact configured yet. Enrollment is unavailable.'}</p>
            <p><strong>Important.</strong> Consent does not replace legal registration or other data protection obligations. Contact the project team to exercise access, correction and withdrawal rights.</p>
          </section>
          <div className="field"><label htmlFor="retention">Keep my voice clips for</label><select id="retention" value={retentionDays} onChange={event => setRetentionDays(Number(event.target.value))}>{RETENTION_OPTIONS.map(days => <option key={days} value={days}>{days} days</option>)}</select></div>
          <label className="permission-card"><input type="checkbox" checked={termsAccepted && consent} onChange={event => { setTermsAccepted(event.target.checked); setConsent(event.target.checked); }}/><span><strong>I agree to record and privately store the voice clips I choose to make</strong><small>I have reviewed the voice data terms above. I can withdraw consent and delete my recordings.</small></span></label>
          <details className="advanced-settings"><summary>Optional research permission</summary><label className="check-row"><input type="checkbox" checked={improvementConsent} onChange={event => setImprovementConsent(event.target.checked)}/><span><strong>Consider my approved recordings for a future model update</strong><small>Optional. No model changes automatically.</small></span></label></details>
          {age && !eligibleAge && <p className="inline-note">Under 18? You can explore the next step, but recording requires verified parent or guardian consent. This is not yet available in the pilot.</p>}
          {!canContinue && <p className="inline-note">Enter your name and age, then agree to the voice data terms to continue.</p>}
          <div className="card-actions"><button type="button" disabled={!canContinue || accountBusy} onClick={() => void continueToVoiceSamples()}>{accountBusy ? 'Setting up your profile…' : 'Continue to voice samples'} <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => goTo(1)}>Back</button></div>
        </div>

        <div hidden={step !== 3}>
          <div className="section-heading"><Icon>●</Icon><div><p className="step-kicker">Step 3 of 5</p><h2>Teach Sauti your voice</h2></div></div>
          {!permissionReady && <p className="inline-note" role="status">{!eligibleAge ? 'Voice recording is not available for participants under 18 until a verified guardian consent process is in place.' : !accountReady && (!userId.trim() || !userToken.trim()) ? 'Finish the previous step to create your secure voice profile automatically. No recording is uploaded until you press Record.' : 'Review your consent and privacy contact before recording.'}</p>}
          <div className="segmented language-switch"><button type="button" className={language === 'en-KE' ? 'selected' : ''} aria-pressed={language === 'en-KE'} onClick={() => setLanguage('en-KE')}>English</button><button type="button" className={language === 'sw-KE' ? 'selected' : ''} aria-pressed={language === 'sw-KE'} onClick={() => setLanguage('sw-KE')}>Kiswahili</button></div>
          <div className="field"><label htmlFor="intent">Command to practise</label><select id="intent" value={intent} onChange={event => setIntent(event.target.value as Intent)}>{intentOptions.map(command => <option key={command} value={command}>{labelFor(command, language)}</option>)}</select></div>
          <div className="phrase-card"><span aria-hidden="true">◖))</span><strong>{labelFor(intent, language)}</strong></div>
          {target > 0 && <p className="tone-prompt"><span className={'tone-chip tone-' + nextTone.id}>{nextTone.label}</span> Say your phrase {nextTone.prompt}.</p>}
          {intent === 'UNKNOWN' && <p className="tone-prompt">Say something unrelated to any command, such as a name or a different sentence.</p>}
          <p className="comfort-copy">Use a phrase that feels comfortable to you.</p>
          <div className="sample-row"><strong>{target ? 'Example ' + Math.min(saved + 1, target) + ' of ' + target : 'Optional training example'}</strong><div className="sample-dots" aria-label={saved + ' of ' + target + ' saved'}>{Array.from({ length: Math.max(target, 1) }, (_, index) => <span className={index < saved ? 'done' : index === saved ? 'current' : ''} key={index}/>)}</div></div>
          <RecordingButtons mode="enroll"/>
          <div className="record-secondary"><button className="soft-button" type="button" disabled={!hasClip} onClick={() => playClip()}>▶ Listen</button><button className="soft-button" type="button" disabled={!pendingClip || state === 'processing'} onClick={() => void savePendingClip()}>✓ Save voice sample</button><button className="soft-button" type="button" disabled={state !== 'idle'} onClick={() => { setPendingClip(null); setHasClip(false); if (clipUrl.current) { URL.revokeObjectURL(clipUrl.current); clipUrl.current = ''; } setStatus('Ready to record again. Unsaved audio was discarded.'); }}>↻ Record again</button></div>
          <p className="break-copy">Take a break whenever you need.</p>
          <section className="calibration-card" aria-label="Calibration progress">
            <h3>Calibration progress</h3>
            <p className="calibration-help">Record at least three examples per command for training, then two for calibration and two for the untouched test. Vary your speaking style naturally. These samples help evaluate your command recognizer; accuracy is not guaranteed.</p>
            {(['train', 'calibration', 'test'] as SessionRole[]).map(role => <div className="calibration-row" key={role}>
              <strong>{ROLE_LABEL[role]}</strong>
              <span className={'state-pill ' + (progress[role].done ? 'ready' : 'pending')}>{progress[role].done ? 'Complete' : 'In progress'}</span>
              <small>{progress[role].rows.map(row => labelFor(row.command, language) + ' ' + Math.min(row.have, row.need) + '/' + row.need).join(' · ')}{progress[role].unknownNeed ? ' · Unknown speech ' + Math.min(progress[role].unknownHave, progress[role].unknownNeed) + '/' + progress[role].unknownNeed : ''}</small>
            </div>)}
            {readyToTrain
              ? <div className="train-box"><p><strong>All three sessions are complete.</strong> Open the Railway service, go to Console, and run this once to build your personal model:</p><code>{trainCommand}</code><button type="button" className="soft-button" onClick={() => void navigator.clipboard.writeText(trainCommand).then(() => setStatus('Training command copied.')).catch(() => setStatus('Copy was unavailable.'))}>Copy training command</button></div>
              : <p className="inline-note">Keep recording until all three sessions show Complete.</p>}
          </section>
          <details className="advanced-settings"><summary>Session settings</summary><div className="settings-grid"><div className="field"><label htmlFor="role">Recording session</label><select id="role" value={sessionRole} onChange={event => { const role = event.target.value as SessionRole; setSessionRole(role); selectRoleSession(role); }}><option value="train">Training</option><option value="calibration">Calibration</option><option value="test">Untouched test</option></select></div><div className="field"><label htmlFor="session">Session ID</label><input id="session" readOnly value={sessionShown}/></div></div><button type="button" className="soft-button" onClick={() => newSession()}>Start a new recording session</button><p>Use different sessions for training, calibration, and the untouched test. Include unrelated speech under Unknown speech.</p></details>
          <div className="card-actions"><button type="button" onClick={() => goTo(4)}>Check recognition <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => setStatus('Setup paused. Your saved samples remain in private storage.')}>Pause setup</button></div>
        </div>

        <div hidden={step !== 4}>
          <div className="section-heading"><Icon tone="blue">✓</Icon><div><p className="step-kicker">Step 4 of 5</p><h2>Check recognition</h2></div></div>
          <p className="lead-copy">Test live commands using your validated personal model, or compare three cloud models on one fresh recording without executing any action.</p>
          <section className="model-lab" aria-label="Cloud speech model comparison">
            <label className="check-row"><input type="checkbox" checked={experimentMode} onChange={event => { setExperimentMode(event.target.checked); setComparisonRows([]); setPrediction(null); }}/><span><strong>Compare recognition models</strong><small>Research mode does not execute commands, even when a model accepts one.</small></span></label>
            {experimentMode && <div className="lab-fields">
              <div className="settings-grid">
                <div className="field"><label htmlFor="comparisonModel">Model</label><select id="comparisonModel" value={comparisonModel} onChange={event => setComparisonModel(event.target.value as ComparisonModel)}><option value="all">Compare all three</option><option value="prototype">Personalized Wav2Vec2</option><option value="english">CDLI Kenyan English Whisper</option><option value="swahili">CDLI Kenyan Kiswahili Whisper</option></select></div>
                <div className="field"><label htmlFor="comparisonLanguage">Spoken language</label><select id="comparisonLanguage" value={comparisonLanguage} onChange={event => setComparisonLanguage(event.target.value as ComparisonLanguage)}><option value="en-KE">English</option><option value="sw-KE">Kiswahili</option><option value="mixed">English and Kiswahili mixed</option></select></div>
              </div>
              <div className="settings-grid">
                <div className="field"><label htmlFor="comparisonExpected">Intended command</label><select id="comparisonExpected" value={comparisonExpected} onChange={event => setComparisonExpected(event.target.value as Intent)}>{[...COMMANDS, 'UNKNOWN' as Intent].map(command => <option key={command} value={command}>{labelFor(command, language)}</option>)}</select></div>
                <div className="field"><label htmlFor="comparisonReference">Correct transcript (optional)</label><input id="comparisonReference" maxLength={280} value={comparisonReference} onChange={event => setComparisonReference(event.target.value)} placeholder="e.g. move down kidogo"/></div>
              </div>
              <label className="permission-card"><input type="checkbox" checked={comparisonConsent} onChange={event => setComparisonConsent(event.target.checked)}/><span><strong>I consent to a one-time model comparison</strong><small>This clip is processed by the private comparison service without being stored or used to execute actions. Cloud deployment must be approved before using real participant recordings.</small></span></label>
              <p className="inline-note">Whisper transcripts and Wav2Vec2 similarity are different measurement types. Do not select whichever model reports the highest raw number.</p>
            </div>}
          </section>
          <RecordingButtons mode="recognize"/>
          {experimentMode && comparisonRows.length > 0 && <div className="model-results" aria-label="Comparison results">
            <h3>Model comparison results</h3>
            {comparisonRows.map((row, index) => <div className="model-result" key={row.model + index}>
              <strong>{row.model === 'prototype' ? 'Personalized Wav2Vec2' : row.model === 'english' ? 'CDLI Kenyan English Whisper' : 'CDLI Kenyan Kiswahili Whisper'}</strong>
              <p>Status: {row.status} · Intent: {row.intent || 'None'}</p>
              {row.transcript && <p>Transcript: {row.transcript}</p>}
              {row.error && <p>Unavailable: {row.error}</p>}
              {typeof row.wer === 'number' && <p>Word error rate: {(row.wer * 100).toFixed(1)}%</p>}
               {typeof row.cer === 'number' && <p>Character error rate: {(row.cer * 100).toFixed(1)}%</p>}
              {typeof row.correct_intent === 'boolean' && <p>Intended command: {row.correct_intent ? 'Matched' : 'Not matched'}</p>}
              {typeof row.load_and_inference_seconds === 'number' && <p>Model load and inference: {row.load_and_inference_seconds.toFixed(1)} seconds</p>}
            </div>)}
            <p><strong>No browser action was executed by this comparison.</strong></p>
          </div>}
          {!experimentMode && prediction && <div className={'prediction-card ' + prediction.status}><span className="prediction-icon">{prediction.status === 'accepted' ? '✓' : '!'}</span><div><strong>{prediction.status === 'accepted' ? labelFor(prediction.intent, language) : 'Command rejected safely'}</strong><small>{prediction.reason || 'Accepted by the active personal model.'}</small></div></div>}
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
          <ol className="extension-steps"><li>Build and load the extension from <code>apps/extension/dist</code>.</li><li>Open its side panel and paste this PWA origin and profile ID.</li><li>Enter the pilot user ID and token supplied by the research team.</li><li>Enable only the website you want Sauti to control.</li></ol>
          <button type="button" onClick={() => void copyExtensionSetup()}>Copy extension setup</button>
          <p className="inline-note">The extension currently requires separate credentials supplied by the research team. Automatic browser account pairing is not yet available. Do not share your private voice session to connect an extension.</p>
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
          <button type="button" className="delete-button" disabled={!deleteArmed || (!accountReady && (!userId.trim() || !userToken.trim()))} onClick={() => void deleteProfile()}>Delete my voice data</button>
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
