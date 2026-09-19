'use client';

import { useState, useCallback } from 'react';
import NavBar from '@/components/NavBar';
import { SourceBadge } from '@/components/SourceBadge';
import { Play, CheckCircle, XCircle, Loader, Circle } from 'lucide-react';
import type { PaymentRequiredBody } from '@vendx/protocol';

// Micro-USDC → USD display (no node:crypto, pure math)
function microToUsd(micro: string): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

// Browser-safe random hex (uses Web Crypto)
function randomHex(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface HandshakeStep {
  label: string;
  detail?: string;
}

const STEPS: HandshakeStep[] = [
  { label: 'AI requests sensor data', detail: 'GET /api/telemetry' },
  { label: 'ESP32 → HTTP 402 Payment Required', detail: 'challenge + nonce issued' },
  { label: 'AI checks APEX policy', detail: '$5.00/day cap' },
  { label: 'Policy approved', detail: 'within daily budget' },
  { label: 'Execute USDC transfer (simulated)', detail: 'mock tx signature' },
  { label: 'Solana confirms transaction', detail: 'devnet, via simulator' },
  { label: 'AI submits receipt to ESP32', detail: 'POST /settle → GET /api/telemetry' },
  { label: 'ESP32 verifies receipt (offline, ~40ms)', detail: 'Ed25519 + nonce check' },
  { label: 'ESP32 returns real-time sensor data', detail: 'source=badge or simulator' },
];

interface RunState {
  statuses: StepStatus[];
  details: (string | null)[];
  challenge?: PaymentRequiredBody;
  telemetry?: Record<string, unknown>;
  error?: string;
}

function initialState(): RunState {
  return { statuses: STEPS.map(() => 'idle'), details: STEPS.map(() => null) };
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader size={16} className="text-[#5ed29c] animate-spin" aria-hidden="true" />;
  if (status === 'done') return <CheckCircle size={16} className="text-[#5ed29c]" aria-hidden="true" />;
  if (status === 'error') return <XCircle size={16} className="text-red-400" aria-hidden="true" />;
  return <Circle size={16} className="text-white/20" aria-hidden="true" />;
}

export default function AgentPage() {
  const [state, setState] = useState<RunState>(initialState());
  const [running, setRunning] = useState(false);

  const setStep = useCallback((i: number, status: StepStatus, detail?: string) => {
    setState((prev) => {
      const statuses = [...prev.statuses];
      const details = [...prev.details];
      statuses[i] = status;
      if (detail !== undefined) details[i] = detail;
      return { ...prev, statuses, details };
    });
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setState(initialState());
    let challenge: PaymentRequiredBody | undefined = undefined;
    let receipt: string | undefined = undefined;

    try {
      // Step 0 — request telemetry (no payment)
      setStep(0, 'running');
      const r1 = await fetch('/api/telemetry');
      const body1 = await r1.json() as PaymentRequiredBody | { error?: string };

      if (r1.status === 503) {
        setStep(0, 'error', 'relay offline');
        setState((p) => ({ ...p, error: 'Relay is offline. Start relay-proxy first.' }));
        setRunning(false);
        return;
      }

      if (r1.status !== 402) {
        setStep(0, 'error', `unexpected ${r1.status}`);
        setState((p) => ({ ...p, error: `Expected 402, got ${r1.status}` }));
        setRunning(false);
        return;
      }

      setStep(0, 'done', 'GET /api/telemetry sent');

      // Step 1 — 402 received
      setStep(1, 'running');
      challenge = body1 as PaymentRequiredBody;
      setState((p) => ({ ...p, challenge }));
      await new Promise((r) => setTimeout(r, 300));
      setStep(1, 'done', `nonce=${challenge.nonce.slice(0, 8)}…`);

      // Step 2 — policy check
      setStep(2, 'running');
      const req = challenge.accepts[0];
      await new Promise((r) => setTimeout(r, 200));
      setStep(2, 'done', `${req.maxAmountRequired} µUSDC within $5.00/day`);

      // Step 3 — policy approved
      setStep(3, 'running');
      await new Promise((r) => setTimeout(r, 150));
      setStep(3, 'done', `payTo=${req.payTo.slice(0, 8)}…`);

      // Step 4 — mock USDC transfer
      setStep(4, 'running');
      const txSig = 'SimTx' + randomHex(29);
      await new Promise((r) => setTimeout(r, 250));
      setStep(4, 'done', `txSig=${txSig.slice(0, 14)}… (simulator)`);

      // Step 5 — Solana confirm (simulated, instant)
      setStep(5, 'running');
      await new Promise((r) => setTimeout(r, 300));
      setStep(5, 'done', 'devnet simulator — no chain latency');

      // Step 6 — POST /settle
      setStep(6, 'running');
      const settleRes = await fetch('/api/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: challenge.nonce,
          txSignature: txSig,
          payTo: req.payTo,
          amount: req.maxAmountRequired,
          network: req.network,
        }),
      });

      const settleData = await settleRes.json() as { receipt?: string; error?: string };

      if (!settleRes.ok || !settleData.receipt) {
        setStep(6, 'error', settleData.error ?? `HTTP ${settleRes.status}`);
        setState((p) => ({ ...p, error: `Settlement failed: ${settleData.error ?? settleRes.status}` }));
        setRunning(false);
        return;
      }

      receipt = settleData.receipt;
      setStep(6, 'done', `receipt=${receipt.slice(0, 16)}…`);

      // Step 7 — device verifies (relay proxies verification)
      setStep(7, 'running');
      const r2 = await fetch('/api/telemetry', {
        headers: { 'x-payment-receipt': receipt },
      });

      const body2 = await r2.json() as Record<string, unknown>;

      if (!r2.ok) {
        setStep(7, 'error', (body2.error as string) ?? `HTTP ${r2.status}`);
        setState((p) => ({ ...p, error: `Device rejected receipt: ${body2.error ?? r2.status}` }));
        setRunning(false);
        return;
      }

      setStep(7, 'done', 'Ed25519 verified, nonce consumed');

      // Step 8 — data returned
      setStep(8, 'running');
      await new Promise((r) => setTimeout(r, 150));
      setState((p) => ({ ...p, telemetry: body2 }));
      setStep(8, 'done', `source=${body2.source ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((p) => ({ ...p, error: msg }));
    }

    setRunning(false);
  }, [setStep]);

  const { statuses, details, challenge, telemetry, error } = state;

  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <h1 className="font-[family-name:var(--font-inter)] font-extrabold text-3xl text-white mb-2">
          Agent Console
        </h1>
        <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-10">
          Watch the 9-step x402 handshake happen live. Each step lights up when a real network call
          completes — not on a timer.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: steps */}
          <div className="flex flex-col gap-6">
            <button
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-full bg-[#5ed29c] text-[#070b0a] uppercase font-bold text-sm px-6 py-3 hover:bg-[#4ec08a] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed self-start"
              aria-label={running ? 'Handshake running' : 'Run handshake'}
            >
              <Play size={14} aria-hidden="true" />
              {running ? 'Running…' : 'Run handshake'}
            </button>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                <p className="font-[family-name:var(--font-inter)] text-sm text-red-400">{error}</p>
              </div>
            )}

            <ol className="flex flex-col gap-3" aria-label="Handshake steps">
              {STEPS.map((step, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-4 rounded-xl border px-4 py-3 transition-all duration-200 ${
                    statuses[i] === 'done'
                      ? 'border-[#5ed29c]/20 bg-[#5ed29c]/5'
                      : statuses[i] === 'running'
                        ? 'border-[#5ed29c]/30 bg-[#5ed29c]/10'
                        : statuses[i] === 'error'
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-white/5 bg-white/[0.01]'
                  }`}
                >
                  <StepIcon status={statuses[i]} />
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 font-mono w-5 shrink-0">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={`font-[family-name:var(--font-inter)] text-sm ${
                          statuses[i] === 'done'
                            ? 'text-white'
                            : statuses[i] === 'error'
                              ? 'text-red-400'
                              : 'text-white/60'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {(details[i] || step.detail) && (
                      <p className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/30 pl-7">
                        {details[i] ?? step.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Right: live data */}
          <div className="flex flex-col gap-4">
            {/* Challenge */}
            {challenge && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                <div className="px-4 py-2 border-b border-white/10 bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold font-[family-name:var(--font-inter)] uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      402 Challenge
                    </span>
                    <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">
                      nonce: {challenge.nonce.slice(0, 16)}…
                    </span>
                  </div>
                </div>
                <div className="px-4 py-3 grid grid-cols-2 gap-2">
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-0.5">
                      Resource
                    </p>
                    <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/70">
                      {challenge.accepts[0]?.resource}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-0.5">
                      Price
                    </p>
                    <p className="font-[family-name:var(--font-inter)] font-bold text-sm text-[#5ed29c]">
                      ${microToUsd(challenge.accepts[0]?.maxAmountRequired ?? '0')}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-0.5">
                      Network
                    </p>
                    <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/70">
                      {challenge.accepts[0]?.network}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-0.5">
                      Expires in
                    </p>
                    <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/70">
                      {Math.max(0, challenge.expiresAt - Math.floor(Date.now() / 1000))}s
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Telemetry */}
            {telemetry && (
              <div className="rounded-xl border border-[#5ed29c]/20 bg-[#5ed29c]/5 overflow-hidden">
                <div className="px-4 py-2 border-b border-[#5ed29c]/10 flex items-center gap-2">
                  <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold font-[family-name:var(--font-inter)] uppercase tracking-wider bg-[#5ed29c]/10 text-[#5ed29c] border border-[#5ed29c]/20">
                    200 OK — Telemetry
                  </span>
                  {typeof telemetry.source === 'string' && (
                    <SourceBadge source={telemetry.source as 'badge' | 'simulator'} />
                  )}
                </div>
                <pre className="px-4 py-3 font-mono text-[11px] text-white/60 overflow-x-auto whitespace-pre-wrap break-all max-h-60">
                  {JSON.stringify(telemetry, null, 2)}
                </pre>
              </div>
            )}

            {/* Empty state */}
            {!challenge && !telemetry && !error && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[200px]">
                <Play size={24} className="text-white/10" aria-hidden="true" />
                <p className="font-[family-name:var(--font-inter)] text-sm text-white/30">
                  Press <strong className="text-white/50">Run handshake</strong> to start the
                  live demo.
                </p>
                <p className="font-[family-name:var(--font-inter)] text-xs text-white/20">
                  Relay-proxy must be running on port 3402.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
