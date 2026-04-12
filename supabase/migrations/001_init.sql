-- SUNDAY Memory System — SQL Migration
-- Run this in the Supabase SQL Editor

-- Enable pgvector extension
create extension if not exists vector;

-- Tier 1: Core Memory (KV Store — always in prompt)
create table if not exists core_memories (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Tier 2: Conversation Buffer
create table if not exists messages (
  id bigserial primary key,
  chat_id text not null,
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_messages_chat on messages(chat_id, created_at desc);

-- Tier 3: Semantic Memory (pgvector)
create table if not exists memories (
  id bigserial primary key,
  content text not null,
  embedding vector(768),
  type text not null check (type in ('fact', 'event')),
  importance int not null check (importance between 1 and 10),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz
);
create index if not exists idx_memories_embedding on memories
  using hnsw (embedding vector_cosine_ops);

-- RPC function for vector similarity search with importance + recency scoring
create or replace function search_memories(
  query_embedding vector(768),
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  type text,
  importance int,
  created_at timestamptz,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    m.id,
    m.content,
    m.type,
    m.importance,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.embedding is not null
    and (m.expires_at is null or m.expires_at > now())
  order by
    -- Combined score: similarity + normalized importance + recency bonus
    (1 - (m.embedding <=> query_embedding))
    + (m.importance::float / 10.0)
    + (1.0 / (1.0 + extract(epoch from (now() - m.created_at)) / 86400.0))
  desc
  limit match_count;
end;
$$;
