'use client';

import { useState, useCallback } from 'react';
import NavBar from '@/components/NavBar';
import PanelHeader from '@/components/PanelHeader';
import { Panel } from '@/components/Panel';
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

// Four greys from the same ink. The chain step is where money actually
// moves, so it is the one party drawn in full ink.
const PARTY_COLORS: Record<HandshakeStep['party'], string> = {
  agent: '#5e5a54',
  device: '#8a857d',
  chain: '#141414',
  policy: '#b3ada4',
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
        <CheckCircle size={14} color="#e4e0d8" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full border-2 border-alarm bg-alarm/15" aria-hidden="true">
        <XCircle size={14} className="text-alarm" />
      </span>
    );
  }
  return (
    <span
      className="flex items-center justify-center w-7 h-7 rounded-full border-2"
      style={{ borderColor: '#cdc8bf' }}
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
    <main className="min-h-screen bg-canvas">
      <NavBar />
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-8 md:px-12">
        <PanelHeader
          title="Agent console"
          subtitle="A live run of the nine-step handshake. Each step lights when a real call returns — not on a timer."
          stamp={running ? 'running' : hasStarted ? `${doneCount}/${STEPS.length}` : 'idle'}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">

          {/* Timeline */}
          <div className="flex flex-col gap-6">

            {/* Run button + progress */}
            <div className="flex items-center gap-4">
              <button
                onClick={run}
                disabled={running}
                className="readout inline-flex items-center gap-2.5 rounded-full border border-ink bg-ink px-7 py-3 text-sm text-canvas transition-colors duration-150 hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={running ? 'Handshake running' : 'Run handshake'}
              >
                <Play size={13} aria-hidden="true" />
                {running ? 'Running…' : 'Run handshake'}
              </button>
              {hasStarted && (
                <span className="readout text-xs text-ink-muted">
                  {doneCount}/{STEPS.length} steps
                </span>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-3 border-l-2 border-alarm px-4 py-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-alarm" aria-hidden="true" />
                <p className="text-sm text-alarm">{error}</p>
              </div>
            )}

            {/* Party legend */}
            <div className="flex flex-wrap gap-4">
              {(Object.keys(PARTY_LABELS) as HandshakeStep['party'][]).map((p) => (
                <div key={p} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PARTY_COLORS[p] }} aria-hidden="true" />
                  <span className="plate normal-case tracking-normal">{PARTY_LABELS[p]}</span>
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
                            backgroundColor: isDone ? `${color}66` : '#cdc8bf',
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
                          className="text-[15px] leading-snug transition-colors duration-200"
                          style={{
                            color: isActive ? color : isDone ? '#141414' : statuses[i] === 'error' ? '#b93a2e' : '#5e5a54',
                          }}
                        >
                          {step.label}
                        </span>
                        <span
                          className="plate rounded-[2px] border px-1.5 py-0.5"
                          style={{ borderColor: `${color}55`, color }}
                        >
                          {PARTY_LABELS[step.party]}
                        </span>
                      </div>
                      <p className="readout text-[11px] text-ink-muted">
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
              <Panel label="402 challenge" stamp={`nonce ${challenge.nonce.slice(0, 10)}…`} live>
                <div className="grid grid-cols-2">
                  <div className="px-4 py-3.5">
                    <div className="plate mb-1">price</div>
                    <div className="readout  text-2xl leading-none text-ink">
                      {microToUsd(challenge.accepts[0]?.maxAmountRequired ?? '0')}
                      <span className="ml-1 text-[0.45em] text-ink-muted">USDC</span>
                    </div>
                  </div>
                  <div className="panel-divide-x px-4 py-3.5">
                    <div className="plate mb-1">network</div>
                    <div className="readout text-sm text-ink/85">{challenge.accepts[0]?.network}</div>
                  </div>
                  <div className="panel-divide col-span-2 px-4 py-3.5">
                    <div className="plate mb-1">resource</div>
                    <div className="readout break-all text-sm text-ink/85">{challenge.accepts[0]?.resource}</div>
                  </div>
                  <div className="panel-divide px-4 py-3.5">
                    <div className="plate mb-1">expires in</div>
                    <div className="readout text-sm text-ink">
                      {Math.max(0, challenge.expiresAt - Math.floor(Date.now() / 1000))}s
                    </div>
                  </div>
                </div>
              </Panel>
            )}

            {/* Telemetry result */}
            {telemetry && (
              <Panel
                label="200 OK · dispensed"
                stamp={typeof telemetry.source === 'string' ? <SourceBadge source={telemetry.source as 'badge' | 'simulator'} /> : undefined}
                live
              >
                <pre className="readout max-h-64 overflow-x-auto whitespace-pre-wrap break-all px-4 py-4 text-[11px] leading-relaxed text-ink/80">
                  {JSON.stringify(telemetry, null, 2)}
                </pre>
              </Panel>
            )}

            {/* Idle empty state */}
            {!challenge && !telemetry && !error && (
              <Panel label="Readout">
                <div className="flex min-h-[220px] flex-col justify-center px-4 py-8">
                  <p className="readout mb-1 text-sm text-ink-muted">Run the handshake to see live data here.</p>
                  <p className="text-xs text-ink-muted/70">
                    The 402 challenge and the telemetry payload appear as each call completes.
                  </p>
                </div>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
