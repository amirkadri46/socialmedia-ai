# Epic 4 — Video Library UI

## Objective

Build the Video Library page: a browsable, filterable grid of all downloaded videos with a preview modal, caption generation, and sidebar integration. This is the user's primary interface for managing their video assets before scheduling.

## Prerequisites

- Epic 3 complete (`GET /api/library` returns real data with signed URLs)

## Scope

- `/library` page with responsive video grid
- Filter bar (platform, status, creator, search)
- `VideoCard` component with hover actions
- `VideoPreviewModal` with video player + caption section
- Sidebar update: add "Library" section
- Stats row (total / available / scheduled / published counts)

## Out of Scope

- Campaign creation or assignment (Epic 5)
- Worker or publishing (Epic 6)
- Analytics (not in v1)

---

## Step 1 — Sidebar Update

Edit `app/src/components/app-sidebar.tsx`.

Add import: `import { Library, Megaphone, ListChecks, History } from "lucide-react";`

Add this section to the `SECTIONS` array **before** the existing `"downloader"` section:

```typescript
{
  id: "library",
  icon: Library,
  label: "Library",
  items: [
    { title: "Video Library", href: "/library", icon: Library },
  ],
},
```

Update `getSectionFromPath`:
```typescript
if (pathname.startsWith("/library")) return "library";
```

Update the `SectionId` type — it is derived from `typeof SECTIONS` automatically, no manual change needed.

---

## Step 2 — FilterBar Component

Create `app/src/components/library/filter-bar.tsx` (client component).

Props:
```typescript
interface FilterBarProps {
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
}

interface LibraryFilters {
  platform: string;      // "" = all
  publish_status: string; // "" = all
  search: string;
}
```

UI (single horizontal bar, sticky at top):
- Search `<Input>` — `placeholder="Search by title or creator..."` — debounced 300ms
- Platform `<Select>`: All Platforms | YouTube | Instagram
- Status `<Select>`: All Statuses | Available | Scheduled | Published
- `[Clear filters]` button (ghost, shown only when any filter is active)

Use shadcn `Input`, `Select`, `Button`. Keep the bar compact — all controls in one line.

---

## Step 3 — VideoCard Component

Create `app/src/components/library/video-card.tsx` (client component).

Props:
```typescript
interface VideoCardProps {
  video: VideoWithUrls;     // from API
  onPreview: (video: VideoWithUrls) => void;
  onAddToCampaign?: (video: VideoWithUrls) => void;
}
```

Layout (aspect-ratio 9/16 card, like Instagram):
```
┌─────────────────────┐
│                     │
│   [thumbnail img]   │  ← object-cover, rounded-lg
│                     │
│ ──── hover overlay ─── │
│  [Preview] [+Campaign] │
└─────────────────────┘
  Platform badge  Duration
  Creator name
  Title (1 line, truncated)
  Status badge
```

- Thumbnail: `<img src={video.thumbnail_url ?? "/placeholder-video.png"} />`
- On hover: semi-transparent overlay with two buttons
- Platform badge: `"YT"` (purple) for youtube, `"IG"` (pink) for instagram
- Status badge colors: Available=grey, Scheduled=blue, Published=green
- Duration: format as `"1:23"` from `duration_sec`
- If `thumbnail_url` is null: show a grey card with a `Film` icon centered

---

## Step 4 — VideoPreviewModal Component

Create `app/src/components/library/video-preview-modal.tsx` (client component).

Props:
```typescript
interface VideoPreviewModalProps {
  videoId: string | null;   // null = closed
  onClose: () => void;
}
```

State: `detail: VideoDetail | null` — fetched from `GET /api/library/{videoId}` when `videoId` changes.

Layout (Dialog, max-width 900px, two-column):
```
Left column (60%):
  <video controls src={detail.video_url} className="w-full rounded-lg" />
  Title, Creator, Platform, Duration, Downloaded date

Right column (40%):
  "Caption" section header
  If caption exists:
    <Textarea readonly value={caption} />
    [Regenerate] button
  If no caption:
    "No caption generated yet"
    [Generate Caption] button
  
  Divider
  
  [Delete from Library] button (destructive, ghost)
```

