import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeviceChallenge, verifyDeviceReceipt, VENDOR_PRICE_USD } from './simulator.js';
import { readBadge, badgeAttached } from './badge-source.js';
import { captureScreen, screenEnabled } from './badge-screen.js';
import { settle, type SettleRequest } from './facilitator.js';
import { recordSale, getSales } from './sales-log.js';
import { registerNode, listNodes, getNode, probeNode } from './node-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

export const DEFAULT_PORT = 3402;

/** Program ID for the vendx-zk Anchor program on devnet. */
const VENDX_PROGRAM_ID = 'VnDXzkZKqiG2X8kGBJYDqExQEuCz9TnshCHsf2WVEoY';

/** Must match DAY_CAP_MICRO_USDC in agent-buyer/src/policy.ts. */
const DAY_CAP_MICRO_USDC = 5_000_000n;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readSpendLedger(): { date: string; spentMicroUsdc: string } {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'spend-ledger.json'), 'utf8')) as {
      date: string;
      spentMicroUsdc: string;
    };
  } catch {
    return { date: new Date().toISOString().slice(0, 10), spentMicroUsdc: '0' };
  }
}

export function createRelayServer(port = DEFAULT_PORT) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const { pathname } = url;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      return res.end();
    }

    // GET /api/screen — live badge screen, local demo only.
    // Gated behind VENDX_ALLOW_SCREEN because the badge home screen renders
    // the attendee's name, badge ID and identity QR. See docs/BADGE.md.
    if (req.method === 'GET' && pathname === '/api/screen') {
      if (!screenEnabled()) {
        return json(res, 404, {
          error: 'screen_capture_disabled',
          hint: 'set VENDX_ALLOW_SCREEN=1 to enable; it exposes personal data on the badge screen',
        });
      }
      const pngBuf = await captureScreen();
      if (!pngBuf) return json(res, 503, { error: 'capture_failed', badgeAttached: badgeAttached() });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(pngBuf);
    }

    // GET /api/telemetry — paywalled device telemetry endpoint
    if (req.method === 'GET' && pathname === '/api/telemetry') {
      const receiptHeader = req.headers['x-payment-receipt'];

      if (!receiptHeader || typeof receiptHeader !== 'string') {
        const challenge = buildDeviceChallenge();
        return json(res, 402, challenge);
      }

      const result = verifyDeviceReceipt(receiptHeader);
      if (!result.ok) {
        return json(res, 402, { error: result.reason });
      }

      return json(res, 200, await readBadge());
    }

    // POST /settle — facilitator endpoint
    if (req.method === 'POST' && pathname === '/settle') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: 'bad_json' });
      }

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as Record<string, unknown>).nonce !== 'string' ||
        typeof (parsed as Record<string, unknown>).txSignature !== 'string'
      ) {
        return json(res, 400, { error: 'missing_fields: need nonce, txSignature' });
      }

      const req2 = parsed as Record<string, unknown>;
      const settleReq: SettleRequest = {
        nonce: req2.nonce as string,
        txSignature: req2.txSignature as string,
        payTo: (req2.payTo as string | undefined) ?? '',
        amount: (req2.amount as string | undefined) ?? '0',
        network: (req2.network as string | undefined) ?? 'solana-devnet',
        deviceId: typeof req2.deviceId === 'string' ? req2.deviceId : undefined,
      };

      const result = await settle(settleReq);
      if (!result.success) {
        return json(res, 402, result);
      }

      recordSale({
        id: settleReq.nonce,
        nonce: settleReq.nonce,
        amountMicroUsdc: settleReq.amount,
        timestamp: Math.floor(Date.now() / 1000),
        txSignature: settleReq.txSignature,
        source: result.node ? 'esp32c3' : badgeAttached() ? 'badge' : 'simulator',
        deviceId: result.node?.deviceId,
      });

      res.setHeader('X-Payment-Response', result.settleHeader);
      return json(res, 200, { receipt: result.receipt, success: true });
    }

    // POST /api/nodes/register — a VENDX node (ESP32 running firmware-vendor)
    // announcing itself. Also its heartbeat: the node re-posts every
    // `heartbeatSec`. See node-registry.ts for why the relay needs this.
    if (req.method === 'POST' && (pathname === '/api/nodes/register' || pathname === '/api/nodes/heartbeat')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: 'bad_json' });
      }
      const result = registerNode(parsed, req.socket.remoteAddress ?? undefined);
      if (!result.ok) return json(res, 400, result);
      if (result.isNew) {
        console.log(`[relay-proxy] node registered: ${result.node.deviceId} at ${result.node.url} payTo=${result.node.payTo} price=${result.node.priceMicroUsdc}µ`);
      }
      // Confirm the URL answers as this device — after replying, never in the
      // request path (the node is waiting on a 3 s timeout of its own).
      void probeNode(result.node.deviceId).then(() => {
        const n = getNode(result.node.deviceId);
        if (n && (result.isNew || !n.reachable)) {
          console.log(`[relay-proxy] node ${n.deviceId} probe: ${n.reachable ? 'reachable' : `unreachable (${n.probe?.detail ?? '?'})`} at ${n.url}`);
        }
      });
      return json(res, 200, {
        ok: true,
        deviceId: result.node.deviceId,
        registered: !result.isNew ? 'refreshed' : 'new',
        heartbeatSec: result.node.heartbeatSec,
        facilitator: `http://${req.headers.host ?? `localhost:${port}`}`,
      });
    }

    // GET /api/nodes — registered nodes only (the fleet list merges them in)
    if (req.method === 'GET' && pathname === '/api/nodes') {
      return json(res, 200, { nodes: listNodes() });
    }

    // GET /api/devices — fleet list: the badge-or-simulator device plus every registered node
    if (req.method === 'GET' && pathname === '/api/devices') {
      const telemetry = await readBadge();
      const sales = getSales();
      const earned = (rows: readonly { amountMicroUsdc: string }[]) =>
        rows.reduce((sum, s) => sum + BigInt(s.amountMicroUsdc), 0n).toString();
      const deviceSales = sales.filter(s => s.source === telemetry.source);
      const nodes = listNodes().map(n => {
        const nodeSales = sales.filter(s => s.source === 'esp32c3' && s.deviceId === n.deviceId);
        return {
          id: n.deviceId,
          source: n.source,
          priceUsd: Number(n.priceMicroUsdc) / 1_000_000,
          freeHeap: n.freeHeap ?? null,
          largestBlock: n.largestBlock ?? null,
          chip: n.chip ?? null,
          lastSeen: n.lastSeen,
          totalSales: nodeSales.length,
          totalEarnedMicroUsdc: earned(nodeSales),
          url: n.url,
          mdns: n.mdns ?? null,
          payTo: n.payTo,
          network: n.network,
          nodeState: n.nodeState,
          reachable: n.reachable,
          ageSeconds: n.ageSeconds,
        };
      });
      return json(res, 200, {
        devices: [
          {
            id: telemetry.deviceId,
            source: telemetry.source,
            priceUsd: VENDOR_PRICE_USD,
            freeHeap: telemetry.freeHeap ?? null,
            largestBlock: telemetry.largestBlock ?? null,
            chip: telemetry.chip ?? null,
            lastSeen: telemetry.timestamp,
            totalSales: deviceSales.length,
            totalEarnedMicroUsdc: earned(deviceSales),
          },
          ...nodes,
        ],
      });
    }

    // GET /api/devices/:id — single device detail
    const deviceMatch = /^\/api\/devices\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && deviceMatch) {
      const id = decodeURIComponent(deviceMatch[1]);
      const node = getNode(id);
      if (node) {
        const recentSales = getSales().filter(s => s.source === 'esp32c3' && s.deviceId === id).slice(0, 50);
        // Same shape the badge path serves (deviceId/timestamp/source/chip/heap),
        // plus the node's own fields, so the site renders it with one component.
        return json(res, 200, {
          device: {
            deviceId: node.deviceId,
            timestamp: node.lastSeen,
            source: node.source,
            chip: node.chip,
            freeHeap: node.freeHeap,
            largestBlock: node.largestBlock,
            url: node.url,
            mdns: node.mdns,
            resource: node.resource,
            payTo: node.payTo,
            priceMicroUsdc: node.priceMicroUsdc,
            network: node.network,
            asset: node.asset,
            uptime: node.uptime,
            rssi: node.rssi,
            bucket: node.bucket,
            firmware: node.firmware,
            sdk: node.sdk,
            firstSeen: node.firstSeen,
            heartbeats: node.heartbeats,
            heartbeatSec: node.heartbeatSec,
            nodeState: node.nodeState,
            reachable: node.reachable,
            probe: node.probe,
            ageSeconds: node.ageSeconds,
          },
          recentSales,
        });
      }
      const telemetry = await readBadge();
      if (telemetry.deviceId !== id) {
        return json(res, 404, { error: 'device_not_found', id });
      }
      const deviceSales = getSales().filter(s => s.source !== 'esp32c3').slice(0, 50);
      return json(res, 200, { device: telemetry, recentSales: deviceSales });
    }

    // GET /api/sales — all sales records
    if (req.method === 'GET' && pathname === '/api/sales') {
      return json(res, 200, { sales: getSales() });
    }

    // GET /api/policy — APEX spend policy state
    if (req.method === 'GET' && pathname === '/api/policy') {
      const ledger = readSpendLedger();
      const spent = BigInt(ledger.spentMicroUsdc);
      const remaining = spent >= DAY_CAP_MICRO_USDC ? 0n : DAY_CAP_MICRO_USDC - spent;
      return json(res, 200, {
        capMicroUsdc: DAY_CAP_MICRO_USDC.toString(),
        spentMicroUsdc: spent.toString(),
        remainingMicroUsdc: remaining.toString(),
        date: ledger.date,
        capUsd: 5.0,
        spentUsd: Number(spent) / 1_000_000,
        remainingUsd: Number(remaining) / 1_000_000,
        perRequestLimitMicroUsdc: '100',
        perVendorLimitMicroUsdc: '1000000',
      });
    }

    // GET /api/ledger — on-chain ledger status
    if (req.method === 'GET' && pathname === '/api/ledger') {
      const allSales = getSales();
      const totalSettled = allSales.reduce(
        (sum, s) => sum + BigInt(s.amountMicroUsdc),
        0n,
      );
      return json(res, 200, {
        programId: VENDX_PROGRAM_ID,
        network: 'solana-devnet',
        // The Anchor program is compile-verified; no deployed instance yet on devnet.
        deployed: false,
        totalBuckets: allSales.length,
        totalSettledMicroUsdc: totalSettled.toString(),
        totalSettledUsd: Number(totalSettled) / 1_000_000,
        entries: allSales.slice(0, 20).map(s => ({
          nonce: s.nonce,
          amountMicroUsdc: s.amountMicroUsdc,
          timestamp: s.timestamp,
          txSignature: s.txSignature,
          source: s.source,
          solscanUrl: `https://solscan.io/tx/${s.txSignature}?cluster=devnet`,
        })),
        compressionNote:
          'Each batch of up to 64 buckets is committed as a single state-root update, ' +
          'versus 64 separate rent-paying accounts in naive storage.',
      });
    }

    // GET /health
    if (req.method === 'GET' && pathname === '/health') {
      const nodes = listNodes();
      return json(res, 200, {
        status: 'ok',
        mode: badgeAttached() ? 'badge' : 'simulator',
        nodes: nodes.length,
        nodesLive: nodes.filter(n => n.nodeState === 'live').length,
      });
    }

    return json(res, 404, { error: 'not_found' });
  });
}
