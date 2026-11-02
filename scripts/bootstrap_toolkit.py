"""Fetch the exact upstream accessibility toolkit revision verified for this starter.

The checkout lives at vendor/ai4a11y-toolkit/ and is gitignored. This script
exits non-zero unless HEAD is exactly REVISION, the worktree is clean, and the
Controller files this repo imports are present.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'vendor' / 'ai4a11y-toolkit'
REPOSITORY = 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git'
REVISION = '7cf5006dbab9e328fadf54b654147c6bca44113d'
REQUIRED = (
    'LICENSE',
    'controller/createController.js',
    'controller/web/dom-receiver.js',
    'controller/mount/index.js',
    'controller/grammar.js',
    'controller/router.js',
    'controller/control-port.js',
    'controller/presentation.js',
    'controller/intent.js',
    'controller/DESIGN.md',
    'controller/PROTOCOL.md',
    'toolkit/registry/tools.js',
)


def run(*args):
    subprocess.run(args, check=True)


def git_text(*args):
    return subprocess.check_output(['git', '-C', str(DEST), *args], text=True).strip()


def assert_pinned(actual):
    if actual != REVISION:
        raise SystemExit(
            'ERROR: AI4A11y toolkit SHA verification failed.\n'
            f'  expected: {REVISION}\n'
            f'  actual:   {actual or "(empty)"}\n'
            'Refusing to continue with a different upstream checkout.'
        )


def commit_present():
    kind = subprocess.run(
        ['git', '-C', str(DEST), 'cat-file', '-t', REVISION],
        capture_output=True, text=True,
    )
    return kind.returncode == 0 and kind.stdout.strip() == 'commit'


def ensure_commit():
    if commit_present():
        return
    fetched = subprocess.run(
        ['git', '-C', str(DEST), 'fetch', '--no-tags', 'origin', REVISION],
        check=False,
    )
    if fetched.returncode != 0 or not commit_present():
        run('git', '-C', str(DEST), 'fetch', '--no-tags', 'origin')
    if not commit_present():
        raise SystemExit(
            f'ERROR: pinned revision {REVISION} is not a commit in {DEST}. '
            'Refusing to check out a different revision.'
        )


def assert_clean_and_complete():
    dirty = git_text('status', '--porcelain')
    if dirty:
        raise SystemExit(
            'ERROR: toolkit checkout does not match pinned commit '
            f'{REVISION} (local modifications). Refusing to verify it.\n{dirty}'
        )
    missing = [rel for rel in REQUIRED if not (DEST / rel).is_file()]
    if missing:
        raise SystemExit(
            'ERROR: pinned toolkit checkout is missing required files:\n  '
            + '\n  '.join(missing)
        )


def main():
    if not DEST.exists():
        print('Cloning official AI4A11y Toolkit...', flush=True)
        run('git', 'clone', '--filter=blob:none', REPOSITORY, str(DEST))
    if not (DEST / '.git').exists():
        raise SystemExit(f'{DEST} exists but is not a Git clone; refusing to overwrite.')
    dirty = git_text('status', '--porcelain')
    if dirty:
        raise SystemExit(
            'ERROR: toolkit checkout contains local changes. '
            'Restore a clean tree before verifying the pinned revision.\n' + dirty
        )
    if git_text('rev-parse', 'HEAD') != REVISION:
        ensure_commit()
        run('git', '-C', str(DEST), 'checkout', '--detach', REVISION)
    actual = git_text('rev-parse', 'HEAD')
    assert_pinned(actual)
    assert_clean_and_complete()
    print('Verified toolkit revision:', actual)
    print('License: Apache License 2.0 (vendor/ai4a11y-toolkit/LICENSE)')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f'Git operation failed. Check network access and Git installation: {e}')
