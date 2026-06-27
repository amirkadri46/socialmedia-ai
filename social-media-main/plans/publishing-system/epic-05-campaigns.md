# Epic 5 — Campaigns

## Objective

Build the full Campaigns feature: a `CampaignService`, all campaign API routes, and a multi-step campaign creation UI that lets the user select videos from the Library, pick accounts, set a schedule rule, preview the generated timeline, and publish. After clicking Publish, the campaign status becomes `running` and the Campaign Runner (Epic 6) takes over.

## Prerequisites

- Epic 4 complete (Video Library UI and API working)
- At least one `instagram_accounts` row in Supabase (migrated in Epic 1)

## Scope

- `CampaignService` and `ScheduleService`
- All campaign API routes
- Sidebar update: add Campaigns section
- Campaign list page (`/campaigns`)
- Campaign create page (`/campaigns/new`) — multi-step
- Campaign detail page (`/campaigns/[id]`)
- Components: `ScheduleRuleEditor`, `VideoSelector`, `AccountSelector`, `CampaignPreviewCard`

## Out of Scope

- Actual publishing (Epic 6)
- Queue and history pages (Epic 7)
- Analytics

---

## Step 1 — Install Dependencies

```bash
cd app
npm install date-fns date-fns-tz
```

---

## Step 2 — Schedule Service

Create `app/src/lib/services/schedule-service.ts`.

This is a pure utility module — no Supabase, no side effects. Used by both the preview API and the Campaign Runner.

```typescript
import { addHours, parseISO, setHours, setMinutes, startOfDay, addDays, isAfter, isBefore } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { ScheduleRule } from "@/lib/db/types";

/**
 * Given a schedule rule and a reference datetime, returns the next valid
 * posting slot strictly AFTER `from`. Respects timezone and publishing window.
 */
export function computeNextSlot(rule: ScheduleRule, from: Date): Date {
  const tz = rule.timezone;
  // Convert 'from' to the campaign's timezone
  let candidate = toZonedTime(addHours(from, rule.frequencyHours), tz);

  // Parse window boundaries in campaign timezone
  const [winStartH, winStartM] = rule.windowStart.split(":").map(Number);
  const [winEndH, winEndM] = rule.windowEnd.split(":").map(Number);

  // Adjust candidate to be within the publishing window
  const candidateDay = startOfDay(candidate);
  const windowStart = setMinutes(setHours(candidateDay, winStartH), winStartM);
  const windowEnd = setMinutes(setHours(candidateDay, winEndH), winEndM);

  if (isBefore(candidate, windowStart)) {
    candidate = windowStart;
  } else if (isAfter(candidate, windowEnd)) {
    // Move to window start of next day
    const nextDay = addDays(candidateDay, 1);
    candidate = setMinutes(setHours(nextDay, winStartH), winStartM);
  }

  // Convert back to UTC
  return fromZonedTime(candidate, tz);
}

/**
 * Compute the first slot for a campaign starting from rule.startDate.
 */
export function computeFirstSlot(rule: ScheduleRule): Date {
  const tz = rule.timezone;
  const [winStartH, winStartM] = rule.windowStart.split(":").map(Number);
  const startDate = parseISO(rule.startDate);
  const zonedStart = toZonedTime(startDate, tz);
  const firstSlot = setMinutes(setHours(startOfDay(zonedStart), winStartH), winStartM);
  return fromZonedTime(firstSlot, tz);
}

export interface CampaignPreview {
  totalJobs: number;
  estimatedDurationDays: number;
  firstPost: string;   // ISO string
  lastPost: string;    // ISO string
}

/**
 * Calculate the full campaign schedule preview without creating any database rows.
 */
export function calculatePreview(
  videoCount: number,
  accountCount: number,
  rule: ScheduleRule
): CampaignPreview {
  const totalJobs = videoCount * accountCount;
  if (totalJobs === 0) return { totalJobs: 0, estimatedDurationDays: 0, firstPost: "", lastPost: "" };

  const firstPost = computeFirstSlot(rule);

  // Walk through slots to find the last one (for videoCount slots, since each slot serves all accounts)
  let current = firstPost;
  for (let i = 1; i < videoCount; i++) {
    current = computeNextSlot(rule, current);
  }
  const lastPost = current;

  const durationMs = lastPost.getTime() - firstPost.getTime();
  const estimatedDurationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

  return {
    totalJobs,
    estimatedDurationDays,
    firstPost: firstPost.toISOString(),
    lastPost: lastPost.toISOString(),
  };
}
```

