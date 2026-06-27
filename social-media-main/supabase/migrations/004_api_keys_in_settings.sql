-- Store API keys entered via the Settings UI so they survive page refreshes.
-- Env vars always take priority at runtime; these are the DB fallback.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS openai_api_key      text,
  ADD COLUMN IF NOT EXISTS openrouter_api_key  text,
  ADD COLUMN IF NOT EXISTS apify_api_token     text,
  ADD COLUMN IF NOT EXISTS deepgram_api_key    text,
  ADD COLUMN IF NOT EXISTS assemblyai_api_key  text,
  ADD COLUMN IF NOT EXISTS meta_app_id         text,
  ADD COLUMN IF NOT EXISTS meta_app_secret     text;
