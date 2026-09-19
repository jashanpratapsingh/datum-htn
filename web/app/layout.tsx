import type { Metadata } from 'next';
import { Inter, Plus_Jakarta_Sans, Instrument_Serif } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VENDX — Your Sensors. Their Wallets.',
  description:
    'A $5 ESP32 that charges AI agents for its own telemetry. HTTP 402, USDC on Solana, settled in milliseconds.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jakarta.variable} ${instrument.variable} bg-[#070b0a] text-white antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
