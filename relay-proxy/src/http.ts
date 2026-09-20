import type { IncomingMessage, ServerResponse } from 'node:http';

/** Small helpers so the handlers stay about protocol, not plumbing. */

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/**
 * Node's http module has no built-in 402 reason phrase, and the firmware will
 * need `httpd_resp_set_status(req, "402 Payment Required")` for the same reason:
 * the status line has to say it explicitly.
 */
export function sendPaymentRequired(
  res: ServerResponse,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(402, 'Payment Required', {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export async function readJsonBody<T>(req: IncomingMessage, limitBytes = 64 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limitBytes) throw new Error(`request body exceeded ${limitBytes} bytes`);
    chunks.push(buf);
  }
  if (total === 0) throw new Error('empty request body');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

/** First value of a header, lowercased name, or null. */
export function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://localhost').pathname;
}
