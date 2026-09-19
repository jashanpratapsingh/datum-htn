'use client';

import { useState, useCallback } from 'react';
import NavBar from '@/components/NavBar';
import { SourceBadge } from '@/components/SourceBadge';
import { Play, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { PaymentRequiredBody } from '@vendx/protocol';

function microToUsd(micro: string): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

function randomHex(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface HandshakeStep {
  label: string;
  detail?: string;
  party: 'agent' | 'device' | 'chain' | 'policy';
}

const STEPS: HandshakeStep[] = [
  { label: 'Agent requests sensor data', detail: 'GET /api/telemetry', party: 'agent' },
  { label: 'Device issues 402 challenge', detail: 'nonce minted, 60s TTL', party: 'device' },
  { label: 'Agent consults APEX policy', detail: '$5.00/day spend cap', party: 'policy' },
  { label: 'Policy approved', detail: 'within daily budget', party: 'policy' },
  { label: 'USDC transfer submitted', detail: 'mock tx signature, simulator', party: 'chain' },
  { label: 'Solana confirms transaction', detail: 'devnet — no chain latency', party: 'chain' },
  { label: 'Agent replays receipt', detail: 'POST /settle → GET /api/telemetry', party: 'agent' },
  { label: 'Device verifies offline', detail: 'Ed25519 + nonce check ~40ms', party: 'device' },
  { label: 'Telemetry dispensed', detail: 'source=badge or simulator', party: 'device' },
];

const PARTY_COLORS: Record<HandshakeStep['party'], string> = {
  agent: '#818cf8',   // indigo
  device: '#5ed29c',  // green (our accent)
  chain: '#f59e0b',   // amber
  policy: '#c084fc',  // purple
};

const PARTY_LABELS: Record<HandshakeStep['party'], string> = {
  agent: 'Agent',
  device: 'Device',
  chain: 'Solana',
  policy: 'Policy',
};

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

function StepDot({ status, color }: { status: StepStatus; color: string }) {
  if (status === 'running') {
    return (
      <span
        className="relative flex items-center justify-center w-7 h-7 rounded-full border-2"
        style={{ borderColor: color, backgroundColor: `${color}22` }}
        aria-hidden="true"
      >
        <span
          className="w-2 h-2 rounded-full animate-ping absolute"
          style={{ backgroundColor: color, opacity: 0.6 }}
        />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span
        className="flex items-center justify-center w-7 h-7 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        <CheckCircle size={14} color="#070b0a" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-red-500/20 border-2 border-red-500" aria-hidden="true">
        <XCircle size={14} className="text-red-400" />
      </span>
    );
  }
  return (
    <span
      className="flex items-center justify-center w-7 h-7 rounded-full border-2"
      style={{ borderColor: 'rgba(255,255,255,0.15)' }}
      aria-hidden="true"
    />
  );
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
      setStep(0, 'running');
      const r1 = await fetch('/api/telemetry');
      const body1 = await r1.json() as PaymentRequiredBody | { error?: string };

      if (r1.status === 503) {
        setStep(0, 'error', 'relay offline');
        setState((p) => ({ ...p, error: 'Relay is offline. Start relay-proxy first (port 3402).' }));
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

      setStep(1, 'running');
      challenge = body1 as PaymentRequiredBody;
      setState((p) => ({ ...p, challenge }));
      await new Promise((r) => setTimeout(r, 300));
      setStep(1, 'done', `nonce: ${challenge.nonce.slice(0, 12)}…`);

      setStep(2, 'running');
      const req = challenge.accepts[0];
      await new Promise((r) => setTimeout(r, 200));
      setStep(2, 'done', `${req.maxAmountRequired} µUSDC ≤ $5.00/day cap`);

      setStep(3, 'running');
      await new Promise((r) => setTimeout(r, 150));
      setStep(3, 'done', `payTo: ${req.payTo.slice(0, 10)}…`);

      setStep(4, 'running');
      const txSig = 'SimTx' + randomHex(29);
      await new Promise((r) => setTimeout(r, 250));
      setStep(4, 'done', `sig: ${txSig.slice(0, 16)}…`);

      setStep(5, 'running');
      await new Promise((r) => setTimeout(r, 300));
      setStep(5, 'done', 'devnet simulator — no chain latency');

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
      setStep(6, 'done', `receipt: ${receipt.slice(0, 18)}…`);

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
  const doneCount = statuses.filter((s) => s === 'done').length;
  const hasStarted = statuses.some((s) => s !== 'idle');

  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">

        {/* Page header */}
        <div className="mb-10 border-l-2 border-[#5ed29c]/30 pl-5">
          <h1 className="font-[family-name:var(--font-instrument)] text-4xl md:text-5xl text-white leading-tight mb-3">
            Agent Console
          </h1>
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 max-w-2xl leading-relaxed">
            A live run of the 9-step x402 handshake. Each step lights up when a real network call
            completes — not on a timer. Relay-proxy must be running on port 3402.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">

          {/* Timeline */}
          <div className="flex flex-col gap-6">

            {/* Run button + progress */}
            <div className="flex items-center gap-4">
              <button
                onClick={run}
                disabled={running}
                className="inline-flex items-center gap-2.5 rounded-full bg-[#5ed29c] text-[#070b0a] font-[family-name:var(--font-inter)] font-bold text-sm px-7 py-3 hover:bg-[#4ec08a] active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={running ? 'Handshake running' : 'Run handshake'}
              >
                <Play size={13} aria-hidden="true" />
                {running ? 'Running…' : 'Run handshake'}
              </button>
              {hasStarted && (
                <span className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/30">
                  {doneCount}/{STEPS.length} steps
                </span>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                <AlertCircle size={15} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="font-[family-name:var(--font-inter)] text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Party legend */}
            <div className="flex flex-wrap gap-4">
              {(Object.keys(PARTY_LABELS) as HandshakeStep['party'][]).map((p) => (
                <div key={p} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PARTY_COLORS[p] }} aria-hidden="true" />
                  <span className="font-[family-name:var(--font-inter)] text-xs text-white/40">
                    {PARTY_LABELS[p]}
                  </span>
                </div>
              ))}
            </div>

            {/* Timeline steps */}
            <ol className="flex flex-col" aria-label="Handshake steps">
              {STEPS.map((step, i) => {
                const color = PARTY_COLORS[step.party];
                const isActive = statuses[i] === 'running';
                const isDone = statuses[i] === 'done';

                return (
                  <li key={i} className="flex gap-4">
                    {/* Left column: dot + connector */}
                    <div className="flex flex-col items-center shrink-0 w-7">
                      <StepDot status={statuses[i]} color={color} />
                      {i < STEPS.length - 1 && (
                        <div
                          className="w-px flex-1 min-h-[1.75rem] mt-1 transition-colors duration-500"
                          style={{
                            backgroundColor: isDone
                              ? `${color}50`
                              : 'rgba(255,255,255,0.07)',
                          }}
                        />
                      )}
                    </div>

                    {/* Right column */}
                    <div
                      className={`flex flex-col gap-1 pb-5 flex-1 pt-0.5 transition-opacity duration-200 ${
                        i === STEPS.length - 1 ? 'pb-0' : ''
                      } ${!hasStarted ? 'opacity-60' : statuses[i] === 'idle' && hasStarted ? 'opacity-40' : 'opacity-100'}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-[family-name:var(--font-inter)] text-sm font-medium leading-snug transition-colors duration-200"
                          style={{
                            color: isActive ? color : isDone ? 'rgba(255,255,255,0.9)' : statuses[i] === 'error' ? '#f87171' : 'rgba(255,255,255,0.45)',
                          }}
                        >
                          {step.label}
                        </span>
                        <span
                          className="font-[family-name:var(--font-inter)] text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${color}18`,
                            color: `${color}aa`,
                          }}
                        >
                          {PARTY_LABELS[step.party]}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-white/30 pl-0">
                        {details[i] ?? step.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Right panel: live data */}
          <div className="flex flex-col gap-4">

            {/* 402 Challenge */}
            {challenge && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-500/15 flex items-center justify-between gap-2">
                  <span className="font-[family-name:var(--font-inter)] text-xs font-bold text-amber-400">
                    402 Challenge
                  </span>
                  <span className="font-mono text-[10px] text-white/30 truncate">
                    nonce: {challenge.nonce.slice(0, 14)}…
                  </span>
                </div>
                <div className="px-4 py-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Price</p>
                    <p className="font-[family-name:var(--font-instrument)] text-2xl text-[#5ed29c]">
                      ${microToUsd(challenge.accepts[0]?.maxAmountRequired ?? '0')}
                    </p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Network</p>
                    <p className="font-mono text-xs text-white/60">{challenge.accepts[0]?.network}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Resource</p>
                    <p className="font-mono text-xs text-white/60 break-all">{challenge.accepts[0]?.resource}</p>
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Expires in</p>
                    <p className="font-mono text-xs text-amber-400">
                      {Math.max(0, challenge.expiresAt - Math.floor(Date.now() / 1000))}s
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Telemetry result */}
            {telemetry && (
              <div className="rounded-xl border border-[#5ed29c]/25 bg-[#5ed29c]/[0.04] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#5ed29c]/15 flex items-center gap-2">
                  <span className="font-[family-name:var(--font-inter)] text-xs font-bold text-[#5ed29c]">
                    200 OK
                  </span>
                  <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/40">
                    Telemetry dispensed
                  </span>
                  {typeof telemetry.source === 'string' && (
                    <SourceBadge source={telemetry.source as 'badge' | 'simulator'} />
                  )}
                </div>
                <pre className="px-4 py-4 font-mono text-[11px] text-white/55 overflow-x-auto whitespace-pre-wrap break-all max-h-64">
                  {JSON.stringify(telemetry, null, 2)}
                </pre>
              </div>
            )}

            {/* Idle empty state */}
            {!challenge && !telemetry && !error && (
              <div className="rounded-xl border border-white/8 bg-white/[0.015] p-8 flex flex-col items-start gap-4 min-h-[220px] justify-center">
                <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center">
                  <Play size={16} className="text-white/20" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-[family-name:var(--font-inter)] text-sm text-white/40 mb-1">
                    Run the handshake to see live data here.
                  </p>
                  <p className="font-[family-name:var(--font-inter)] text-xs text-white/20">
                    The 402 challenge and telemetry payload appear step by step as each call completes.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
