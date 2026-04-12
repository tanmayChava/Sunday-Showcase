-- Mission Control — Enable Realtime on Tasks
-- Run this in the Supabase SQL Editor

-- This tells Supabase to broadcast insert, update, and delete events for the tasks table
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