---

## Step 3 — CampaignService

Create `app/src/lib/services/campaign-service.ts`:

```typescript
import { campaignRepository, videoRepository, accountRepository } from "@/lib/db/repositories";
import { calculatePreview } from "./schedule-service";
import type { Campaign, ScheduleRule, CampaignStatus } from "@/lib/db/types";
import { v4 as uuid } from "uuid";

export const campaignService = {
  async listAll(): Promise<Campaign[]> {
    return campaignRepository.findAll();
  },

  async getById(id: string): Promise<Campaign | null> {
    return campaignRepository.findById(id);
  },

  async create(data: {
    name: string;
    captionPromptTemplate?: string;
    scheduleRule: ScheduleRule;
    timezone: string;
    startsAt?: string;
  }): Promise<Campaign> {
    return campaignRepository.create({
      name: data.name,
      status: "draft",
      caption_prompt_template: data.captionPromptTemplate ?? null,
      assignment_mode: "crosspost",
      schedule_rule: data.scheduleRule,
      timezone: data.timezone,
      starts_at: data.startsAt ?? null,
    });
  },

  async update(id: string, data: Partial<Campaign>): Promise<Campaign> {
    return campaignRepository.update(id, { ...data, updated_at: new Date().toISOString() });
  },

  async delete(id: string): Promise<void> {
    // Cancel all queued jobs first
    // (upload_job cancellation handled in Epic 6 worker; here just mark campaign cancelled)
    await campaignRepository.update(id, { status: "cancelled" });
    await campaignRepository.delete(id);
  },

  async getPreview(id: string): Promise<ReturnType<typeof calculatePreview>> {
    const campaign = await campaignRepository.findById(id);
    if (!campaign) throw new Error("Campaign not found");

    const videos = await campaignRepository.getVideos(id);
    const accounts = await campaignRepository.getAccounts(id);
    const activeVideos = videos.filter(v => !v.skipped).length;

    return calculatePreview(activeVideos, accounts.length, campaign.schedule_rule);
  },

  async publish(id: string): Promise<void> {
    const campaign = await campaignRepository.findById(id);
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status !== "draft" && campaign.status !== "ready") {
      throw new Error(`Campaign is ${campaign.status} — cannot publish`);
    }

    const videos = await campaignRepository.getVideos(id);
    const accounts = await campaignRepository.getAccounts(id);
    if (videos.length === 0) throw new Error("Campaign has no videos");
    if (accounts.length === 0) throw new Error("Campaign has no accounts");

    await campaignRepository.update(id, { status: "running" });

    // Seed runner state (cursor starts at 0)
    await campaignRepository.upsertRunnerState({
      campaign_id: id,
      cursor: 0,
      last_tick: null,
      locked_until: null,
      worker_id: null,
    });
  },

  async pause(id: string): Promise<void> {
    await campaignRepository.update(id, { status: "paused" });
  },

  async resume(id: string): Promise<void> {
    await campaignRepository.update(id, { status: "running" });
  },
};
```

---

## Step 4 — Campaign API Routes

### `app/src/app/api/campaigns/route.ts`

- **GET** → `campaignService.listAll()`, return array
- **POST** → body: `{ name, captionPromptTemplate, scheduleRule, timezone }` → `campaignService.create(body)`, return created campaign

### `app/src/app/api/campaigns/[id]/route.ts`

- **GET** → `campaignService.getById(id)`, 404 if null
- **PATCH** → `campaignService.update(id, body)`
- **DELETE** → `campaignService.delete(id)`, return `{ ok: true }`

### `app/src/app/api/campaigns/[id]/preview/route.ts`

- **GET** → `campaignService.getPreview(id)`, return `CampaignPreview`

### `app/src/app/api/campaigns/[id]/publish/route.ts`

