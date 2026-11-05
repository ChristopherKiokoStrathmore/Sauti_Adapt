'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COMMAND_LABELS, commandToUtterance, validRecognition, type Intent, type Language, type Recognition } from '@sauti/shared';
import { clampClipMs, startRecording, type RecordingSession } from '@sauti/shared/audio';
import { isReadAloudUtterance, speakText, stopSpeaking } from '@sauti/shared/speak';
import { CONTROLLER_CSS } from '@toolkit/controller/web/ui.js';
import { createController, createDomReceiver } from '@sauti/shared/controller';
import { capReadPort } from '@sauti/shared/page-text';
import { HeadwayInstallStep } from './HeadwayInstallStep';

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
const STEPS = ['Your preferences', 'Your permission', 'Voice samples', 'Check recognition', 'Install extension'] as const;
const TEST_COMMANDS = [
  { utterance: 'scroll down', label: 'scroll down' },
  { utterance: 'scroll up', label: 'scroll up' },
  { utterance: 'read this', label: 'Read this page aloud' },
  { utterance: "what's on screen", label: "What's on screen" },
  { utterance: 'bigger text', label: 'bigger text' },
  { utterance: 'undo', label: 'Undo last setting' },
];
type Step = 1 | 2 | 3 | 4 | 5;
type JourneyVariant = 'a' | 'b' | 'c';
const JOURNEY_DESCRIPTION: Record<JourneyVariant, string> = {
  a: 'Original guided setup',
  b: 'Progressive setup',
  c: 'Guided accessible setup',
};
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
  const [journeyVariant, setJourneyVariant] = useState<JourneyVariant>('c');
  const [speechServiceMode, setSpeechServiceMode] = useState<'mock' | 'prototype' | 'unavailable' | 'checking'>('checking');
  const [modelStatusChecked, setModelStatusChecked] = useState(false);
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
  const retentionDays = 365;
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
    const experiment = new URLSearchParams(window.location.search).get('journey');
    // Opt-in deterministic engineering variants. No random assignment or tracking.
    if (experiment === 'a' || experiment === 'b' || experiment === 'c') setJourneyVariant(experiment);
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
    // Every new page visit starts a fresh three-example onboarding sequence.
    // Previously uploaded clips remain stored in the private profile until deletion or expiry.
    const sessions: Record<SessionRole, string> = { train: crypto.randomUUID(), calibration: crypto.randomUUID(), test: crypto.randomUUID() };
    window.localStorage.removeItem('sauti-counts');
    window.localStorage.setItem('sauti-role-sessions', JSON.stringify(sessions));
    setCounts({});
    setSessionRole('train');
    setRoleSessions(sessions);
    sessionId.current = sessions.train;
    setSessionShown(sessions.train);
    void fetch('/api/health', { cache: 'no-store' })
      .then(response => response.json())
      .then(body => setBackendConfigured(Boolean(body.speech_api_configured)))
      .catch(() => setBackendConfigured(false));
    void fetch('/api/admin/status', { cache: 'no-store' })
      .then(response => response.json())
      .then(body => {
        setSpeechServiceMode(body.online && body.mode === 'prototype' ? 'prototype' : body.online ? 'mock' : 'unavailable');
        setModelStatusChecked(true);
      })
      .catch(() => { setSpeechServiceMode('unavailable'); setModelStatusChecked(true); });
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const root = document.getElementById('controlled-site');
    if (root) controller.current = createController({
      control: capReadPort(createDomReceiver(root, { scrollTarget: root }), root),
      operator: { abilityModel: { supportAreas: ['motor'] } },
    });
    return () => { recording.current?.cancel(); stopSpeaking(); clipAudio.current?.pause(); if (clipUrl.current) URL.revokeObjectURL(clipUrl.current); controller.current = null; };
  }, []);

  // Recording counts describe this visit, not the lifetime history of a private profile.

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
    if (forStep === 4) return 'Step 4 of 5. Check recognition. The voice model may not be ready yet. You can try accessible demo controls while training is being prepared.';
    return 'Step 5 of 5. Install Headway. Download the Chrome extension, open the installation instructions, and turn on head pointer controls when you are ready.';
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

  function beginJourney() {
    goTo(1);
    document.getElementById('main-onboarding')?.scrollIntoView({ block: 'start', behavior: 'auto' });
    const preferences = document.getElementById('main-onboarding');
    preferences?.focus({ preventScroll: true });
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
    form.append('language', language);
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = URL.createObjectURL(audio); // stays in this browser tab. Never uploaded for playback.
    setHasClip(true);
    if (mode === 'enroll') {
      form.append('intent', intent);
      form.append('session_id', sessionId.current);
      form.append('session_role', sessionRole);
      form.append('consent', String(consent && termsAccepted && eligibleAge));
      form.append('tone', journeyVariant === 'c' ? 'neutral' : TONES[saved % TONES.length].id satisfies ToneId);
      form.append('retention_days', String(retentionDays));
      form.append('terms_version', TERMS_VERSION);
      form.append('improvement_consent', String(improvementConsent));
    }
    const endpoint = mode === 'enroll' ? '/api/enroll' : '/api/recognize';
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
      if (sessionRole === 'train' && intent !== 'UNKNOWN' && target > 0 && saved + 1 >= target) {
        setStatus('All three voice examples for ' + labelFor(intent, language) + ' are saved. You can now try recognition. Your full personal model still needs separate training and evaluation.');
        goTo(4);
        requestAnimationFrame(() => document.getElementById('main-onboarding')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      } else {
        setStatus('Voice sample saved privately for ' + labelFor(intent, language) + '. Record a fresh example when ready.');
      }
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
    // A released voice command must not execute if the secure participant
    // session was revoked or its profile changed during model inference.
    if (accountReady && !userId.trim()) {
      try {
        const response = await fetch('/api/participant', { cache: 'no-store' });
        const session = response.ok ? await response.json() : null;
        if (!session?.authenticated || session.profile_id !== profileId) {
          setStatus('Session changed while speech was processing. No action was taken.');
          return;
        }
      } catch {
        setStatus('Could not verify your voice session. No action was taken.');
        return;
      }
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
        if (journeyVariant === 'c') {
          await processAudio(audio);
          setPendingClip(null);
        } else {
          setStatus('Recording complete. Listen to your voice, then choose Save or Record again. Nothing has been uploaded.');
        }
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
      setState('listening');
      setStatus(autoStop
        ? 'Listening because you pressed the button. Recording stops after ' + maxDurationMs / 1000 + ' seconds or when you stop it.'
        : 'Listening because you pressed the button. Select Stop when the phrase is finished.');
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Microphone unavailable.');
      if (failure.name === 'NotAllowedError' || /permission|denied|user agent|not allowed/i.test(failure.message)) {
        setStatus('Microphone access is blocked. Open Sauti Adapt in Safari or Chrome directly, allow microphone access in the browser site settings, then press Start voice recording again. If you previously blocked access, change the site permission and reload.');
      } else if (failure.name === 'NotFoundError' || failure.name === 'DevicesNotFoundError') {
        setStatus('No microphone was found. Connect or enable a microphone, then try recording again.');
      } else if (failure.name === 'NotReadableError' || failure.name === 'TrackStartError') {
        setStatus('The microphone is in use or unavailable. Close other apps using it and try again.');
      } else {
        setStatus('Could not start voice recording: ' + failure.message);
      }
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

  return <main className="app-shell" data-journey={journeyVariant}>
    <style data-aa-upstream-css="">{CONTROLLER_CSS}</style>
    <header className="topbar">
      <a href="#main-onboarding" className="brand" aria-label="Sauti Adapt home"><span className="brand-mark" aria-hidden="true">✚</span><span>Sauti Adapt</span></a>
      <span className="concept-badge">Early access · Research prototype</span>
      <button className="profile-button" type="button" onClick={() => goTo(2)}><span aria-hidden="true">◉</span> My voice profile</button>
    </header>

    <section className="intro" aria-labelledby="page-title">
      <div className="intro-content">
        <p className="eyebrow"><span className="eyebrow-indicator" aria-hidden="true"/> VOICE ACCESSIBILITY, REIMAGINED</p>
        <h1 id="page-title">Your voice.<br/><em>Your way.</em></h1>
        <p className="hero-description">Meet Sauti. A more personal way to navigate the digital world, designed to understand how you speak.</p>
        <button type="button" className="hero-primary-action" onClick={beginJourney}>Get started <span aria-hidden="true">→</span></button>
        <div className="hero-assurances" aria-label="What to expect">
          <span><span aria-hidden="true">✳</span> At your own pace</span>
          <span><span aria-hidden="true">◉</span> Your voice stays yours</span>
        </div>
      </div>
      <div className="intro-visual" aria-hidden="true">
        <div className="voice-orbit voice-orbit-outer"/>
        <div className="voice-orbit voice-orbit-inner"/>
        <div className="voice-orb"><div className="voice-orb-shine"/><div className="voice-waveform"><i/><i/><i/><i/><i/><i/><i/></div></div>
        <span className="intro-visual-label">A VOICE THAT IS UNIQUELY YOURS</span>
      </div>
      <span className="hero-watermark" aria-hidden="true">SAUTI</span>
    </section>

    <div id="main-onboarding" className="onboarding-layout" tabIndex={-1} aria-label="Your voice onboarding">
      <nav className="stepper-card" aria-label="Onboarding steps">
        <div className="stepper-intro"><p className="stepper-eyebrow">STEP {step} OF {STEPS.length}</p><h2>Make it yours</h2><p>One step at a time.</p>{journeyVariant !== 'c' && <small className="journey-experiment-label">{JOURNEY_DESCRIPTION[journeyVariant]}</small>}</div>
        <ol>{STEPS.map((item, index) => {
          const number = (index + 1) as Step;
          const complete = number < step;
          return <li key={item} className={number === step ? 'active' : complete ? 'complete' : ''}><button type="button" aria-current={number === step ? 'step' : undefined} onClick={() => goTo(number)}><span className="step-number">{complete ? '✓' : number}</span><span>{item}</span></button></li>;
        })}</ol>
        <div className="stepper-reassurance"><span className="stepper-reassurance-icon" aria-hidden="true">✳</span><div><strong>No rush.</strong><p>Take a break or try again whenever you need.</p></div></div>
      </nav>

      <section className={step === 5 ? "main-card hi-main-card" : "main-card"}>
        <div className="hear-step"><button type="button" className="soft-button" onClick={hearStep}>🔊 Hear this step</button><button type="button" className="text-button" disabled={!speaking} onClick={silence}>Stop speaking</button></div>
        <div hidden={step !== 1}>
          <div className="section-heading"><Icon>⚙</Icon><div><p className="step-kicker">Step 1 of 5</p><h2>Your preferences</h2></div></div>
          <p className="lead-copy">Choose how you would like to begin. You can adjust everything later.</p>
          <fieldset className="choice-group"><legend>Language</legend><div className="segmented"><button type="button" className={language === 'en-KE' ? 'selected' : ''} aria-pressed={language === 'en-KE'} onClick={() => setLanguage('en-KE')}>English</button><button type="button" className={language === 'sw-KE' ? 'selected' : ''} aria-pressed={language === 'sw-KE'} onClick={() => setLanguage('sw-KE')}>Kiswahili</button></div></fieldset>
          <details className="preferences-advanced" open={journeyVariant === 'a' ? true : undefined}><summary>Choose your commands (optional)</summary><fieldset className="choice-group command-grid"><legend>Commands to practise</legend>{COMMANDS.map(command => <label className={chosen.includes(command) ? 'command-choice selected' : 'command-choice'} key={command}><input type="checkbox" checked={chosen.includes(command)} onChange={event => {
            setChosen(current => event.target.checked ? [...current, command] : current.filter(item => item !== command));
            if (!event.target.checked && intent === command) setIntent('UNKNOWN');
          }}/><span className="command-check">✓</span><span>{labelFor(command, language)}</span></label>)}</fieldset></details>
          <details className="preferences-advanced recording-preferences" open={journeyVariant === 'a' ? true : undefined}><summary>Recording accessibility options</summary><div className="settings-grid"><div className="field"><label htmlFor="listen">Recording control</label><select id="listen" value={listenMethod} onChange={event => setListenMethod(event.target.value as 'toggle' | 'separate')}><option value="toggle">One start and stop button</option><option value="separate">Separate start and stop buttons</option></select></div><div className="field"><label htmlFor="maxsec">Clip length</label><select id="maxsec" value={maxSeconds} onChange={event => setMaxSeconds(event.target.value)}><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="8">8 seconds</option><option value="15">15 seconds</option></select></div></div><p className="field-help">You can use a single large button or separate Start and Stop controls, and adjust how long a recording lasts.</p></details>
          <label className="check-row"><input type="checkbox" checked={readSteps} onChange={event => { setReadSteps(event.target.checked); if (!event.target.checked) silence(); }}/><span><strong>Read each step aloud</strong><small>Sauti speaks the instructions for every step. Nothing is recorded while it speaks.</small></span></label>
          <label className="check-row" ><input type="checkbox" checked={autoStop} onChange={event => setAutoStop(event.target.checked)}/><span><strong>Stop automatically</strong><small>Recording ends at the selected clip length.</small></span></label>
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
          <details className="terms-disclosure"><summary>Read full privacy terms</summary><section className="terms-box" tabIndex={0} role="region" aria-label={'Voice data terms, version ' + TERMS_VERSION}>
            <h3>Voice data terms <small>(version {TERMS_VERSION})</small></h3>
            <p><strong>What we keep.</strong> The short voice clips you choose to record, the command each clip is for, its language and tone (calm, happy or frustrated), and your profile ID.</p>
            <p><strong>Why.</strong> To build and evaluate your personal command recognizer and run your approved commands. Separate optional permission covers future improvements; we do not use clips for advertising or sell voice recordings.</p>
            <p><strong>How long.</strong> Each clip is scheduled for deletion after 365 days, subject to the retention sweep. Your personal model remains until you delete your profile. You may withdraw consent and request deletion sooner.</p>
            <p><strong>Where.</strong> Clips are encrypted in private storage. Ask the project team where its current server is hosted and whether cross border transfers apply before giving consent.</p>
            <p><strong>Your rights.</strong> You can see, correct or delete your data, and withdraw this permission at any time using Delete my voice data. You may also complain to the Office of the Data Protection Commissioner.</p>
            <p><strong>Contact.</strong> {TERMS_CONTACT || 'No privacy contact configured yet. Enrollment is unavailable.'}</p>
            <p><strong>Important.</strong> Consent does not replace legal registration or other data protection obligations. Contact the project team to exercise access, correction and withdrawal rights.</p>
          </section></details>
          <p className="inline-note">Your recordings are scheduled for deletion after one year, or sooner if you delete your voice profile. Review the full privacy terms above.</p>
          <label className="permission-card"><input type="checkbox" checked={termsAccepted && consent} onChange={event => { setTermsAccepted(event.target.checked); setConsent(event.target.checked); }}/><span><strong>I agree to record and privately store the voice clips I choose to make</strong><small>I have reviewed the voice data terms above. I can withdraw consent and delete my recordings.</small></span></label>
          <details className="advanced-settings"><summary>Optional future model improvement consent</summary><label className="check-row"><input type="checkbox" checked={improvementConsent} onChange={event => setImprovementConsent(event.target.checked)}/><span><strong>Consider my approved recordings for a future model update</strong><small>Optional. No model changes automatically.</small></span></label></details>
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
          {target > 0 && (journeyVariant === 'c' ? <p className="tone-prompt">Speak naturally. There is no need to change your voice or rush.</p> : <p className="tone-prompt"><span className={'tone-chip tone-' + nextTone.id}>{nextTone.label}</span> Say your phrase {nextTone.prompt}.</p>)}
          {intent === 'UNKNOWN' && <p className="tone-prompt">Say something unrelated to any command, such as a name or a different sentence.</p>}
          <p className="comfort-copy">Use a phrase that feels comfortable to you.</p>
          <div className="sample-row"><strong>{target ? 'Example ' + Math.min(saved + 1, target) + ' of ' + target : 'Optional training example'}</strong><div className="sample-dots" aria-label={saved + ' of ' + target + ' saved'}>{Array.from({ length: Math.max(target, 1) }, (_, index) => <span className={index < saved ? 'done' : index === saved ? 'current' : ''} key={index}/>)}</div></div>
          <RecordingButtons mode="enroll"/>
          <div className="record-secondary">{journeyVariant !== 'c' && <><button className="soft-button" type="button" disabled={!hasClip} onClick={() => playClip()}>▶ Listen</button><button className="soft-button" type="button" disabled={!pendingClip || state === 'processing'} onClick={() => void savePendingClip()}>✓ Save voice sample</button></>}<button className="soft-button" type="button" disabled={state !== 'idle'} onClick={() => { setPendingClip(null); setHasClip(false); if (clipUrl.current) { URL.revokeObjectURL(clipUrl.current); clipUrl.current = ''; } setStatus('Ready to record another example. Previously saved recordings remain stored.'); }}>↻ Record another example</button></div>
          <p className="break-copy">{journeyVariant === 'c' ? 'Your recording is saved automatically when you finish speaking, using the consent you gave. Take a break whenever you need.' : 'Take a break whenever you need. Your recording will only be uploaded after you choose Save.'}</p>
          {journeyVariant === 'c' && <details className="preferences-advanced inline-recording-options"><summary>Need more speaking time or a different recording button?</summary><div className="settings-grid"><div className="field"><label htmlFor="clip-pace">Clip length</label><select id="clip-pace" value={maxSeconds} onChange={event => setMaxSeconds(event.target.value)}><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="8">8 seconds</option><option value="15">15 seconds</option></select></div><div className="field"><label htmlFor="record-style">Recording control</label><select id="record-style" value={listenMethod} onChange={event => setListenMethod(event.target.value as 'toggle' | 'separate')}><option value="toggle">One start and stop button</option><option value="separate">Separate start and stop buttons</option></select></div></div><p>Choose the setting that feels comfortable to you. There is no time limit to decide.</p></details>}
          <details className="calibration-card" aria-label="Technical training progress">
            <summary>More about training progress</summary>
            <h3 className="visually-hidden">Calibration progress</h3>
            <p className="calibration-help">Record at least three examples per command for training, then two for calibration and two for the untouched test. Vary your speaking style naturally. These samples help evaluate your command recognizer; accuracy is not guaranteed.</p>
            {(['train', 'calibration', 'test'] as SessionRole[]).map(role => <div className="calibration-row" key={role}>
              <strong>{ROLE_LABEL[role]}</strong>
              <span className={'state-pill ' + (progress[role].done ? 'ready' : 'pending')}>{progress[role].done ? 'Complete' : 'In progress'}</span>
              <small>{progress[role].rows.map(row => labelFor(row.command, language) + ' ' + Math.min(row.have, row.need) + '/' + row.need).join(' · ')}{progress[role].unknownNeed ? ' · Unknown speech ' + Math.min(progress[role].unknownHave, progress[role].unknownNeed) + '/' + progress[role].unknownNeed : ''}</small>
            </div>)}
            {readyToTrain
              ? <div className="train-box"><p><strong>All three sessions are complete.</strong> Open the Railway service, go to Console, and run this once to build your personal model:</p><code>{trainCommand}</code><button type="button" className="soft-button" onClick={() => void navigator.clipboard.writeText(trainCommand).then(() => setStatus('Training command copied.')).catch(() => setStatus('Copy was unavailable.'))}>Copy training command</button></div>
              : <p className="inline-note">Your voice examples are saved. Full model training requires additional sessions and evaluation.</p>}
          </details>
          <details className="advanced-settings"><summary>Session settings</summary><div className="settings-grid"><div className="field"><label htmlFor="role">Recording session</label><select id="role" value={sessionRole} onChange={event => { const role = event.target.value as SessionRole; setSessionRole(role); selectRoleSession(role); }}><option value="train">Training</option><option value="calibration">Calibration</option><option value="test">Untouched test</option></select></div><div className="field"><label htmlFor="session">Session ID</label><input id="session" readOnly value={sessionShown}/></div></div><button type="button" className="soft-button" onClick={() => newSession()}>Start a new recording session</button><p>Use different sessions for training, calibration, and the untouched test. Include unrelated speech under Unknown speech.</p></details>
          <div className="card-actions"><button type="button" onClick={() => goTo(4)}>Check recognition <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => setStatus('Setup paused. Your saved samples remain in private storage.')}>Pause setup</button></div>
        </div>

        <div hidden={step !== 4}>
          <div className="section-heading"><Icon tone="blue">✓</Icon><div><p className="step-kicker">Step 4 of 5</p><h2>{journeyVariant === 'c' ? 'Test with your voice' : 'Check recognition'}</h2></div></div>
          <p className="lead-copy">Explore how Sauti can respond. A personalized voice model must be trained and validated before it can recognize your commands.</p>
          {journeyVariant === 'c' && <div className="model-readiness" aria-label="Voice recognition readiness"><strong>{!modelStatusChecked ? 'Checking personalization status' : speechServiceMode === 'prototype' ? 'Experimental speech recognition available' : 'Personalizing your experience'}</strong><p>{speechServiceMode === 'prototype' ? 'The speech service can attempt recognition, but it may reject your voice until your profile is validated.' : 'Your voice samples have been saved. Training and validation must finish before your personal model can be marked ready. This status does not represent a timed progress estimate.'}</p></div>}
          <RecordingButtons mode="recognize"/>
          {prediction && <div className={'prediction-card ' + prediction.status}><span className="prediction-icon">{prediction.status === 'accepted' ? '✓' : '!'}</span><div><strong>{prediction.status === 'accepted' ? labelFor(prediction.intent, language) : 'Command rejected safely'}</strong><small>{prediction.reason || 'Accepted by the active personal model.'}</small></div></div>}
          <div className="toolkit-check">
            <div className="toolkit-heading"><Icon>AI</Icon><div><h3>{journeyVariant === 'c' ? 'Optional demo without speaking' : 'Try a command without speaking'}</h3><p>Choose a button to see how the accessibility controls work. This does not train your model or upload audio.</p></div></div>
            <div className="controls">{TEST_COMMANDS.map(command => <button type="button" className="soft-button" key={command.utterance} onClick={() => void runToolkit(command.utterance)}>{command.label}</button>)}</div>
            <button type="button" className="text-button" disabled={!speaking} onClick={silence}>Stop speaking</button>
            <div id="controlled-site" className="content" aria-label="Demo article under toolkit control"><h3>Welcome to the accessible demo</h3><p>Here is a real application surface. The official toolkit Controller is responsible for actions here.</p><h3>Our goal</h3><p>The co-designer uses preferred speech to navigate in Kenyan English or Kiswahili.</p><h3>Accessibility matters</h3><p>The person chooses commands. Uncertain predictions are rejected and feedback stays available to screen readers.</p><h3>A longer page</h3><p>This section gives scroll commands a real distance to move inside the article.</p><p>Text size, contrast, and motion settings are applied here by the toolkit DOM receiver.</p><p>The end of the demo article is below this line.</p></div>
          </div>
          <div className="card-actions"><button type="button" onClick={() => goTo(5)}>{journeyVariant === 'a' ? 'Continue to extension' : 'Finish this journey'} <span aria-hidden="true">→</span></button><button className="text-button" type="button" onClick={() => goTo(3)}>Back to samples</button></div>
        </div>

        <div hidden={step !== 5}>
          <HeadwayInstallStep onBack={() => goTo(4)} onReview={() => goTo(1)} />
        </div>
      </section>

      <aside className="side-stack"><details className="profile-details"><summary>My voice and privacy</summary>
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
          <button type="button" className="soft-button full-width" onClick={() => goTo(5)}>Install Headway</button>
          <small>Available now for manual Chrome installation. No voice model required.</small>
        </section>
      </details></aside>
    </div>

    <div role="status" aria-live="polite" className="global-status">{status}</div>

    <section className="after-onboarding" aria-labelledby="after-title">
      <div className="after-title"><span className="after-icon" aria-hidden="true">▣</span><h2 id="after-title">After onboarding</h2></div>
      <div className="flow-card"><Icon tone="blue">▰</Icon><div><strong>Personal voice profile</strong><span>Recognizes your chosen commands</span></div></div><span className="flow-arrow" aria-hidden="true">→</span>
      <div className="flow-card"><Icon>AI</Icon><div><strong>AI4A11y Toolkit</strong><span>Handles accepted commands</span></div></div><span className="flow-arrow" aria-hidden="true">→</span>
      <div className="flow-card"><Icon>✚</Icon><div><strong>Headway Chrome extension</strong><span>Head pointer and mouth clicks on websites you allow</span><a className="soft-button extension-quick-link" href="/install">Install browser extension</a></div></div>
      <p className="feedback-banner">Feedback you approve can support the next validated voice profile.</p>
    </section>
    <footer><p>Sauti Adapt supports access and communication. It does not diagnose or treat cerebral palsy or another medical condition.</p></footer>
  </main>;
}
