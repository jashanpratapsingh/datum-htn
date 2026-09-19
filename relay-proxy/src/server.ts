import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildDeviceChallenge, verifyDeviceReceipt } from './simulator.js';
import { readBadge, badgeAttached } from './badge-source.js';
import { settle, type SettleRequest } from './facilitator.js';

export const DEFAULT_PORT = 3402;

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
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createRelayServer(port = DEFAULT_PORT) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // GET /api/telemetry — device simulator endpoint
    if (req.method === 'GET' && url.pathname === '/api/telemetry') {
      const receiptHeader = req.headers['x-payment-receipt'];

      if (!receiptHeader || typeof receiptHeader !== 'string') {
        const challenge = buildDeviceChallenge();
        res.setHeader('Access-Control-Allow-Origin', '*');
        return json(res, 402, challenge);
      }

      const result = verifyDeviceReceipt(receiptHeader);
      if (!result.ok) {
        return json(res, 402, { error: result.reason });
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      return json(res, 200, await readBadge());
    }

    // POST /settle — facilitator endpoint
    if (req.method === 'POST' && url.pathname === '/settle') {
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
      };

      const result = settle(settleReq);
      if (!result.success) {
        return json(res, 402, result);
      }

      res.setHeader('X-Payment-Response', result.settleHeader);
      return json(res, 200, { receipt: result.receipt, success: true });
    }

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { status: 'ok', mode: 'simulator' });
    }

    return json(res, 404, { error: 'not_found' });
  });
}
