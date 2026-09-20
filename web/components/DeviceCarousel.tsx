'use client';

import { Carousel, TestimonialCard } from '@/components/ui/retro-testimonial';
import { SourceBadge } from './SourceBadge';
import { deviceHref, MULTI_RELAY } from '@/lib/relay';
import type { DeviceEntry } from '@/lib/relay';

/*
  Each device in the fleet gets a card, and the card speaks for the device.
  Every number in the sentence is one the relay actually returned — a field
  the relay did not send is left out of the sentence, not filled in.
*/

const AVATAR: Record<DeviceEntry['source'], string> = {
  badge: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=300&q=80',
  simulator: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=300&q=80',
};

function sentence(d: DeviceEntry): string {
  const parts: string[] = [];
  if (d.totalSales != null) {
    parts.push(
      d.totalSales === 0
        ? 'nothing sold yet'
        : `${d.totalSales} reading${d.totalSales === 1 ? '' : 's'} sold`,
    );
  }
  if (d.earningsMicroUsdc != null) {
    parts.push(`${(Number(d.earningsMicroUsdc) / 1e6).toFixed(4)} USDC earned`);
  }
  if (d.priceUsd != null) parts.push(`${d.priceUsd.toFixed(4)} USDC a reading`);
  if (d.freeHeap != null) parts.push(`${Math.round(d.freeHeap / 1024)} KB of heap free`);
  return parts.length ? parts.join(', ') + '.' : 'registered, no telemetry yet.';
}

function designation(d: DeviceEntry): string {
  const what = d.source === 'badge' ? 'ESP32-C3 badge' : 'simulated device';
  const base = d.chip ? `${what}, ${d.chip}` : what;
  return MULTI_RELAY ? `${base} · via ${d.relay.label}` : base;
}

function Detail({ d }: { d: DeviceEntry }) {
  const rows: [string, string][] = [];
  if (d.lastSeen) rows.push(['Last seen', new Date(d.lastSeen * 1000).toISOString()]);
  if (d.largestBlock != null) rows.push(['Largest free block', `${Math.round(d.largestBlock / 1024)} KB`]);
  if (d.bootCount != null) rows.push(['Boot count', String(d.bootCount)]);
  return (
    <dl className="readout grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base text-ink/70">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink/50">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      <div className="contents">
        <dt className="text-ink/50">Detail</dt>
        <dd>
          <a href={deviceHref(d)} className="underline underline-offset-4">
            open the device page
          </a>
        </dd>
      </div>
    </dl>
  );
}

export default function DeviceCarousel({ devices }: { devices: DeviceEntry[] }) {
  const cards = devices.map((d, i) => (
    <TestimonialCard
      key={`${d.relay.key}:${d.id}`}
      index={i}
      testimonial={{
        name: d.id,
        designation: designation(d),
        description: sentence(d),
        profileImage: AVATAR[d.source],
      }}
      stamp={<SourceBadge source={d.source} />}
      detail={<Detail d={d} />}
    />
  ));
  return <Carousel items={cards} />;
}
