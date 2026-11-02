"""Fetch the exact upstream accessibility toolkit revision verified for this starter."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'vendor' / 'ai4a11y-toolkit'
REPOSITORY = 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-Toolkit.git'
REVISION = '7cf5006dbab9e328fadf54b654147c6bca44113d'


def run(*args):
    subprocess.run(args, check=True)


def main():
    if not DEST.exists():
        print('Cloning official AI4A11y Toolkit...')
        run('git', 'clone', '--filter=blob:none', REPOSITORY, str(DEST))
    if not (DEST / '.git').exists():
        raise SystemExit(f'{DEST} exists but is not a Git clone; refusing to overwrite.')
    current = subprocess.check_output(['git', '-C', str(DEST), 'rev-parse', 'HEAD'], text=True).strip()
    if current != REVISION:
        changes = subprocess.check_output(['git', '-C', str(DEST), 'status', '--porcelain'], text=True)
        if changes.strip():
            raise SystemExit('Toolkit checkout contains local changes. Commit/stash them before switching revision.')
        run('git', '-C', str(DEST), 'fetch', 'origin', REVISION)
        run('git', '-C', str(DEST), 'checkout', '--detach', REVISION)
    actual = subprocess.check_output(['git', '-C', str(DEST), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != REVISION:
        raise SystemExit(f'Version mismatch: {actual}')
    print('Verified toolkit revision:', actual)
    print('License and upstream notices remain in vendor/ai4a11y-toolkit/')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f'Git operation failed. Check network access and Git installation: {e}')
