'use client';

/**
 * Fleet economics, in a popup off the hero.
 *
 * Four controls — nodes, reads per node per day, price per read, ledger batch
 * cadence — drive a small model of what a fleet of five-dollar sensors earns
 * and costs. Two bars, three readouts, and a one-line verdict that arrives
 * once the slider settles. It is a model, not a reading: it is labelled as
 * such and pulls nothing from the relay.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PillButton } from './Pill';

/* ------------------------------------------------------------------ *
   The model. Every constant is stated in the footnote of the popup.
 * ------------------------------------------------------------------ */

const NODE_COST_USD = 5; // the five-dollar sensor
const NODE_WATTS = 0.4; // ESP32-C3 with WiFi up and BLE scanning, averaged
const KWH_USD = 0.15;
const COMMIT_FEE_USD = 0.00002; // one compressed ledger commit, roughly 5k lamports

/** The price ladder the slider walks. Index 0 is what live devices charge today. */
const PRICES = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01];

const BATCHES = [
  { label: '1m', minutes: 1, words: 'every minute' },
  { label: '5m', minutes: 5, words: 'every 5 minutes' },
  { label: '10m', minutes: 10, words: 'every 10 minutes' },
  { label: '1h', minutes: 60, words: 'every hour' },
  { label: '24h', minutes: 1440, words: 'once a day' },
];

type Inputs = { nodes: number; reads: number; priceIx: number; batchIx: number };

const DEFAULTS: Inputs = { nodes: 100, reads: 1440, priceIx: 0, batchIx: 2 };

function model(i: Inputs) {
  const price = PRICES[i.priceIx];
  const revenue = i.nodes * i.reads * price;
  const power = i.nodes * ((NODE_WATTS * 24) / 1000) * KWH_USD;
  const commits = i.nodes * (1440 / BATCHES[i.batchIx].minutes) * COMMIT_FEE_USD;
  const cost = power + commits;
  const profit = revenue - cost;
  const hardware = i.nodes * NODE_COST_USD;
  const days = profit > 0 ? Math.ceil(hardware / profit) : null;
  return { price, revenue, power, commits, cost, profit, hardware, days };
}

type Model = ReturnType<typeof model>;

