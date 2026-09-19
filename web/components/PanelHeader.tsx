/**
 * The page masthead.
 *
 * Extracted because this markup was previously copy-pasted into PageShell,
 * all six loading.tsx skeletons and an inline copy in /agent — eight places
 * that had already begun to drift.
 *
 * `as` exists only for /agent, which is a client component and renders its own
 * shell; everything else keeps the h1 that every route test asserts on.
 */
export default function PanelHeader({
  title,
  subtitle,
  stamp,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Plate lettering stamped top-right, e.g. a live/offline state. */
  stamp?: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex items-start justify-between gap-6 border-b border-rule pb-5">
      <div>
        <h1 className="text-3xl leading-none tracking-tight text-phosphor md:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-phosphor-dim">
            {subtitle}
          </p>
        )}
      </div>
      {stamp && <div className="plate shrink-0 pt-2">{stamp}</div>}
    </div>
  );
}