- **POST** → `campaignService.publish(id)`, return `{ ok: true }`

### `app/src/app/api/campaigns/[id]/pause/route.ts`

- **POST** → `campaignService.pause(id)`, return `{ ok: true }`

### `app/src/app/api/campaigns/[id]/resume/route.ts`

- **POST** → `campaignService.resume(id)`, return `{ ok: true }`

### `app/src/app/api/campaigns/[id]/videos/route.ts`

- **GET** → `campaignRepository.getVideos(id)` joined with video metadata
- **POST** body: `{ videoId, position }` → `campaignRepository.addVideo(id, videoId, position)`
- **DELETE** body: `{ videoId }` → `campaignRepository.removeVideo(id, videoId)`
- **PATCH** body: `{ orderedVideoIds: string[] }` → `campaignRepository.reorderVideos(id, orderedVideoIds)`

### `app/src/app/api/campaigns/[id]/accounts/route.ts`

- **GET** → `campaignRepository.getAccounts(id)` joined with account details from `accountRepository`
- **POST** body: `{ accountId }` → `campaignRepository.addAccount(id, accountId)`
- **DELETE** body: `{ accountId }` → `campaignRepository.removeAccount(id, accountId)`

---

## Step 5 — Sidebar Update

Edit `app/src/components/app-sidebar.tsx`.

Add **after** the `"library"` section and **before** `"downloader"`:

```typescript
{
  id: "campaigns",
  icon: Megaphone,
  label: "Campaigns",
  items: [
    { title: "Campaigns", href: "/campaigns", icon: Megaphone },
    { title: "Queue", href: "/campaigns/queue", icon: ListChecks },
    { title: "History", href: "/campaigns/history", icon: History },
  ],
},
```

Import `Megaphone`, `ListChecks`, `History` from lucide-react.

Update `getSectionFromPath`:
```typescript
if (pathname.startsWith("/campaigns")) return "campaigns";
```

---

## Step 6 — UI Components

### `components/campaigns/schedule-rule-editor.tsx`

Props: `value: ScheduleRule; onChange: (rule: ScheduleRule) => void`

Fields (use shadcn `Select`, `Input`, `Label`):
- **Frequency**: Select — `1h / 2h / 3h / 4h / 6h / 8h / 12h / 24h` → sets `frequencyHours`
- **Publishing window**: two Selects side by side — Start: `6:00 AM` to `11:00 PM` (hourly), End: same — sets `windowStart`, `windowEnd`
- **Timezone**: Select with common timezones: `Asia/Kolkata`, `America/New_York`, `America/Los_Angeles`, `Europe/London`, `Europe/Berlin`, `Asia/Tokyo`, `Asia/Dubai`, `UTC`
- **Start date**: `<Input type="date">` → sets `startDate`
- **Randomize**: Select — `None / ±5 min / ±10 min / ±15 min / ±30 min` → sets `randomizeMinutes`

### `components/campaigns/video-selector.tsx`

Props: `selectedIds: string[]; onChange: (ids: string[]) => void`

A scrollable panel showing the Video Library (fetches `GET /api/library`) with:
- Search input at top
- Platform filter
- Each video row: checkbox + thumbnail + title + creator + duration
- "X videos selected" counter at bottom
- [Select All] button

### `components/campaigns/account-selector.tsx`

Props: `selectedIds: string[]; onChange: (ids: string[]) => void`

Fetches `GET /api/accounts` (create this simple route: reads from `accountRepository.findAll()`).

Shows each account as a row: checkbox + username + status badge (green dot = connected, red = needs_reauth).

Accounts with `status === "needs_reauth"` should be shown with a warning and be unselectable.

### `components/campaigns/campaign-preview-card.tsx`

Props: `campaignId: string; videoCount: number; accountCount: number`

Fetches `GET /api/campaigns/{id}/preview` when videoCount or accountCount changes.

Displays a card:
```
Campaign Preview
─────────────────────────────
Videos selected:   120
Accounts:           40
Total jobs:       4,800
Frequency:    Every 3 hours
Window:        9:00 – 22:00
Estimated:        15 days
─────────────────────────────
First post:  Mon July 1, 9:00 AM IST
Last post:   Tue July 16, 6:00 PM IST
```

