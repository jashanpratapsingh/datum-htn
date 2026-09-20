import NavBar from './NavBar';
import PanelHeader from './PanelHeader';

export default function PageShell({
  children,
  title,
  subtitle,
  stamp,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  stamp?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas">
      <NavBar />
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-8 md:px-12">
        <PanelHeader title={title} subtitle={subtitle} stamp={stamp} />
        {children}
      </div>
    </main>
  );
}
