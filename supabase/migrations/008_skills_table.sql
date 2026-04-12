-- =========================================
-- SKILLS TABLE — Supabase-backed Skills System
-- =========================================
-- Stores skill definitions that the bot hot-reloads via Realtime.
-- Mission Control can create, edit, enable/disable skills — changes
-- propagate to the running bot in real-time without restarts.

CREATE TABLE IF NOT EXISTS skills (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN DEFAULT true,
  category    TEXT DEFAULT 'general',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by slug
CREATE INDEX IF NOT EXISTS idx_skills_slug ON skills (slug);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills (enabled);

-- Enable Realtime for hot-reload
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE skills;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- ─── Seed from existing skill files ──────────────────────────────
-- These match the current /skills/*.md files

INSERT INTO skills (name, slug, description, content, enabled, category) VALUES
  ('Job Finder', 'job-finder',
   'Finds real job listings using Apify scrapers across LinkedIn, Indeed, and Naukri',
   E'When the user asks to find jobs, job listings, openings, or career opportunities:\n\n## ALWAYS delegate to the ''jobs'' agent\n\nUse the `delegate` tool with `agent: "jobs"` for ALL job search requests. Do NOT attempt to search manually with web_search. The jobs agent has the `apify_job_search` tool which returns real, live listings.\n\n## What to pass in the task:\n- Role(s) to search for\n- Location (default: India)\n- Time filter (default: past 24 hours)\n- Platforms (LinkedIn, Indeed, Naukri — or all three)\n- Count requested (e.g. "find 20 jobs")\n- Experience level if mentioned (fresher, 0-1 yr, mid-level, etc.)\n\n## NEVER:\n- Ask the user "do you want me to proceed?" — just delegate immediately\n- Use web_search for job listings (it can''t filter by time)\n- Say "I cannot find specific job postings" — that''s what the jobs agent is for\n- Make the user go to job boards themselves',
   true, 'productivity'),

  ('Code Review', 'code-review',
   'Expert code review and analysis',
   E'When asked to review code, analyze it for:\n- Bugs and potential issues\n- Performance concerns\n- Security vulnerabilities\n- Best practices and patterns\n- Readability and maintainability\n\nProvide actionable suggestions with code examples.',
   true, 'development'),

  ('Research Assistant', 'research-assistant',
   'Deep research and analysis on any topic',
   E'When asked to research a topic:\n1. Use web_search for initial discovery\n2. Use web_research for deep multi-source analysis\n3. Use read_url to extract key details from top sources\n4. Synthesize findings into a clear, structured report\n5. Always cite sources',
   true, 'research'),

  ('Daily Planner', 'daily-planner',
   'Helps plan and organize the day',
   E'When the user asks to plan their day or manage tasks:\n- Ask about priorities if not stated\n- Create a structured timeline\n- Consider energy levels (deep work in morning)\n- Include breaks and buffer time\n- Track commitments and deadlines',
   true, 'productivity'),

  ('Summarizer', 'summarizer',
   'Summarize long texts, articles, and documents',
   E'When asked to summarize content:\n- Extract key points and main arguments\n- Preserve important details and data\n- Use bullet points for clarity\n- Include a TL;DR at the top\n- Note any caveats or limitations',
   true, 'general'),

  ('Writing Coach', 'writing-coach',
   'Helps improve writing style and clarity',
   E'When helping with writing:\n- Focus on clarity and conciseness\n- Suggest stronger word choices\n- Improve sentence structure\n- Maintain the author''s voice\n- Provide before/after examples',
   true, 'creative'),

  ('Debate Partner', 'debate-partner',
   'Engages in structured debates and arguments',
   E'When asked to debate:\n- Take the assigned position seriously\n- Use logical arguments and evidence\n- Address counterarguments\n- Keep it respectful and constructive\n- Summarize key points at the end',
   true, 'general'),

  ('Git Expert', 'git-expert',
   'Expert guidance on Git workflows and commands',
   E'When asked about Git:\n- Provide exact commands to run\n- Explain what each command does\n- Suggest best practices for branching\n- Help resolve merge conflicts\n- Recommend workflow strategies',
   true, 'development'),

  ('Learning Accelerator', 'learning-accelerator',
   'Accelerates learning with structured approaches',
   E'When helping someone learn:\n- Break complex topics into digestible parts\n- Use analogies and examples\n- Create practice exercises\n- Test understanding with questions\n- Provide resources for deeper learning',
   true, 'general'),

  ('Startup Ideator', 'startup-ideator',
   'Generates and validates startup ideas',
   E'When brainstorming startup ideas:\n- Identify pain points and market gaps\n- Evaluate feasibility and market size\n- Suggest MVP features\n- Analyze competition\n- Outline a validation strategy',
   true, 'business'),

  ('SaaS Architect', 'saas-architect',
   'Designs SaaS application architectures',
   E'When designing SaaS architectures:\n- Choose appropriate tech stack\n- Design for scalability from day one\n- Plan multi-tenancy strategy\n- Consider security and compliance\n- Outline deployment and monitoring',
   true, 'development'),

  ('System Design', 'system-design',
   'System design for interviews and real projects',
   E'When doing system design:\n- Start with requirements clarification\n- Estimate scale and constraints\n- Design high-level architecture\n- Deep dive into critical components\n- Discuss trade-offs and alternatives',
   true, 'development'),

  ('Product Improver', 'product-improver',
   'Improves products with actionable suggestions',
   E'When asked to improve a product:\n- Analyze current user experience\n- Identify friction points\n- Suggest UI/UX improvements\n- Prioritize by impact vs effort\n- Provide mockup descriptions',
   true, 'business')
ON CONFLICT (slug) DO NOTHING;
