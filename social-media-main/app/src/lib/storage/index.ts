import { createR2Provider } from "./r2";
import type { StorageProvider } from "./types";

// ponytail: single-process singleton; replace with per-request if edge runtime needed
let _provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!_provider) {
    const name = process.env.STORAGE_PROVIDER ?? "r2";
    if (name !== "r2") throw new Error(`Unknown storage provider: ${name}`);
    _provider = createR2Provider();
  }
  return _provider;
}

export type { StorageProvider } from "./types";
