import NavBar from '@/components/NavBar';

interface Props {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function PageShell({ children, title, subtitle }: Props) {
  return (
    <main className="min-h-screen bg-[#070b0a] text-white">
      <NavBar />
      <div className="pt-28 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto pb-24">
        <div className="mb-10 border-l-2 border-[#5ed29c]/30 pl-5">
          <h1 className="font-[family-name:var(--font-instrument)] text-4xl md:text-5xl text-white leading-tight mb-3">
            {title}
          </h1>
          {subtitle && (
            <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </main>
  );
}
