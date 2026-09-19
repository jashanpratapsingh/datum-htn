import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/*
  IBM Plex, because IBM is the mainframe. Condensed reads as the stencil
  lettering stamped on a machine fascia; Mono is the terminal voice the
  product actually speaks in.
*/
const panel = IBM_Plex_Sans_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-condensed',
  display: 'swap',
});

const readout = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'VENDX — a sensor that bills for its own readings',
  description:
    'A $5 ESP32 that charges AI agents for its own telemetry. HTTP 402, USDC on Solana, settled in milliseconds.',
};

export const viewport: Viewport = {
  themeColor: '#071014',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${panel.variable} ${readout.variable}`}>{children}</body>
    </html>
  );
}
