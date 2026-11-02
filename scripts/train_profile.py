#!/usr/bin/env python3
"""Train one personal prototype model after consented sessions already exist.

Usage:
  SAUTI_PRIVATE_DIR=/absolute/path/outside/the/repo \\
    python scripts/train_profile.py PROFILE_UUID CALIBRATION_SESSION_UUID TEST_SESSION_UUID

This command does not record speech, does not download a dataset, and does not
invent results. If the sessions are missing, it exits non-zero. Counts written
by a successful run are not an accuracy claim. Real co-designer results are
NOT VERIFIED by this repository.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services' / 'speech-api'))


def main() -> int:
    if len(sys.argv) != 4:
        print('Usage: python scripts/train_profile.py PROFILE_UUID CALIBRATION_SESSION_UUID TEST_SESSION_UUID', file=sys.stderr)
        print('Real participant results are NOT VERIFIED. This command does not create speech and does not report accuracy.', file=sys.stderr)
        return 2
    if not os.environ.get('SAUTI_PRIVATE_DIR', '').strip():
        print('SAUTI_PRIVATE_DIR is not set. Refusing to read or write inside the repository.', file=sys.stderr)
        print('Real results remain NOT VERIFIED.', file=sys.stderr)
        return 2
    from sauti_ml.train import run
    try:
        report = run(sys.argv[1], sys.argv[2], sys.argv[3])
    except Exception as exc:
        print(f'Training did not release a model: {exc}', file=sys.stderr)
        print('Real results remain NOT VERIFIED.', file=sys.stderr)
        return 1
    print('result_kind:', report.get('result_kind'))
    print('accuracy_claim:', report.get('accuracy_claim'))
    print('latency_seconds:', report.get('latency_seconds'))
    print('threshold:', report.get('threshold'))
    print('Per-language counts are in the private evaluation.json. They are not an accuracy claim.')
    print('Real co-designer results are NOT VERIFIED by this repository.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
