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
  /** Live readouts get scanlines; static ones do not. */
  live?: boolean;
}) {
  return (
    <section className={`panel ${live ? 'scanlines' : ''} ${className}`}>
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
  tone = 'phosphor',
  size = 'md',
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** `amber` is reserved for money. Nothing else may use it. */
  tone?: 'phosphor' | 'amber' | 'alarm' | 'dim';
  size?: 'sm' | 'md' | 'lg';
}) {
  const toneClass = {
    phosphor: 'text-phosphor',
    amber: 'text-amber bloom-amber',
    alarm: 'text-alarm',
    dim: 'text-phosphor-dim',
  }[tone];

  const sizeClass = { sm: 'text-base', md: 'text-2xl', lg: 'text-4xl md:text-5xl' }[size];

  return (
    <div className="px-4 py-3.5">
      <div className="plate mb-1.5">{label}</div>
      <div className={`readout leading-none ${sizeClass} ${toneClass}`}>
        {value}
        {unit && <span className="ml-1.5 text-[0.42em] text-phosphor-dim">{unit}</span>}
      </div>
    </div>
  );
}
