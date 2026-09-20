/**
 * Public Supabase settings, inlined at build time. Everything that needs
 * auth degrades to "not configured" when these are absent, so a checkout
 * without .env.local still renders every page (and the relay-down smoke
 * tests stay green).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function hasSupabaseEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}
