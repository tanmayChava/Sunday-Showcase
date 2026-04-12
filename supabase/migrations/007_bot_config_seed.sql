-- =========================================
-- BOT CONFIG SEED + OFFICE AGENTS CLEANUP
-- =========================================
-- Seed bot_config with default values that the bot reads at startup.
-- Mission Control writes to this table; bot watches for changes via Realtime.

-- Seed default config values (idempotent — won't overwrite existing rows)
INSERT INTO bot_config (key, value, category) VALUES
  ('primary_model',     'gemini-2.5-flash',  'ai_engine'),
  ('temperature',       '0.7',               'ai_engine'),
  ('auto_compact',      'true',              'memory'),
  ('semantic_memory',   'true',              'memory'),
  ('fact_threshold',    '4',                 'memory'),
  ('delegation',        'true',              'sub_agents'),
  ('show_model_footer', 'true',              'general')
ON CONFLICT (key) DO NOTHING;

-- Clean up seeded office_agents (we'll sync from profiles.ts on startup)
-- Add extra columns for profile metadata
ALTER TABLE office_agents ADD COLUMN IF NOT EXISTS profile_name TEXT;
ALTER TABLE office_agents ADD COLUMN IF NOT EXISTS tools TEXT[] DEFAULT '{}';
ALTER TABLE office_agents ADD COLUMN IF NOT EXISTS temperature NUMERIC(3,2) DEFAULT 0.7;
ALTER TABLE office_agents ADD COLUMN IF NOT EXISTS max_iterations INTEGER DEFAULT 5;
ALTER TABLE office_agents ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '🤖';

-- Unique constraint on profile_name for upsert support
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'office_agents_profile_name_key'
  ) THEN
    ALTER TABLE office_agents ADD CONSTRAINT office_agents_profile_name_key UNIQUE (profile_name);
  END IF;
END $$;

-- Enable Realtime on bot_config for hot-reload
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE bot_config;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
