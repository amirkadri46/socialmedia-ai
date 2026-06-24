export interface Config {
  id: string;
  configName: string;
  creatorsCategory: string;
  analysisInstruction: string;
  newConceptsInstruction: string;
}

export interface Creator {
  id: string;
  username: string;
  category: string;
  profilePicUrl: string;
  followers: number;
  reelsCount30d: number;
  avgViews30d: number;
  lastScrapedAt: string;
}

export interface Video {
  id: string;
  link: string;
  thumbnail: string;
  creator: string;
  views: number;
  likes: number;
  comments: number;
  analysis: string;
  newConcepts: string;
  datePosted: string;
  dateAdded: string;
  configName: string;
  starred: boolean;
}

export interface CreatorOverride {
  username: string;
  nDays?: number;
  maxVideos?: number;
  topK?: number;
}

export interface PipelineParams {
  configName: string;
  maxVideos: number;
  topK: number;
  nDays: number;
  selectedCreators?: string[];
  creatorOverrides?: CreatorOverride[];
}

export interface ActiveTask {
  id: string;
  creator: string;
  step: string;
  views?: number;
}

export interface PipelineProgress {
  pipelineId?: string;
  configName?: string;
  status: "idle" | "running" | "completed" | "error";
  phase: "scraping" | "analyzing" | "done";
  activeTasks: ActiveTask[];
  creatorsCompleted: number;
  creatorsTotal: number;
  creatorsScraped: number;
  videosAnalyzed: number;
  videosTotal: number;
  errors: string[];
  log: string[];
}

// ── Outreach ──────────────────────────────────────────────────────────────────

export type DraftStatus = "idle" | "drafting" | "done" | "error";

// AI analysis lifecycle for a lead (separate from draftStatus)
export type AnalysisStatus = "idle" | "analyzing" | "done" | "error";

export type PriorityLevel = "hot" | "high" | "medium" | "low";

// CRM pipeline stages
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

// Website presence classification
export type WebsiteStatus = "has_website" | "no_website" | "social_only" | "unknown";

// Structured cold-call brief
export interface ColdCallNotes {
  businessType: string;
  reviewCount: number;
  rating: number;
  keyStrength: string;
  keyWeakness: string;
  talkingPoints: string[]; // 3–5 bullets
}

export interface Prospect {
  id: string;
  fullName?: string;
  firstName?: string;
  headline?: string;
  company?: string; // for Maps leads = business name (reuse, don't add businessName)
  jobTitle?: string;
  location?: string;
  profileUrl?: string;
  email?: string;
  bio?: string;
  website?: string;
  followers?: number;
  customNotes: string;
  linkedinMessage?: string; // existing — LinkedIn flow
  emailMessage?: string; // existing — REUSE for the email draft, do NOT duplicate
  draftStatus: DraftStatus;
  lastDraftedAt?: string;
  source: "csv" | "apify" | "maps";
  rawData?: Record<string, string>;

  // ── Google Maps business inputs ──
  businessCategory?: string; // normalized category (e.g. "Dental Clinic")
  rating?: number; // 0–5
  reviewCount?: number;
  priceRange?: string; // "$", "$$", "$$$", "$$$$"
  phone?: string;
  address?: string;
  reviewsRaw?: string; // raw scraped review text blob (input to AI)

  // ── AI analysis outputs ──
  analysisStatus?: AnalysisStatus;
  priorityScore?: number; // 0–100
  priorityLevel?: PriorityLevel;
  reviewSummary?: string; // AI summary of review sentiment/themes
  websiteStatus?: WebsiteStatus;
  outreachAngle?: string; // the specific hook to lead with
  lastAnalyzedAt?: string;

  // ── personalized outreach (multi-channel) ──
  whatsappMessage?: string; // NEW channel (emailMessage above is reused)
  coldCallNotes?: ColdCallNotes;

  // ── CRM pipeline ──
  leadStatus?: LeadStatus; // defaults to "new" on import
  lastContactedAt?: string;
  followUpDate?: string; // ISO date
  dealValue?: number; // optional revenue tracking
  priceQuoted?: number; // price you quoted the lead
  priceConfirmed?: number; // price the lead confirmed / agreed to
  // free-text objection / note the user wants recorded (reuses customNotes for the note column)
}

export interface ProspectList {
  id: string;
  name: string;
  createdAt: string;
  prospects: Prospect[];
}

export interface OfferTemplate {
  id: string;
  offerName: string;
  whatYouSell: string;
  channelFocus: "LinkedIn" | "Instagram" | "X" | "Email";
  valueProps: string[];
  tone: string;
  cta: string;
  proofPoints?: string;
  dosAndDonts?: string;
  isActive: boolean;
  createdAt: string;
}

