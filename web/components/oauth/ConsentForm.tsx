'use client';

import { useActionState, useState } from 'react';
import { approve, deny, type ConsentState } from '@/app/oauth/authorize/actions';

export interface AgentOption {
  id: string;
  name: string;
  clientName: string | null;
  walletPubkey: string | null;
  dailyCapUsd: number | null;
  perRequestCapUsd: number;
}

interface Props {
  clientName: string;
  scope: string;
  hidden: Record<string, string>;
  agents: AgentOption[];
  viewerLabel: string;
}

const input = 'readout w-full rounded-[8px] border border-rule bg-pill px-3.5 py-2 text-[15px] text-ink placeholder:text-ink-muted/60 focus:border-ink focus:outline-none';

/**
 * The consent step of the OAuth flow. The owner picks which agent this
 * client will act as (or names a new one), sets its caps, and approves.
 */
export default function ConsentForm({ clientName, scope, hidden, agents, viewerLabel }: Props) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(approve, {});
  const [choice, setChoice] = useState<string>(agents.length ? agents[0].id : 'new');
  const selected = agents.find((a) => a.id === choice);

  return (
    <form action={action} className="panel mx-auto w-full max-w-xl" data-consent={pending ? 'pending' : 'ready'}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div className="flex flex-col gap-1 px-5 py-5">
        <p className="plate">connect</p>
        <h2 className="text-[22px] leading-tight text-ink">
          <span className="font-medium">{clientName}</span> wants to buy sensor readings as you
        </h2>
        <p className="text-sm text-ink-muted">
          Signed in as <span className="readout text-ink">{viewerLabel}</span>. Scope: <span className="readout">{scope}</span>. It will pay from an agent wallet you fund, inside the caps below, without asking again.
        </p>
      </div>

      <fieldset className="panel-divide flex flex-col gap-3 px-5 py-5">
        <legend className="plate mb-2">act as</legend>
        {agents.map((a) => (
          <label key={a.id} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="agent" value={a.id} checked={choice === a.id} onChange={() => setChoice(a.id)} className="mt-1 accent-ink" />
            <span className="flex flex-col">
              <span className="text-[15px] text-ink">{a.name}</span>
              <span className="readout text-xs text-ink-muted">
                {a.clientName ? `${a.clientName} · ` : ''}
                {a.walletPubkey ? `wallet ${a.walletPubkey.slice(0, 4)}…${a.walletPubkey.slice(-4)}` : 'no wallet yet'}
              </span>
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer items-start gap-3">
          <input type="radio" name="agent" value="new" checked={choice === 'new'} onChange={() => setChoice('new')} className="mt-1 accent-ink" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="text-[15px] text-ink">A new agent</span>
            {choice === 'new' && (
              <input name="name" defaultValue={clientName} maxLength={64} className={input} placeholder="name, e.g. Claude Code on my laptop" aria-label="Agent name" />
            )}
          </span>
        </label>
      </fieldset>

      <div className="panel-divide grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="plate">per reading · max USDC</span>
          <input name="per_request_cap" inputMode="decimal" defaultValue={(selected?.perRequestCapUsd ?? 0.1).toString()} className={input} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="plate">per day · max USDC (0 = no daily cap)</span>
          <input name="daily_cap" inputMode="decimal" defaultValue={(selected?.dailyCapUsd ?? 0.5).toString()} className={input} />
        </label>
        <p className="text-xs leading-relaxed text-ink-muted sm:col-span-2">
          The hard limit is what the agent wallet holds. A reading costs about 0.0001–0.01 USDC on devnet. Caps are enforced in the database before any transfer.
        </p>
      </div>

      {state.error && (
        <p className="panel-divide px-5 py-3 text-sm text-alarm" role="alert">
          {state.error}
        </p>
      )}

      <div className="panel-divide flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <button type="submit" formAction={deny} formNoValidate className="text-[15px] text-ink-muted underline underline-offset-4 hover:text-ink" disabled={pending}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="readout inline-flex items-center justify-center rounded-full border border-ink bg-ink px-7 py-2.5 text-sm text-canvas transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          data-consent-approve
        >
          {pending ? 'Connecting…' : `Connect ${clientName}`}
        </button>
      </div>
    </form>
  );
}
