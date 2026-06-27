/**
 * repos — the single import for all data access.
 *
 * Set STORAGE_BACKEND=supabase in env to switch from file-based storage to Supabase.
 * Default is "file" so the app keeps working exactly as before during migration.
 *
 * Usage in API routes:
 *   import { repos } from "@/lib/db";
 *   const configs = await repos.configs.getAll();
 */

import { fileConfigs, supabaseConfigs } from "./repos/configs";
import { fileCreators, supabaseCreators } from "./repos/creators";
import { fileVideos, supabaseVideos } from "./repos/videos";
import { fileProspects, supabaseProspects } from "./repos/prospects";
import { fileOfferTemplates, supabaseOfferTemplates } from "./repos/offer-templates";
import { fileClipJobs, supabaseClipJobs } from "./repos/clip-jobs";
import { fileClips, supabaseClips } from "./repos/clips";
import { fileClipEdits, supabaseClipEdits } from "./repos/clip-edits";
import { fileClipTranscripts, supabaseClipTranscripts } from "./repos/clip-transcripts";
import { fileSocialAccounts, supabaseSocialAccounts } from "./repos/social-accounts";
import { fileScheduledPosts, supabaseScheduledPosts } from "./repos/scheduled-posts";
import { fileCaptionTemplates, supabaseCaptionTemplates } from "./repos/caption-templates";
import { fileCaptionPromptTemplates, supabaseCaptionPromptTemplates } from "./repos/caption-prompt-templates";
import { fileSettings, supabaseSettings } from "./repos/settings";

const isSupabase = process.env.STORAGE_BACKEND === "supabase";

export const repos = {
  configs:                isSupabase ? supabaseConfigs               : fileConfigs,
  creators:               isSupabase ? supabaseCreators              : fileCreators,
  videos:                 isSupabase ? supabaseVideos                : fileVideos,
  prospects:              isSupabase ? supabaseProspects             : fileProspects,
  offerTemplates:         isSupabase ? supabaseOfferTemplates        : fileOfferTemplates,
  clipJobs:               isSupabase ? supabaseClipJobs              : fileClipJobs,
  clips:                  isSupabase ? supabaseClips                 : fileClips,
  clipEdits:              isSupabase ? supabaseClipEdits             : fileClipEdits,
  clipTranscripts:        isSupabase ? supabaseClipTranscripts       : fileClipTranscripts,
  socialAccounts:         isSupabase ? supabaseSocialAccounts        : fileSocialAccounts,
  scheduledPosts:         isSupabase ? supabaseScheduledPosts        : fileScheduledPosts,
  captionTemplates:       isSupabase ? supabaseCaptionTemplates      : fileCaptionTemplates,
  captionPromptTemplates: isSupabase ? supabaseCaptionPromptTemplates : fileCaptionPromptTemplates,
  settings:               isSupabase ? supabaseSettings              : fileSettings,
};

export type Repos = typeof repos;
