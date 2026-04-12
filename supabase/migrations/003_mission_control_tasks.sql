-- Mission Control — Tasks Table
-- Run this in the Supabase SQL Editor

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'backlog' check (status in ('recurring', 'backlog', 'in_progress', 'review', 'done')),
  tag text,
  avatar text,
  avatar_color text,
  dot_color text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS (Optional, based on your Supabase configuration, but typically good practice)
-- alter table tasks enable row level security;
-- create policy "Allow all" on tasks for all using (true);

-- Insert initial task data
insert into tasks (title, description, status, tag, avatar, avatar_color, dot_color) values
('Determine next steps', 'Awaiting User instructions', 'in_progress', 'SUNDAY', 'U', 'avatar-h', 'orange'),
('Build Digital Office Screen', 'Created visual representation of the team', 'done', 'Mission Control', 'A', 'avatar-a', 'green'),
('Add Memory Screen', 'Included memory screen and search functionality', 'done', 'Mission Control', 'A', 'avatar-a', 'green'),
('Add Calendar to Mission Control', 'Included calendar section for scheduled tasks', 'done', 'Mission Control', 'A', 'avatar-a', 'green'),
('Create task tracking board', 'Initial setup of the board', 'done', 'Mission Control', 'A', 'avatar-a', 'green');
