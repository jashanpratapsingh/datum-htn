import NavBar from '@/components/NavBar';

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-5 animate-pulse">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex flex-col gap-2">
          <div className="h-5 w-24 rounded bg-white/5" />
          <div className="h-4 w-48 rounded bg-white/5" />
        </div>
        <div className="h-5 w-14 rounded bg-white/5" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-white/5 pt-4">
        {[0, 1, 2, 3].map((j) => (
          <div key={j} className="flex flex-col gap-1">
            <div className="h-3 w-16 rounded bg-white/5" />
            <div className="h-4 w-10 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DevicesLoading() {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/20 pl-5 animate-pulse">
          <div className="h-10 w-44 rounded bg-white/5 mb-3" />
          <div className="h-4 w-80 rounded bg-white/5" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    </main>
  );
}
