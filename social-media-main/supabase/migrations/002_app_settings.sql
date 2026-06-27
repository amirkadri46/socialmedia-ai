-- ============================================================
-- 002_app_settings.sql
-- App preferences table (non-secret settings, single-row).
-- Run via: Supabase dashboard SQL editor or `supabase db push`
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider               text NOT NULL DEFAULT 'openrouter',
  openrouter_model       text NOT NULL DEFAULT 'deepseek/deepseek-v4-flash',
  gemini_model           text NOT NULL DEFAULT 'gemini-2.5-flash',
  linkedin_char_limit    integer NOT NULL DEFAULT 200,
  email_length_guidance  text NOT NULL DEFAULT 'Aim for 80–130 words. Conversational and direct. No self-introduction opener.',
  whatsapp_char_limit    integer NOT NULL DEFAULT 600,
  sender_name            text NOT NULL DEFAULT '',
  default_location_label text NOT NULL DEFAULT '',
  transcription_provider text NOT NULL DEFAULT 'deepgram',
  default_caption_preset text NOT NULL DEFAULT 'Karaoke',
  default_aspect_ratio   text NOT NULL DEFAULT '9:16',
  default_clip_length    text NOT NULL DEFAULT 'Auto (0-3m)',
  ytdlp_cookies_browser  text,
  ytdlp_cookies_text     text,
  enable_social_publish  boolean NOT NULL DEFAULT false,
  editor_shortcuts       jsonb NOT NULL DEFAULT '{}',
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Seed the single settings row so GET always finds it
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
