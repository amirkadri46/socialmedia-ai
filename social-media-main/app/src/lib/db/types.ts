export type StorageStatus = "available" | "deleted";
export type PublishStatus = "unpublished" | "scheduled" | "published";
export type AccountStatus = "connected" | "needs_reauth" | "disconnected";
export type CampaignStatus = "draft" | "ready" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
export type JobStatus =
  | "queued" | "preparing" | "uploading" | "waiting_for_instagram"
  | "publishing" | "published" | "failed" | "cancelled";

export interface StorageObject {
  id: string;
  provider: string;
  bucket: string;
  key: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  version: number;
  is_current: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface InstagramAccount {
  id: string;
  ig_user_id: string;
  username: string;
  display_name: string | null;
  access_token: string;
  token_expires_at: string | null;
  status: AccountStatus;
  last_posted_at: string | null;
  created_at: string;
}

export interface Video {
  id: string;
  storage_object_id: string | null;
  thumbnail_object_id: string | null;
  title: string;
  creator: string | null;
  platform: string | null;
  duration_sec: number | null;
  original_url: string | null;
  storage_status: StorageStatus;
  publish_status: PublishStatus;
  downloaded_at: string;
}

export interface VideoCaption {
  id: string;
  video_id: string;
  platform: string;
  language: string;
  caption: string;
  created_at: string;
}

export interface ScheduleRule {
  frequencyHours: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  randomizeMinutes: number;
  startDate: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  caption_prompt_template: string | null;
  assignment_mode: "crosspost" | "distribute";
  schedule_rule: ScheduleRule;
  timezone: string;
  starts_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRunnerState {
  campaign_id: string;
  cursor: number;
  last_tick: string | null;
  locked_until: string | null;
  worker_id: string | null;
}

export interface CampaignVideo {
  id: string;
  campaign_id: string;
  video_id: string;
  position: number;
  skipped: boolean;
}

export interface UploadJob {
  id: string;
  campaign_id: string | null;
  video_id: string;
  account_id: string;
  scheduled_at: string;
  idempotency_key: string;
  status: JobStatus;
  retry_count: number;
  error_message: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  instagram_container_id: string | null;
  instagram_media_id: string | null;
  published_at: string | null;
  created_at: string;
}

export interface PublishHistory {
  id: string;
  job_id: string | null;
  video_id: string;
  account_id: string;
  instagram_media_id: string | null;
  permalink: string | null;
  published_at: string;
  views_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  reach: number | null;
  analytics_fetched_at: string | null;
}
