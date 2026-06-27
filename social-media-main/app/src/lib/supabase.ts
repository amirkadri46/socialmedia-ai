import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const isBuild = process.env.npm_lifecycle_event === "build" || process.env.NEXT_PHASE === "phase-production-build";

if (!isBuild && !supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
if (!isBuild && !serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
if (!isBuild && !publicKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
}

/**
 * Server-side Supabase client. Uses service role key — full database access.
 * Never import this in client components or expose to the browser.
 */
export const supabaseServer = createClient(
  supabaseUrl || "https://example.supabase.co",
  serviceRoleKey || "build-placeholder",
  { auth: { persistSession: false } }
);

/**
 * Public Supabase client. Uses anon key — safe for browser use.
 * Only needed for real-time subscriptions (future). All data fetching
 * goes through API routes using supabaseServer.
 */
export const supabasePublic = createClient(
  supabaseUrl || "https://example.supabase.co",
  publicKey || "build-placeholder"
);
