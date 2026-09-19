import NavBar from '@/components/NavBar';

export default function LedgerLoading() {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/20 pl-5 animate-pulse">
          <div className="h-10 w-44 rounded bg-white/5 mb-3" />
          <div className="h-4 w-96 rounded bg-white/5" />
        </div>
        {/* Compression section */}
        <div className="mb-10 animate-pulse">
          <div className="h-6 w-40 rounded bg-white/5 mb-4" />
          <div className="h-4 w-full max-w-lg rounded bg-white/5 mb-4" />
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 rounded-xl border border-white/5 bg-white/[0.02]" />
            ))}
          </div>
        </div>
        {/* Ledger section */}
        <div className="animate-pulse">
          <div className="h-6 w-44 rounded bg-white/5 mb-4" />
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-xl border border-white/5 bg-white/[0.02]" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
