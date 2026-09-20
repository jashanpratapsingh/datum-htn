'use client';

import { useState } from 'react';
import { CopyPill } from '@/components/Pill';
import type { Snippet } from '@/lib/connect/snippets';

/** Tabs per coding agent; each block has a copy pill. Deep links render as a button too. */
export default function InstallSnippets({ snippets, compact = false }: { snippets: Snippet[]; compact?: boolean }) {
  const [active, setActive] = useState(snippets[0]?.client ?? 'claude');
  const s = snippets.find((x) => x.client === active) ?? snippets[0];
  if (!s) return null;
  return (
    <div className={compact ? '' : 'panel'} data-install={active}>
      <div className="flex border-b border-rule" role="tablist" aria-label="Coding agent">
        {snippets.map((x) => (
          <button
            key={x.client}
            type="button"
            role="tab"
            aria-selected={x.client === active}
            onClick={() => setActive(x.client)}
            className={`flex-1 px-4 py-3 text-[15px] transition-colors ${x.client === active ? 'text-ink' : 'text-ink-muted hover:text-ink'} [&+&]:border-l [&+&]:border-rule`}
          >
            {x.title}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-5 px-5 py-5">
        {s.blocks.map((b) => (
          <div key={b.label} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="plate">{b.label}</span>
              <span className="flex items-center gap-2">
                {b.href && (
                  <a href={b.href} className="readout rounded-full border border-ink bg-ink px-3 py-1 text-xs text-canvas hover:bg-transparent hover:text-ink">
                    open in Cursor
                  </a>
                )}
                <CopyPill value={b.text} label="copy" />
              </span>
            </div>
            <pre className="paper readout overflow-x-auto whitespace-pre-wrap break-all px-4 py-3 text-[12px] leading-relaxed text-ink">{b.text}</pre>
          </div>
        ))}
        <p className="text-[13px] leading-relaxed text-ink-muted">{s.note}</p>
      </div>
    </div>
  );
}