/** USDC for people: at least two decimals, up to six when the amount has them (0.432, 14.40). */
function formatUsdc(n: number, min = 2, max = 6): string {
  const [w, f = ''] = n.toFixed(max).split('.');
  let frac = f;
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${Number(w).toLocaleString('en-US')}.${frac}`;
}
const usd = (n: number) => `$${formatUsdc(n)}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function verdict(m: Model, i: Inputs): { text: string; tone: 'ink' | 'alarm' } {
  const nodes = `${i.nodes.toLocaleString('en-US')} node${i.nodes === 1 ? '' : 's'}`;
  if (m.days === null) {
    return {
      tone: 'alarm',
      text: `Underwater. ${nodes} cost ${usd(m.cost)} a day to run and bill ${usd(m.revenue)}. Raise the price or the read rate.`,
    };
  }
  if (m.days <= 30) {
    return {
      tone: 'ink',
      text: `Fast payback. ${nodes} earn back ${whole(m.hardware)} of hardware in ${m.days} day${m.days === 1 ? '' : 's'}, then clear ${usd(m.profit)} a day.`,
    };
  }
  if (m.days <= 365) {
    return {
      tone: 'ink',
      text: `${nodes} pay for themselves in ${m.days} days. After that, ${usd(m.profit)} a day is margin.`,
    };
  }
  const years = (m.days / 365).toFixed(1);
  return {
    tone: 'ink',
    text: `Slow burn. ${years} years to break even at ${m.price} USDC a read. Agents that poll more often would fix that.`,
  };
}

/** How often one read lands, for a reads-per-day figure. */
function cadence(readsPerDay: number): string {
  const s = 86400 / readsPerDay;
  if (s < 60) return `every ${Math.round(s)}s`;
  if (s < 3600) return `every ${Math.round(s / 60)}m`;
  return `every ${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 1)}h`;
}

/* ------------------------------------------------------------------ *
   Two bars on one axis. Both are labelled directly — with two marks a
   legend would be more chrome than data.
 * ------------------------------------------------------------------ */

function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

function tick(v: number): string {
  if (v === 0) return '0';
  return v.toFixed(5).replace(/\.?0+$/, '');
}

const COLS = 'grid grid-cols-[6.5rem_1fr_4.75rem] items-center gap-x-3 sm:grid-cols-[8rem_1fr_5.5rem]';

function Bars({ revenue, cost }: { revenue: number; cost: number }) {
  const max = niceCeil(Math.max(revenue, cost, 0.001));
  const rows = [
    { label: 'Daily revenue', value: revenue, hatched: false, id: 'econ-bar-revenue' },
    { label: 'Operating cost', value: cost, hatched: true, id: 'econ-bar-cost' },
  ];
  const stops = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="px-4 pt-5 pb-3" aria-hidden="true">
      {rows.map((r) => (
        <div key={r.label} className={`${COLS} py-2.5`}>
          <span className="plate">{r.label}</span>
          <div className="relative h-[14px]">
            {stops.map((f) => (
              <span
                key={f}
                className="absolute -inset-y-3 w-px bg-rule"
                style={{ left: `${f * 100}%`, transform: f === 1 ? 'translateX(-1px)' : undefined }}
              />
            ))}
            <div
              data-testid={r.id}
              className="absolute inset-y-0 left-0 overflow-hidden rounded-r-[4px] bg-ink transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.min(100, (r.value / max) * 100)}%`,
                minWidth: r.value > 0 ? 2 : 0,
                backgroundImage: r.hatched
                  ? 'repeating-linear-gradient(135deg, var(--color-ink) 0 2px, var(--color-canvas-lift) 2px 5px)'
                  : undefined,
              }}
            />
          </div>
          <span className="readout text-right text-[13px] text-ink">{usd(r.value)}</span>
        </div>
      ))}
      <div className={`${COLS} mt-1`}>
        <span />
        <div className="relative h-4">
          {stops.map((f) => (
            <span
              key={f}
              className={`plate absolute top-0 -translate-x-1/2 text-[11px] ${
                f === 0.25 || f === 0.75 ? 'hidden sm:inline' : ''
              }`}
              style={{ left: `${f * 100}%` }}
            >
              {tick(f * max)}
            </span>
          ))}
        </div>
        <span className="plate text-right text-[11px]">USDC/day</span>
      </div>
    </div>
  );
}

