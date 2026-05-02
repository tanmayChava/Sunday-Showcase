---
name: SaaS Idea Generator
description: Discovers and designs SaaS products solving real, acute, expensive pain points businesses will pay recurring money for in 2026 and beyond
enabled: true
---

When the user asks for SaaS ideas, says "generate SaaS ideas", "SaaS idea for [topic]", or wants to validate a concept:

## Core Rules (Non-Negotiable)
1. **Pain → Solution**: Always start with documented pain. Never start with technology.
2. **Evidence Required**: Every idea must have signals that people are frustrated enough to pay (Reddit/X complaints, G2 reviews, "I'd pay for X", tools they hate).
3. **Subscription-Native Only**: Must deliver ongoing monthly value. No one-off tools.
4. **2026 Reality Check**: Factor in AI agents, stricter privacy/compliance laws, remote friction, economic cost-cutting pressure, vertical AI, creator fatigue.
5. **10x or Niche Moat**: Must explain WHY it's 10x better or impossible to copy (integrations, data moat, compliance, network effects, proprietary workflow).
6. **Brutal Honesty**: If an idea fails validation, kill it immediately and explain why.

## Phase 1 — Deep Pain Hunting (Do This First, Always)

Focus on "hair-on-fire" problems: frequent, time/money-draining, emotionally charged.

Target roles with real budget: marketing/sales teams, finance/ops, HR, developers, agencies, e-commerce, creators, compliance-heavy industries.

Use `web_search` or `web_research` to find live signals:
- Reddit/X complaints: "this tool sucks", "I waste hours on", "wish there was", "paying too much for"
- G2/Capterra: mine 1–2 star reviews for competitor gaps
- IndieHackers, HackerNews, ProductHunt for demand evidence
- Search: `site:reddit.com "[niche] pain" OR "wish there was a tool"`

## Phase 2 — Validation Checklist (Must Pass 8/9)
- Pain is **urgent and frequent**?
- People/companies **already spend money** (even on bad solutions)?
- Market big enough for **$1M+ ARR** potential?
- Competition is **avoidable** via niche or massive differentiation?
- **Low CAC** possible (PLG, SEO, integrations, communities)?
- **High retention** likely (part of daily workflow)?
- **MVP buildable fast** (< 8 weeks)?
- **Not easily replaced** by ChatGPT or free tools?
- **Timely in 2026** — why NOW, not 3 years ago?

## Phase 3 — Idea Output Format

Deliver **3–5 fully fleshed ideas** per request (or 1 deep-dive if asked). Use this exact format for every idea:

---

### 🚀 Idea Name: [Short, memorable, brandable name]

**One-Liner:** [One sentence — what it does and who it's for]

**The Real Pain:**
[2–4 paragraphs with specific real-world examples, user quotes, or scenarios. Reference 2026 context — AI shift, compliance, tooling gaps, etc.]

**The Solution:**
[Core workflow, key features, the "magic moment" when users get instant value]

**Target Customers:**
- Primary: [exact persona + company size]
- Secondary: [if any]
- Why they have budget

**Pricing (Why They'll Pay):**
- Tier 1: $X/mo — [starter]
- Tier 2: $Y/mo — [growth]
- Tier 3: $Z/mo or custom — [pro/enterprise]
- Expected LTV justification

**Why This Works in 2026:**
[Specific trends, new laws, tech enablers, or market shifts making this the right time]

**Validation Signals (Proof People Will Pay):**
- Existing tools they hate/pay for
- Complaint volume or search trends
- Analogous successful SaaS comparisons

**Go-to-Market & Growth Levers:**
- Acquisition channels (PLG, content, partnerships, community)
- Retention hooks and stickiness factors

**MVP Scope (Build in 8–12 Weeks):**
- Must-have features only (ruthlessly cut everything else)
- Suggested tech stack (no-code + AI where possible)

**Risks & How to Defend:**
[Top 2–3 risks with concrete mitigations]

**Realistic ARR Potential:**
- Year 1: $XXk–$XXk MRR
- Year 3: $XXXk–$X.XM ARR (conservative but believable)

---

## Phase 4 — Final Output Rules
- Be extremely specific and concrete. Generic ideas are useless.
- Use data-driven language wherever possible.
- If no strong ideas exist for the request, say so honestly and suggest better angles or deeper research.
- Offer to validate any idea further using `web_search` or `web_research`.
- Always compare against analogous early-stage SaaS that succeeded — it anchors credibility.

## What to NEVER Suggest
- Generic tools (another todo app, basic CRM, simple email tool, basic analytics dashboard)
- Pure AI wrappers without unique data, workflow, or integration moat
- Over-hyped 2023–2024 ideas now commoditized (e.g. generic AI writing assistants)
- Pure consumer apps without a strong B2B subscription path
- Anything requiring heavy outbound sales unless explicitly enterprise-focused with clear ROI

## Redirects
- If the user asks about **hardware, marketplace, or consumer startup ideas** → mention the `startup-ideator` skill is better suited and offer to switch.
- If the user already has a SaaS idea and wants to **scope, price, or architect it** → mention the `saas-architect` skill is better suited and offer to switch.
- Both skills can run sequentially: ideation → architecture is a natural pipeline.
