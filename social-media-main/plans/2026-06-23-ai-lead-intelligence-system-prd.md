# AI Lead Intelligence System — PRD

**Status:** Proposed
**Date:** 2026-06-23
**Owner:** Aamir
**Builds on:** the existing Outreach vertical (`/outreach/*`, `lib/outreach.ts`, `data/outreach-lists.json`)

---

## 0. TL;DR for Claude Code

Turn the existing **CSV → Prospect → Draft Message** outreach flow into a full **Lead Intelligence System**:

```
Google Maps CSV → AI Analysis → Lead Priority → AI Personalization → Outreach Workflow (CRM)
```

**This is an EXTENSION, not a rewrite.** The current Outreach feature (LinkedIn prospect import + draft) **stays exactly as it is**. We add Google-Maps-style local-business leads, AI priority scoring, multi-channel message generation (WhatsApp / Email / Cold Call), a lead pipeline (CRM statuses), filtering, bulk processing, and a dashboard — all on top of the **same `Prospect` / `ProspectList` model and the same `data/outreach-lists.json` store.**

### The one rule: extend, do not duplicate

Before creating any new type, route, page, helper, or field, check whether it already exists in the list below and **reuse / extend it**. Only create something new when there is no existing equivalent.

| Concern | Already exists — REUSE | Action |
|---|---|---|
| Lead record | `Prospect` (`lib/types.ts`) | **Add fields**, don't make a second type |
| List of leads | `ProspectList` (`lib/types.ts`) | Reuse as-is |
| Store read/write | `lib/outreach.ts` (`readProspectLists`, `writeProspectLists`, `writeProspectListAsCsv`) | Reuse / extend the CSV column list |
| Persisted store | `data/outreach-lists.json` (+ `data/csv/`) | Reuse |
| CSV upload + header mapping | `POST /api/outreach/import` | Extend with Google-Maps aliases + a "Google Maps" preset |
| List CRUD + per-prospect PATCH | `/api/outreach/lists` (GET/POST/PATCH/DELETE) | Reuse; add new fields to `WRITABLE_PROSPECT_FIELDS` |
| Email message field | `Prospect.emailMessage` **already exists** | **DO NOT add a second email field** |
| LinkedIn message field | `Prospect.linkedinMessage` already exists | Keep for the LinkedIn flow; add `whatsappMessage` alongside |
| AI provider/client setup | `POST /api/outreach/draft` (OpenAI / OpenRouter selection, batching of 3) | Factor the client-build into a shared helper and reuse |
| Prospects UI | `app/outreach/prospects/page.tsx` | Extend the card + add filters/badges |
| Offer context | `OfferTemplate` + `/outreach/templates` | Reuse (feeds the personalization prompts) |
| Settings | `lib/settings.ts` `AppSettings` | Add a few lead-intelligence keys |
| Sidebar nav | `components/app-sidebar.tsx` → `SECTIONS[0]` ("Outreach") | Add "Leads" + "Dashboard" items |

If a new thing **would** duplicate one of the above, build the single shared version instead.

---

## 1. Current vs. New System

**Current (keep working):**

```
LinkedIn/CSV import → Prospect list → "Draft" → linkedinMessage + emailMessage
```

**New (additive):**

```
Google Maps CSV → bulk AI Analysis → priorityScore + priorityLevel + businessCategory
                → AI Personalization → whatsappMessage + emailMessage + coldCallNotes + outreachAngle
                → Lead Pipeline (leadStatus, lastContactedAt, followUpDate)
                → Filtering + Dashboard
```

Both flows live in the **same lists**. A `Prospect` simply carries more fields when it came from a Google Maps CSV (`source: "maps"`).

---

## 2. Data Model Changes (`app/src/lib/types.ts`)

### 2.1 Extend the existing `Prospect` interface

Add the new fields to the **existing** `Prospect` interface (do not create `Lead`). All new fields are optional so existing LinkedIn prospects remain valid.

