import NavBar from '@/components/NavBar';

export default function MarketplaceLoading() {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/20 pl-5 animate-pulse">
          <div className="h-10 w-52 rounded bg-white/5 mb-3" />
          <div className="h-4 w-96 rounded bg-white/5" />
        </div>
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
              <div className="h-3 w-20 rounded bg-white/5 mb-2" />
              <div className="h-8 w-16 rounded bg-white/5" />
            </div>
          ))}
        </div>
        {/* Sale rows */}
        <div className="flex flex-col gap-2 animate-pulse">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4 h-16" />
          ))}
        </div>
      </div>
    </main>
  );
}
