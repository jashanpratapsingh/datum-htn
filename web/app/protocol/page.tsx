import PageShell from '@/components/PageShell';
import { fetchChallenge } from '@/lib/relay';
import type { PaymentRequiredBody } from '@vendx/protocol';
import { microUsdcToUsd } from '@vendx/protocol';

function Field({ label, value, mono = false, accent = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-[family-name:var(--font-inter)] text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </span>
      <span
        className={`font-[family-name:var(--font-inter)] text-sm break-all ${
          mono ? 'font-mono' : ''
        } ${accent ? 'text-[#5ed29c]' : 'text-white/80'}`}
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02]">
        <p className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/60 uppercase tracking-wider">
          {title}
        </p>
      </div>
      <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

function ChallengeDecoded({ challenge }: { challenge: PaymentRequiredBody }) {
  const req = challenge.accepts[0];
  const priceUsd = microUsdcToUsd(req.maxAmountRequired);
  const expires = new Date(challenge.expiresAt * 1000);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold font-[family-name:var(--font-inter)] uppercase tracking-wider">
          HTTP 402 Payment Required
        </span>
        <span className="font-[family-name:var(--font-inter)] text-xs text-white/30">
          live — fetched just now
        </span>
      </div>

      <Section title="Envelope">
        <Field label="x402Version" value={challenge.x402Version} />
        <Field label="error" value={challenge.error} />
        <Field label="nonce" value={challenge.nonce} mono accent />
        <Field
          label="expiresAt"
          value={`${challenge.expiresAt} — ${expires.toISOString()}`}
        />
      </Section>

      <Section title="Payment requirements — accepts[0]">
        <Field label="scheme" value={req.scheme} />
        <Field label="network" value={req.network} accent />
        <Field
          label="maxAmountRequired"
          value={`${req.maxAmountRequired} µUSDC = $${priceUsd.toFixed(6)}`}
          accent
        />
        <Field label="resource" value={req.resource} mono />
        <Field label="description" value={req.description} />
        <Field label="mimeType" value={req.mimeType} mono />
        <Field label="payTo (wallet owner, not ATA)" value={req.payTo} mono />
        <Field label="asset (USDC mint)" value={req.asset} mono />
        <Field label="maxTimeoutSeconds" value={req.maxTimeoutSeconds} />
      </Section>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
        <p className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">
          Raw JSON
        </p>
        <pre className="font-mono text-[11px] text-white/50 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(challenge, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function StaticSection({
  title,
  badge,
  children,
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#5ed29c]/10 border border-[#5ed29c]/20 text-[#5ed29c] text-xs font-bold font-[family-name:var(--font-inter)] uppercase tracking-wider">
          {badge}
        </span>
        <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-lg text-white">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

export default async function ProtocolPage() {
  const challengeResult = await fetchChallenge();

  return (
    <PageShell
      title="Protocol Explorer"
      subtitle="Inspect a real 402 challenge field by field, then follow the payment to receipt."
    >
      <div className="flex flex-col gap-16">

        {/* Step 1 — 402 challenge */}
        <StaticSection title="HTTP 402 Challenge" badge="Step 1">
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-4">
            The device advertises what it sells and what it costs. The nonce is single-use — a new
            one is minted for every request. The buyer must consume it before{' '}
            <code className="text-[#5ed29c] text-xs">expiresAt</code>.
          </p>

          {challengeResult.ok ? (
            <ChallengeDecoded challenge={challengeResult.data} />
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="font-[family-name:var(--font-inter)] text-xs text-white/30 uppercase tracking-wider mb-2">
                {challengeResult.reason === 'offline' ? 'Relay offline' : 'Challenge unavailable'}
              </p>
              <p className="font-[family-name:var(--font-inter)] text-sm text-white/50">
                Start relay-proxy to fetch a live challenge.
              </p>
            </div>
          )}
        </StaticSection>

        {/* Step 2 — X-PAYMENT header */}
        <StaticSection title="X-PAYMENT Header" badge="Step 2">
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-4">
            The buyer sends this with their replay request — base64url of canonical JSON. The nonce
            echoes the challenge and the signature proves the transfer settled on-chain.
          </p>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
            <pre className="font-mono text-[11px] text-white/60 whitespace-pre-wrap break-all">{`{
  "x402Version": 1,
  "scheme": "exact",
  "network": "solana-devnet",
  "payload": {
    "signature": "<base58 settled Solana tx>",
    "nonce":     "<hex — echoes the challenge nonce>"
  }
}`}</pre>
            <p className="font-[family-name:var(--font-inter)] text-xs text-white/30 mt-3">
              Header: <code className="text-[#5ed29c]">X-PAYMENT: &lt;base64url of the above&gt;</code>
            </p>
          </div>
        </StaticSection>

        {/* Step 3 — Signed receipt */}
        <StaticSection title="Signed Receipt (VENDX extension)" badge="Step 3">
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-4">
            The relay settles on-chain and signs a receipt with its Ed25519 facilitator key. The
            device holds one 32-byte public key and verifies offline in ~40ms — no TLS, no RPC, no
            heap spike. The signature covers the base64url text as transmitted, so the device never
            re-serializes JSON to verify.
          </p>
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
              <p className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                Receipt body (base64url JSON)
              </p>
              <pre className="font-mono text-[11px] text-white/60 whitespace-pre-wrap break-all">{`{
  "v": 1,
  "nonce":     "<hex — the challenge nonce>",
  "payTo":     "<vendor wallet base58>",
  "amount":    "<micro-USDC string>",
  "signature": "<base58 Solana tx>",
  "network":   "solana-devnet",
  "issuedAt":  <unix seconds>,
  "expiresAt": <unix seconds>
}`}</pre>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
              <p className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                Wire format — header value
              </p>
              <code className="font-mono text-xs text-[#5ed29c] break-all">
                X-Payment-Receipt: {'<body_b64url>.<sig_b64url>'}
              </code>
            </div>
          </div>
        </StaticSection>

        {/* Step 4 — What the device checks */}
        <StaticSection title="Device Verification Checklist" badge="Step 4">
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-4">
            The ESP32 runs these checks in order. Any failure returns 402 with a specific{' '}
            <code className="text-[#5ed29c] text-xs">error</code> field.
          </p>
          <ol className="flex flex-col gap-3">
            {[
              ['ed25519_verify(FACILITATOR_PUBKEY, receipt.body)', 'Proves relay signed it'],
              ['nonce ∈ issued_nonces', 'Proves this challenge was ours'],
              ['nonce not already used', 'Replay defence without state'],
              ['receipt.expiresAt > now', 'Expires within maxTimeoutSeconds'],
              ['receipt.payTo == VENDOR_WALLET', 'Payment went to us, not redirected'],
              ['receipt.amount ≥ price', 'Full price paid, not discounted'],
              ['receipt.network == expected_network', 'Right chain'],
            ].map(([check, why], i) => (
              <li key={i} className="flex items-start gap-4">
                <span className="font-[family-name:var(--font-inter)] text-[#5ed29c] text-xs font-bold w-5 shrink-0 mt-0.5">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-col gap-0.5">
                  <code className="font-mono text-xs text-white/70">{check}</code>
                  <span className="font-[family-name:var(--font-inter)] text-xs text-white/30">
                    {why}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </StaticSection>

        {/* Failure codes */}
        <StaticSection title="Failure Reasons" badge="types.ts">
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-4">
            Every failure has a machine-readable reason defined in{' '}
            <code className="text-[#5ed29c] text-xs">packages/vendx-protocol/src/types.ts</code>{' '}
            and mirrored in{' '}
            <code className="text-[#5ed29c] text-xs">firmware-vendor/src/verifier.cpp</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              'missing_header',
              'malformed_header',
              'bad_signature',
              'nonce_unknown',
              'nonce_replayed',
              'nonce_expired',
              'wrong_recipient',
              'insufficient_amount',
              'wrong_network',
              'receipt_expired',
            ].map((code) => (
              <code
                key={code}
                className="font-mono text-xs text-white/50 border border-white/10 rounded px-2 py-1"
              >
                {code}
              </code>
            ))}
          </div>
        </StaticSection>
      </div>
    </PageShell>
  );
}
