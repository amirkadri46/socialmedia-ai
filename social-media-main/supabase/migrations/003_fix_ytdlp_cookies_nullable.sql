-- Allow null values for optional yt-dlp cookie fields (fix NOT NULL from older schema)
ALTER TABLE app_settings
  ALTER COLUMN ytdlp_cookies_browser DROP NOT NULL,
  ALTER COLUMN ytdlp_cookies_text    DROP NOT NULL;
