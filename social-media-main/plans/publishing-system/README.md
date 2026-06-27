# Publishing System — Epic Index

Implement one epic per Claude Code session. Do not begin the next epic until the current one passes all acceptance criteria.

## Epics

| # | Epic | Scope | Lines est. |
|---|------|-------|-----------|
| 1 | [Foundation](./epic-01-foundation.md) | Supabase schema, clients, repositories, account migration | ~800 |
| 2 | [Storage Layer](./epic-02-storage.md) | StorageProvider interface, Cloudflare R2 implementation | ~300 |
| 3 | [Video Ingestion](./epic-03-ingestion.md) | Downloader → R2 → Supabase, library API routes | ~600 |
| 4 | [Video Library UI](./epic-04-library-ui.md) | Library page, grid, filters, preview modal, captions | ~800 |
| 5 | [Campaigns](./epic-05-campaigns.md) | Campaign service, API routes, full campaign UI | ~1200 |
| 6 | [Worker](./epic-06-worker.md) | Campaign runner, publisher worker, Instagram publisher, token refresh | ~1000 |
| 7 | [Monitoring](./epic-07-monitoring.md) | Queue page, publish history page, monitoring APIs | ~500 |

## Global Implementation Rules

These rules apply to every epic. Claude must not deviate from them.

1. **Never break the existing clipping pipeline.** Do not modify any file under `lib/clip/`, `app/clip/`, or `api/clip/` unless explicitly instructed by the epic.
2. **Existing APIs remain backward compatible.** Do not change response shapes of existing API routes.
3. **No placeholder implementations.** Every function must be fully implemented. No `// TODO`, no `return null` stubs.
4. **No mock data.** All data comes from real sources (Supabase, R2). No hardcoded arrays.
5. **One epic at a time.** Do not implement anything outside the current epic's scope.
6. **Stop and report when an epic is complete.** List every file created/modified and confirm all acceptance criteria pass.
7. **Check before creating.** If a file already exists at a given path, read it first and extend it — do not overwrite working code.
8. **API routes must be tested before UI.** If an epic includes both API routes and UI, verify the API routes work before building the UI components.

## Architecture Layers (enforced across all epics)

```
React Component
    ↓
API Route (app/src/app/api/*)
    ↓
Service (app/src/lib/services/*)
    ↓
Repository (app/src/lib/db/repositories/*)
    ↓
Supabase
```

```
Worker
    ↓
Service (app/src/lib/services/* OR worker/services/*)
    ↓
Repository (shared)
    ↓
Supabase
```

React components and worker code never call Supabase directly.  
API routes never call Supabase directly.  
Workers never call the Instagram API directly — they call `InstagramPublisher`.

## Environment Variables Required

Add these to Railway (both services) and your local `.env` before starting Epic 1:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Cloudflare R2 (needed from Epic 2)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com

# Worker identity (needed from Epic 6)
WORKER_ID=worker-1
```
