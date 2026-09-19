/**
 * Expose the local relay (port 3402) via a Cloudflare quick tunnel.
 *
 * Quick tunnels get a new hostname every restart, and NEXT_PUBLIC_RELAY_URL is
 * baked into the Next.js build — after each restart you must update Vercel and
 * redeploy. Prefer a named tunnel for judging day.
 *
 * Usage:
 *   npm run build -w @vendx/relay-proxy
 *   node relay-proxy/dist/index.js          # terminal 1
 *   node scripts/tunnel.mjs                 # terminal 2
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const bin = resolve(root, 'tools/cloudflared.exe');
const port = process.env.RELAY_PORT ?? '3402';
const target = `http://localhost:${port}`;

if (!existsSync(bin)) {
  console.error(`cloudflared not found at ${bin}`);
  console.error('Download: https://github.com/cloudflare/cloudflared/releases');
  process.exit(1);
}

console.log(`tunneling ${target} …`);
console.log('After you see the https://*.trycloudflare.com URL:');
console.log('  1. vercel env add NEXT_PUBLIC_RELAY_URL production');
console.log('  2. cd web && vercel --prod');
console.log();

const child = spawn(bin, ['tunnel', '--url', target], {
  stdio: 'inherit',
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGINT', () => child.kill());
