-- Mission Control — Enable Realtime on Memories
-- Run this in the Supabase SQL Editor

-- Enable realtime broadcasts for the exact tier-3 memories SUNDAY writes to
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE memories;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
