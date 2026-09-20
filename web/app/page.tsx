import NavBar from '@/components/NavBar';
import HeroSection from '@/components/HeroSection';
import TelemetryTicker from '@/components/TelemetryTicker';
import VendorMap from '@/components/VendorMap';

/*
  The landing page is the hero plus two live strips. The five marketing
  sections that used to sit here were permanently-empty placeholders that
  duplicated working pages (/agent, /policy, /ledger); the hero links to the
  real ones instead.
*/
export default function Home() {
  return (
    <main className="min-h-screen bg-canvas">
      <NavBar />
      <HeroSection />
      <div className="mx-auto max-w-6xl px-5 pb-24 sm:px-8 md:px-12">
        <VendorMap />
        <TelemetryTicker />
      </div>
    </main>
  );
}
