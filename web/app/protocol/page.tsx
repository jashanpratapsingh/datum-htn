import PageShell from '@/components/PageShell';
import { Panel } from '@/components/Panel';
import { fetchChallenge, MULTI_RELAY } from '@/lib/relay';
import type { PaymentRequiredBody } from '@vendx/protocol';
import { microUsdcToUsd } from '@vendx/protocol';

function Field({ label, value, money = false }: { label: string; value: React.ReactNode; money?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className="plate mb-1">{label}</div>
      <div className={`readout break-all text-sm ${money ? 'text-ink' : 'text-ink/85'}`}>{value}</div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 [&>*:nth-child(n+2)]:panel-divide md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(even)]:panel-divide-x">{children}</div>;
}

function ChallengeDecoded({ challenge }: { challenge: PaymentRequiredBody }) {
  const req = challenge.accepts[0];
  return (
    <div className="flex flex-col gap-4">
      <Panel label="Envelope" stamp="HTTP 402 · live" live>
        <Grid>
          <Field label="x402Version" value={challenge.x402Version} />
          <Field label="error" value={challenge.error} />
          <Field label="nonce" value={challenge.nonce} />
          <Field label="expiresAt" value={`${challenge.expiresAt} — ${new Date(challenge.expiresAt * 1000).toISOString()}`} />
        </Grid>
      </Panel>
      <Panel label="accepts[0]">
        <Grid>
          <Field label="scheme" value={req.scheme} />
          <Field label="network" value={req.network} />
          <Field label="maxAmountRequired" value={`${req.maxAmountRequired} µUSDC = ${microUsdcToUsd(req.maxAmountRequired).toFixed(6)} USDC`} money />
          <Field label="maxTimeoutSeconds" value={req.maxTimeoutSeconds} />
          <Field label="resource" value={req.resource} />
          <Field label="mimeType" value={req.mimeType} />
          <Field label="payTo — wallet owner, not the ATA" value={req.payTo} />
          <Field label="asset — USDC mint" value={req.asset} />
        </Grid>
      </Panel>
      <Panel label="Raw">
        <pre className="readout overflow-x-auto whitespace-pre-wrap break-all px-4 py-4 text-[11px] leading-relaxed text-ink-muted">
          {JSON.stringify(challenge, null, 2)}
        </pre>
      </Panel>
    </div>
  );
}

/*
  The `badge` span is asserted by the route test: exactly four spans whose text
  is exactly "Step 1".."Step 4". Keep it a bare <span> with that exact text.
*/
function Step({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 border-b border-rule pb-3">
        <span className="readout text-xs text-ink">{badge}</span>
        <h2 className="text-xl text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <pre className="readout whitespace-pre-wrap break-all px-4 py-4 text-[12px] leading-relaxed text-ink/85">{children}</pre>
);

const CHECKS: [string, string][] = [
  ['ed25519_verify(FACILITATOR_PUBKEY, receipt.body)', 'the relay signed it'],
  ['nonce ∈ issued_nonces', 'this challenge was ours'],
  ['nonce not already used', 'replay defence, without a database'],
  ['receipt.expiresAt > now', 'still inside maxTimeoutSeconds'],
  ['receipt.payTo == VENDOR_WALLET', 'paid to us, not redirected'],
  ['receipt.amount ≥ price', 'full price, not discounted'],
  ['receipt.network == expected', 'the right chain'],
];

const FAILURES = ['missing_header','malformed_header','bad_signature','nonce_unknown','nonce_replayed','nonce_expired','wrong_recipient','insufficient_amount','wrong_network','receipt_expired'];

export default async function ProtocolPage() {
  const ch = await fetchChallenge();

  return (
    <PageShell
      title="Protocol explorer"
      subtitle="Take a real 402 apart field by field, then follow the payment through to the receipt the device checks."
      stamp={ch.ok ? (MULTI_RELAY ? `live challenge · ${ch.data.relay.label}` : 'live challenge') : 'no link'}
    >
      <div className="flex flex-col gap-14">
        <Step title="The device says what it costs" badge="Step 1">
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink/80">
            The 402 advertises what is for sale and the price. The nonce is single-use — a fresh one
            is minted per request and must be spent before <span className="readout text-ink">expiresAt</span>.
          </p>
          {ch.ok ? (
            <ChallengeDecoded challenge={ch.data.challenge} />
          ) : (
            <Panel label={ch.reason === 'offline' ? 'no relay link' : 'challenge unavailable'}>
              <p className="readout px-4 py-10 text-center text-sm text-ink-muted">
                Start relay-proxy to fetch a live challenge.
              </p>
            </Panel>
          )}
        </Step>

        <Step title="The buyer proves it paid" badge="Step 2">
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink/80">
            Sent with the replay request as base64url of canonical JSON. The nonce echoes the challenge;
            the signature is the settled Solana transaction.
          </p>
          <Panel label="X-PAYMENT">
            <Code>{`{
  "x402Version": 1,
  "scheme":      "exact",
  "network":     "solana-devnet",
  "payload": {
    "signature": "<base58 settled Solana tx>",
    "nonce":     "<hex — echoes the challenge nonce>"
  }
}`}</Code>
          </Panel>
        </Step>

        <Step title="The relay signs a receipt" badge="Step 3">
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink/80">
            The relay settles on-chain and signs a receipt with its Ed25519 key. The device holds one
            32-byte public key and verifies offline in about 40ms — no TLS, no RPC, no heap spike. The
            signature covers the base64url text exactly as transmitted, so the device never has to
            re-serialise JSON to check it.
          </p>
          <Panel label="Receipt body" stamp="base64url JSON">
            <Code>{`{
  "v":         1,
  "nonce":     "<hex — the challenge nonce>",
  "payTo":     "<vendor wallet, base58>",
  "amount":    "<micro-USDC, string>",
  "signature": "<base58 Solana tx>",
  "network":   "solana-devnet",
  "issuedAt":  <unix seconds>,
  "expiresAt": <unix seconds>
}`}</Code>
            <div className="panel-divide px-4 py-3">
              <div className="plate mb-1">on the wire</div>
              <code className="readout break-all text-xs text-ink">X-Payment-Receipt: {'<body_b64url>.<sig_b64url>'}</code>
            </div>
          </Panel>
        </Step>

        <Step title="What the device checks" badge="Step 4">
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink/80">
            In this order. Any failure returns 402 with a specific <span className="readout text-ink">error</span>.
            Signature comes first, so nothing about live nonces leaks to anyone without a valid one.
          </p>
          <Panel label="Verification order">
            <ol>
              {CHECKS.map(([check, why], i) => (
                <li key={check} className={`flex items-baseline gap-4 px-4 py-3 ${i > 0 ? 'panel-divide' : ''}`}>
                  <span className="readout w-5 shrink-0 text-xs text-ink-muted">{i + 1}</span>
                  <div>
                    <code className="readout text-xs text-ink">{check}</code>
                    <div className="text-xs text-ink-muted">{why}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </Step>

        <Step title="Every way it can fail" badge="types.ts">
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink/80">
            Each reason is defined once in <span className="readout text-ink">packages/vendx-protocol/src/types.ts</span> and
            mirrored in <span className="readout text-ink">firmware-vendor/src/verifier.cpp</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            {FAILURES.map((f) => (
              <code key={f} className="readout border border-rule px-2 py-1 text-xs text-ink/80">{f}</code>
            ))}
          </div>
        </Step>
      </div>
    </PageShell>
  );
}
