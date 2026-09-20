"""Restore the pinned Tau inputs without changing a user's repository checkout."""
import argparse, base64, hashlib, json, shutil, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE/'source-manifest.json').read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--checkout', type=Path, help='Read pinned files with git show from this repository')
parser.add_argument('--verify', action='store_true', help='Only verify existing repo/ files')
args = parser.parse_args()
if not args.verify and not args.checkout and not shutil.which('gh'):
    parser.error('Use --checkout /path/to/Tau, or install/authenticate GitHub CLI (gh).')

for f in manifest['files']:
    dest=HERE/'repo'/f['path']
    if args.verify:
        data=dest.read_bytes()
    elif args.checkout:
        data=subprocess.check_output(['git','-C',str(args.checkout),'show',manifest['commit']+':'+f['path']])
    else:
        raw=subprocess.check_output(['gh','api','repos/'+manifest['repository']+'/git/blobs/'+f['blob']])
        blob=json.loads(raw)
        if blob.get('encoding')!='base64': raise RuntimeError('Unexpected GitHub blob encoding')
        data=base64.b64decode(blob['content'])
    actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if actual!=f['blob']: raise RuntimeError('Source mismatch: '+f['path'])
    if not args.verify:
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
print(('Verified' if args.verify else 'Restored and verified')+f" {len(manifest['files'])} source files at {manifest['commit']}.")
