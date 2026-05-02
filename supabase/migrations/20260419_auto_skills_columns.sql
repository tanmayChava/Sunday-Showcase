-- Migration: Create skills table (full schema)
-- Run this in Supabase SQL Editor → New Query → Run
--
-- Creates the skills table from scratch if it doesn't exist.
-- This table serves two purposes:
--   1. Operator-managed skills created via Mission Control dashboard
--   2. Auto-generated skills from the autonomous skill generator (auto-generator.ts)
--
-- loader.ts reads from this table on startup and via Supabase Realtime hot-reload.
-- auto-generator.ts writes to this table as its primary persistence store.

CREATE TABLE IF NOT EXISTS public.skills (
  -- Core identity
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT        NOT NULL UNIQUE,  -- URL-safe dedup key (e.g. "web-research-workflow")
  name          TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',

  -- Skill content — the actual prompt/instructions injected into the agent
  content       TEXT        NOT NULL DEFAULT '',

  -- Classification
  category      TEXT        NOT NULL DEFAULT 'general',
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Auto-generation metadata (null for manually-created skills)
  auto_generated  BOOLEAN   NOT NULL DEFAULT FALSE,
  source_agent    TEXT,                       -- which sub-agent generated it (e.g. "research")
  effectiveness   INTEGER   NOT NULL DEFAULT 0, -- times reused; incremented by feedback loop

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────

-- Speed up loader.ts: SELECT * FROM skills ORDER BY name
CREATE INDEX IF NOT EXISTS idx_skills_name
  ON public.skills (name);

-- Speed up auto-generator.ts: SELECT ... WHERE auto_generated = TRUE
CREATE INDEX IF NOT EXISTS idx_skills_auto_generated
  ON public.skills (auto_generated)
  WHERE auto_generated = TRUE;

-- ─── Auto-update updated_at on any row change ─────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skills_updated_at ON public.skills;
CREATE TRIGGER trg_skills_updated_at
  BEFORE UPDATE ON public.skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Enable Realtime (required for loader.ts hot-reload) ──────────
-- Run this only if your Supabase project has Realtime enabled.
-- Go to: Database → Replication → Tables → enable for 'skills'
-- OR uncomment the line below (requires superuser in some plans):
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.skills;
