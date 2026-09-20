'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PanelHeader from '@/components/PanelHeader';
import NavBar from '@/components/NavBar';
import { Panel } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { SourceBadge } from '@/components/SourceBadge';
import { Play, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { PaymentRequiredBody } from '@vendx/protocol';
import { RELAYS, MULTI_RELAY, type RelayInfo } from '@/lib/relays';

function microToUsd(micro: string): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface HandshakeStep {
  label: string;
  detail?: string;
  party: 'agent' | 'device' | 'chain' | 'policy';
}

/** Nine steps, each lit by a real call returning from /api/buy — never a timer. */
const STEPS: HandshakeStep[] = [
  { label: 'Agent requests sensor data', detail: 'GET /api/telemetry', party: 'agent' },
  { label: 'Device issues 402 challenge', detail: 'nonce minted, 300 s TTL', party: 'device' },
  { label: 'Web spend guard checks the offer', detail: 'devnet USDC · ≤ $0.10 · 5/min', party: 'policy' },
  { label: 'Guard approved', detail: 'payTo is the vendor wallet', party: 'policy' },
  { label: 'USDC transferChecked + memo = nonce', detail: 'signed by the shared devnet wallet', party: 'chain' },
  { label: 'Solana confirms transaction', detail: 'confirmed commitment', party: 'chain' },
  { label: 'Relay verifies on-chain, signs receipt', detail: 'POST /settle · attributed to you', party: 'agent' },
  { label: 'Device verifies offline', detail: 'Ed25519 + nonce burn ~40 ms', party: 'device' },
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
  policy: 'Guard',
};

interface BuyResult {
  relay: string;
  challenge: PaymentRequiredBody;
  signature: string;
  solscanUrl: string;
  payer: string;
  receipt: string;
  attribution: string;
  telemetry: Record<string, unknown>;
}

interface RunState {
  statuses: StepStatus[];
  details: (string | null)[];
  challenge?: PaymentRequiredBody;
  result?: BuyResult;
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
        <span className="w-2 h-2 rounded-full animate-ping absolute" style={{ backgroundColor: color, opacity: 0.6 }} />
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full" style={{ backgroundColor: color }} aria-hidden="true">
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
  return <span className="flex items-center justify-center w-7 h-7 rounded-full border-2" style={{ borderColor: '#cdc8bf' }} aria-hidden="true" />;
}

type StreamLine =
  | { step: number; status: StepStatus; detail?: string }
  | { done: true; result: BuyResult }
  | { done: true; error: string; message: string; step: number };

const ERROR_COPY: Record<string, string> = {
  relay_offline: 'The relay is offline. Nothing was charged.',
  unexpected_status: 'The relay did not answer with a 402. Nothing was charged.',
  not_payable: 'The offer is outside what the shared wallet may pay for. Nothing was charged.',
  buyer_unfunded: 'The shared devnet wallet needs funding. Nothing was charged.',
  buyer_unconfigured: 'This deployment has no shared wallet configured.',
  confirm_timeout: 'Devnet did not confirm in time. The transfer may still land; check Solscan before retrying.',
  settle_failed: 'Paid, but the relay refused to settle. The payment is on-chain; the relay reason is above.',
  device_rejected: 'Paid and settled, but the device rejected the receipt.',
  rate_limited: 'Slow down: five purchases a minute per account.',
  unauthenticated: 'Sign in to buy with the shared wallet.',
};

export interface Viewer {
  id: string;
  name: string;
}

export default function AgentConsole({ viewer, authConfigured }: { viewer: Viewer | null; authConfigured: boolean }) {
  const [state, setState] = useState<RunState>(initialState());
  const [running, setRunning] = useState(false);
  // The 402 and the settlement must go to the same relay: nonces live in
  // that relay's store only. The picker chooses the vendor for the whole run.
  const [relay, setRelay] = useState<RelayInfo>(RELAYS[0]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setStep = useCallback((i: number, status: StepStatus, detail?: string) => {
    if (!alive.current) return;
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
    try {
      const res = await fetch('/api/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay: relay.key }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; retryAfter?: number };
        const code = body.error ?? `http_${res.status}`;
        setStep(0, 'error', code);
        setState((p) => ({ ...p, error: `${ERROR_COPY[code] ?? body.message ?? `HTTP ${res.status}`}${body.retryAfter ? ` Retry in ${body.retryAfter} s.` : ''}` }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const handle = (line: StreamLine) => {
        if ('done' in line) {
          if ('result' in line) {
            setState((p) => ({ ...p, challenge: line.result.challenge, result: line.result }));
          } else {
            setState((p) => ({ ...p, error: `${ERROR_COPY[line.error] ?? line.error}${line.message ? ` (${line.message})` : ''}` }));
          }
          return;
        }
        setStep(line.step, line.status, line.detail);
        if (line.step === 1 && line.status === 'done') {
          // The challenge itself arrives with the final result; show the detail meanwhile.
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handle(JSON.parse(line) as StreamLine);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (alive.current) setState((p) => ({ ...p, error: msg }));
    } finally {
      if (alive.current) setRunning(false);
    }
  }, [relay, setStep]);

  const { statuses, details, challenge, result, error } = state;
  const telemetry = result?.telemetry;
  const doneCount = statuses.filter((s) => s === 'done').length;
  const hasStarted = statuses.some((s) => s !== 'idle');

  return (
    <main className="min-h-screen bg-canvas">
      <NavBar />
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-8 md:px-12">
        <PanelHeader
          title="Agent console"
          subtitle="A live run of the nine-step handshake, paid with real devnet USDC from the site's shared wallet. Each step lights when a real call returns — not on a timer."
          stamp={running ? 'running' : hasStarted ? `${doneCount}/${STEPS.length}` : viewer ? 'ready' : 'sign in to run'}
        />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
          {/* Timeline */}
          <div className="flex flex-col gap-6">
            {MULTI_RELAY && (
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Relay">
                <span className="plate mr-1">relay</span>
                {RELAYS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    role="radio"
                    aria-checked={r.key === relay.key}
                    disabled={running}
                    onClick={() => setRelay(r)}
                    title={r.url}
                    className={`readout rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed ${
                      r.key === relay.key ? 'border-ink bg-ink text-canvas' : 'border-rule text-ink-muted hover:border-ink hover:text-ink'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4">
              {viewer ? (
                <button
                  onClick={run}
                  disabled={running}
                  className="readout inline-flex items-center gap-2.5 rounded-full border border-ink bg-ink px-7 py-3 text-sm text-canvas transition-colors duration-150 hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={running ? 'Handshake running' : 'Run handshake'}
                >
                  <Play size={13} aria-hidden="true" />
                  {running ? 'Running…' : 'Run handshake'}
                </button>
              ) : (
                <Pill href={authConfigured ? '/login?next=%2Fagent' : '/protocol'}>{authConfigured ? 'Sign in to run' : 'Accounts not configured — read the protocol'}</Pill>
              )}
              {hasStarted && (
                <span className="readout text-xs text-ink-muted">
                  {doneCount}/{STEPS.length} steps
                </span>
              )}
              {viewer && !hasStarted && (
                <span className="readout text-xs text-ink-muted">as {viewer.name} · about $0.0001 per run</span>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-3 border-l-2 border-alarm px-4 py-2">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-alarm" aria-hidden="true" />
                <p className="text-sm text-alarm">{error}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              {(Object.keys(PARTY_LABELS) as HandshakeStep['party'][]).map((p) => (
                <div key={p} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PARTY_COLORS[p] }} aria-hidden="true" />
                  <span className="plate normal-case tracking-normal">{PARTY_LABELS[p]}</span>
                </div>
              ))}
            </div>

            <ol className="flex flex-col" aria-label="Handshake steps">
              {STEPS.map((step, i) => {
                const color = PARTY_COLORS[step.party];
                const isActive = statuses[i] === 'running';
                const isDone = statuses[i] === 'done';
                return (
                  <li key={i} className="flex gap-4">
                    <div className="flex flex-col items-center shrink-0 w-7">
                      <StepDot status={statuses[i]} color={color} />
                      {i < STEPS.length - 1 && (
                        <div className="w-px flex-1 min-h-[1.75rem] mt-1 transition-colors duration-500" style={{ backgroundColor: isDone ? `${color}66` : '#cdc8bf' }} />
                      )}
                    </div>
                    <div
                      className={`flex flex-col gap-1 pb-5 flex-1 pt-0.5 transition-opacity duration-200 ${i === STEPS.length - 1 ? 'pb-0' : ''} ${
                        !hasStarted ? 'opacity-60' : statuses[i] === 'idle' && hasStarted ? 'opacity-40' : 'opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[15px] leading-snug transition-colors duration-200"
                          style={{ color: isActive ? color : isDone ? '#141414' : statuses[i] === 'error' ? '#b93a2e' : '#5e5a54' }}
                        >
                          {step.label}
                        </span>
                        <span className="plate rounded-[2px] border px-1.5 py-0.5" style={{ borderColor: `${color}55`, color }}>
                          {PARTY_LABELS[step.party]}
                        </span>
                      </div>
                      <p className="readout text-[11px] text-ink-muted">{details[i] ?? step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Right panel: live data */}
          <div className="flex flex-col gap-4">
            {challenge && (
              <Panel label="402 challenge" stamp={`nonce ${challenge.nonce.slice(0, 10)}…`} live>
                <div className="grid grid-cols-2">
                  <div className="px-4 py-3.5">
                    <div className="plate mb-1">price</div>
                    <div className="readout text-2xl leading-none text-ink">
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
                  <div className="panel-divide col-span-2 px-4 py-3.5">
                    <div className="plate mb-1">payTo · wallet owner, not the ATA</div>
                    <div className="readout break-all text-sm text-ink/85">{challenge.accepts[0]?.payTo}</div>
                  </div>
                </div>
              </Panel>
            )}

            {result && (
              <Panel label="Paid" stamp={result.attribution === 'web' ? 'recorded to your account' : result.attribution} live>
                <div className="paper m-3 px-4 py-3">
                  <div className="readout flex justify-between gap-4 text-[13px]">
                    <span className="truncate text-ink">{result.signature}</span>
                    <span className="shrink-0 tabular-nums text-ink">{microToUsd(result.challenge.accepts[0]?.maxAmountRequired ?? '0')}</span>
                  </div>
                  <div className="readout mt-1 flex justify-between gap-4 text-[11px] text-ink-muted">
                    <span className="truncate">payer {result.payer.slice(0, 8)}… · shared devnet wallet</span>
                    <a href={result.solscanUrl} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2 hover:text-ink-muted">
                      solscan
                    </a>
                  </div>
                </div>
                <p className="panel-divide px-4 py-2.5 text-[12px] text-ink-muted">
                  This purchase is now listed under <a href="/account" className="text-ink underline underline-offset-2">your account</a>, on the marketplace and in the ledger.
                </p>
              </Panel>
            )}

            {telemetry && (
              <Panel
                label="200 OK · dispensed"
                stamp={typeof telemetry.source === 'string' ? <SourceBadge source={telemetry.source as 'badge' | 'simulator' | 'esp32c3'} /> : undefined}
                live
              >
                <pre className="readout max-h-64 overflow-x-auto whitespace-pre-wrap break-all px-4 py-4 text-[11px] leading-relaxed text-ink/80">
                  {JSON.stringify(telemetry, null, 2)}
                </pre>
              </Panel>
            )}

            {!challenge && !telemetry && !error && (
              <Panel label="Readout">
                <div className="flex min-h-[220px] flex-col justify-center px-4 py-8">
                  {viewer ? (
                    <>
                      <p className="readout mb-1 text-sm text-ink-muted">Run the handshake to see live data here.</p>
                      <p className="text-xs text-ink-muted/70">The 402 challenge, the Solscan link and the telemetry payload appear as each call completes.</p>
                    </>
                  ) : (
                    <>
                      <p className="readout mb-1 text-sm text-ink-muted">Sign in to buy a reading from this page.</p>
                      <p className="text-xs text-ink-muted/70">
                        The site pays from a shared devnet wallet and records the purchase to your account. To buy from your own
                        agent, register one under Account and use the MCP server.
                      </p>
                    </>
                  )}
                </div>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