// ── Clipping ────────────────────────────────────────────────────────────────────

export interface Word {
  text: string;
  start: number;
  end: number;
  color?: string; // resolved per-word render color (hex); set by windowWords from wordStyles
}

// Per-word style overrides, keyed by the word's SOURCE start time (Word.start).
export interface WordStyle {
  t: number; // = Word.start in source seconds (stable key)
  color?: string; // highlight / font color, hex (e.g. "#3BE477"); undefined = none
  text?: string; // edited replacement text (undefined = original)
}

export interface Moment {
  start: number;
  end: number;
  title: string;
  hook: string; // text-hook line for first 5s
  score: number; // 0–100 virality estimate
  reason: string; // why it was picked
  genre: string; // e.g. "Journey & tutorial"
  hookType: string; // e.g. "Intrigue hook"
}

export type ClipJobStatus =
  | "idle"
  | "downloading"
  | "transcribing"
  | "selecting"
  | "rendering"
  | "done"
  | "error"
  | "canceled";

export interface ClipJob {
  id: string;
  sourceUrl?: string;
  sourceTitle: string;
  sourceDurationSec: number;
  sourceThumbnail?: string;
  status: ClipJobStatus;
  // settings snapshot
  clipModel: string; // "Auto" | "ClipBasic" | ...
  genre: string; // "Auto" | specific
  clipLengthMode: string; // "Auto(0-3m)" | "<30s" | "30s-60s" | "60s-90s"
  autoHook: boolean;
  captionPreset: string; // "Karaoke" | "Beasty" | ... | "No caption"
  aspectRatio: string; // "9:16" | "1:1" | "16:9"
  speechLanguage: string; // "English" | ...
  includeMomentsPrompt?: string;
  rangeStartSec: number; // processing timeframe slider
  rangeEndSec: number;
  topK: number;
  createdAt: string;
  errors: string[];
}

export interface Clip {
  id: string;
  jobId: string;
  rank: number;
  title: string;
  start: number;
  end: number;
  durationSec: number;
  score: number; // virality
  hook: string;
  hookType: string;
  genre: string;
  reason: string;
  transcript: string; // text of the clip, for caption generation
  filePath: string; // final captioned vertical mp4 (local)
  publicUrl?: string; // when uploaded for publishing
  thumbnail: string;
  caption?: string; // AI-generated social caption
  starred: boolean;
  createdAt: string;
}

export interface ClipProgress {
  jobId: string;
  status: ClipJobStatus;
  sourceTitle?: string;
  curationMethod?: string; // mirrors "Curation method: ClipBasic..."
  rangeLabel?: string; // "From 0:00:00 to 0:10:16, 0-180s..."
  etaSeconds?: number;
  percent: number; // 0–100 overall
  momentsTotal: number;
  clipsRendered: number;
  log: string[];
  errors: string[];
}

// Social

export interface SocialAccount {
  id: string;
  platform: "instagram" | "tiktok" | "youtube";
  displayName: string;
  username: string;
  avatarUrl?: string;
  accessToken: string; // store at-rest; never expose to client
  igUserId?: string;
  pageId?: string;
  expiresAt?: string;
  connectedAt: string;
}

export interface ScheduledPost {
  id: string;
  clipId: string;
  accountId: string;
  caption: string;
  scheduledFor?: string; // ISO; absent = publish now
  status: "draft" | "scheduled" | "published" | "failed";
  error?: string;
  createdAt: string;
}

// ── Clip Editor (Phase 2) ─────────────────────────────────────────────────────────
// One ClipEdit document is the single source of truth: both the browser preview and
// the server ffmpeg export are pure functions of it (PRD §2).

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
} // normalized 0–1 of the source frame

// Placement of the (cropped) source video inside the output canvas, normalized to the
// canvas (0–1). May exceed [0,1] when the video overflows the canvas (Fill); sits inside
// [0,1] with black bars when smaller than the canvas (Fit). Mirrors the on-screen video box.
export interface VideoFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Multiple-speaker layouts (3D): a segment can stack N face-crops of the SAME source into
// tiled slots of the output canvas. "single" (default/absent) = the classic one-frame model.
export type LayoutKind = "single" | "split" | "triple" | "quad"; // 1 / 2 / 3 / 4 panes

export interface SpeakerPane {
  crop: CropRect; // source region for this speaker (built to the slot's pixel aspect, face-centered)
  label?: string; // optional ("Speaker 1")
}

