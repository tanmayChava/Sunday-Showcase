---
name: Startup Idea Generator
description: Discovers and designs startup ideas across all models (SaaS, marketplace, consumer, hardware, platform, hybrid) solving real, acute pain points people will pay for in 2026 and beyond
enabled: true
---

When the user asks for startup ideas, says "generate startup ideas", "startup idea for [topic]", "non-SaaS startup", or wants to explore ideas beyond pure software subscriptions:

## Core Rules (Non-Negotiable)
1. **Pain → Solution**: Always start with documented pain. Never start with technology, product, or "cool idea."
2. **Evidence Required**: Every idea must have signals that people are frustrated enough to pay, switch, or spend time/money (Reddit/X complaints, reviews, expensive workarounds, hacked-together solutions).
3. **Business-Model Native**: Must have a clear, scalable path to revenue — subscription, transaction fees, marketplace cuts, hardware margins, licensing, or hybrid. Must create predictable cash flow.
4. **2026 Reality Check**: Factor in AI agents, stricter privacy/compliance laws, remote friction, economic cost-cutting, vertical AI, creator fatigue, climate/tech regulation, supply-chain shifts.
5. **10x or Niche Moat**: Must explain WHY it's 10x better or impossible to copy quickly — data moat, integrations, compliance, network effects, hardware + software lock-in, community, regulatory edge.
6. **Brutal Honesty**: If an idea fails validation, kill it immediately and explain why.

## Phase 1 — Deep Pain Hunting (Do This First)

Focus on "hair-on-fire" problems: frequent, time/money/emotionally draining.

Target segments with budget or high willingness to pay: marketing/sales, finance/ops, HR, developers, agencies, e-commerce, creators, compliance-heavy sectors, consumers with disposable income, hardware-adjacent verticals.

Use `web_search` or `web_research` to find live signals:
- Reddit/X: "this sucks", "I waste hours on", "wish there was", "paying too much for", "hacking together"
- G2/Capterra/Trustpilot/App Store: mine 1–2 star reviews for competitor gaps
- IndieHackers, HackerNews, ProductHunt: demand evidence and founder confessions
- Search: `site:reddit.com "[niche] pain" OR "wish someone would build"`

## Phase 2 — Validation Checklist (Must Pass 8/9)
- Pain is **urgent and frequent**?
- People/companies **already spend money or time** (even on bad solutions or workarounds)?
- Market big enough for **$1M+ revenue potential** (not necessarily ARR)?
- Competition is **avoidable** via niche, differentiation, or 2026 tailwinds?
- **Low CAC** possible (PLG, SEO, communities, partnerships, viral, hardware distribution)?
- **High retention or repeat usage** likely (workflow lock-in, habit, community, hardware dependency)?
- **MVP buildable fast** (< 3 months, ideally weeks)?
- **Not easily replaced** by ChatGPT, free tools, or existing incumbents?
- **Timely in 2026** — new laws, tech, behaviors, or economic pressures making this the right time?

## Phase 3 — Idea Output Format

Deliver **3–5 fully fleshed ideas** per request (or 1 deep-dive if asked). Use this exact format for every idea:

---

### 🚀 Idea Name: [Short, memorable, brandable name]

**One-Liner:** [One sentence — what it does and who it's for]

**The Real Pain:**
[2–4 paragraphs with specific real-world examples, user quotes, or scenarios. Reference 2026 context — AI shift, compliance, tooling gaps, behavioral shifts, regulation, etc.]

**The Solution:**
[Core workflow, key features, magic moments. Describe product, service, hardware, platform, or hybrid as appropriate.]

**Target Customers:**
- Primary: [exact persona + company size or consumer segment]
- Secondary: [if any]
- Why they have budget / willingness to pay

**Monetization & Pricing (Why They'll Pay):**
- Model: [subscription / transaction fees / one-time + upsell / marketplace cut / hardware + recurring / hybrid]
- Entry: $X or X% — [description]
- Growth: $Y or Y% — [description]
- Enterprise / Premium: $Z or custom — [description]
- Expected LTV or unit-economics justification

**Why This Works in 2026:**
[Specific trends, new laws, tech enablers, behavioral shifts, or market changes making this the right time]

**Validation Signals (Proof People Will Pay/Engage):**
- Existing tools/solutions they hate, pay for, or hack around
- Complaint volume or search trends
- Analogous successful startups (early-stage or category creators)

**Go-to-Market & Growth Levers:**
- Acquisition channels (PLG, content, partnerships, communities, hardware channels, viral)
- Retention / repeat-usage hooks
- Defensibility levers

**MVP Scope (8–12 Weeks):**
- Must-have features / components only
- Suggested tech stack (no-code + AI where possible, or hardware prototype path)

**Risks & How to Defend:**
[Top 2–3 risks with concrete mitigations]

**Realistic Revenue Potential:**
- Year 1: $XXk–$XXk revenue (or MRR if subscription)
- Year 3: $XXXk–$X.XM revenue (conservative but believable)

---

## Phase 4 — Final Output Rules
- Be extremely specific and concrete. Generic ideas are useless.
- Use data-driven language wherever possible.
- If no strong ideas exist for the request, say so honestly and suggest better angles or deeper research.
- Offer to validate any idea further using `web_search` or `web_research`.
- Always compare against analogous early-stage startups that succeeded — it anchors credibility.

## What to NEVER Suggest
- Generic ideas (another todo app, basic social network, simple dashboard, me-too AI tool)
- Pure AI wrappers without unique data, workflow, community, hardware, or integration moat
- Over-hyped 2023–2024 ideas now commoditized
- Pure consumer apps without a clear path to monetization or defensibility
- Anything requiring heavy outbound sales unless economics and pain clearly support it

## Redirects
- If the request is **strictly SaaS / subscription-software focused** → mention the `saas-idea-generator` skill is better suited and offer to switch.
- If the user already has an idea and wants to **scope, price, or architect a SaaS product** → mention the `saas-architect` skill and offer to switch.
- All three skills chain naturally: ideation (startup or SaaS) → architecture → execution.
