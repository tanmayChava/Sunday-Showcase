-- Mission Control Dashboard — Additional Tables
-- Run this in the Supabase SQL Editor

-- Activity log for agent actions (heartbeats, messages, tool calls)
create table if not exists activity_log (
  id bigserial primary key,
  type text not null check (type in ('heartbeat', 'message', 'tool_use', 'content_sync', 'error')),
  description text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_activity_log_created on activity_log(created_at desc);
create index if not exists idx_activity_log_type on activity_log(type);

-- Bot configuration (personality, settings, grouped by category)
create table if not exists bot_config (
  key text primary key,
  value text not null,
  category text not null default 'general',
  updated_at timestamptz default now()
);

-- Content items synced from external platforms (YouTube, etc.)
create table if not exists content_items (
  id bigserial primary key,
  title text not null,
  url text,
  thumbnail_url text,
  platform text not null default 'youtube',
  views bigint default 0,
  likes bigint default 0,
  comments bigint default 0,
  outlier_score float default 1.0,
  published_at timestamptz,
  synced_at timestamptz default now()
);

-- Bot facts / Second Brain knowledge store
create table if not exists bot_facts (
  id bigserial primary key,
  content text not null,
  category text not null default 'general',
  source text,
  created_at timestamptz default now()
);
create index if not exists idx_bot_facts_category on bot_facts(category);

-- Enable realtime for activity_log
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