Caption actions:
- `[Generate Caption]` / `[Regenerate]` → POST `/api/library/{id}/caption` → show loading spinner → update local state with result → toast success
- `[Delete from Library]` → confirm dialog → DELETE `/api/library/{id}` → close modal → parent refreshes list

Use shadcn `Dialog`, `DialogContent`, `Textarea`, `Button`, `Separator`.

---

## Step 5 — VideoGrid Component

Create `app/src/components/library/video-grid.tsx` (client component).

Props:
```typescript
interface VideoGridProps {
  videos: VideoWithUrls[];
  onVideoClick: (video: VideoWithUrls) => void;
  loading: boolean;
}
```

- Responsive grid: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`
- Each cell: `<VideoCard>`
- Loading state: 10 skeleton cards (use shadcn `Skeleton`)
- Empty state: `Library` icon + "No videos yet. Go to Downloads to get started." + `<Button>` → `/downloader`

---

## Step 6 — Library Page

Create `app/src/app/library/page.tsx` (client component, `"use client"`).

State:
```typescript
const [videos, setVideos] = useState<VideoWithUrls[]>([]);
const [loading, setLoading] = useState(true);
const [filters, setFilters] = useState<LibraryFilters>({ platform: "", publish_status: "", search: "" });
const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
const [stats, setStats] = useState({ total: 0, available: 0, scheduled: 0, published: 0 });
```

Fetch effect:
```typescript
useEffect(() => {
  setLoading(true);
  const params = new URLSearchParams();
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.publish_status) params.set("publish_status", filters.publish_status);
  if (filters.search) params.set("search", filters.search);
  params.set("limit", "100");

  fetch(`/api/library?${params}`)
    .then(r => r.json())
    .then(data => {
      setVideos(data);
      setStats({
        total: data.length,
        available: data.filter((v: any) => v.publish_status === "unpublished").length,
        scheduled: data.filter((v: any) => v.publish_status === "scheduled").length,
        published: data.filter((v: any) => v.publish_status === "published").length,
      });
    })
    .finally(() => setLoading(false));
}, [filters]);
```

Layout:
```tsx
<div className="flex flex-col gap-6">
  {/* Header */}
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-2xl font-semibold">Video Library</h1>
      <p className="text-sm text-muted-foreground mt-1">
        {stats.total} videos · {stats.available} available · {stats.scheduled} scheduled · {stats.published} published
      </p>
    </div>
    <Button variant="outline" onClick={() => router.push("/downloader")}>
      <Download className="h-4 w-4 mr-2" />
      Download more
    </Button>
  </div>

  {/* Filters */}
  <FilterBar filters={filters} onChange={setFilters} />

  {/* Grid */}
  <VideoGrid
    videos={videos}
    onVideoClick={(v) => setSelectedVideoId(v.id)}
    loading={loading}
  />

  {/* Preview Modal */}
  <VideoPreviewModal
    videoId={selectedVideoId}
    onClose={() => { setSelectedVideoId(null); /* re-fetch */ }}
  />
</div>
```

---

## Acceptance Criteria

Epic 4 is complete when ALL of the following are true:

- [ ] `/library` page loads and displays a grid of downloaded videos with thumbnails
- [ ] Platform filter works (select YouTube → only YouTube videos shown)
- [ ] Status filter works
- [ ] Search filter works (type partial title → grid updates within 300ms debounce)
- [ ] Clicking a video card opens the preview modal
- [ ] Preview modal shows a working video player (video plays inline)
- [ ] "Generate Caption" button generates and displays a caption
- [ ] "Delete from Library" removes the video from the grid
- [ ] Stats row shows accurate counts
- [ ] Sidebar shows "Library" section with "Video Library" nav item
- [ ] Empty state shows when no videos match filters
- [ ] Skeleton loading state shows while fetching
- [ ] No TypeScript errors (`cd app && npx tsc --noEmit`)
- [ ] Existing clipping pipeline is completely unaffected
