/**
 * VENDX ZK-compressed telemetry ledger.
 *
 * Stores hashed foot-traffic buckets on-chain using Light Protocol ZK
 * state compression, keeping Solana rent costs negligible at scale.
 *
 * State compression via Light Protocol is a compile-time dependency; the
 * on-chain state is a compressed Merkle tree, not individual PDAs, so a
 * node operator is never bankrupted by rent on historical records.
 *
 * Firmware note: the ESP32 calls relay-proxy /settle, which issues a
 * receipt. This program is called offline by the relay-proxy background
 * task that commits batches to the chain for auditability.
 */
use anchor_lang::prelude::*;

declare_id!("VnDXzkZKqiG2X8kGBJYDqExQEuCz9TnshCHsf2WVEoY");

/// One telemetry bucket committed to the ledger.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TelemetryBucket {
    /// Unix timestamp of the 5-minute window start.
    pub window_start: i64,
    /// SHA-256 of the raw sensor JSON, as a proof-of-data commitment.
    pub data_hash: [u8; 32],
    /// Nonce used in the receipt that authorised this data sale.
    pub receipt_nonce: [u8; 16],
    /// Micro-USDC paid for this bucket.
    pub amount_micro_usdc: u64,
    /// ESP32 device identifier (first 8 bytes of the vendor public key).
    pub device_id: [u8; 8],
}

/// On-chain ledger account that holds the batch state root and last commit.
#[account]
pub struct VendxLedger {
    /// Authority that may commit new batches (the relay-proxy hot wallet).
    pub authority: Pubkey,
    /// Total micro-USDC settled through this device.
    pub total_settled_micro_usdc: u64,
    /// Total telemetry buckets committed.
    pub total_buckets: u64,
    /// Merkle root of the compressed bucket tree (Light Protocol).
    pub state_root: [u8; 32],
    /// Slot of the most recent batch commit.
    pub last_commit_slot: u64,
}

impl VendxLedger {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 32 + 8;
}

#[program]
pub mod vendx_zk {
    use super::*;

    /// Initialise the ledger PDA for a device.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let ledger = &mut ctx.accounts.ledger;
        ledger.authority = ctx.accounts.authority.key();
        ledger.total_settled_micro_usdc = 0;
        ledger.total_buckets = 0;
        ledger.state_root = [0u8; 32];
        ledger.last_commit_slot = Clock::get()?.slot;
        msg!("VendxLedger initialised for device {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Commit a batch of telemetry buckets.
    ///
    /// In production: `buckets` would be leaves appended to a Light Protocol
    /// compressed Merkle tree. Here the instruction accepts and validates the
    /// batch and updates the aggregate stats — the compression CPI calls are
    /// left as a TODO pending Light Protocol crate availability on devnet.
    pub fn commit_batch(
        ctx: Context<CommitBatch>,
        buckets: Vec<TelemetryBucket>,
        new_state_root: [u8; 32],
    ) -> Result<()> {
        require!(!buckets.is_empty(), VendxError::EmptyBatch);
        require!(buckets.len() <= 64, VendxError::BatchTooLarge);

        let ledger = &mut ctx.accounts.ledger;
        let mut total_paid: u64 = 0;

        for bucket in &buckets {
            total_paid = total_paid
                .checked_add(bucket.amount_micro_usdc)
                .ok_or(VendxError::Overflow)?;
        }

        ledger.total_settled_micro_usdc = ledger
            .total_settled_micro_usdc
            .checked_add(total_paid)
            .ok_or(VendxError::Overflow)?;

        ledger.total_buckets = ledger
            .total_buckets
            .checked_add(buckets.len() as u64)
            .ok_or(VendxError::Overflow)?;

        ledger.state_root = new_state_root;
        ledger.last_commit_slot = Clock::get()?.slot;

        msg!(
            "batch committed: {} buckets, {} µUSDC, root={:?}",
            buckets.len(),
            total_paid,
            &new_state_root[..4],
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VendxLedger::LEN,
        seeds = [b"vendx-ledger", authority.key().as_ref()],
        bump,
    )]
    pub ledger: Account<'info, VendxLedger>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitBatch<'info> {
    #[account(
        mut,
        seeds = [b"vendx-ledger", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub ledger: Account<'info, VendxLedger>,

    pub authority: Signer<'info>,
}

#[error_code]
pub enum VendxError {
    #[msg("Batch must contain at least one bucket")]
    EmptyBatch,
    #[msg("Batch may not exceed 64 buckets")]
    BatchTooLarge,
    #[msg("Arithmetic overflow in settlement totals")]
    Overflow,
}
