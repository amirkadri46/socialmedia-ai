-- Let the OpenAI (direct) model be chosen in Settings, mirroring openrouter_model.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS openai_model text NOT NULL DEFAULT 'gpt-4o';