```ts
// ── Outreach ──────────────────────────────────────────────────────────────────

export type DraftStatus = "idle" | "drafting" | "done" | "error";

// NEW: AI analysis lifecycle for a lead (separate from draftStatus)
export type AnalysisStatus = "idle" | "analyzing" | "done" | "error";

// NEW
export type PriorityLevel = "hot" | "high" | "medium" | "low";

// NEW — CRM pipeline stages
export type LeadStatus =
  | "new"
  | "contacted"
  | "interested"
  | "follow_up"
  | "meeting_booked"
  | "proposal_sent"
  | "won"
  | "lost"
  | "not_relevant";

// NEW — website presence classification
export type WebsiteStatus = "has_website" | "no_website" | "social_only" | "unknown";

// NEW — structured cold-call brief
export interface ColdCallNotes {
  businessType: string;
  reviewCount: number;
  rating: number;
  keyStrength: string;
  keyWeakness: string;
  talkingPoints: string[];   // 3–5 bullets
}

export interface Prospect {
  id: string;
  // ── existing identity/contact fields (unchanged) ──
  fullName?: string;
  firstName?: string;
  headline?: string;
  company?: string;          // for Maps leads = business name (reuse, don't add businessName)
  jobTitle?: string;
  location?: string;
  profileUrl?: string;
  email?: string;
  bio?: string;
  website?: string;
  followers?: number;
  customNotes: string;
  linkedinMessage?: string;  // existing — LinkedIn flow
  emailMessage?: string;     // existing — REUSE for the email draft, do NOT duplicate
  draftStatus: DraftStatus;
  lastDraftedAt?: string;
  source: "csv" | "apify" | "maps"; // ADD "maps"
  rawData?: Record<string, string>;

  // ── NEW: Google Maps business inputs ──
  businessCategory?: string; // normalized category (e.g. "Dental Clinic")
  rating?: number;           // 0–5
  reviewCount?: number;
  priceRange?: string;       // "$", "$$", "$$$", "$$$$"
  phone?: string;
  address?: string;
  reviewsRaw?: string;       // raw scraped review text blob (input to AI)

  // ── NEW: AI analysis outputs ──
  analysisStatus?: AnalysisStatus;
  priorityScore?: number;    // 0–100
  priorityLevel?: PriorityLevel;
  reviewSummary?: string;    // AI summary of review sentiment/themes
  websiteStatus?: WebsiteStatus;
  outreachAngle?: string;    // the specific hook to lead with
  lastAnalyzedAt?: string;

  // ── NEW: personalized outreach (multi-channel) ──
  whatsappMessage?: string;  // NEW channel (emailMessage above is reused)
  coldCallNotes?: ColdCallNotes;

  // ── NEW: CRM pipeline ──
  leadStatus?: LeadStatus;   // defaults to "new" on import
  lastContactedAt?: string;
  followUpDate?: string;     // ISO date
}
```

> **Dedup notes:**
> - `emailMessage` is **reused** for the generated email — there is exactly one email field.
> - Business name maps onto the existing `company` field — do **not** add `businessName`.
> - Keep `draftStatus` for the legacy LinkedIn draft; `analysisStatus` is separate so Maps analysis and LinkedIn drafting don't fight over one status field.

### 2.2 Priority level thresholds (single source of truth)

Put these in a small shared module `app/src/lib/lead-scoring.ts` so the API and UI agree:

```ts
export function levelFromScore(score: number): PriorityLevel {
  if (score >= 90) return "hot";    // 90–100 Hot Lead
  if (score >= 70) return "high";   // 70–89  High Priority
  if (score >= 50) return "medium"; // 50–69  Medium Priority
  return "low";                     // 0–49   Low Priority
}

export const LEVEL_META: Record<PriorityLevel, { label: string; color: string }> = {
  hot:    { label: "Hot Lead",        color: "#ef4444" },
  high:   { label: "High Priority",   color: "#f59e0b" },
  medium: { label: "Medium Priority", color: "#3b82f6" },
  low:    { label: "Low Priority",    color: "#6b7280" },
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow Up",
  meeting_booked: "Meeting Booked",
  proposal_sent: "Proposal Sent",
  won: "Won",
  lost: "Lost",
  not_relevant: "Not Relevant",
};
```

### 2.3 Storage (`app/src/lib/outreach.ts`)

- Reuse `data/outreach-lists.json` — no new store file.
- **Extend** `writeProspectListAsCsv()` to include the new columns (`businessCategory`, `rating`, `reviewCount`, `priceRange`, `phone`, `address`, `priorityScore`, `priorityLevel`, `websiteStatus`, `outreachAngle`, `whatsappMessage`, `reviewSummary`, `leadStatus`, `lastContactedAt`, `followUpDate`). Keep existing columns.
- Add an optional helper `defaultLeadFields()` that seeds `leadStatus: "new"`, `analysisStatus: "idle"` on import.

