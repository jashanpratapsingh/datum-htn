/**
 * Sign In With Solana (SIWS) message text.
 *
 * Phantom's `signIn` builds this text itself from the input we hand it and
 * returns the exact bytes it signed. The server therefore never trusts a
 * client-built string: it parses the signed bytes back into fields and checks
 * domain, address, nonce and issue time against what it issued.
 *
 * Isomorphic: used by the nonce route (build), the verify route (parse) and
 * the Playwright Phantom mock (build), so the three cannot drift apart.
 * Format per the wallet-standard SIWS spec (SolanaSignInInput in
 * @solana/wallet-standard-features).
 */

export interface SiwsInput {
  domain: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

export interface ParsedSiws {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources: string[];
}

const HEADER_RE = /^(.+) wants you to sign in with your Solana account:$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const FIELD_KEYS: Record<string, keyof ParsedSiws> = {
  URI: 'uri',
  Version: 'version',
  'Chain ID': 'chainId',
  Nonce: 'nonce',
  'Issued At': 'issuedAt',
  'Expiration Time': 'expirationTime',
  'Not Before': 'notBefore',
  'Request ID': 'requestId',
};

export function buildSiwsMessage(input: SiwsInput & { address: string }): string {
  let text = `${input.domain} wants you to sign in with your Solana account:\n${input.address}`;
  if (input.statement) text += `\n\n${input.statement}`;
  const fields: string[] = [];
  if (input.uri) fields.push(`URI: ${input.uri}`);
  if (input.version) fields.push(`Version: ${input.version}`);
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (input.notBefore) fields.push(`Not Before: ${input.notBefore}`);
  if (input.requestId) fields.push(`Request ID: ${input.requestId}`);
  if (input.resources?.length) {
    fields.push('Resources:');
    for (const r of input.resources) fields.push(`- ${r}`);
  }
  if (fields.length) text += `\n\n${fields.join('\n')}`;
  return text;
}

/** Parse signed SIWS text. Returns null on anything that is not well-formed. */
export function parseSiwsMessage(text: string): ParsedSiws | null {
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  const header = HEADER_RE.exec(lines[0]);
  if (!header) return null;
  const address = lines[1];
  if (!BASE58_RE.test(address)) return null;

  const out: ParsedSiws = { domain: header[1], address, resources: [] };
  let i = 2;
  if (i >= lines.length) return out;
  if (lines[i] !== '') return null; // a blank line must follow the address
  i++;

  // Optional statement: a non-empty line that is not a "Key: value" field,
  // followed by a blank line before the fields begin.
  if (i < lines.length && lines[i] !== '' && !isField(lines[i])) {
    out.statement = lines[i];
    i++;
    if (i < lines.length) {
      if (lines[i] !== '') return null;
      i++;
    }
  }

  let inResources = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (inResources) {
      if (line.startsWith('- ')) {
        out.resources.push(line.slice(2));
        continue;
      }
      inResources = false;
    }
    if (line === 'Resources:') {
      inResources = true;
      continue;
    }
    const sep = line.indexOf(': ');
    if (sep < 0) return null;
    const key = FIELD_KEYS[line.slice(0, sep)];
    if (!key || key === 'resources') return null;
    if (out[key] !== undefined) return null; // duplicate field
    (out as unknown as Record<string, unknown>)[key] = line.slice(sep + 2);
  }
  return out;
}

function isField(line: string): boolean {
  const sep = line.indexOf(': ');
  return (sep > 0 && line.slice(0, sep) in FIELD_KEYS) || line === 'Resources:';
}

export function isBase58Address(s: unknown): s is string {
  return typeof s === 'string' && BASE58_RE.test(s);
}

/** 7xKp…9fQ2 */
export function shortAddress(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
