import PageShell from '@/components/PageShell';
import { ExternalLink } from 'lucide-react';

const DOCS = [
  {
    title: 'Architecture',
    path: 'docs/ARCHITECTURE.md',
    desc: 'System map, 7 surfaces, payment handshake steps, trust model.',
  },
  {
    title: 'Protocol',
    path: 'docs/PROTOCOL.md',
    desc: 'Wire format — 402 challenge, X-PAYMENT header, signed receipt, why we diverge from @x402-solana.',
  },
  {
    title: 'Badge',
    path: 'docs/BADGE.md',
    desc: 'The real ESP32-C3 Hack the North badge: hardware, memory, console, Lua runtime, what VENDX can and cannot do.',
  },
  {
    title: 'Frontend brief',
    path: 'docs/FRONTEND_BRIEF.md',
    desc: 'Hero spec, colour palette, typography, accessibility requirements.',
  },
  {
    title: 'Features',
    path: 'docs/FEATURES.md',
    desc: 'Planned product routes beyond the hero — what each page must prove.',
  },
  {
    title: 'Runbook',
    path: 'docs/RUNBOOK.md',
    desc: 'Node setup, npm run demo, Supabase, Vercel, firmware upload, troubleshooting.',
  },
  {
    title: 'API reference',
    path: 'docs/API.md',
    desc: 'relay-proxy endpoints: GET /api/telemetry, POST /settle, GET /health — request/response shapes and error codes.',
  },
  {
    title: 'Build status',
    path: 'docs/STATUS.md',
    desc: 'Append-only build board — CLAIM / DONE / BLOCKED / IDLE from every fleet session.',
  },
];

export default function DocsPage() {
  return (
    <PageShell
      title="Documentation"
      subtitle="Links into the repo's markdown. Every claim here has a source."
    >
      <ul className="flex flex-col gap-3">
        {DOCS.map(({ title, path, desc }) => (
          <li key={path}>
            <a
              href={`https://github.com/jashanpratapsingh/datum-htn/blob/feat/vendx-architecture-gamma/${path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start justify-between gap-6 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 hover:border-white/20 hover:bg-white/[0.04] transition-all duration-200"
            >
              <div className="flex flex-col gap-1">
                <span className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white group-hover:text-[#5ed29c] transition-colors duration-200">
                  {title}
                </span>
                <span className="font-[family-name:var(--font-inter)] text-xs text-white/50 leading-relaxed">
                  {desc}
                </span>
                <span className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/30 mt-1">
                  {path}
                </span>
              </div>
              <ExternalLink
                size={14}
                className="text-white/30 group-hover:text-[#5ed29c] shrink-0 mt-0.5 transition-colors duration-200"
                aria-hidden="true"
              />
            </a>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
