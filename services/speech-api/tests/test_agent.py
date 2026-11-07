"""Synthetic-only Gemini planner tests. No external API calls or participant data."""
import json
from unittest.mock import patch

import pytest

from sauti_ml.agent import AgentPlanError, plan_action, validate_plan


class FakeGeminiResponse:
    def __init__(self, plan):
        self.plan = plan

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        assert limit <= 80000
        return json.dumps({
            'candidates': [{'content': {'parts': [{'text': json.dumps(self.plan)}]}}]
        }).encode('utf-8')


def test_agent_rejects_unsupported_actions():
    for action in ('click', 'type', 'submit', 'purchase', 'delete', 'run_script'):
        with pytest.raises(ValueError, match='unsupported'):
            validate_plan({'action': action})


def test_agent_rejects_internal_and_insecure_navigation():
    for url in ('http://example.com', 'https://localhost/secret',
                'https://127.0.0.1/', 'https://192.168.1.12/',
                'https://user:pass@example.com', 'https://example.com:8080/'):
        with pytest.raises(ValueError):
            validate_plan({'action': 'open_url', 'url': url})


def test_agent_only_accepts_constrained_plans():
    assert validate_plan({'action': 'search_web', 'query': '  Sauti Adapt  '}) == {
        'action': 'search_web', 'query': 'Sauti Adapt'
    }
    assert validate_plan({'action': 'scroll', 'direction': 'down'}) == {
        'action': 'scroll', 'direction': 'down'
    }
    assert validate_plan({'action': 'read_page', 'danger': 'ignore'}) == {
        'action': 'read_page'
    }
    assert validate_plan({'action': 'open_url', 'url': 'https://example.com/'}) == {
        'action': 'open_url', 'url': 'https://example.com/'
    }


def test_model_call_requires_key_and_never_shares_personal_identity(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'synthetic-secret-not-a-real-key')
    monkeypatch.setenv('GEMINI_MODEL', 'gemini-3.5-flash-lite')

    def fake_urlopen(request, timeout):
        assert timeout <= 30
        assert request.get_header('X-goog-api-key') == 'synthetic-secret-not-a-real-key'
        assert request.full_url.endswith('/gemini-3.5-flash-lite:generateContent')
        sent = json.loads(request.data)
        assert 'synthetic-secret-not-a-real-key' not in request.data.decode('utf8')
        assert 'my private transcript database' not in request.data.decode('utf8')
        assert sent['generationConfig']['responseMimeType'] == 'application/json'
        return FakeGeminiResponse({'action': 'search_web', 'query': 'Strathmore University'})

    with patch('urllib.request.urlopen', side_effect=fake_urlopen):
        assert plan_action('Search for Strathmore University',
                           'https://example.com/')['action'] == 'search_web'


def test_missing_key_refuses_without_network(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    with patch('urllib.request.urlopen') as outbound:
        with pytest.raises(AgentPlanError, match='not configured'):
            plan_action('Search for Strathmore')
    outbound.assert_not_called()


def test_failed_api_response_never_creates_an_action(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'synthetic-key')
    with patch('urllib.request.urlopen', return_value=FakeGeminiResponse({
        'action': 'click', 'selector': '#delete'
    })):
        with pytest.raises(AgentPlanError):
            plan_action('click delete')
