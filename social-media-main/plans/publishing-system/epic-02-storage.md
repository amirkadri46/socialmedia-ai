# Epic 2 — Storage Layer (Cloudflare R2)

## Objective

Build a `StorageProvider` abstraction and implement it with Cloudflare R2. Every other feature that reads or writes files goes through this interface — nothing ever calls the S3/R2 SDK directly outside this module.

## Prerequisites

- Epic 1 complete
- Cloudflare R2 bucket created (private, no public access)
- R2 API token created with Object Read & Write permissions
- Environment variables set: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`

## Scope

- `StorageProvider` interface
- R2 implementation using `@aws-sdk/client-s3`
- Storage factory (singleton)
- Shared from both Next.js app AND worker process

## Out of Scope

- Anything that uses storage (Epic 3+)
- Supabase (Epic 1)
- UI (Epics 4–5)

---

## Step 1 — Install Dependencies

```bash
cd app
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

---

## Step 2 — StorageProvider Interface

Create `app/src/lib/storage/types.ts`:

```typescript
export interface UploadOptions {
  mimeType: string;
  /** Optional metadata to store alongside the object */
  metadata?: Record<string, string>;
}

export interface StorageProvider {
  /**
   * Upload a file buffer to the given key.
   * Key format: "videos/abc123.mp4" or "thumbnails/abc123.jpg"
   * Overwrites if the key already exists.
   */
  upload(key: string, buffer: Buffer, options: UploadOptions): Promise<void>;

  /**
   * Generate a pre-signed GET URL valid for expiresInSeconds.
   * Default: 21600 seconds (6 hours).
   * Use 6 hours for Instagram publishing (Instagram fetches async).
   * Use 3600 seconds (1 hour) for thumbnail display in UI.
   */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Permanently delete a file. Does not throw if key doesn't exist.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists. Returns false if not found.
   */
  exists(key: string): Promise<boolean>;
}
```

---

## Step 3 — R2 Implementation

Create `app/src/lib/storage/r2.ts`:

```typescript
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider, UploadOptions } from "./types";

export function createR2Provider(): StorageProvider {
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const bucket = process.env.R2_BUCKET_NAME!;

  return {
    async upload(key: string, buffer: Buffer, options: UploadOptions): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: options.mimeType,
          Metadata: options.metadata,
        })
      );
    },

    async getSignedUrl(key: string, expiresInSeconds = 21600): Promise<string> {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },

    async delete(key: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err: any) {
        // NoSuchKey is not an error — the file is already gone
        if (err?.Code !== "NoSuchKey") throw err;
      }
    },

    async exists(key: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

---

## Step 4 — Storage Factory

Create `app/src/lib/storage/index.ts`:

```typescript
import { createR2Provider } from "./r2";
import type { StorageProvider } from "./types";

let _provider: StorageProvider | null = null;

/**
 * Returns the configured StorageProvider singleton.
 * Currently always returns R2. To switch providers, change this function only.
 */
export function getStorageProvider(): StorageProvider {
  if (!_provider) {
    const providerName = process.env.STORAGE_PROVIDER ?? "r2";
    if (providerName === "r2") {
      _provider = createR2Provider();
    } else {
      throw new Error(`Unknown storage provider: ${providerName}`);
    }
  }
  return _provider;
}

export type { StorageProvider } from "./types";
```

---

## Step 5 — Worker-side Storage

The worker process (Epic 6) also needs storage access. Create `worker/lib/storage.ts` (this file is part of Epic 6's scope, but document the requirement here):

The worker imports the same `createR2Provider` from a relative path:
```
import { createR2Provider } from "../../app/src/lib/storage/r2";
```

This works because the worker's start command is `cd app && npx tsx ../worker/index.ts`, so `../../app/src` resolves correctly. Document this in Epic 6.

---

## Cloudflare R2 Setup Instructions

Include these steps in the plan for the developer to follow manually:

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → Create bucket
2. Bucket name: pick a name (e.g., `social-media-videos`)
3. **Do not enable public access** — bucket stays private
4. Go to R2 → Overview → Manage R2 API Tokens → Create API Token
5. Permissions: **Object Read & Write** on the specific bucket
6. Copy: Account ID, Access Key ID, Secret Access Key
7. R2 Endpoint format: `https://{ACCOUNT_ID}.r2.cloudflarestorage.com`
8. Add all four values to Railway env vars and local `.env`

---

## Acceptance Criteria

Epic 2 is complete when ALL of the following are true:

- [ ] `app/src/lib/storage/types.ts` — `StorageProvider` interface exported
- [ ] `app/src/lib/storage/r2.ts` — `createR2Provider()` fully implemented
- [ ] `app/src/lib/storage/index.ts` — `getStorageProvider()` factory exported
- [ ] Manual test: write a small Node script that calls `getStorageProvider().upload("test/hello.txt", Buffer.from("hello"), { mimeType: "text/plain" })` → verify file appears in R2 dashboard
- [ ] Manual test: `getStorageProvider().getSignedUrl("test/hello.txt")` → URL is accessible in browser and shows "hello"
- [ ] Manual test: `getStorageProvider().delete("test/hello.txt")` → file removed from R2 dashboard
- [ ] Manual test: `getStorageProvider().exists("test/hello.txt")` → returns `false` after deletion
- [ ] No TypeScript errors (`cd app && npx tsc --noEmit`)
- [ ] Existing clipping pipeline is completely unaffected
