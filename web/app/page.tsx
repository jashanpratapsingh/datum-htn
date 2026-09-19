import NavBar from '@/components/NavBar';
import HeroSection from '@/components/HeroSection';
import PaymentHandshake from '@/components/PaymentHandshake';
import VendorMap from '@/components/VendorMap';
import TelemetryTicker from '@/components/TelemetryTicker';
import PolicyGauge from '@/components/PolicyGauge';
import CompressionSavings from '@/components/CompressionSavings';
import Explorer from '@/components/Explorer';

export default function Home() {
  return (
    <main>
      <NavBar />
      <HeroSection />
      <PaymentHandshake />
      <VendorMap />
      <TelemetryTicker />
      <PolicyGauge />
      <CompressionSavings />
      <Explorer />
    </main>
  );
}