---

## 3. Phase 1 — Google Maps Lead Intelligence (Import + Analysis)

**Goal:** when a Google Maps CSV is uploaded, every lead is analyzed; leads are not treated equally — each is tagged High / Medium / Low (and Hot).

### 3.1 Import — extend `POST /api/outreach/import`

The existing import route already parses CSV, suggests a header→field mapping, and returns a preview. Extend it:

1. Add Google-Maps column aliases to `FIELD_ALIASES`, e.g.:
   - `name`/`title` → `company` (business name)
   - `category`/`type`/`categoryname` → `businessCategory`
   - `rating`/`stars`/`totalscore` → `rating`
   - `reviews`/`reviewscount`/`reviewcount`/`user_ratings_total` → `reviewCount`
   - `price`/`pricerange`/`price_level` → `priceRange`
   - `phone`/`phonenumber`/`international_phone_number` → `phone`
   - `address`/`formatted_address`/`street` → `address`
   - `website`/`site`/`url` → `website`
   - `email` → `email`
   - `reviewstext`/`reviews`/`reviewsraw` → `reviewsRaw`
2. Add a **"Google Maps" preset** (parallel to `LINKEDIN_SCRAPER_PRESET`) matching the common Apify Google Maps scraper columns, so a Maps export auto-maps with zero manual mapping.
3. The mapping UI in `app/outreach/prospects/page.tsx` must offer the new fields in its `PROSPECT_FIELDS` / `FIELD_LABELS` lists.
4. On list creation (`POST /api/outreach/lists`), set `source: "maps"` when Maps fields are present, seed `leadStatus: "new"`, `analysisStatus: "idle"`. Add the new fields to `WRITABLE_PROSPECT_FIELDS` so PATCH can update them.

### 3.2 AI analysis input

For each business the analyzer receives: Business Name (`company`), `businessCategory`, `rating`, `reviewCount`, `priceRange`, `website`, `reviewsRaw`, `address`, `phone`, `email`.

### 3.3 AI analysis output (per lead)

`priorityScore`, `priorityLevel`, `businessCategory` (normalized), `reviewSummary`, `websiteStatus`, `outreachAngle`. (Scoring rules in Phase 2; message generation in Phase 3.)

---

## 4. Phase 2 — Priority Scoring (0–100)

A new endpoint scores each lead. The model returns a 0–100 number; the **level is always derived from the score** via `levelFromScore()` (never let the model pick the bucket).

**Scoring signals (give the model this rubric):**

| Signal | Higher score when |
|---|---|
| Review count | More reviews → higher (social proof / established) |
| Rating | 4.5+ → higher |
| Price range | Premium (`$$$`/`$$$$`) → higher (budget for services) |
| Website availability | Has website → higher; **no website → lower** (but flag as an outreach opportunity) |
| Service type | High-ticket services → higher: clinics, architects, real estate, law firms, agencies |

**Bands:**

```
90–100  Hot Lead
70–89   High Priority
50–69   Medium Priority
 0–49   Low Priority
```

> Note the deliberate tension: "no website" lowers the *priority* score (less established) but is simultaneously the strongest *outreach angle* for a web/design offer. The analyzer should set `websiteStatus` and surface "no website" prominently in `outreachAngle`, independent of the numeric score.

**Implementation:** the score + level + `reviewSummary` + `websiteStatus` + `businessCategory` + `outreachAngle` are produced in a **single LLM call per lead** (one JSON response) inside the analysis endpoint, to minimize cost/latency. Reuse the provider/client selection from the existing draft route (see §10 shared helper).

---

## 5. Phase 3 — AI Personalized Outreach

For every lead, generate three channel assets in one pass (extends the existing draft concept):

1. **`whatsappMessage`** — short, warm, references a real detail (rating/reviews/category/location), soft CTA. Tone like:
   > Hi {firstName}, I came across your {category} while researching {category} businesses in {location}. The reviews are excellent and it's clear customers trust your service. I noticed a few opportunities where a stronger online presence could help generate more inquiries and bookings. Would love to share a few ideas if you're open to it.
