-- Publishing tables are server-owned. Browser clients get no direct access.

ALTER TABLE pub_storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_video_captions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_campaign_runner_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_campaign_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_campaign_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_upload_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pub_publish_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY pub_storage_objects_service_role_all ON pub_storage_objects
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_instagram_accounts_service_role_all ON pub_instagram_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_videos_service_role_all ON pub_videos
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_video_captions_service_role_all ON pub_video_captions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_campaigns_service_role_all ON pub_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_campaign_runner_state_service_role_all ON pub_campaign_runner_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_campaign_videos_service_role_all ON pub_campaign_videos
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_campaign_accounts_service_role_all ON pub_campaign_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_upload_jobs_service_role_all ON pub_upload_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY pub_publish_history_service_role_all ON pub_publish_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
