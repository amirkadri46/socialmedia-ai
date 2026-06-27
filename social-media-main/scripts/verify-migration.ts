/**
 * Verify migration: compare local file counts with Supabase row counts.
 *
 * Run from the app/ directory:
 *   cd app && npx tsx ../scripts/verify-migration.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SECRET_KEY in ../.env (project root).
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";

// Load .env without the dotenv package (scripts/ has no node_modules)
const ENV_PATH = path.join(__dirname, "..", ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

const DATA_DIR = path.join(__dirname, "..", "data");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

function countCsv(file: string): number {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return 0;
  try {
    return (parse(fs.readFileSync(p, "utf8"), { columns: true, bom: true, skip_empty_lines: true }) as unknown[]).length;
  } catch { return 0; }
}

function countJson(file: string): number {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(data) ? data.length : 0;
  } catch { return 0; }
}

function countDir(dir: string): number {
  const p = path.join(DATA_DIR, dir);
  if (!fs.existsSync(p)) return 0;
  return fs.readdirSync(p).filter((f) => f.endsWith(".json")).length;
}

function countJsonNested(file: string, key: string): number {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return 0;
  try {
    const lists = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>[];
    return lists.reduce((sum, l) => sum + ((l[key] as unknown[])?.length ?? 0), 0);
  } catch { return 0; }
}

async function dbCount(table: string): Promise<number> {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log("🔍  Verifying migration…\n");

  const checks: Array<{ table: string; local: number; supabase?: number }> = [
    { table: "configs",                   local: countCsv("configs.csv") },
    { table: "creators",                  local: countCsv("creators.csv") },
    { table: "videos",                    local: countCsv("videos.csv") },
    { table: "offer_templates",           local: countJson("offer-templates.json") },
    { table: "prospect_lists",            local: countJson("outreach-lists.json") },
    { table: "prospects",                 local: countJsonNested("outreach-lists.json", "prospects") },
    { table: "clip_jobs",                 local: countJson("clip-jobs.json") },
    { table: "clips",                     local: countCsv("clips.csv") },
    { table: "clip_edits",               local: countDir("clip-edits") },
    { table: "clip_transcripts",         local: countDir("clip-transcripts") },
    { table: "social_accounts",          local: countJson("social-accounts.json") },
    { table: "scheduled_posts",          local: countJson("scheduled-posts.json") },
    { table: "caption_templates",        local: countJson("caption-templates.json") },
    { table: "caption_prompt_templates", local: countJson("caption-prompt-templates.json") },
  ];

  // Fetch supabase counts in parallel
  await Promise.all(checks.map(async (c) => {
    c.supabase = await dbCount(c.table);
  }));

  let allOk = true;
  console.log(
    "Table".padEnd(30) + "Local".padEnd(10) + "Supabase".padEnd(12) + "Status"
  );
  console.log("─".repeat(65));

  for (const c of checks) {
    const ok = c.supabase === c.local;
    if (!ok) allOk = false;
    const status = ok ? "✓" : `✗ (${c.supabase! - c.local} diff)`;
    console.log(
      c.table.padEnd(30) +
      String(c.local).padEnd(10) +
      String(c.supabase).padEnd(12) +
      status
    );
  }

  console.log("");
  if (allOk) {
    console.log("✅  All counts match — migration looks good!");
  } else {
    console.log("⚠️   Some counts differ — run migrate-to-supabase.ts again to sync.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Verify failed:", err.message);
  process.exit(1);
});
