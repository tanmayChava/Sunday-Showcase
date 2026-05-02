-- Migration 009: Feature 4.4 — Natural Language Cron Scheduling
-- Adds columns to the reminders table for recurring reminder support.
--
-- New columns:
--   is_recurring   boolean — whether this reminder fires on a schedule
--   cron_expr      text    — cron expression (null for one-off)
--   schedule_desc  text    — human-readable description (e.g. "every Monday at 9am IST")
--
-- The fire_at column is reused as the NEXT fire time for recurring reminders.
-- After each fire, the bot updates fire_at to the next scheduled time instead
-- of marking the reminder as fired.
--
-- Run this migration once against your Supabase project.

-- Add recurring support columns to reminders table (graceful — safe to re-run)
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS is_recurring  BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cron_expr     TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS schedule_desc TEXT     DEFAULT NULL;

-- Index to efficiently query unfired reminders (existing index may already cover this)
CREATE INDEX IF NOT EXISTS idx_reminders_fired_fire_at
  ON reminders (fired, fire_at)
  WHERE fired = FALSE;

-- Comment the table for documentation
COMMENT ON COLUMN reminders.is_recurring IS 'True for recurring reminders; false for one-time.';
COMMENT ON COLUMN reminders.cron_expr IS 'Standard cron expression (UTC). Null for one-time reminders.';
COMMENT ON COLUMN reminders.schedule_desc IS 'Human-readable schedule: e.g. every Monday at 9:00 IST';
COMMENT ON COLUMN reminders.fire_at IS 'UTC timestamp of next scheduled fire. Updated after each recurring fire.';
