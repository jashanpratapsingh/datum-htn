/**
 * A vend panel: one readout behind a bezel.
 *
 * Deliberately not a generic Card. Panels are divided internally by hairlines
 * (`panel-divide`), never by nesting more panels — a grid of identical rounded
 * cards is the look this design is avoiding.
 */
export function Panel({
  children,
  label,
  stamp,
  className = '',
  live = false,
}: {
  children: React.ReactNode;
  /** Plate lettering on the fascia. */
  label?: string;
  stamp?: React.ReactNode;
  className?: string;
  /** Kept for call sites; a live panel no longer draws differently. */
  live?: boolean;
}) {
  void live;
  return (
    <section className={`panel ${className}`}>
      {(label || stamp) && (
        <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
          {label && <span className="plate">{label}</span>}
          {stamp && <span className="plate">{stamp}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A labelled value inside a panel. Numerals are always tabular. */
export function Readout({
  label,
  value,
  unit,
  tone = 'ink',
  size = 'md',
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** `amber` marks money. Same ink, one weight up, so a price still leads. */
  tone?: 'ink' | 'amber' | 'alarm' | 'dim';
  size?: 'sm' | 'md' | 'lg';
}) {
  const toneClass = {
    ink: 'text-ink',
    amber: 'text-ink font-medium',
    alarm: 'text-alarm',
    dim: 'text-ink-muted',
  }[tone];

  const sizeClass = { sm: 'text-base', md: 'text-2xl', lg: 'text-4xl md:text-5xl' }[size];

  return (
    <div className="px-4 py-3.5">
      <div className="plate mb-1.5">{label}</div>
      <div className={`readout leading-none ${sizeClass} ${toneClass}`}>
        {value}
        {unit && <span className="ml-1.5 text-[0.42em] text-ink-muted">{unit}</span>}
      </div>
    </div>
  );
}
