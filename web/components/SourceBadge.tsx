export function SourceBadge({ source }: { source: 'badge' | 'simulator' }) {
  const isBadge = source === 'badge';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-[family-name:var(--font-inter)] ${
        isBadge
          ? 'bg-[#5ed29c]/10 text-[#5ed29c] border border-[#5ed29c]/20'
          : 'bg-white/5 text-white/40 border border-white/10'
      }`}
      title={isBadge ? 'Data from real ESP32-C3 badge' : 'Data from simulator'}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${isBadge ? 'bg-[#5ed29c]' : 'bg-white/40'}`}
        aria-hidden="true"
      />
      {source}
    </span>
  );
}
