-- Supabase PostgreSQL schema for Social Media AI
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- All tables use UUID PKs and timestamptz. RLS is ON by default (no public policies needed).

-- ─── Analysis pipeline ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name   text NOT NULL,
  creators_category        text NOT NULL DEFAULT '',
  analysis_instruction     text NOT NULL DEFAULT '',
  new_concepts_instruction text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creators (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text NOT NULL UNIQUE,
  category         text NOT NULL DEFAULT '',
  profile_pic_url  text NOT NULL DEFAULT '',
  followers        integer NOT NULL DEFAULT 0,
  reels_count_30d  integer NOT NULL DEFAULT 0,
  avg_views_30d    integer NOT NULL DEFAULT 0,
  last_scraped_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link          text NOT NULL,
  thumbnail     text NOT NULL DEFAULT '',
  creator       text NOT NULL DEFAULT '',
  views         integer NOT NULL DEFAULT 0,
  likes         integer NOT NULL DEFAULT 0,
  comments      integer NOT NULL DEFAULT 0,
  analysis      text NOT NULL DEFAULT '',
  new_concepts  text NOT NULL DEFAULT '',
  date_posted   text NOT NULL DEFAULT '',
  date_added    timestamptz NOT NULL DEFAULT now(),
  config_name   text NOT NULL DEFAULT '',
  starred       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS videos_creator_idx    ON videos (creator);
CREATE INDEX IF NOT EXISTS videos_starred_idx    ON videos (starred);
CREATE INDEX IF NOT EXISTS videos_date_added_idx ON videos (date_added DESC);
CREATE INDEX IF NOT EXISTS videos_config_idx     ON videos (config_name);

-- ─── Outreach / Lead Intelligence ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prospect_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prospects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id           uuid NOT NULL REFERENCES prospect_lists(id) ON DELETE CASCADE,

  -- Identity
  full_name         text,
  first_name        text,
  headline          text,
  company           text,
  job_title         text,
  location          text,
  profile_url       text,
  email             text,
  bio               text,
  website           text,
  followers         integer,
  custom_notes      text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT 'csv', -- 'csv' | 'apify' | 'maps'
  raw_data          jsonb,

  -- Google Maps business inputs
  business_category text,
  rating            numeric(3,1),
  review_count      integer,
  price_range       text,
  phone             text,
  address           text,
  reviews_raw       text,

  -- AI analysis outputs
  analysis_status   text NOT NULL DEFAULT 'idle', -- 'idle' | 'analyzing' | 'done' | 'error'
  priority_score    integer,
  priority_level    text,  -- 'hot' | 'high' | 'medium' | 'low'
  review_summary    text,
  website_status    text,  -- 'has_website' | 'no_website' | 'social_only' | 'unknown'
  outreach_angle    text,
  last_analyzed_at  timestamptz,

  -- Outreach drafts
  draft_status      text NOT NULL DEFAULT 'idle', -- 'idle' | 'drafting' | 'done' | 'error'
  last_drafted_at   timestamptz,
  linkedin_message  text,
  email_message     text,
  whatsapp_message  text,
  cold_call_notes   jsonb,

  -- CRM pipeline
  lead_status         text NOT NULL DEFAULT 'new',
  last_contacted_at   timestamptz,
  follow_up_date      date,
  deal_value          numeric(12,2),
  price_quoted        numeric(12,2),
  price_confirmed     numeric(12,2),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prospects_list_id_idx      ON prospects (list_id);
CREATE INDEX IF NOT EXISTS prospects_lead_status_idx  ON prospects (lead_status);
CREATE INDEX IF NOT EXISTS prospects_priority_idx     ON prospects (priority_level);
CREATE INDEX IF NOT EXISTS prospects_analysis_idx     ON prospects (analysis_status);

CREATE TABLE IF NOT EXISTS offer_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_name    text NOT NULL,
  what_you_sell text NOT NULL DEFAULT '',
  channel_focus text NOT NULL DEFAULT 'Email', -- 'LinkedIn' | 'Instagram' | 'X' | 'Email'
  value_props   text[] NOT NULL DEFAULT '{}',
  tone          text NOT NULL DEFAULT '',
  cta           text NOT NULL DEFAULT '',
  proof_points  text,
  dos_and_donts text,
  is_active     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Clipping ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clip_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url            text,
  source_title          text NOT NULL DEFAULT '',
  source_duration_sec   numeric(10,3) NOT NULL DEFAULT 0,
  source_thumbnail      text,
  status                text NOT NULL DEFAULT 'idle',
  -- settings snapshot
  clip_model            text NOT NULL DEFAULT 'Auto',
  genre                 text NOT NULL DEFAULT 'Auto',
  clip_length_mode      text NOT NULL DEFAULT 'Auto (0-3m)',
  auto_hook             boolean NOT NULL DEFAULT true,
  caption_preset        text NOT NULL DEFAULT 'Karaoke',
  aspect_ratio          text NOT NULL DEFAULT '9:16',
  speech_language       text NOT NULL DEFAULT 'English',
  include_moments_prompt text,
  range_start_sec       numeric(10,3) NOT NULL DEFAULT 0,
  range_end_sec         numeric(10,3) NOT NULL DEFAULT 0,
  top_k                 integer NOT NULL DEFAULT 5,
  errors                text[] NOT NULL DEFAULT '{}',
  progress              jsonb,  -- live ClipProgress (replaces in-memory Map)
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_jobs_status_idx ON clip_jobs (status);
CREATE INDEX IF NOT EXISTS clip_jobs_created_idx ON clip_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS clips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       uuid NOT NULL REFERENCES clip_jobs(id) ON DELETE CASCADE,
  rank         integer NOT NULL DEFAULT 1,
  title        text NOT NULL DEFAULT '',
  start_sec    numeric(10,3) NOT NULL DEFAULT 0,
  end_sec      numeric(10,3) NOT NULL DEFAULT 0,
  duration_sec numeric(10,3) NOT NULL DEFAULT 0,
  score        integer NOT NULL DEFAULT 0,
  hook         text NOT NULL DEFAULT '',
  hook_type    text NOT NULL DEFAULT '',
  genre        text NOT NULL DEFAULT '',
  reason       text NOT NULL DEFAULT '',
  transcript   text NOT NULL DEFAULT '',
  file_path    text NOT NULL DEFAULT '', -- Storage object key when STORAGE_BACKEND=supabase
  public_url   text,
  thumbnail    text NOT NULL DEFAULT '',
  caption      text,
  starred      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clips_job_id_idx ON clips (job_id);
CREATE INDEX IF NOT EXISTS clips_starred_idx ON clips (starred);

CREATE TABLE IF NOT EXISTS clip_edits (
  clip_id    uuid PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
  job_id     uuid NOT NULL REFERENCES clip_jobs(id) ON DELETE CASCADE,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clip_transcripts (
  job_id     uuid PRIMARY KEY REFERENCES clip_jobs(id) ON DELETE CASCADE,
  words      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Social publishing ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS social_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     text NOT NULL DEFAULT 'instagram', -- 'instagram' | 'tiktok' | 'youtube'
  display_name text NOT NULL DEFAULT '',
  username     text NOT NULL DEFAULT '',
  avatar_url   text,
  access_token text NOT NULL DEFAULT '', -- store as-is; rotated regularly via OAuth refresh
  ig_user_id   text,
  page_id      text,
  expires_at   timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id        uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  caption        text NOT NULL DEFAULT '',
  scheduled_for  timestamptz,
  status         text NOT NULL DEFAULT 'draft', -- 'draft' | 'scheduled' | 'published' | 'failed'
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Caption templates ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS caption_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  config     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS caption_prompt_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  creator           text,
  context           text NOT NULL DEFAULT '',
  brand_voice       text,
  cta               text,
  hashtags          text,
  include_hashtags  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── App settings (single-row, non-secret prefs only) ───────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforces single row
  provider              text NOT NULL DEFAULT 'openrouter',
  openrouter_model      text NOT NULL DEFAULT 'deepseek/deepseek-v4-flash',
  gemini_model          text NOT NULL DEFAULT 'gemini-2.5-flash',
  linkedin_char_limit   integer NOT NULL DEFAULT 200,
  email_length_guidance text NOT NULL DEFAULT 'Aim for 80–130 words. Conversational and direct. No self-introduction opener.',
  whatsapp_char_limit   integer NOT NULL DEFAULT 600,
  sender_name           text NOT NULL DEFAULT '',
  default_location_label text NOT NULL DEFAULT '',
  transcription_provider text NOT NULL DEFAULT 'deepgram',
  default_caption_preset text NOT NULL DEFAULT 'Karaoke',
  default_aspect_ratio   text NOT NULL DEFAULT '9:16',
  default_clip_length    text NOT NULL DEFAULT 'Auto (0-3m)',
  yt_dlp_cookies_browser text NOT NULL DEFAULT '',
  yt_dlp_cookies_text    text NOT NULL DEFAULT '',
  enable_social_publish  boolean NOT NULL DEFAULT false,
  editor_shortcuts       jsonb NOT NULL DEFAULT '{}',
  updated_at             timestamptz NOT NULL DEFAULT now()
);
-- Seed the single settings row so GET always finds it
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Enable Row Level Security (no public policies — server-only via secret key) ──
ALTER TABLE configs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE creators                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_lists           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE clips                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_edits               ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_transcripts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE caption_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE caption_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings             ENABLE ROW LEVEL SECURITY;
