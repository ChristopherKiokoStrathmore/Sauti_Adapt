"""Full training export test using a deterministic fake encoder, not pretrained model weights."""
import json
from uuid import uuid4
import numpy as np
from sauti_ml.storage import store_enrollment, profile_dir
from sauti_ml.contracts import Intent, Language
from sauti_ml.train import run
from sauti_ml.prototype import PrototypeModel

class FakeEncoder:
    model_id = 'test-frequency-encoder'
    def embed(self, audio):
        freq = np.fft.rfftfreq(len(audio), 1/16000)
        peak = freq[np.argmax(np.abs(np.fft.rfft(audio)))]
        if abs(peak-220)<12: return np.array([1,0,0], dtype=np.float32)
        if abs(peak-330)<12: return np.array([0,1,0], dtype=np.float32)
        if abs(peak-440)<12: return np.array([0,0,1], dtype=np.float32)
        return np.array([-1,-1,-1], dtype=np.float32)/np.sqrt(3)


def test_training_produces_validated_artifact_only_with_holdout(monkeypatch, tmp_path):
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    pid, train_id, cal_id, test_id = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    for intent, frequency in [
        (Intent.SCROLL_DOWN,220), (Intent.SCROLL_UP,330), (Intent.GO_BACK,440)
    ]:
        for sid, n in [(train_id,3),(cal_id,2),(test_id,2)]:
            for ix in range(n):
                phase = {train_id:0.0, cal_id:0.6, test_id:1.2}[sid] + .08 * ix
                x = (.1*np.sin(2*np.pi*frequency*np.arange(16000)/16000+phase)).astype(np.float32)
                store_enrollment(pid, sid, intent, Language.KENYAN_ENGLISH, x, user_id='11111111-1111-4111-8111-111111111111')
    for ix in range(5):
        x=(.1*np.sin(2*np.pi*720*np.arange(16000)/16000+.11*ix)).astype(np.float32)
        y=(.1*np.sin(2*np.pi*720*np.arange(16000)/16000+1.0+.11*ix)).astype(np.float32)
        store_enrollment(pid,cal_id,Intent.UNKNOWN,Language.KENYAN_ENGLISH,x, user_id='11111111-1111-4111-8111-111111111111')
        store_enrollment(pid,test_id,Intent.UNKNOWN,Language.KENYAN_ENGLISH,y, user_id='11111111-1111-4111-8111-111111111111')
    report = run(pid,cal_id,test_id,encoder=FakeEncoder(), result_kind='artificial-fixture')
    assert report['metrics']['test']['unknown_false_accepts']==0
    assert report['metrics']['test']['correct_accepted']==6
    path=profile_dir(pid)
    assert (path/'evaluation.json').exists()
    exported=PrototypeModel.load(path)
    assert exported.predict([1,0,0]).intent==Intent.SCROLL_DOWN
    from sauti_ml.storage import read_private_bytes
    assert not (path/'model.json').read_bytes().startswith(b'{')
    assert json.loads(read_private_bytes(path/'model.json'))['validated'] is True
    english = report['metrics']['test']['by_language']['en-KE']
    assert english['correct'] == 6
    assert english['incorrect'] == 0
    assert english['unknown_false_accepts'] == 0
    assert report['metrics']['test']['by_language']['sw-KE']['known_count'] == 0
    assert report['result_kind'] == 'artificial-fixture'
    assert report['accuracy_claim'] is False
    assert report['latency_seconds'] >= 0
    assert 'en-KE' in report['metrics']['test']['confusion_by_language']


def _tone(frequency, phase=0.0):
    # Deterministic sine wave. Not human speech.
    return (.1 * np.sin(2 * np.pi * frequency * np.arange(16000) / 16000 + phase)).astype(np.float32)


def test_release_requires_each_enrolled_language(monkeypatch, tmp_path):
    """Artificial tones and a fake encoder. Not human speech and not an accuracy result.

    Kiswahili calibration and test tones do not match their prototypes, so the
    model must not be released even though Kenyan English would have passed.
    """
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', str(tmp_path))
    pid, train_id, cal_id, test_id = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
    commands = [(Intent.SCROLL_DOWN, 220), (Intent.SCROLL_UP, 330), (Intent.GO_BACK, 440)]
    for intent, frequency in commands:
        for language in (Language.KENYAN_ENGLISH, Language.KISWAHILI):
            for sid, n in ((train_id, 3), (cal_id, 2), (test_id, 2)):
                for ix in range(n):
                    phase = {train_id: 0.0, cal_id: 0.6, test_id: 1.2}[sid] + .08 * ix
                    heard = frequency
                    if language is Language.KISWAHILI and sid != train_id:
                        heard = 720
                    store_enrollment(pid, sid, intent, language, _tone(heard, phase), user_id='11111111-1111-4111-8111-111111111111')
    for language in (Language.KENYAN_ENGLISH, Language.KISWAHILI):
        for sid in (cal_id, test_id):
            for ix in range(5):
                store_enrollment(pid, sid, Intent.UNKNOWN, language, _tone(720, .11 * ix + (0 if sid == cal_id else 1)), user_id='11111111-1111-4111-8111-111111111111')
    try:
        run(pid, cal_id, test_id, encoder=FakeEncoder())
    except RuntimeError as exc:
        assert 'sw-KE' in str(exc)
        assert 'NOT released' in str(exc)
    else:
        raise AssertionError('Model was released without a correct Kiswahili activation')
