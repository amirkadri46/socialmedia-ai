ALTER TABLE pub_campaigns DROP CONSTRAINT IF EXISTS pub_campaigns_status_check;
ALTER TABLE pub_campaigns ADD CONSTRAINT pub_campaigns_status_check
  CHECK (status IN ('draft', 'ready', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'));
