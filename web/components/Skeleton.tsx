import NavBar from './NavBar';

/*
  One skeleton for every route.

  There used to be six loading.tsx files, each hand-copying the page shell and
  the header. They had already started to drift from each other and from
  PageShell. Now they are each one line, and this is the only place the loading
  state is drawn.
*/

function Bar({ w, h = 'h-3' }: { w: string; h?: string }) {
  return <div className={`${h} ${w} bg-rule`} />;
}

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <Bar w="w-16" h="h-2.5" />
        <Bar w="w-10" h="h-2.5" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`flex items-center justify-between px-4 py-4 ${i > 0 ? 'panel-divide' : ''}`}>
          <div className="flex flex-col gap-2">
            <Bar w="w-40" />
            <Bar w="w-24" h="h-2.5" />
          </div>
          <Bar w="w-16" h="h-5" />
        </div>
      ))}
    </div>
  );
}

export default function PageSkeleton({ panels = [3] }: { panels?: number[] }) {
  return (
    <main className="min-h-screen bg-glass" aria-busy="true" aria-label="Loading">
      <NavBar />
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-8 md:px-12">
        <div className="mb-10 flex items-start justify-between border-b border-rule pb-5">
          <div className="flex flex-col gap-3">
            <Bar w="w-48" h="h-8" />
            <Bar w="w-80" />
          </div>
          <Bar w="w-14" h="h-2.5" />
        </div>
        <div className="flex flex-col gap-5">
          {panels.map((rows, i) => <PanelSkeleton key={i} rows={rows} />)}
        </div>
      </div>
    </main>
  );
}