2. **`emailMessage`** — **reuse the existing field.** Subject + body, opens on the prospect's world (not "Hi, I'm X"), ~80–130 words, low-friction CTA, signed with the user's name (from active `OfferTemplate` / settings). Example tone:
   > Subject: Quick observation about your online presence
   > Hi {firstName}, I was researching {category} in {location} and found your business. The quality of reviews stood out immediately. Businesses with this level of trust often have an opportunity to convert more visitors into inquiries through stronger positioning online. I put together a few observations and would be happy to share them. Regards, Aamir
3. **`coldCallNotes`** (`ColdCallNotes`) — displayed as a brief: Business Type, Review Count, Rating, Key Strength, Key Weakness, Suggested Talking Points (3–5).

All three are generated automatically during bulk processing (Phase 6) and re-generatable per-lead from the card. The prompt pulls offer context from the active `OfferTemplate` (reuse `getActiveTemplate()`), exactly like the existing draft route.

---

## 6. Phase 4 — Lead Pipeline Management (CRM)

- Add a **Lead Status dropdown** on each lead card backed by `leadStatus` (`LeadStatus` enum, labels from `LEAD_STATUS_LABELS`). Default `"new"`.
- Changing status PATCHes via the existing `/api/outreach/lists` PATCH (add `leadStatus`, `lastContactedAt`, `followUpDate` to `WRITABLE_PROSPECT_FIELDS`). Setting status to `contacted` auto-stamps `lastContactedAt` if empty.
- Each lead card shows: **Priority Score**, **Priority Badge** (color from `LEVEL_META`), **Status**, **Last Contacted**, **Next Follow Up**.
- A follow-up date picker writes `followUpDate`.

---

## 7. Phase 5 — Smart Filtering

Add a filter bar to `app/outreach/prospects/page.tsx` (client-side over the loaded list; no schema change). Filters:

- **Priority:** Hot Leads, High Priority (and Medium / Low)
- **Website:** No Website, Has Website (`websiteStatus`)
- **Contact:** Has Email, Has Phone
- **Category** (`businessCategory`) — populated from the data
- **Location** (`location`)
- **Status** (`leadStatus`)