Show a loading skeleton while fetching. Show "Select videos and accounts to see preview" if counts are zero.

---

## Step 7 — Campaign Pages

### `app/src/app/campaigns/page.tsx` (client component)

Fetches `GET /api/campaigns`. Shows a table:

Columns: Name | Status | Videos | Accounts | Started | Actions

Status badge colors:
- `draft` → grey
- `ready` → blue
- `scheduled` → blue
- `running` → green (with pulsing dot)
- `paused` → orange
- `completed` → green (static)
- `cancelled` → red strikethrough

Actions per row:
- [Manage] → `/campaigns/[id]`
- [Pause] (if running) → POST `/api/campaigns/[id]/pause`
- [Resume] (if paused) → POST `/api/campaigns/[id]/resume`

[+ New Campaign] button top right → `/campaigns/new`.

Empty state: `Megaphone` icon + "No campaigns yet." + [Create Campaign] button.

### `app/src/app/campaigns/new/page.tsx` (client component)

Multi-step wizard with a step indicator (1–4).

**Step 1 — Details:**
- Campaign name Input (required)
- Caption prompt template Textarea (optional, shows default placeholder)
- [Next →] button

**Step 2 — Select Videos:**
- `<VideoSelector>` component (full height, scrollable)
- Must have at least 1 video selected to proceed
- [← Back] [Next →]

**Step 3 — Select Accounts:**
- `<AccountSelector>` component
- Must have at least 1 account selected to proceed
- [← Back] [Next →]

**Step 4 — Schedule & Publish:**
- `<ScheduleRuleEditor>` component
- `<CampaignPreviewCard>` (live preview updates as schedule changes)
- [Save as Draft] button → creates campaign + adds videos + accounts, status='draft', redirects to `/campaigns`
- [Publish Campaign] button → creates campaign + adds videos + accounts + calls publish endpoint, redirects to `/campaigns`

Flow for both buttons:
1. POST `/api/campaigns` → get `{ id }`
2. POST `/api/campaigns/{id}/videos` for each selected video (in order)
3. POST `/api/campaigns/{id}/accounts` for each selected account
4. If "Publish": POST `/api/campaigns/{id}/publish`
5. Redirect

Show a loading spinner on both buttons while the above runs.

### `app/src/app/campaigns/[id]/page.tsx` (client component)

Campaign detail view. Fetches campaign + videos + accounts + jobs count.

Shows:
- Campaign name (editable inline)
- Status badge + action buttons (Pause/Resume/Cancel)
- Three-column summary: Videos | Accounts | Jobs (pending / published / failed)
- Tab: "Videos" — ordered list of campaign videos with position, skip toggle
- Tab: "Accounts" — list of accounts in this campaign
- Tab: "Schedule" — `<ScheduleRuleEditor>` (editable only if draft/paused)
- Tab: "Preview" — `<CampaignPreviewCard>`

---

## Acceptance Criteria

Epic 5 is complete when ALL of the following are true:

- [ ] Sidebar shows "Campaigns" section with Campaigns, Queue, History nav items
- [ ] `/campaigns` loads and lists all campaigns with correct status badges
- [ ] Creating a new campaign through the wizard completes without error
- [ ] After creation, campaign appears in Supabase `campaigns` table
- [ ] Selected videos appear in `campaign_videos` table with correct `position` ordering
- [ ] Selected accounts appear in `campaign_accounts` table
- [ ] Campaign Preview card shows accurate `totalJobs`, `firstPost`, `lastPost`
- [ ] "Save as Draft" creates campaign with `status='draft'`
- [ ] "Publish Campaign" sets `status='running'` and seeds `campaign_runner_state` in Supabase
- [ ] Campaign detail page loads and shows all four tabs with real data
- [ ] Pause and Resume buttons update campaign status correctly
- [ ] `GET /api/accounts` returns connected Instagram accounts
- [ ] No TypeScript errors (`cd app && npx tsc --noEmit`)
- [ ] Existing clipping pipeline is completely unaffected
