import numpy as np
from sauti_ml.prototype import PrototypeModel
from sauti_ml.train import test_predictions as evaluate_predictions


def model():
    return PrototypeModel(
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        ['SCROLL_DOWN', 'SCROLL_UP', 'GO_BACK'],
        ['en-KE', 'sw-KE', 'en-KE'],
        threshold=.9, margin=.1, version='test', encoder_id='fake-encoder')


def test_known_accepts():
    predicted = model().predict([1, 0, 0])
    assert predicted.status == 'accepted'
    assert predicted.intent.value == 'SCROLL_DOWN'
    assert predicted.confidence == 1


def test_ambiguous_rejected():
    predicted = model().predict([.7, .7, 0])
    assert predicted.status == 'rejected'
    assert predicted.intent.value == 'UNKNOWN'


def test_unknown_rejected():
    predicted = model().predict([-1, -1, -1])
    assert predicted.status == 'rejected'


def test_evaluate_no_false_activation():
    result = evaluate_predictions(
        model(),
        [('SCROLL_DOWN', 'en-KE', np.array([1, 0, 0]))],
        [('en-KE', np.array([-1., -1., -1.]))],
    )
    assert result['unknown_false_accepts'] == 0
    assert result['correct_accepted'] == 1
    assert result['by_language']['en-KE']['correct'] == 1
    assert result['by_language']['en-KE']['unknown_false_accepts'] == 0
    assert result['by_command_language']['SCROLL_DOWN|en-KE']['correct'] == 1


def test_language_counts_are_split_on_artificial_vectors():
    """Hand-written vectors, not human speech, and not an accuracy result."""
    known = [
        ('SCROLL_DOWN', 'en-KE', np.array([1, 0, 0])),
        ('SCROLL_UP', 'sw-KE', np.array([0, 1, 0])),
        ('GO_BACK', 'en-KE', np.array([0.2, 0.2, 0.2])),
    ]
    unknown = [('sw-KE', np.array([-1., -1., -1.])), ('en-KE', np.array([1., 0, 0]))]
    result = evaluate_predictions(model(), known, unknown)
    english = result['by_language']['en-KE']
    kiswahili = result['by_language']['sw-KE']
    assert english['correct'] == 1
    assert english['rejected'] == 1
    assert english['incorrect'] == 0
    assert english['unknown_false_accepts'] == 1
    assert kiswahili['correct'] == 1
    assert kiswahili['rejected'] == 0
    assert kiswahili['unknown_false_accepts'] == 0
    assert result['by_command_language']['GO_BACK|en-KE']['rejected'] == 1
    assert result['by_command_language']['SCROLL_UP|sw-KE']['correct'] == 1
