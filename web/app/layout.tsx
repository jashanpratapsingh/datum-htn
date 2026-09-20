import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/* One grotesque, regular weight, for every word on the site. */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VENDX — a sensor that bills for its own readings',
  description:
    'A $5 ESP32 that charges AI agents for its own telemetry. HTTP 402, USDC on Solana, settled in milliseconds.',
};

export const viewport: Viewport = {
  themeColor: '#e4e0d8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
