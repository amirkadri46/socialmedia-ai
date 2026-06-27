import type { Config } from "@/lib/types";
import { readConfigs, writeConfigs } from "@/lib/csv";
import { serverClient } from "../client";

export interface ConfigsRepo {
  getAll(): Promise<Config[]>;
  upsert(config: Config): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileConfigs: ConfigsRepo = {
  async getAll() { return readConfigs(); },
  async upsert(config) {
    const all = readConfigs();
    const idx = all.findIndex((c) => c.id === config.id);
    if (idx >= 0) all[idx] = config; else all.push(config);
    writeConfigs(all);
  },
  async delete(id) {
    writeConfigs(readConfigs().filter((c) => c.id !== id));
  },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): Config {
  return {
    id: r.id as string,
    configName: r.config_name as string,
    creatorsCategory: r.creators_category as string,
    analysisInstruction: r.analysis_instruction as string,
    newConceptsInstruction: r.new_concepts_instruction as string,
  };
}

function toRow(c: Config) {
  return {
    id: c.id,
    config_name: c.configName,
    creators_category: c.creatorsCategory,
    analysis_instruction: c.analysisInstruction,
    new_concepts_instruction: c.newConceptsInstruction,
  };
}

export const supabaseConfigs: ConfigsRepo = {
  async getAll() {
    const { data, error } = await serverClient().from("configs").select("*").order("created_at");
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async upsert(config) {
    const { error } = await serverClient().from("configs").upsert(toRow(config));
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("configs").delete().eq("id", id);
    if (error) throw error;
  },
};
