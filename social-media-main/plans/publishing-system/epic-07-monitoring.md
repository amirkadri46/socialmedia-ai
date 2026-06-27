# Epic 7 — Monitoring (Queue + Publish History)

## Objective

Build the two monitoring pages: Queue (`/campaigns/queue`) shows all pending/active upload jobs across all campaigns, and History (`/campaigns/history`) shows the immutable publish audit log. Both are read-only views — no publishing actions here.

## Prerequisites

- Epic 6 complete (worker is running and creating real rows in `upload_jobs` and `publish_history`)

## Scope

- `GET /api/upload-jobs` — query upload_jobs with filters
- `GET /api/publish-history` — query publish_history with filters
- `/campaigns/queue` page
- `/campaigns/history` page
- Shared `StatusBadge` and `PlatformBadge` components (if not already created in earlier epics)

## Out of Scope

- Any write actions (cancel/retry are future)
- Analytics charts (not in v1)
- Email/Slack notifications

---

## Step 1 — Upload Jobs API

Create `app/src/app/api/upload-jobs/route.ts`:

**GET** — query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `campaign_id` | string | filter by campaign |
| `account_id` | string | filter by account |
| `status` | string | queued\|preparing\|uploading\|waiting_for_instagram\|publishing\|published\|failed |
| `from` | ISO date | scheduled_at >= from |
| `to` | ISO date | scheduled_at <= to |
| `limit` | number | default 50 |
| `offset` | number | default 0 |

Response: `{ jobs: UploadJobRow[]; total: number }`

Each `UploadJobRow`:
```typescript
{
  id: string;
  campaign_id: string;
  campaign_name: string;     // joined from campaigns
  video_id: string;
  video_title: string;       // joined from videos
  account_id: string;
  account_username: string;  // joined from instagram_accounts
  status: string;
  scheduled_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  instagram_media_id: string | null;
  published_at: string | null;
  retry_count: number;
  error_message: string | null;
}
```

Implementation — use `uploadJobRepository.findWithFilters(filters)`. This method does a Supabase query joining `campaigns(name)`, `videos(title)`, `instagram_accounts(username)`.

### Upload Jobs Repository method

Add to `app/src/lib/db/repositories/upload-job-repository.ts`:

```typescript
async findWithFilters(filters: {
  campaign_id?: string;
  account_id?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: UploadJobWithMeta[]; total: number }> {
  let query = supabaseServer
    .from("upload_jobs")
    .select(
      `*, campaigns(name), videos(title), instagram_accounts(username)`,
      { count: "exact" }
    )
    .order("scheduled_at", { ascending: true });

  if (filters.campaign_id) query = query.eq("campaign_id", filters.campaign_id);
  if (filters.account_id) query = query.eq("account_id", filters.account_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.from) query = query.gte("scheduled_at", filters.from);
  if (filters.to) query = query.lte("scheduled_at", filters.to);
  query = query.range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    rows: (data ?? []).map((row: any) => ({
      ...row,
      campaign_name: row.campaigns?.name ?? "",
      video_title: row.videos?.title ?? "",
      account_username: row.instagram_accounts?.username ?? "",
    })),
    total: count ?? 0,
  };
}
```

---

## Step 2 — Publish History API

Create `app/src/app/api/publish-history/route.ts`:

**GET** — query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `account_id` | string | filter by account |
| `video_id` | string | filter by video |
| `from` | ISO date | published_at >= from |
| `to` | ISO date | published_at <= to |
| `limit` | number | default 50 |
| `offset` | number | default 0 |

Response: `{ entries: PublishHistoryRow[]; total: number }`

Each `PublishHistoryRow`:
```typescript
{
  id: string;
  job_id: string;
  video_id: string;
  video_title: string;       // joined
  video_thumbnail_key: string | null;  // joined (generate signed URL in service)
  account_id: string;
  account_username: string;  // joined
  instagram_media_id: string;
  published_at: string;
  created_at: string;
}
```

### Publish History Repository method

Add to `app/src/lib/db/repositories/publish-history-repository.ts`:

```typescript
async findWithFilters(filters: {
  account_id?: string;
  video_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: any[]; total: number }> {
  let query = supabaseServer
    .from("publish_history")
    .select(
      `*, videos(title, thumbnail_object_id), instagram_accounts(username)`,
      { count: "exact" }
    )
    .order("published_at", { ascending: false });

  if (filters.account_id) query = query.eq("account_id", filters.account_id);
  if (filters.video_id) query = query.eq("video_id", filters.video_id);
  if (filters.from) query = query.gte("published_at", filters.from);
  if (filters.to) query = query.lte("published_at", filters.to);
  query = query.range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    rows: (data ?? []).map((row: any) => ({
      ...row,
      video_title: row.videos?.title ?? "",
      video_thumbnail_key: row.videos?.thumbnail_object_id ?? null,
      account_username: row.instagram_accounts?.username ?? "",
    })),
    total: count ?? 0,
  };
}
```

