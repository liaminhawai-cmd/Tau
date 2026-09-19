"""Restore and verify the exact inputs for the Brief 5 review."""
import argparse
import base64
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE / 'source-manifest.json').read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--checkout', type=Path, help='Read pinned blobs from an existing Tau checkout')
parser.add_argument('--verify', action='store_true', help='Verify existing files without fetching')
args = parser.parse_args()
if not args.verify and not args.checkout and not shutil.which('gh'):
    parser.error('Use --checkout /path/to/Tau, or install and authenticate GitHub CLI (gh).')

jobs = [(HERE / 'repo' / f['path'], f['blob']) for f in manifest['files']]
for key in ['auditCurrentIndex', 'auditCurrentLoader']:
    f = manifest[key]
    jobs.append((HERE / f['local'], f['blob']))

for dest, blob in jobs:
    if args.verify:
        data = dest.read_bytes()
    elif args.checkout:
        # Reading by immutable blob also handles the frozen engine from another revision.
        data = subprocess.check_output(['git', '-C', str(args.checkout), 'cat-file', 'blob', blob])
    else:
        raw = subprocess.check_output(['gh', 'api', 'repos/' + manifest['repository'] + '/git/blobs/' + blob])
        result = json.loads(raw)
        if result.get('encoding') != 'base64':
            raise RuntimeError('Unexpected GitHub blob encoding')
        data = base64.b64decode(result['content'])
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if actual != blob:
        raise RuntimeError('Source mismatch: ' + str(dest))
    if not args.verify:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
print(('Verified' if args.verify else 'Restored and verified') + f' {len(jobs)} exact source files.')
