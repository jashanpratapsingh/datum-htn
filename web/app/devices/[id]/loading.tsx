import NavBar from '@/components/NavBar';

export default function DeviceDetailLoading() {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/20 pl-5 animate-pulse">
          <div className="h-10 w-44 rounded bg-white/5 mb-3" />
          <div className="h-3 w-72 rounded bg-white/5" />
        </div>
        <div className="flex flex-col gap-8">
          {/* Identity */}
          <div className="flex justify-between gap-4 animate-pulse">
            <div className="flex flex-col gap-2">
              <div className="h-5 w-20 rounded bg-white/5" />
              <div className="h-4 w-48 rounded bg-white/5" />
            </div>
            <div className="h-8 w-24 rounded bg-white/5" />
          </div>
          {/* Memory panel */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-5 animate-pulse">
            <div className="h-4 w-28 rounded bg-white/5 mb-5" />
            <div className="h-10 w-36 rounded bg-white/5 mb-4" />
            <div className="h-2.5 w-full rounded-full bg-white/5" />
          </div>
          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="h-3 w-16 rounded bg-white/5" />
                <div className="h-5 w-10 rounded bg-white/5" />
              </div>
            ))}
          </div>
          {/* Histogram panel */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-5 animate-pulse">
            <div className="h-4 w-44 rounded bg-white/5 mb-5" />
            <div className="h-24 w-full rounded bg-white/5" />
          </div>
        </div>
      </div>
    </main>
  );
}