The API route should generate a signed thumbnail URL from `video_thumbnail_key` using `getStorageProvider().getSignedUrl(key, 3600)` for each row that has one.

---

## Step 3 — Queue Page

Create `app/src/app/campaigns/queue/page.tsx` (client component).

State:
```typescript
const [jobs, setJobs] = useState<UploadJobRow[]>([]);
const [total, setTotal] = useState(0);
const [loading, setLoading] = useState(true);
const [filters, setFilters] = useState({
  status: "",
  campaign_id: "",
  from: "",
  to: "",
});
const [page, setPage] = useState(0);
const PAGE_SIZE = 50;
```

Auto-refresh: `setInterval(fetchJobs, 15000)` — the queue is live, refresh every 15 seconds.

Layout:
```
Page header: "Upload Queue"
             "{total} total jobs"

Filter bar (one line):
  Status: [All | Queued | Preparing | Uploading | Waiting | Publishing | Published | Failed]
  Campaign: [dropdown from GET /api/campaigns]
  Date range: [from] [to]

Summary counters (small cards):
  Queued: X  |  In Progress: X  |  Published: X  |  Failed: X

Jobs table:
  Columns: Campaign | Video | Account | Scheduled | Status | Retries | Error
```

Table rows:
- **Campaign** name
- **Video** title (truncated to 30 chars)
- **Account** username (`@username`)
- **Scheduled** formatted as `"Mon Jun 30, 2:00 PM"` in local time
- **Status** badge with color coding:
  - `queued` → slate
  - `preparing` → blue
  - `uploading` → blue
  - `waiting_for_instagram` → yellow (with pulsing dot)
  - `publishing` → blue
  - `published` → green
  - `failed` → red
- **Retries** number (only show if > 0, else `–`)
- **Error** truncated error message (tooltip with full text)

Pagination: Previous / Next buttons at bottom, showing `"Showing 1–50 of {total}"`.

Empty state: "No jobs in queue." with a `[Go to Campaigns]` button.

---

## Step 4 — History Page

Create `app/src/app/campaigns/history/page.tsx` (client component).

State:
```typescript
const [entries, setEntries] = useState<PublishHistoryRow[]>([]);
const [total, setTotal] = useState(0);
const [loading, setLoading] = useState(true);
const [filters, setFilters] = useState({
  account_id: "",
  from: "",
  to: "",
});
const [page, setPage] = useState(0);
const PAGE_SIZE = 50;
```

Layout:
```
Page header: "Publish History"
             "{total} total published videos"

Filter bar:
  Account: [dropdown from GET /api/accounts]
  Date range: [from] [to]

Stats: Total Published: X | This Month: X | This Week: X | Today: X

History table:
  Columns: Thumbnail | Video | Account | Published | Instagram ID
```

Table rows:
- **Thumbnail**: 40x40 rounded image, or grey `Film` icon if null
- **Video**: title + creator below in smaller text
- **Account**: `@username`
- **Published**: formatted as `"Mon Jun 30, 2026 at 2:03 PM"`
- **Instagram ID**: `media_{id}` as a truncated monospace string. No link needed (the post URL isn't stored — this is the media ID, not a permalink).

Pagination: same as Queue page.

No "Delete" or "Undo" button — history is immutable and append-only by design. If the user asks why they can't delete entries, the page should have a tooltip/info note: "Publish history is an audit log and cannot be modified."

---

## Step 5 — Campaign Detail Page Update

Epic 5 built `app/src/app/campaigns/[id]/page.tsx`. Update it to add a fifth tab:

**Tab: "Jobs"** — fetch `GET /api/upload-jobs?campaign_id={id}` and show a condensed table:

Columns: Video | Account | Scheduled | Status | Retries

Show counts at the top: `X queued · X published · X failed`

Link at bottom: `[View all jobs in Queue →]` → `/campaigns/queue?campaign_id={id}`

---

## Acceptance Criteria

Epic 7 is complete when ALL of the following are true:

- [ ] `GET /api/upload-jobs` returns real rows with campaign_name, video_title, account_username joined correctly
- [ ] `GET /api/publish-history` returns real rows ordered by published_at desc
- [ ] `/campaigns/queue` loads and shows the job table with correct status badges
- [ ] Status filter on Queue page works
- [ ] Queue page auto-refreshes every 15 seconds (verify by watching a job status change)
- [ ] Summary counters (Queued / In Progress / Published / Failed) show correct counts
- [ ] `/campaigns/history` loads and shows published videos with thumbnails
- [ ] Account filter on History page works
- [ ] Date range filter on History page works
- [ ] Campaign detail page shows a "Jobs" tab with job counts
- [ ] No TypeScript errors (`cd app && npx tsc --noEmit`)
- [ ] Existing clipping pipeline is completely unaffected
