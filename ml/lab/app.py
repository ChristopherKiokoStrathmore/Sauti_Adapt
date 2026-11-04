"""Run using: python scripts/run_model_lab.py"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import streamlit as st
from ml.lab.core import Engine, MODELS, PHRASES, compare, explain_failure, merge_results, summarize
from ml.lab.profile import COMMANDS, enroll, open_experiment, readiness, reset_experiment, train_once

st.set_page_config(page_title='Sauti model lab', page_icon='🎙️', layout='wide')
st.title('Sauti model lab')
st.write('Record once. Compare the personal model and both Kenyan Whisper models on the same speech.')
st.caption('Local experiment. Predictions are displayed only. No website actions are executed.')

try:
    settings_path, settings = open_experiment()
except Exception as exc:
    st.error('The local experiment could not be opened. Check SAUTI_LAB_DIR and its settings file.')
    st.stop()

if 'engine' not in st.session_state:
    st.session_state.engine = Engine()
if 'history' not in st.session_state:
    st.session_state.history = []

engine = st.session_state.engine
comparison, enrollment = st.tabs(['Compare models', 'Train personal baseline'])

with comparison:
    chosen = st.segmented_control('Model', options=list(MODELS),
        format_func=lambda key: MODELS[key].label, default='english', key='model_choice')
    language = st.selectbox('Language spoken in this recording', ['en-KE', 'sw-KE'],
                            format_func=lambda value: 'Kenyan English' if value == 'en-KE' else 'Kiswahili')
    allowed = st.checkbox('I agree to process this recording locally for this experiment.', key='compare_consent')
    source = st.radio('Audio source', ['Microphone', 'WAV file'], horizontal=True)
    if source == 'Microphone':
        audio = st.audio_input('Record a short phrase, then press stop', sample_rate=16000,
                               disabled=not allowed, key='compare_audio')
    else:
        audio = st.file_uploader('Choose a WAV recording', type=['wav'], disabled=not allowed,
                                 key='compare_upload')
    st.caption('Use 0.3 to 5 seconds by default. Record a fresh clip for comparison after training.')
    expected = st.selectbox('What should the command be?',
        [None, *COMMANDS, 'READ_PAGE', 'UNDO', 'UNKNOWN'],
        format_func=lambda x: 'Not labelled yet' if x is None else x,
        help='Choose UNKNOWN for unrelated speech that should not activate a command.')
    reference = st.text_input('Correct transcript, optional',
                              help='Type what was actually said to calculate Whisper word error rate.')
    with st.expander('Command phrases used by the Whisper comparison'):
        st.table([{'Phrase': phrase, 'Command': intent} for phrase, intent in PHRASES[language].items()])
        st.write('Only a complete matching phrase becomes a command. The personal model uses your recorded examples.')
    first, second, third = st.columns(3)
    run_selected = first.button('Test selected model', disabled=not (allowed and audio and chosen), type='primary')
    run_all = second.button('Compare all three', disabled=not (allowed and audio))
    if third.button('Unload model from memory'):
        engine.unload()
        st.success('Model unloaded.')
    current = None
    if audio is not None:
        payload = audio.getvalue()
        current = (hashlib.sha256(payload).hexdigest(), language, expected, reference)
    if st.session_state.get('last_context') != current:
        st.session_state.pop('last_rows', None)
    if run_selected or run_all:
        keys = list(MODELS) if run_all else [chosen]
        try:
            with st.spinner('Running locally. The first run downloads the selected model weights.'):
                results = compare(payload, keys, engine, settings['profile_id'], language, reference, expected)
            st.session_state.last_rows = results
            st.session_state.last_context = current
            st.session_state.history = merge_results(st.session_state.history, results)
        except ValueError as exc:
            st.error(str(exc))
        except Exception as exc:
            st.error(explain_failure(exc))
    if st.session_state.get('last_rows'):
        visible = []
        for r in st.session_state.last_rows:
            visible.append({
                'Model': r['model_label'], 'Status': r['status'], 'Transcript': r['transcript'],
                'Command': r['intent'], 'Correct': r['command_correct'], 'WER': r['wer'],
                'Load seconds': r['load_seconds'], 'Recognition seconds': r['inference_seconds'],
                'Input language matches': r['language_match'], 'Note': r['error'],
            })
        st.dataframe(visible, hide_index=True, use_container_width=True)
        st.caption('WER is a word error rate, so lower is better and it can exceed 1. '
                   'The personal model has no transcript or WER. Its similarity is not a probability. '
                   'The first recognition may include device warmup; loading is timed separately.')
    if st.session_state.history:
        st.subheader('This session')
        st.dataframe(summarize(st.session_state.history), hide_index=True, use_container_width=True)
        st.caption('Language mismatches are excluded from this summary. Errors are not correct rejections. '
                   'Compare equal sets of fresh clips in each language before choosing a model. '
                   'These exploratory clips are not a final test set for model selection.')
        st.download_button('Download comparison results',
            json.dumps({'result_kind': 'exploratory-local-comparison', 'accuracy_claim': False,
                        'normalization': 'NFKC, casefold, punctuation to spaces; not Whisper BasicTextNormalizer',
                        'phrase_mapping_version': 'exact_phrases_v1',
                        'results': st.session_state.history}, indent=2),
            file_name='sauti_comparison.json', mime='application/json')
        st.caption('The export includes transcripts and labels, but no audio or credentials. Keep it private.')
        if st.button('Clear comparison results'):
            st.session_state.history = []
            st.session_state.pop('last_rows', None)
            st.rerun()

with enrollment:
    st.write('Whisper can be tested immediately after its weights download. '
             'The personal baseline needs your own training, calibration, and test recordings first.')
    st.write('Start with Scroll down, Scroll up, and Go back. In each language record 3 examples of '
             'each for training, 2 for calibration, and 2 for the untouched test. '
             'Add 5 different unrelated phrases to calibration and 5 to the test. '
             'That is 31 clips for one language, or 62 when testing both languages.')
    st.caption('Use separate recording sessions, taking a break between them. Never copy a recording between sessions. '
               'Your own voice establishes an engineering check; participant performance needs their consented speech.')
    role = st.selectbox('Recording session', ['train', 'calibration', 'test'])
    enrollment_language = st.selectbox('Enrollment language', ['en-KE', 'sw-KE'])
    intent = st.selectbox('Label for the next recording', [*COMMANDS, 'UNKNOWN'])
    consent = st.checkbox('I agree to retain these recordings locally for personal model training.', key='enroll_consent')
    clip = st.audio_input('Record one enrollment example', sample_rate=16000,
                          disabled=not consent or settings['test_used'], key='enroll_audio')
    if st.button('Save labelled example', disabled=not (consent and clip) or settings['test_used']):
        try:
            enroll(settings_path, settings, clip.getvalue(), role, intent, enrollment_language, consent)
            st.success('Recording saved.')
        except ValueError as exc:
            st.error(str(exc))
        except Exception as exc:
            st.error(explain_failure(exc))
    ready, counts = readiness(settings)
    st.table(counts)
    if st.button('Train and validate personal model', disabled=not ready or settings['test_used']):
        engine.unload()
        try:
            with st.spinner('Extracting speech embeddings, calibrating, and evaluating the untouched session.'):
                report = train_once(settings_path, settings)
            st.success('The personal model passed this pilot test. You can now compare it on fresh recordings.')
            st.json(report['metrics'])
        except Exception as exc:
            if isinstance(exc, (ValueError, RuntimeError)):
                st.error(str(exc))
            else:
                st.error(explain_failure(exc))
        st.caption('This session cannot establish general accuracy. A failed release is a result to investigate.')
    if settings['test_used']:
        st.info('This experiment has used its test session. Use fresh comparison clips. '
                'For another training attempt, reset and collect a new experiment.')
    with st.expander('Delete this experiment and start again'):
        delete_confirmed = st.checkbox('Delete all recordings and the model from this local experiment.')
        if st.button('Delete and reset experiment', disabled=not delete_confirmed):
            engine.unload()
            reset_experiment(settings_path, settings)
            st.session_state.history = []
            st.session_state.pop('last_rows', None)
            st.rerun()
