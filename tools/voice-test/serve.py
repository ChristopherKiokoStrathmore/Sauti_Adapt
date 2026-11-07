"""Sauti voice test: a local page plus a small forwarder to the speech endpoint.

The browser never sees the endpoint token, and the endpoint needs no CORS changes.

Run (from this folder):
    Windows PowerShell:
        $env:SAUTI_ENDPOINT = "https://<your-endpoint>.modal.run"
        $env:SAUTI_TOKEN = "<the bearer token>"
        python serve.py
    macOS / Linux:
        SAUTI_ENDPOINT=https://<your-endpoint>.modal.run SAUTI_TOKEN=<token> python serve.py

Then open http://127.0.0.1:8765 in Chrome.

Optional:
    SAUTI_FORMAT=float32   (default) raw 16 kHz float32 mono, as the Modal Whisper endpoint expects
    SAUTI_FORMAT=wav       16 kHz 16-bit mono WAV, for endpoints that take a WAV file
    SAUTI_PORT=8765
"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENDPOINT = os.environ.get('SAUTI_ENDPOINT', '').strip()
TOKEN = os.environ.get('SAUTI_TOKEN', '').strip()
FORMAT = os.environ.get('SAUTI_FORMAT', 'float32').strip()
PORT = int(os.environ.get('SAUTI_PORT', '8765'))
MODELS = {'english', 'swahili', 'personalized_english', 'personalized_swahili'}
MAX_BYTES = 2_000_000


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            page = (HERE / 'index.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(page)))
            self.end_headers()
            self.wfile.write(page)
        elif self.path == '/api/config':
            self._json(200, {'format': FORMAT, 'configured': bool(ENDPOINT)})
        else:
            self._json(404, {'detail': 'Not found.'})

    def do_POST(self):
        if self.path != '/api/transcribe':
            return self._json(404, {'detail': 'Not found.'})
        if not ENDPOINT:
            return self._json(503, {'detail': 'No endpoint set. Start the helper with SAUTI_ENDPOINT.'})
        model = self.headers.get('X-Model', 'english')
        if model not in MODELS:
            return self._json(422, {'detail': 'Unknown model.'})
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_BYTES:
            return self._json(413, {'detail': 'Recording is empty or longer than 30 seconds.'})
        audio = self.rfile.read(length)
        headers = {
            'Content-Type': 'audio/wav' if FORMAT == 'wav' else 'application/octet-stream',
            'X-Sauti-Model': model,
        }
        if TOKEN:
            headers['Authorization'] = 'Bearer ' + TOKEN
        req = urllib.request.Request(ENDPOINT, data=audio, method='POST', headers=headers)
        try:
            # A cold GPU can take a while to start; no automatic retry.
            with urllib.request.urlopen(req, timeout=150) as res:
                data = json.loads(res.read(100_000) or b'{}')
            return self._json(200, data if isinstance(data, dict) else {'transcript': str(data)})
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read(10_000)).get('detail')
            except Exception:
                detail = None
            return self._json(502, {'detail': detail or f'The speech endpoint answered {exc.code}.'})
        except (urllib.error.URLError, TimeoutError):
            return self._json(504, {'detail': 'Could not reach the speech endpoint. Check the address and your connection.'})

    def log_message(self, fmt, *args):
        # Log only the request line, never audio or headers.
        print(f'{self.command} {self.path} -> {args[1] if len(args) > 1 else ""}')


if __name__ == '__main__':
    if not ENDPOINT:
        print('Warning: SAUTI_ENDPOINT is not set; the page will load but cannot transcribe.')
    print(f'Sauti voice test running at http://127.0.0.1:{PORT}  (format: {FORMAT})')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
