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
    result = evaluate_predictions(model(), [('SCROLL_DOWN', np.array([1,0,0]))], [np.array([-1.,-1.,-1.])])
    assert result['unknown_false_accepts'] == 0
    assert result['correct_accepted'] == 1
