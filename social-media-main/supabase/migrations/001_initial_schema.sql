-- ============================================================
-- 001_initial_schema.sql
-- Publishing system foundation schema.
-- All tables are prefixed with pub_ to avoid collision with
-- the existing analysis-pipeline tables (videos, etc.).
-- Run via: Supabase dashboard SQL editor or `supabase db push`
-- ============================================================

-- pub_storage_objects
CREATE TABLE IF NOT EXISTS pub_storage_objects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL DEFAULT 'r2',
  bucket       text NOT NULL,
  key          text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  checksum     text,
  version      int NOT NULL DEFAULT 1,
  is_current   boolean NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS pub_storage_objects_checksum_idx ON pub_storage_objects (checksum);
CREATE INDEX IF NOT EXISTS pub_storage_objects_key_is_current_idx ON pub_storage_objects (key, is_current);

-- pub_instagram_accounts
CREATE TABLE IF NOT EXISTS pub_instagram_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_user_id       text UNIQUE NOT NULL,
  username         text NOT NULL,
  display_name     text,
  access_token     text NOT NULL,
  token_expires_at timestamptz,
  status           text NOT NULL DEFAULT 'connected'
                   CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),
  last_posted_at   timestamptz,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pub_instagram_accounts_status_idx ON pub_instagram_accounts (status);

-- pub_videos
CREATE TABLE IF NOT EXISTS pub_videos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_object_id   uuid REFERENCES pub_storage_objects(id),
  thumbnail_object_id uuid REFERENCES pub_storage_objects(id),
  title               text NOT NULL,
  creator             text,
  platform            text,
  duration_sec        int,
  original_url        text,
  storage_status      text NOT NULL DEFAULT 'available'
                      CHECK (storage_status IN ('available', 'deleted')),
  publish_status      text NOT NULL DEFAULT 'unpublished'
                      CHECK (publish_status IN ('unpublished', 'scheduled', 'published')),
  downloaded_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pub_videos_platform_idx ON pub_videos (platform);
CREATE INDEX IF NOT EXISTS pub_videos_storage_publish_status_idx ON pub_videos (storage_status, publish_status);

-- pub_video_captions
CREATE TABLE IF NOT EXISTS pub_video_captions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   uuid NOT NULL REFERENCES pub_videos(id) ON DELETE CASCADE,
  platform   text NOT NULL DEFAULT 'instagram',
  language   text NOT NULL DEFAULT 'en',
  caption    text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (video_id, platform, language)
);

-- pub_campaigns
CREATE TABLE IF NOT EXISTS pub_campaigns (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'ready', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  caption_prompt_template text,
  assignment_mode         text NOT NULL DEFAULT 'crosspost'
                          CHECK (assignment_mode IN ('crosspost', 'distribute')),
  schedule_rule           jsonb NOT NULL DEFAULT '{}',
  timezone                text NOT NULL DEFAULT 'UTC',
  starts_at               timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- pub_campaign_runner_state
CREATE TABLE IF NOT EXISTS pub_campaign_runner_state (
  campaign_id  uuid PRIMARY KEY REFERENCES pub_campaigns(id) ON DELETE CASCADE,
  cursor       int NOT NULL DEFAULT 0,
  last_tick    timestamptz,
  locked_until timestamptz,
  worker_id    text
);

-- pub_campaign_videos
CREATE TABLE IF NOT EXISTS pub_campaign_videos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES pub_campaigns(id) ON DELETE CASCADE,
  video_id    uuid NOT NULL REFERENCES pub_videos(id),
  position    int NOT NULL,
  skipped     boolean NOT NULL DEFAULT false,
  UNIQUE (campaign_id, video_id)
);

CREATE INDEX IF NOT EXISTS pub_campaign_videos_campaign_position_idx ON pub_campaign_videos (campaign_id, position);

-- pub_campaign_accounts
CREATE TABLE IF NOT EXISTS pub_campaign_accounts (
  campaign_id uuid NOT NULL REFERENCES pub_campaigns(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES pub_instagram_accounts(id),
  PRIMARY KEY (campaign_id, account_id)
);

-- pub_upload_jobs
CREATE TABLE IF NOT EXISTS pub_upload_jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            uuid REFERENCES pub_campaigns(id),
  video_id               uuid NOT NULL REFERENCES pub_videos(id),
  account_id             uuid NOT NULL REFERENCES pub_instagram_accounts(id),
  scheduled_at           timestamptz NOT NULL,
  idempotency_key        text UNIQUE NOT NULL,
  status                 text NOT NULL DEFAULT 'queued'
                         CHECK (status IN (
                           'queued', 'preparing', 'uploading', 'waiting_for_instagram',
                           'publishing', 'published', 'failed', 'cancelled'
                         )),
  retry_count            int NOT NULL DEFAULT 0,
  error_message          text,
  claimed_by             text,
  claimed_at             timestamptz,
  instagram_container_id text,
  instagram_media_id     text,
  published_at           timestamptz,
  created_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pub_upload_jobs_status_scheduled_idx ON pub_upload_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS pub_upload_jobs_campaign_id_idx ON pub_upload_jobs (campaign_id);
CREATE INDEX IF NOT EXISTS pub_upload_jobs_account_scheduled_idx ON pub_upload_jobs (account_id, scheduled_at);

-- pub_publish_history
CREATE TABLE IF NOT EXISTS pub_publish_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               uuid REFERENCES pub_upload_jobs(id),
  video_id             uuid NOT NULL REFERENCES pub_videos(id),
  account_id           uuid NOT NULL REFERENCES pub_instagram_accounts(id),
  instagram_media_id   text,
  permalink            text,
  published_at         timestamptz NOT NULL DEFAULT now(),
  views_count          bigint,
  likes_count          bigint,
  comments_count       bigint,
  reach                bigint,
  analytics_fetched_at timestamptz
);

CREATE INDEX IF NOT EXISTS pub_publish_history_account_published_idx ON pub_publish_history (account_id, published_at);
CREATE INDEX IF NOT EXISTS pub_publish_history_pending_analytics_idx ON pub_publish_history (analytics_fetched_at)
  WHERE analytics_fetched_at IS NULL;