Filters combine (AND) and show a live count. Persist the active filter set in `localStorage` keyed by list id (matches the app's existing pattern).

---

## 8. Phase 6 — Bulk AI Processing

User uploads up to ~500 leads; the system analyzes, scores, generates outreach, assigns priority, and stores everything automatically.

**Endpoint:** new SSE route `POST /api/outreach/analyze` (mirror the SSE pattern already used by the clip pipeline and `/api/pipeline`). Body: `{ listId, prospectIds?, regenerate? }`.

- Process in batches (reuse the draft route's concurrency of 3; make it configurable) to respect rate limits.
- Two-stage progress so the UI can show both lines from the spec:
  - `Analyzing 247/500`
  - `Generating Messages 247/500`
  - `Completed`
- Persist incrementally to `data/outreach-lists.json` after each batch (so a closed tab/crash keeps finished work), exactly like the draft route persists results.
- Each event: `{ phase: "analyzing" | "generating" | "done", completed, total, lastId }`.

**Progress bar UI:** a modal/inline bar on the Prospects (Leads) page that consumes the SSE stream, shows the two counters, and updates each card's badge/status as results arrive. Closing the modal must not cancel the job (same UX as clipping).

---

## 9. Phase 7 — Dashboard

New page `app/outreach/dashboard/page.tsx` (nav item under Outreach). Metrics computed across all lists (add a lightweight `GET /api/outreach/stats` that aggregates `outreach-lists.json`):

- Total Leads
- Hot Leads (`priorityLevel === "hot"`)
- High Priority Leads
- Messages Generated (leads with `whatsappMessage` or `emailMessage`)
- Meetings Booked (`leadStatus === "meeting_booked"`)
- Won Deals (`leadStatus === "won"`)
- Lost Deals (`leadStatus === "lost"`)
- Conversion Rate (`won / total contacted`)
- Revenue Generated (sum of an optional `dealValue` field — add `dealValue?: number` to `Prospect` if revenue tracking is wanted; otherwise show "—")

Render as stat cards; optionally a small priority-distribution and pipeline-funnel chart. Note: **no chart library is currently installed** — either render bars with plain CSS/SVG (preferred, zero new deps) or add `recharts` to `app/package.json` first.

> Consider also offering this as a **live artifact** so Aamir can re-open a refreshing dashboard, but the in-app page is the primary deliverable.

---

## 10. UI Architecture, Component Structure & Design System

The feature must look and feel like a **professional CRM dashboard**, consistent with the app's existing shell (collapsible icon sidebar + sticky top bar) and its **monochrome shadcn "new-york" theme** (light + dark). Every control is built from **shadcn/ui** primitives — no ad-hoc HTML inputs, no second design language.

### 10.1 Design language (match the existing app)

- **Theme:** the monochrome palette already in `app/src/app/globals.css` (`--background`, `--card`, `--muted-foreground`, `--border`, `--primary`…). Use these tokens — never hardcoded hex, except the priority/status semantic colors below.
- **Style:** shadcn **new-york**, base color **neutral**, icons **lucide-react** (the app default), radius `0.75rem` — all already set in `app/components.json`.
- **Density:** comfortable but information-dense (this is a data tool). `text-sm` body, `muted-foreground` labels, `Separator`s between blocks — mirror the existing `prospects/page.tsx`.
- **Semantic-color exception:** the app is otherwise monochrome, but a CRM needs at-a-glance triage. Allow ONE small muted semantic scale, used *only* on priority badges and status dots, centralized in `lib/lead-scoring.ts` (`LEVEL_META` + a new `STATUS_META`) so it's the single source: Hot = red, High = amber, Medium = blue, Low = grey. Everything else stays monochrome.

### 10.2 shadcn component inventory

**Already installed — reuse, don't reinvent:**
`badge, button, card, checkbox, collapsible, dialog, dropdown-menu, input, label, popover, progress, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, textarea, tooltip`.

**Add via `npx shadcn@latest add <name>` (run inside `app/`):**

- `avatar` — business monogram on each lead row
- `sonner` — toasts for analyze / status-change / copy success + errors
- `pagination` — paging the leads table at 500+ rows
- `command` — quick lead search / command palette (recommended)
- `hover-card` — review-summary preview on hover (optional)

If a needed primitive isn't listed, add the official shadcn component rather than hand-rolling one.

### 10.3 Feature folder structure (keep it navigable)

Co-locate all Lead-Intelligence UI under one folder, mirroring how `components/clip/` is organized today:

```
app/src/
├── app/outreach/
│   ├── prospects/page.tsx          # (existing) → becomes the Leads workspace (thin composition)
│   ├── dashboard/page.tsx          # NEW (Phase 7)
│   └── templates/page.tsx          # (existing, unchanged)
├── components/outreach/            # NEW — every feature component lives here
│   ├── lead-table.tsx              # professional data table (Table primitive)
│   ├── lead-row.tsx                # one row: avatar, name, badges, inline status
│   ├── lead-detail-sheet.tsx       # Sheet: full intelligence + 3 message tabs
│   ├── priority-badge.tsx          # Badge driven by LEVEL_META
│   ├── lead-status-select.tsx      # Select driven by LEAD_STATUS_LABELS
│   ├── filter-bar.tsx              # Phase 5 filters (Popover + Checkbox/Select)
│   ├── analyze-progress-dialog.tsx # Phase 6 SSE progress (Dialog + Progress ×2)
│   ├── import-wizard.tsx           # extracted CSV import stepper (Tabs steps)
│   ├── outreach-message-tabs.tsx   # WhatsApp / Email / Cold-call (Tabs)
│   ├── cold-call-card.tsx          # structured ColdCallNotes view
│   ├── stat-card.tsx               # dashboard metric card (Card)
│   └── dashboard-charts.tsx        # CSS/SVG bars + funnel (no chart dependency)
└── hooks/
    ├── use-leads.ts                # load/patch a list's prospects
    └── use-lead-filters.ts         # filter state + localStorage persistence
```

> **Refactor note:** `prospects/page.tsx` is ~1,168 lines today. As part of this work, **extract** the import flow and the lead card into the components above so the page becomes a thin composition (header + `filter-bar` + `lead-table` + `lead-detail-sheet`). This is what makes the feature easy to navigate and work on.

### 10.4 Navigation / information architecture

- `components/app-sidebar.tsx` → the "Outreach" section (`SECTIONS[0]`) item list becomes, in order:
  `Dashboard` (`/outreach/dashboard`, icon `LayoutDashboard`), `Leads` (`/outreach/prospects`, icon `Users`), `Templates` (`/outreach/templates`, icon `FileText`).
- `components/top-bar.tsx` `pageTitles`: add `"/outreach/prospects": "Leads"` and `"/outreach/dashboard": "Lead Dashboard"`.
- Every page keeps the existing shell: sticky `TopBar` + `px-6` content in a max-width container, with consistent section headers.

### 10.5 Page layouts

**A) Leads workspace (`/outreach/prospects`)** — the core CRM screen:

- **Header bar:** list `Select` (switch lists) · `Import CSV` `Button` (opens `import-wizard`) · `Analyze All` primary `Button` (opens `analyze-progress-dialog`) · live lead count.
- **`filter-bar`** (Phase 5): priority / website / email / phone / category / location / status as `Popover` + `Checkbox` groups and `Select`s, a live result count, a "Clear" `Button`, and active filters shown as removable `Badge`s.
- **`lead-table`** (`Table`, sticky header, inside `ScrollArea`): columns → Business (`Avatar` + name + category), Priority (`priority-badge` = score + level), Rating/Reviews, Website (`websiteStatus` dot + `Tooltip`), Status (inline `lead-status-select`), Last Contacted, Follow-up, Actions (`DropdownMenu`: Open, Regenerate, Copy WhatsApp, Copy Email, Delete). Sortable by score/rating/reviews; `Pagination` at the bottom.
- **Row click → `lead-detail-sheet`** (`Sheet` from the right): intelligence block (score, badge, `reviewSummary`, `outreachAngle`, website status), then **`outreach-message-tabs`** (WhatsApp · Email · Cold Call) — each tab an editable `Textarea` with Copy + Regenerate `Button`s; then the CRM block (`lead-status-select`, last-contacted, follow-up date via `Popover` calendar).
- **States:** `Skeleton` rows while loading; a friendly empty state with an Import CTA; `sonner` toasts on every action.

**B) Lead Dashboard (`/outreach/dashboard`)** — the "professional dashboard" landing:

- **Top:** responsive grid of **`stat-card`s** (Total Leads, Hot, High Priority, Messages Generated, Meetings Booked, Won, Lost, Conversion Rate, Revenue) — each a `Card` with label, large number, a small context line, and a lucide icon, in monochrome.
- **Middle:** **`dashboard-charts`** — priority distribution (horizontal bars) + pipeline funnel by `leadStatus`, drawn with CSS/SVG (no new dependency).
- **Bottom:** "Hot leads needing action" — a compact `lead-table` pre-filtered to `hot` + `follow_up`, linking into the sheet.
- Optionally wrap in `Tabs` (Overview / Pipeline / Activity).

### 10.6 Reusable component contracts (typed against `Prospect`)

- `priority-badge.tsx` — `({ score?, level? })` → `Badge` colored from `LEVEL_META`, shows level label + score.
- `lead-status-select.tsx` — `({ value, onChange })` → `Select` over `LEAD_STATUS_LABELS`; stamps `lastContactedAt` on first move to `contacted`.
- `stat-card.tsx` — `({ label, value, icon, hint? })` → `Card`.
- `analyze-progress-dialog.tsx` — consumes the `/api/outreach/analyze` SSE stream; two `Progress` bars (Analyzing x/N, Generating x/N) + a live log; non-blocking (closing keeps the job running).
- No parallel prop shapes — all components share the one `Prospect` type.

### 10.7 Professional-polish checklist

- [ ] Every control is a shadcn primitive; spacing/typography match existing pages.
- [ ] Light **and** dark themes correct (theme tokens only).
- [ ] `Skeleton` loaders, empty states, and `sonner` toasts wherever an action can succeed/fail.
- [ ] Accessible by default (keep `Label`s; shadcn primitives handle focus/ARIA).
- [ ] Smooth at 500 rows (paginate; virtualize only if needed).
- [ ] `prospects/page.tsx` reduced to a thin composition; feature logic lives in `components/outreach/` + `hooks/`.

---

## 11. API & Code Changes — summary

**Extend (do not duplicate):**

