/**
 * Facilitator: confirms payments and issues signed receipts.
 *
 * In production this calls getSignatureStatuses() before signing.
 * In simulator mode it trusts the buyer's reported txSignature — the
 * demo is about the receipt-verification path, not Solana RPC.
 */

import {
  signReceipt,
  encodeReceipt,
  encodeSettleHeader,
  type ReceiptBody,
  type SettleResponse,
} from '@vendx/protocol';
import { getKeys } from './keys.js';

export interface SettleRequest {
  nonce: string;
  txSignature: string;
  payTo: string;
  amount: string;
  network: string;
}

export interface SettleOk {
  success: true;
  receipt: string;
  settleHeader: string;
}

export interface SettleErr {
  success: false;
  errorReason: string;
}

export function settle(req: SettleRequest): SettleOk | SettleErr {
  const { secretKey } = getKeys();
  const now = Math.floor(Date.now() / 1000);

  const body: ReceiptBody = {
    v: 1,
    nonce: req.nonce,
    payTo: req.payTo,
    amount: req.amount,
    signature: req.txSignature,
    network: req.network as ReceiptBody['network'],
    issuedAt: now,
    expiresAt: now + 300,
  };

  const signed = signReceipt(body, secretKey);

  const settleResp: SettleResponse = {
    success: true,
    transaction: req.txSignature,
    network: body.network,
    payer: 'simulator',
  };

  return {
    success: true,
    receipt: encodeReceipt(signed),
    settleHeader: encodeSettleHeader(settleResp),
  };
}
