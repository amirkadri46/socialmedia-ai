export interface UploadOptions {
  mimeType: string;
  metadata?: Record<string, string>;
}

export interface StorageProvider {
  upload(key: string, buffer: Buffer, options: UploadOptions): Promise<void>;
  /** Default: 21600s (6h) — long enough for Instagram's async fetch */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Does not throw if key doesn't exist */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
