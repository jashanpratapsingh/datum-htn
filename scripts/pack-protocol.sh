#!/usr/bin/env bash
# Re-pack @vendx/protocol into web/vendx-protocol.tgz and refresh the lockfile.
#
# web/ depends on the protocol as a tarball (`file:./vendx-protocol.tgz`), not
# a workspace link, because Vercel builds web/ on its own. Whenever
# packages/vendx-protocol changes, run this and commit BOTH the tarball and
# package-lock.json — the lockfile pins the tarball's sha512, and a stale hash
# makes every clean `npm ci` (and every Vercel git build) fail with EINTEGRITY.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npm run build -w @vendx/protocol >/dev/null
rm -f web/vendx-protocol.tgz
( cd packages/vendx-protocol && npm pack --silent --pack-destination ../../web >/dev/null )
mv web/vendx-protocol-*.tgz web/vendx-protocol.tgz
# npm treats an already-extracted file: dep as up to date and keeps the old
# integrity line, so drop both the extracted copy and the pinned hash first.
rm -rf web/node_modules/@vendx/protocol
python3 - <<'PY'
import re
p='package-lock.json'; s=open(p).read()
s=re.sub(r'("resolved": "file:web/vendx-protocol\.tgz",\n\s*)"integrity": "[^"]+",\n', r'\1', s)
open(p,'w').write(s)
PY
# npm does not reliably re-emit the integrity for a file: tarball, so pin it
# ourselves: npm's integrity for a tarball is the base64 sha512 of its bytes.
SRI="sha512-$(openssl dgst -sha512 -binary web/vendx-protocol.tgz | base64)"
python3 - "$SRI" <<'PY'
import re,sys
sri=sys.argv[1]; p='package-lock.json'; s=open(p).read()
s,n=re.subn(r'("resolved": "file:web/vendx-protocol\.tgz",\n)(\s*)', lambda m: f'{m.group(1)}{m.group(2)}"integrity": "{sri}",\n{m.group(2)}', s, count=1)
assert n==1, "lockfile entry for the tarball not found"
open(p,'w').write(s)
PY
npm install --silent   # re-extracts the tarball; npm ci below is the real check
echo "web/vendx-protocol.tgz: sha512-$(openssl dgst -sha512 -binary web/vendx-protocol.tgz | base64)"
grep -A1 '"resolved": "file:web/vendx-protocol.tgz"' package-lock.json | grep integrity
