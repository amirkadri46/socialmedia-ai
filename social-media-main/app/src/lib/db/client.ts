import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side client: uses secret key, bypasses RLS. Never expose to browser.
// Memoized so all repo calls within a process share one TLS connection pool.
let _server: SupabaseClient | null = null;
const isBuild = process.env.npm_lifecycle_event === "build" || process.env.NEXT_PHASE === "phase-production-build";

export function serverClient(): SupabaseClient {
  if (_server) return _server;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!isBuild && (!url || !key)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set when STORAGE_BACKEND=supabase");
  }
  _server = createClient(url || "https://example.supabase.co", key || "build-placeholder", { auth: { persistSession: false } });
  return _server;
}

// Browser-side client: uses publishable key, only for reading auth session in middleware.
// Import this only in client components or middleware — never in API routes.
export function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!isBuild && (!url || !key)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  return createClient(url || "https://example.supabase.co", key || "build-placeholder");
}
