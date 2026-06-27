import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side client: uses secret key, bypasses RLS. Never expose to browser.
// Memoized so all repo calls within a process share one TLS connection pool.
let _server: SupabaseClient | null = null;
export function serverClient(): SupabaseClient {
  if (_server) return _server;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set when STORAGE_BACKEND=supabase");
  }
  _server = createClient(url, key, { auth: { persistSession: false } });
  return _server;
}

// Browser-side client: uses publishable key, only for reading auth session in middleware.
// Import this only in client components or middleware — never in API routes.
export function browserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set");
  }
  return createClient(url, key);
}
