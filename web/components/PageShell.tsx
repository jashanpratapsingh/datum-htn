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
        <h1 className="font-[family-name:var(--font-inter)] font-extrabold text-3xl text-white mb-2">
          {title}
        </h1>
        {subtitle && (
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-10">
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </main>
  );
}
