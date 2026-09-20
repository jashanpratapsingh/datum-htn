import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { RelayTag } from '@/components/RelayTag';
import { fetchDevice } from '@/lib/relay';

const HEAP_TOTAL = 327_680;

const REASON_NAMES: Record<string, string> = {
  '0': 'power-on',
  '1': 'reset pin',
  '3': 'SW reset',
  '5': 'deep-sleep wakeup',
  '6': 'panic',
  '7': 'int watchdog',
  '8': 'task watchdog',
  '11': 'deep-sleep',
  '12': 'GPIO wakeup',
  '14': 'ULP wakeup',
};

function ResetHistogram({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return <p className="readout px-4 py-6 text-xs text-ink-muted">No reset data</p>;

  const maxCount = Math.max(...entries.map(([, n]) => n));
  const barW = 36, barGap = 12, chartH = 80, labelH = 28, topPad = 20;
  const svgW = entries.length * (barW + barGap) - barGap;
  const svgH = chartH + labelH + topPad;

  // Phosphor, stepped by rank. Same segment, dimmer the further down the list.
  const fillAt = (i: number) => `rgba(127, 243, 224, ${Math.max(0.95 - i * 0.16, 0.18)})`;

  return (
    <div className="px-4 py-4">
      <div className="overflow-x-auto">
        {/*
          Explicit width, not w-full. A four-bar chart has an svgW of ~180 and
          w-full stretched it ~6x, turning 10px labels into 60px ones. Scale by
          a fixed factor and let the container scroll if it must.
        */}
        <svg
          viewBox={`-4 0 ${svgW + 8} ${svgH}`}
          className="overflow-visible"
          style={{ width: Math.min(svgW * 1.6, 720), maxWidth: '100%', minWidth: 160 }}
          aria-label="Reset reason histogram"
          role="img"
        >
          <line x1={0} y1={chartH + topPad} x2={svgW} y2={chartH + topPad} stroke="#cdc8bf" strokeWidth={1} />
          {entries.map(([reason, count], i) => {
            const x = i * (barW + barGap);
            const barH = (count / maxCount) * chartH;
            const y = chartH + topPad - barH;
            return (
              <g key={reason}>
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fill="#141414" fontSize="10" fontFamily="var(--font-readout)">
                  {count}
                </text>
                {/* Square-cornered: a VFD segment, not a rounded bar. */}
                <rect x={x} y={y} width={barW} height={barH} fill={fillAt(i)}>
                  <title>Reason {reason} ({REASON_NAMES[reason] ?? 'unknown'}): {count} × ({Math.round((count / total) * 100)}%)</title>
                </rect>
                <text x={x + barW / 2} y={chartH + topPad + 16} textAnchor="middle" fill="#5e5a54" fontSize="9" fontFamily="var(--font-readout)">
                  #{reason}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
        {entries.map(([reason, count], i) => (
          <div key={reason} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5" style={{ backgroundColor: fillAt(i) }} aria-hidden="true" />
            <span className="readout text-[11px] text-ink-muted">
              #{reason} {REASON_NAMES[reason] ?? `reason ${reason}`} ×{count}
            </span>
          </div>
        ))}
      </div>

      <p className="readout mt-4 text-[11px] text-ink-muted/80">
        {total} total resets across {entries.length} distinct reason{entries.length !== 1 ? 's' : ''}.
        Reason #11 (deep-sleep) is normal for badge operation.
      </p>
    </div>
  );
}

function HeapGauge({ free, largest }: { free: number; largest: number }) {
  const freePct = Math.min((free / HEAP_TOTAL) * 100, 100);
  const largestPct = Math.min((largest / HEAP_TOTAL) * 100, 100);
  const tone = freePct > 30 ? '#141414' : freePct > 15 ? '#5e5a54' : '#b93a2e';

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-end gap-4">
        <div className="readout  text-4xl leading-none text-ink">
          {Math.round(free / 1024)}
          <span className="ml-1.5 text-[0.4em] text-ink-muted">KB free</span>
        </div>
        <div className="readout pb-1 text-xs text-ink-muted">
          of {Math.round(HEAP_TOTAL / 1024)}KB
        </div>
      </div>

      <div className="relative h-2 overflow-hidden bg-rule">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${freePct}%`, backgroundColor: tone }}
          role="progressbar"
          aria-valuenow={free}
          aria-valuemin={0}
          aria-valuemax={HEAP_TOTAL}
          aria-label={`${Math.round(free / 1024)}KB free of ${Math.round(HEAP_TOTAL / 1024)}KB`}
        />
        <div
          className="absolute inset-y-0 left-0 opacity-30"
          style={{ width: `${largestPct}%`, backgroundColor: tone }}
          title={`Largest contiguous block: ${Math.round(largest / 1024)}KB`}
        />
      </div>

      <p className="readout mt-2 text-[11px] text-ink-muted">
        {freePct.toFixed(1)}% free · largest block {Math.round(largest / 1024)}KB
      </p>

      {free < 40_960 && (
        <p className="readout mt-3 border-l-2 border-alarm pl-3 text-[11px] text-alarm">
          Under 40KB free. A TLS handshake needs 40–50KB contiguous — this device cannot terminate HTTPS itself.
        </p>
      )}
    </div>
  );
}

export default async function DeviceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // The segment arrives still percent-encoded ("relay%3Aid"); decode before
  // splitting off the relay key or the composite id never matches.
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const result = await fetchDevice(id);

  if (!result.ok) {
    return (
      <PageShell title={id.replace(/^[^:]+:/, '')} subtitle="Device detail" stamp={result.reason === 'not_found' ? 'unknown device' : 'no link'}>
        <RelayOffline path={`/api/devices/${encodeURIComponent(id)}`} reason={result.reason} />
      </PageShell>
    );
  }

  const d = result.data;
  const lastSeen = d.lastSeen ? new Date(d.lastSeen * 1000) : null;

  if (d.kind === 'sensor') {
    const stateTone = d.motionState === 'motion' ? '#3a9c4f' : '#b93a2e';
    return (
      <PageShell
        title={d.name ?? d.id}
        subtitle={lastSeen ? `Last seen ${lastSeen.toISOString()}` : 'Device detail'}
        stamp={<span className="flex items-center gap-2">{d.chip}<span className="plate">espectre</span><RelayTag relay={d.relay} /></span>}
      >
        <div className="flex flex-col gap-5">
          <Panel label="Motion" live={d.online}>
            <div className="px-4 py-6">
              <div className="readout text-4xl leading-none" style={{ color: d.online ? stateTone : undefined }}>
                {d.online ? (d.motionState ?? 'unknown') : 'offline'}
              </div>
              {!d.online && (
                <p className="readout mt-2 text-[11px] text-ink-muted">
                  Not seen on the LAN recently — dropped from mDNS or unreachable.
                </p>
              )}
            </div>
          </Panel>

          <Panel label="Readouts">
            <div className="grid grid-cols-2 md:grid-cols-3">
              <Readout label="threshold" value={d.threshold != null ? d.threshold.toFixed(2) : '—'} size="sm" />
              <div className="panel-divide-x"><Readout label="csi occupancy" value={d.csiOccupancy != null ? d.csiOccupancy.toFixed(2) : '—'} size="sm" /></div>
              <div className="panel-divide md:panel-divide-x md:border-t-0"><Readout label="calibrated" value={d.ready == null ? '—' : d.ready ? 'yes' : 'no'} size="sm" /></div>
              <div className="panel-divide"><Readout label="firmware" value={d.firmware ?? '—'} size="sm" /></div>
            </div>
          </Panel>
        </div>
      </PageShell>
    );
  }

  const earned = Number(d.earningsMicroUsdc ?? '0') / 1e6;
  const hasTelemetry = d.freeHeap != null || d.resetReasons;

  return (
    <PageShell
      title={d.id}
      subtitle={lastSeen ? `Last seen ${lastSeen.toISOString()}` : 'Device detail'}
      stamp={<span className="flex items-center gap-2">{d.chip}<SourceBadge source={d.source} /><RelayTag relay={d.relay} /></span>}
    >
      <div className="flex flex-col gap-5">
        <Panel label="Earnings" live>
          <Readout label="lifetime" value={earned.toFixed(4)} unit="USDC" tone="amber" size="lg" />
        </Panel>

        {d.freeHeap != null && d.largestBlock != null && (
          <Panel label="Heap memory" live>
            <HeapGauge free={d.freeHeap} largest={d.largestBlock} />
          </Panel>
        )}

        <Panel label="Readouts">
          <div className="grid grid-cols-2 md:grid-cols-3">
            <Readout label="boots" value={d.bootCount ?? '—'} size="sm" />
            <div className="panel-divide-x"><Readout label="tasks" value={d.taskCount ?? '—'} size="sm" /></div>
            <div className="panel-divide md:panel-divide-x md:border-t-0"><Readout label="LVGL heap" value={d.lvglUsedPct != null ? `${d.lvglUsedPct}%` : '—'} size="sm" /></div>
            <div className="panel-divide"><Readout label="BLE state" value={d.bleState != null ? `0x${d.bleState.toString(16)}` : '—'} size="sm" /></div>
            <div className="panel-divide panel-divide-x"><Readout label="filesystem" value={d.fsBytes != null ? `${Math.round(d.fsBytes / 1024)}KB` : '—'} size="sm" /></div>
            <div className="panel-divide panel-divide-x"><Readout label="device hash" value={d.deviceHash ? `${d.deviceHash.slice(0, 12)}…` : '—'} size="sm" /></div>
          </div>
        </Panel>

        {d.resetReasons && Object.keys(d.resetReasons).length > 0 && (
          <Panel label="Reset reasons" stamp={`${Object.values(d.resetReasons).reduce((a, b) => a + b, 0)} total`}>
            <ResetHistogram reasons={d.resetReasons} />
          </Panel>
        )}

        {!hasTelemetry && (
          <Panel label="Telemetry">
            <p className="readout px-4 py-10 text-center text-sm text-ink-muted">
              Registered, but no readings received yet.
            </p>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