/** A labelled value in the readout row. Sized down on phones so three fit. */
function Stat({ label, divide, children }: { label: string; divide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`px-4 py-3.5 ${divide ? 'panel-divide-x' : ''}`}>
      <div className="plate mb-1.5">{label}</div>
      <div className="readout text-lg leading-none text-ink sm:text-2xl">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Controls.
 * ------------------------------------------------------------------ */

function Slider({
  id,
  label,
  min,
  max,
  value,
  onChange,
  display,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  display: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[10.5rem_1fr_auto]">
      <label htmlFor={id} className="text-[15px] text-ink">
        {label}
      </label>
      <output
        htmlFor={id}
        className="paper readout min-w-[7.5rem] px-3 py-1.5 text-right text-[13px] text-ink sm:order-3"
      >
        {display}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider col-span-2 sm:order-2 sm:col-span-1"
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}

function BatchPicker({ value, onChange }: { value: number; onChange: (ix: number) => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[10.5rem_1fr_auto]">
      <span id="econ-batch-label" className="text-[15px] text-ink">
        Ledger commits
      </span>
      <span className="plate text-right sm:order-3">{BATCHES[value].words}</span>
      <div
        role="radiogroup"
        aria-labelledby="econ-batch-label"
        className="col-span-2 flex flex-wrap gap-1.5 sm:order-2 sm:col-span-1"
      >
        {BATCHES.map((b, ix) => {
          const on = ix === value;
          return (
            <button
              key={b.label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(ix)}
              className={`readout rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ${
                on
                  ? 'border-ink bg-ink text-canvas'
                  : 'border-ink/20 bg-transparent text-ink/80 hover:bg-pill hover:text-ink'
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   The dialog.
 * ------------------------------------------------------------------ */

function EconomicsDialog({ onClose, titleId }: { onClose: () => void; titleId: string }) {
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);
  const m = model(inputs);

  // The verdict waits for the slider to settle. Rewriting a sentence on every
  // pixel of a drag is unreadable; 350 ms after the last change is a beat.
  const [shown, setShown] = useState(() => verdict(model(DEFAULTS), DEFAULTS));
  useEffect(() => {
    const t = setTimeout(() => setShown(verdict(model(inputs), inputs)), 350);
    return () => clearTimeout(t);
  }, [inputs]);

  const ids = {
    nodes: useId(),
    reads: useId(),
    price: useId(),
  };

  const set = (patch: Partial<Inputs>) => setInputs((i) => ({ ...i, ...patch }));

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-end justify-center p-3 sm:items-center sm:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-econ="dialog"
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-[12px]"
        initial={{ y: 16, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 8, scale: 0.98 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <div className="panel text-left">
          <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
            <span className="plate">Fleet economics · a model, not a reading</span>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close fleet economics"
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink hover:text-canvas"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </header>

          <div className="px-4 pt-4">
            <h2 id={titleId} className="text-[20px] leading-snug tracking-tight text-ink sm:text-[22px]">
              What a fleet of five-dollar sensors earns
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
              Move the sliders. Each node bills for its own readings; the fleet pays for power and for
              committing telemetry to the ledger.
            </p>
          </div>

          <Bars revenue={m.revenue} cost={m.cost} />

          <div className="panel-divide grid grid-cols-3">
            <Stat label="Daily revenue">
              <span data-testid="econ-revenue" className="font-medium">
                {usd(m.revenue)}
              </span>
            </Stat>
            <Stat label="Operating cost" divide>
              <span data-testid="econ-cost">{usd(m.cost)}</span>
            </Stat>
            <Stat label="Break-even" divide>
              <span data-testid="econ-breakeven" className={m.days === null ? 'text-alarm' : ''}>
                {m.days === null ? 'never' : m.days.toLocaleString('en-US')}
              </span>
              {m.days !== null && <span className="ml-1.5 text-[13px] text-ink-muted">days</span>}
            </Stat>
          </div>

          <div className="panel-divide px-4 py-3.5">
            <div className="relative min-h-[3.4em] text-[15px] leading-snug" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={shown.text}
                  data-testid="econ-verdict"
                  className={shown.tone === 'alarm' ? 'text-alarm' : 'text-ink'}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  {shown.text}
                </motion.p>
              </AnimatePresence>
            </div>
            <p className="plate readout mt-2">
              power {usd(m.power)} · ledger commits {usd(m.commits)} · hardware {whole(m.hardware)} up front
            </p>
          </div>

          <div className="panel-divide">
            <Slider
              id={ids.nodes}
              label="Nodes deployed"
              min={1}
              max={1000}
              value={inputs.nodes}
              onChange={(nodes) => set({ nodes })}
              display={inputs.nodes.toLocaleString('en-US')}
            />
            <Slider
              id={ids.reads}
              label="Reads per node per day"
              min={1}
              max={2880}
              value={inputs.reads}
              onChange={(reads) => set({ reads })}
              display={`${inputs.reads.toLocaleString('en-US')} · ${cadence(inputs.reads)}`}
            />
            <Slider
              id={ids.price}
              label="Price per read"
              min={0}
              max={PRICES.length - 1}
              value={inputs.priceIx}
              onChange={(priceIx) => set({ priceIx })}
              display={`${PRICES[inputs.priceIx]} USDC`}
            />
            <BatchPicker value={inputs.batchIx} onChange={(batchIx) => set({ batchIx })} />
          </div>

          <p className="panel-divide plate px-4 py-3 leading-relaxed">
            Model, not telemetry. Assumes ${NODE_COST_USD} per node, {NODE_WATTS} W at ${KWH_USD}/kWh, and one
            compressed ledger commit per node per batch at about ${COMMIT_FEE_USD}. Buyers pay their own settlement
            fees. Live devices charge {PRICES[0]} USDC a read today.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
   Trigger + popup. Drops into the hero's pill row.
 * ------------------------------------------------------------------ */

export default function EconomicsPopup() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // The hero's pill row animates in with a transform, which makes it the
  // containing block for anything `fixed` inside it. The dialog therefore
  // renders on <body>, or the overlay would only cover the pill row.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <PillButton
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Run the numbers
      </PillButton>
      {mounted &&
        createPortal(
          <AnimatePresence>{open && <EconomicsDialog onClose={close} titleId={titleId} />}</AnimatePresence>,
          document.body,
        )}
    </>
  );
}
