-- =========================================
-- MISSION CONTROL: FULL SYSTEM INTEGRATION
-- =========================================
-- Run this in your Supabase SQL Editor. 
-- It sets up the tables for your Calendar (Cron/Scheduled tasks)
-- and your Digital Office floorplan.

-- 1. Create the Calendar table
CREATE TABLE IF NOT EXISTS public.scheduled_events (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    title text NOT NULL,
    description text,
    scheduled_time timestamp with time zone NOT NULL,
    frequency text DEFAULT 'Once', -- 'Once', 'Daily', 'Weekly', 'Cron'
    status text DEFAULT 'Waiting', -- 'Waiting', 'Completed', 'Failed'
    assignee text,
    avatar text DEFAULT 'GC',
    avatar_color text DEFAULT 'avatar-a',
    created_at timestamp with time zone DEFAULT now()
);

-- 2. Create the Office floorplan table
CREATE TABLE IF NOT EXISTS public.office_agents (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    name text NOT NULL,
    role text NOT NULL,
    avatar text DEFAULT 'A',
    avatar_color text DEFAULT 'avatar-a',
    workstation text DEFAULT 'Main Node',
    status text DEFAULT 'Offline', -- 'Online', 'Working', 'Offline'
    current_activity text DEFAULT 'Idle',
    last_active timestamp with time zone DEFAULT now()
);

-- 3. ENABLE SUPABASE REALTIME ON NEW TABLES
-- (We also include the previous ones here just in case)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE office_agents;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================
-- OPTIONAL: SEED DATA TO PREVIEW THE UI
-- =========================================

-- Add a test Calendar event
INSERT INTO public.scheduled_events (title, description, scheduled_time, frequency, status, assignee, avatar, avatar_color)
VALUES 
('Daily Briefing Generation', 'Compiles the daily project summary and memory digest.', now() + interval '1 day', 'Daily', 'Waiting', 'System', '⚙️', 'avatar-h'),
('Database Backup', 'Full backup of Supabase public and vector schemas.', now() + interval '2 hours', 'Weekly', 'Waiting', 'Cron', '💾', 'avatar-c');

-- Add test Agents to the Office
INSERT INTO public.office_agents (name, role, avatar, avatar_color, workstation, status, current_activity)
VALUES 
('SUNDAY', 'Core AI Agent', 'SU', 'avatar-a', 'Primary Server', 'Working', 'Processing user requests and organizing memories.'),
('Alpha', 'Research Assistant', 'α', 'avatar-f', 'Node 02', 'Online', 'Waiting for tasks...'),
('Orion', 'Code Reviewer', 'O', 'avatar-c', 'Node 03', 'Offline', 'Sleeping zZz');
