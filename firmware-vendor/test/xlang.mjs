/**
 * Host-side cross-language receipt check (Windows-friendly).
 *
 * Compiles firmware-vendor/test/xlang_verify.c against tweetnacl and runs it
 * on vectors from gen-vectors.mjs. Claims ONLY byte-compatibility with the
 * TypeScript signer — never "runs on silicon".
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vectorsPath = resolve(root, 'packages/vendx-protocol/vectors/receipts.json');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return r;
}

// Ensure vectors exist
const gen = run(process.execPath, [
  resolve(root, 'packages/vendx-protocol/scripts/gen-vectors.mjs'),
], { cwd: root });
if (gen.status !== 0) {
  console.error(gen.stderr || gen.stdout);
  process.exit(1);
}

const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));

const cc = process.platform === 'win32' ? 'gcc' : 'cc';
const which = run(process.platform === 'win32' ? 'where' : 'which', [cc]);
if (which.status !== 0) {
  console.log('SKIP  no C compiler on PATH — vectors written, host verify deferred');
  console.log(`      vectors: ${vectorsPath}`);
  console.log('      install gcc/clang, then: node firmware-vendor/test/xlang.mjs');
  process.exit(0);
}

const outDir = join(tmpdir(), `vendx-xlang-${process.pid}`);
mkdirSync(outDir, { recursive: true });
const exe = join(outDir, process.platform === 'win32' ? 'xlang.exe' : 'xlang');

const compile = run(cc, [
  '-O1',
  `-I${resolve(root, 'firmware-vendor/lib/tweetnacl')}`,
  '-o',
  exe,
  resolve(root, 'firmware-vendor/test/xlang_verify.c'),
  resolve(root, 'firmware-vendor/lib/tweetnacl/tweetnacl.c'),
]);
if (compile.status !== 0) {
  console.error('COMPILE_FAIL', compile.stderr);
  process.exit(1);
}

let fail = 0;
const ok = run(exe, [vectors.validReceipt, vectors.facilitatorPublicKeyB64u]);
if (ok.status === 0) console.log('PASS  valid receipt accepted');
else {
  console.log('FAIL  valid receipt rejected', ok.stdout, ok.stderr);
  fail = 1;
}

const bad = run(exe, [vectors.tamperedReceipt, vectors.facilitatorPublicKeyB64u]);
if (bad.status !== 0) console.log('PASS  tampered receipt rejected');
else {
  console.log('FAIL  tampered receipt ACCEPTED');
  fail = 1;
}

console.log(
  fail === 0
    ? 'CLAIM: TypeScript signer and C tweetnacl verifier agree on host (not silicon).'
    : 'CLAIM FAILED',
);
process.exit(fail);
