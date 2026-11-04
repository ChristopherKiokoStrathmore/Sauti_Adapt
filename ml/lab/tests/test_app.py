"""UI smoke test, without speech weights or a microphone."""
from pathlib import Path
from streamlit.testing.v1 import AppTest


def test_lab_opens_with_model_selector_and_disabled_run_buttons(tmp_path, monkeypatch):
    monkeypatch.setenv('SAUTI_LAB_DIR', str(tmp_path / 'lab'))
    monkeypatch.setenv('SAUTI_PRIVATE_DIR', '')
    monkeypatch.setenv('SAUTI_STORAGE_KEY', '')
    app = Path(__file__).resolve().parents[1] / 'app.py'
    at = AppTest.from_file(str(app)).run(timeout=20)
    assert not at.exception
    assert at.title[0].value == 'Sauti model lab'
    buttons = {button.label: button for button in at.button}
    assert buttons['Test selected model'].disabled
    assert buttons['Compare all three'].disabled
    assert buttons['Train and validate personal model'].disabled
    assert at.session_state['model_choice'] == 'english'