- `POST /api/outreach/import` — Google Maps aliases + preset.
- `POST /api/outreach/lists` — seed `source:"maps"`, `leadStatus:"new"`, `analysisStatus:"idle"`.
- `PATCH /api/outreach/lists` — add new fields to `WRITABLE_PROSPECT_FIELDS`.
- `lib/outreach.ts` `writeProspectListAsCsv` — add new columns.
- `app/outreach/prospects/page.tsx` — mapping fields, filter bar, enriched lead card, status dropdown, follow-up picker, bulk-analyze progress.
- `components/app-sidebar.tsx` — under `SECTIONS[0]` ("Outreach") add `{ title: "Leads", href: "/outreach/prospects" }` (rename "Prospects" → "Leads" or keep both label) and `{ title: "Dashboard", href: "/outreach/dashboard" }`.
- `lib/settings.ts` `AppSettings` — add: `whatsappCharLimit?: number` (default ~600), `senderName?: string` (email signature, e.g. "Aamir"), `defaultLocationLabel?: string` (optional fallback for `{location}`). Reuse existing `provider`/`openaiApiKey`/`openrouterApiKey`/`openrouterModel`.

**New:**

- `app/src/lib/lead-scoring.ts` — `levelFromScore`, `LEVEL_META`, `LEAD_STATUS_LABELS`.
- `POST /api/outreach/analyze` (SSE) — bulk analyze + score + generate (Phase 6).
- `GET /api/outreach/stats` — dashboard aggregates (Phase 7).
- `app/outreach/dashboard/page.tsx` — dashboard page.
- **Shared LLM client helper** `app/src/lib/llm-client.ts` (or reuse `lib/clip/llm.ts` if suitable): factor the OpenAI/OpenRouter client+model selection currently inlined in `/api/outreach/draft/route.ts` into one function used by both the draft route and the new analyze route — **so we don't duplicate provider logic.** Refactor the draft route to call it.

**Unchanged / reused:** `data/outreach-lists.json`, `data/csv/`, `OfferTemplate` + `/outreach/templates`, `getActiveTemplate()`, `ProspectList`, the draft route's email/LinkedIn behaviour (legacy flow stays).

---

## 12. Final Goal (acceptance)

User uploads a Google Maps CSV. Within minutes the system returns, with **no manual research**:

- Ranked leads (priorityScore + badge)
- Business intelligence (businessCategory, reviewSummary, websiteStatus)
- Outreach angle
- WhatsApp draft
- Email draft (reusing `emailMessage`)
- Cold-call notes
- Lead priority level
- CRM status (defaulting to New) with last-contacted / follow-up tracking

…and the **existing LinkedIn outreach flow continues to work unchanged.**

### Acceptance checklist

- [ ] Uploading a Google Maps CSV auto-maps columns (Maps preset) and creates a list with `source:"maps"`.
- [ ] "Analyze All" runs bulk processing with a two-line progress bar (`Analyzing x/N`, `Generating Messages x/N`, then `Completed`); closing the modal does not cancel the job.
- [ ] Every analyzed lead has `priorityScore` (0–100), `priorityLevel` derived via `levelFromScore`, `businessCategory`, `reviewSummary`, `websiteStatus`, `outreachAngle`.
- [ ] Every lead has `whatsappMessage`, `emailMessage`, and `coldCallNotes`.
- [ ] Lead card shows score, colored badge, status dropdown, last-contacted, next-follow-up.
- [ ] Filters work: Hot / High / No Website / Has Website / Has Email / Has Phone / Category / Location / Status.
- [ ] Dashboard shows all 9 metrics.
- [ ] Existing LinkedIn import + draft flow is unaffected; no duplicate Prospect type, no duplicate email field, no second list store.
- [ ] UI is built entirely from shadcn primitives, in both light and dark themes; new components live under `components/outreach/`, and `prospects/page.tsx` is a thin composition (not a 1,000-line file).
- [ ] Sidebar shows Dashboard / Leads / Templates; the Dashboard reads as a professional CRM dashboard.
- [ ] `npm run dev` builds with no type errors; CSV round-trips through `writeProspectListAsCsv` with the new columns.

---

## 13. Maintain CLAUDE.md

After implementing, update `CLAUDE.md`:
- Add the Lead Intelligence flow to the system overview.
- Add the new `Prospect` fields, `/api/outreach/analyze`, `/api/outreach/stats`, `lib/lead-scoring.ts`, `lib/llm-client.ts`, `components/outreach/`, `hooks/use-leads.ts`, `hooks/use-lead-filters.ts`, and `/outreach/dashboard` to the structure tables.
- Note the dedup rule (single `Prospect` model, single email field, single list store) and the UI rule (all controls from shadcn primitives, feature components under `components/outreach/`) so future work doesn't fork it.
