/**
 * Hard-cap demo: grant an on-chain allowance BELOW the quoted price and show
 * the SPL Token program itself rejecting the transfer (not our policy code).
 *
 * Needs funded wallets (see npm run fund). Mock settlement cannot prove this.
 *
 *   node scripts/demo-hardcap.mjs
 */
import { spawn } from 'node:child_process';

function run(cmd, args, env = {}) {
  return new Promise((resolveP, reject) => {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => {
      if (code === 0) resolveP();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

console.log('VENDX hard-cap demo');
console.log('1) Grant a tiny on-chain allowance ($0.001) — below any real quote');
console.log('2) Run one real settlement round — expect SPL Token to reject\n');

try {
  await run('npm', ['run', 'allowance', '--', '--cap', '0.001']);
} catch {
  console.error('\nallowance failed — fund treasury USDC + agent SOL first (npm run fund)');
  process.exit(1);
}

try {
  await run('npm', ['run', 'demo:solana'], { VENDX_SETTLEMENT: 'devnet', VENDX_ROUNDS: '1' });
  console.log('\nUNEXPECTED: demo succeeded. Cap may still be high enough, or settlement stayed mock.');
  process.exit(2);
} catch {
  console.log('\nEXPECTED: transfer rejected by the on-chain allowance / token program.');
  console.log('Look above for a token-program / insufficient-funds / custom program error.');
  console.log('Re-grant a normal cap when done: npm run allowance -- --cap 5');
}
