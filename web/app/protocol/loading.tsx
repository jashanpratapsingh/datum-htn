import NavBar from '@/components/NavBar';

export default function ProtocolLoading() {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/20 pl-5 animate-pulse">
          <div className="h-10 w-52 rounded bg-white/5 mb-3" />
          <div className="h-4 w-80 rounded bg-white/5" />
        </div>
        <div className="flex flex-col gap-16">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-6 w-14 rounded-full bg-white/5" />
                <div className="h-6 w-44 rounded bg-white/5" />
              </div>
              <div className="h-4 w-full max-w-lg rounded bg-white/5" />
              <div className="rounded-xl border border-white/5 bg-white/[0.02] h-36" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
