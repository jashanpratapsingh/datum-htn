import PageShell from '@/components/PageShell';

const REPO = 'https://github.com/jashanpratapsingh/datum-htn/blob/feat/vendx-architecture-gamma';

const DOCS = [
  { title: 'Architecture', path: 'docs/ARCHITECTURE.md', desc: 'System map, the seven surfaces, the handshake, the trust model.' },
  { title: 'Protocol', path: 'docs/PROTOCOL.md', desc: 'Wire format — 402 challenge, X-PAYMENT, signed receipt — and why we diverge from @x402-solana.' },
  { title: 'Badge', path: 'docs/BADGE.md', desc: 'The real ESP32-C3 badge: hardware, memory, console API, and what it refuses to do.' },
  { title: 'Demo', path: 'docs/DEMO.md', desc: 'A three-minute demo script, with and without hardware attached.' },
  { title: 'API', path: 'docs/API.md', desc: 'relay-proxy endpoints, request and response shapes, error codes.' },
  { title: 'Features', path: 'docs/FEATURES.md', desc: 'The product surface beyond the hero — what each page has to prove.' },
  { title: 'Frontend brief', path: 'docs/FRONTEND_BRIEF.md', desc: 'Hero spec, palette, type, the accessibility floor, and this redesign.' },
  { title: 'Runbook', path: 'docs/RUNBOOK.md', desc: 'Node, npm run demo, Supabase, Vercel, firmware, troubleshooting.' },
  { title: 'Build board', path: 'docs/STATUS.md', desc: 'Append-only log from every fleet session — CLAIM, DONE, BLOCKED, IDLE.' },
];

/* Documentation is a printed manual, so it sits on paper. */
export default function DocsPage() {
  return (
    <PageShell title="Documentation" subtitle="Everything links into the repo. Every claim has a source.">
      <div className="paper paper-tear mx-auto w-full max-w-3xl px-6 pb-8 pt-6 sm:px-8">
        <div className="readout mb-5 border-b border-dashed border-ink-fade/50 pb-4 text-center text-[11px] uppercase tracking-[0.22em] text-ink-fade">
          VENDX · operator's manual · contents
        </div>
        <ol className="readout">
          {DOCS.map(({ title, path, desc }, i) => (
            <li key={path} className="border-b border-dotted border-ink-fade/40">
              <a
                href={`${REPO}/${path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-baseline gap-4 py-3 hover:bg-paper-shade/60"
              >
                <span className="w-5 shrink-0 text-[11px] text-ink-fade">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-ink group-hover:underline group-hover:underline-offset-2">{title}</span>
                  <span className="block text-[12px] leading-relaxed text-ink-fade">{desc}</span>
                  <span className="mt-0.5 block text-[10px] text-ink-fade/80">{path}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </PageShell>
  );
}
