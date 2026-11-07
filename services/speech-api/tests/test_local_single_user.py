"""Local single-user pilot mode: no personal token, but only on this machine."""
from unittest.mock import patch

from fastapi.testclient import TestClient

from sauti_ml.api import app, LOCAL_USER_ID

ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
PLAN = {'action': 'scroll', 'direction': 'down', 'reason': 'test'}
local = TestClient(app, client=('127.0.0.1', 50000))
remote = TestClient(app, client=('203.0.113.9', 50000))


def plan_request(c):
    with patch('sauti_ml.agent.plan_action', return_value=PLAN) as planned:
        res = c.post('/v1/extension/agent/plan', headers={'origin': ORIGIN},
                     json={'instruction': 'scroll down', 'page_url': 'https://example.org/'})
    return res, planned


def test_local_mode_lets_this_laptop_plan_without_a_token(monkeypatch):
    monkeypatch.setenv('SAUTI_LOCAL_SINGLE_USER', 'true')
    res, planned = plan_request(local)
    assert res.status_code == 200, res.text
    assert res.json()['plan'] == PLAN and res.json()['executed_action'] is False
    planned.assert_called_once()


def test_local_mode_never_applies_to_another_machine(monkeypatch):
    monkeypatch.setenv('SAUTI_LOCAL_SINGLE_USER', 'true')
    res, planned = plan_request(remote)
    assert res.status_code in (401, 422)
    planned.assert_not_called()


def test_without_the_flag_a_token_is_required_even_locally(monkeypatch):
    monkeypatch.delenv('SAUTI_LOCAL_SINGLE_USER', raising=False)
    res, planned = plan_request(local)
    assert res.status_code in (401, 422)
    planned.assert_not_called()


def test_config_tells_the_extension_which_mode_it_is_in(monkeypatch):
    monkeypatch.setenv('SAUTI_LOCAL_SINGLE_USER', 'true')
    on = local.get('/v1/extension/config', headers={'origin': ORIGIN}).json()
    assert on['single_user'] is True and on['profile_id']
    assert remote.get('/v1/extension/config', headers={'origin': ORIGIN}).json()['single_user'] is False
    monkeypatch.delenv('SAUTI_LOCAL_SINGLE_USER')
    assert local.get('/v1/extension/config', headers={'origin': ORIGIN}).json()['single_user'] is False


def test_local_user_id_is_a_fixed_uuid():
    assert LOCAL_USER_ID == '00000000-0000-4000-8000-000000000001'