export interface LayoutSegment {
  id: string;
  start: number;
  end: number; // clip-local seconds
  mode: "fill" | "fit"; // fill = video covers the canvas; fit = whole video inside the canvas (padded)
  speakerId?: string;
  crop?: CropRect; // source region kept (set in the Crop modal); undefined = whole frame
  cropAspect?: string; // aspect label chosen for the crop ("9:16" | "1:1" | "16:9" | "4:3" | "9:8" | "4:5" | "original" | "custom")
  frame?: VideoFrame; // video placement in the output canvas (move/scale on the preview); derived from `mode` when absent
  kind?: LayoutKind; // multi-speaker layout (3D); absent / "single" = single-frame behavior above
  panes?: SpeakerPane[]; // when kind != "single": the per-speaker crops (length 2/3/4), tiled into slots
}

export interface CaptionFont {
  family: string;
  sizePx: number;
  color: string; // base word color
  uppercase: boolean;
  strokeColor: string;
  strokeWidthPx: number;
  shadow: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface CaptionEffects {
  position: "auto" | "top" | "middle" | "bottom";
  animation: "none" | "box" | "pop" | "bounce" | "karaoke";
  lines: 1 | 3;
  highlightColor: string; // active spoken word
  wordBgColor?: string; // optional word background
}

export interface CaptionConfig {
  enabled: boolean;
  preset: string; // "Karaoke" | ... | "No caption"
  font: CaptionFont;
  effects: CaptionEffects;
  offset?: { x: number; y: number }; // drag-to-reposition (normalized 0–1; overrides position)
}

export interface TextOverlayStyle {
  bg?: string;
  color: string;
  sizePx: number;
  bold: boolean;
  radiusPx: number;
  font?: string;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  widthPct?: number; // max width as % of canvas
  opacity?: number; // 0–1 (e.g. for watermark layers); 1 when absent
}

export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number; // normalized 0–1 on canvas
  style: TextOverlayStyle;
}

export interface MediaOverlay {
  id: string;
  kind: "image" | "video";
  src: string; // path under the clip's assets dir
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number; // normalized 0–1
  z: number;
  opacity?: number;
}

export interface BrollSegment {
  id: string;
  src: string;
  start: number;
  end: number; // replaces main video on this range
  mode: "fill" | "fit";
}

export interface TransitionMarker {
  id: string;
  atTime: number;
  type: "fadein" | "fadeout" | "crossfade" | "crosszoom" | "zoomin" | "zoomout";
  durationSec: number;
}

export interface AudioTrack {
  id: string;
  kind: "music" | "sfx" | "upload";
  src: string;
  label?: string;
  start: number;
  end: number;
  gain: number; // 0–1
  fadeInSec?: number;
  fadeOutSec?: number;
  duckUnderSpeech?: boolean;
}

export interface RemovedRange {
  start: number;
  end: number;
} // speech cleanup cuts (clip-local seconds)

export interface ClipEdit {
  clipId: string;
  jobId: string;
  aspectRatio: string; // "9:16" | "1:1" | "16:9"
  durationSec: number; // edited duration (after removals)
  sourceInSec: number;
  sourceOutSec: number; // window into source.mp4 ("Extend a clip" widens this)
  layout: LayoutSegment[];
  tracker: boolean;
  caption: CaptionConfig;
  removed: RemovedRange[];
  wordStyles?: WordStyle[]; // per-word highlight/color + text edits (3A)
  muteBase?: boolean; // mute the base video audio in export (3B)
  textOverlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  broll: BrollSegment[];
  transitions: TransitionMarker[];
  autoTransitions: boolean;
  audio: AudioTrack[];
  blurBg?: BlurBackground; // auto blurred background for Fit-mode segments (absent = off)
  updatedAt: string;
}

export interface CaptionTemplate {
  id: string;
  name: string;
  config: CaptionConfig;
  createdAt: string;
}

// Auto blurred background (Fit mode): when the video doesn't fill the canvas, the empty
// area is filled with a strongly-blurred, cover-scaled copy of the SAME source frame
// (updated every frame in preview, mirrored in export). Honored only for single-layout
// segments in "fit" mode where bars would otherwise appear.
export interface BlurBackground {
  enabled: boolean;
  blur: number; // intensity 0–100
  scale: number; // cover-scale multiplier (≥1 zooms the background in)
  brightness: number; // 0.3–1.5 (1 = unchanged)
  opacity: number; // 0–1 (blended over black)
}

export const DEFAULT_BLUR_BG: BlurBackground = {
  enabled: true,
  blur: 60,
  scale: 1.2,
  brightness: 0.7,
  opacity: 1,
};
