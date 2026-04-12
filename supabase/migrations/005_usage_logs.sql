-- Create usage_logs table for Mission Control cost tracking
-- Records every LLM API call from SUNDAY for dashboard visualization

CREATE TABLE IF NOT EXISTS usage_logs (
    id          BIGSERIAL PRIMARY KEY,
    chat_id     TEXT NOT NULL,
    model       TEXT NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 8) NOT NULL DEFAULT 0,
    latency_ms  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for Mission Control queries (cost by day, cost by model)
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs (model);
CREATE INDEX IF NOT EXISTS idx_usage_logs_chat_id ON usage_logs (chat_id);

-- Enable Realtime for this table (so Mission Control gets live updates)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE usage_logs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
