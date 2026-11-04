#!/usr/bin/env python3
"""Start the independent model lab on loopback, with no public share link."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    raise SystemExit(subprocess.call([
        sys.executable, '-m', 'streamlit', 'run', str(ROOT / 'ml' / 'lab' / 'app.py'),
        '--server.address=127.0.0.1', '--server.port=8501',
        '--server.maxUploadSize=3', '--browser.gatherUsageStats=false',
    ], cwd=ROOT))
