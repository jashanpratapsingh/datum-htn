/**
 * Live screen capture from the attached badge.
 *
 * OFF BY DEFAULT, and deliberately so. The badge's home screen renders the
 * attendee's name, badge ID and an identity QR code. Publishing that on a
 * public marketplace would leak exactly the personal data the rest of this
 * codebase is careful to exclude (see docs/BADGE.md). Enable it only for a
 * local demo, by setting VENDX_ALLOW_SCREEN=1.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);

const PY = process.env.VENDX_PY ?? '.venv-pio/bin/python';
const SCRIPT = process.env.VENDX_SHOT_SCRIPT ?? 'scripts/badge_shot.py';

export function screenEnabled(): boolean {
  return process.env.VENDX_ALLOW_SCREEN === '1';
}

export async function captureScreen(): Promise<Buffer | null> {
  if (!screenEnabled()) return null;
  const out = join(tmpdir(), `vendx-shot-${Date.now()}.png`);
  try {
    await exec(PY, [SCRIPT, out], { timeout: 60_000 });
    return await readFile(out);
  } catch {
    return null;
  } finally {
    await unlink(out).catch(() => {});
  }
}
