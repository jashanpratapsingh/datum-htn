import NavBar from '@/components/NavBar';

export default function PolicyLoading() {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/20 pl-5 animate-pulse">
          <div className="h-10 w-44 rounded bg-white/5 mb-3" />
          <div className="h-4 w-96 rounded bg-white/5" />
        </div>
        {/* Gauge panel */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-8 mb-8 animate-pulse flex flex-col items-center gap-6">
          <div className="w-56 h-28 rounded-xl bg-white/5" />
          <div className="flex gap-10">
            <div className="flex flex-col items-center gap-2">
              <div className="h-3 w-10 rounded bg-white/5" />
              <div className="h-8 w-20 rounded bg-white/5" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="h-3 w-10 rounded bg-white/5" />
              <div className="h-5 w-12 rounded bg-white/5" />
            </div>
          </div>
        </div>
        {/* Rules panel */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-5 animate-pulse">
          <div className="h-4 w-36 rounded bg-white/5 mb-5" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="h-3 w-24 rounded bg-white/5" />
                <div className="h-4 w-40 rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
