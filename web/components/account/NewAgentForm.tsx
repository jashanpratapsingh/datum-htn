'use client';

import { useActionState } from 'react';
import { createAgent, type CreateAgentState } from '@/app/account/actions';
import { CopyPill } from '@/components/Pill';
import McpSnippet from './McpSnippet';

/**
 * Register an agent and receive its key. The key is shown once, on this
 * render only; navigating away loses it (we never had a copy to show again).
 */
export default function NewAgentForm() {
  const [state, action, pending] = useActionState<CreateAgentState, FormData>(createAgent, {});

  if (state.key && state.agent) {
    return (
      <div className="flex flex-col gap-5 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="plate mb-1">agent registered</div>
            <div className="text-[15px] text-ink">{state.agent.name}</div>
          </div>
          <span className="plate rounded-[2px] border border-alarm/50 px-1.5 py-0.5 text-alarm">shown once</span>
        </div>
        <div className="paper flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <code className="readout break-all text-[13px] text-ink">{state.key}</code>
          <CopyPill value={state.key} label="copy key" />
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          We store only a hash. Copy it now; from here on the page shows <span className="readout text-ink">{state.agent.keyPrefix}…</span> only.
        </p>
        <McpSnippet apiKey={state.key} />
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="plate">new agent name</span>
        <input
          name="name"
          required
          maxLength={64}
          placeholder="claude-code on my laptop"
          className="readout w-full rounded-[8px] border border-rule bg-pill px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-muted/60 focus:border-ink focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="readout inline-flex items-center justify-center rounded-full border border-ink bg-ink px-6 py-2.5 text-sm text-canvas transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Minting key…' : 'Register agent'}
      </button>
      {state.error && (
        <p className="border-l-2 border-alarm px-3 py-1.5 text-sm text-alarm sm:basis-full" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
