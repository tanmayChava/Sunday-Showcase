---
name: Startup Ideator
description: Generates and validates startup ideas with problem-solution mapping and trend analysis
enabled: true
---

When the user wants to brainstorm startup ideas or validate a concept:

## Idea Generation
1. **Start with problems, not solutions** — ask about pain points they've seen in their work, daily life, or industry
2. **Apply filters** to each idea:
   - Is this a painkiller (must-have) or a vitamin (nice-to-have)?
   - Who pays for this? Can you reach them?
   - Is the timing right? Why hasn't someone solved this already?
3. **Use frameworks**:
   - "What's broken?" — find existing processes people hate
   - "What's expensive?" — find services that can be 10x cheaper with tech
   - "What's manual?" — find repetitive tasks ripe for automation

## Trend Integration
1. **Search for current trends** — use web_search to find what's emerging NOW in the relevant industry
2. **Map ideas to macro trends**:
   - AI/ML adoption across industries
   - Quantum-safe cryptography and post-quantum security
   - Regulatory shifts (GDPR evolution, AI Act, DORA, NIST frameworks)
   - Climate tech and sustainability mandates
   - Web3/decentralized infrastructure maturation
   - Edge computing and IoT proliferation
3. **Validate timing** — is the market ready? Too early = no customers, too late = saturated
4. **Cross-reference with standards** — check if the idea aligns with upcoming guidelines (e.g., "Quantum-encrypted SaaS for fintech — validated against 2026 NIST post-quantum guidelines")
5. **Flag trend risks** — is this a hype cycle or a fundamental shift? Check if adoption curves support the idea

## Problem-Solution Mapping
1. **Define the problem sharply** — "Who has this problem, how often, and how painful is it (1-10)?"
2. **Map the current alternatives** — what do people do TODAY? (competitors, manual workarounds, spreadsheets)
3. **Find the gap** — what's missing from existing solutions?
4. **Propose the minimal solution** — the smallest thing you could build that solves the core pain

## Deep Problem Validation & Idea Discovery
PROACTIVELY use `web_search` or `web_research` to find hard evidence that this is a real problem or to discover the competitive landscape using the following sources:

### 1. Complaint & Pain Discovery (Organic Problems)
Use targeted site searches (e.g., `site:reddit.com "startup idea water plants" pain`) to find people venting about this issue.
- **Sites:** Reddit, Twitter/X, Quora, Hacker News, IndieHackers, BlackHatWorld, Warrior Forum, Stack Overflow.

### 2. Review Mining (Competitor Gaps)
Find existing competitors and analyze their 1-star and 2-star reviews to find what they are missing.
- **Sites:** G2, Capterra, TrustPilot, GetApp, Software Advice, TrustRadius, Gartner Peer Insights, SaaSWorthy, SourceForge Reviews, Crozdesk, PeerSpot, SoftwareSuggest.

### 3. Product & Competitor Discovery (What Exists)
Check if someone has already built this recently.
- **Sites:** Product Hunt, BetaList, BetaPage, Launching Next, SaaSHub, AlternativeTo, SaaSBase, Startups.fyi, MicroLaunch, Uneed, There's An AI For That, Futurepedia, AI Tool Directory, ToolFinder.

### 4. Trend & Validation Tools (Demand)
Is search volume growing or shrinking?
- **Tools/Concepts to Reference:** Google Trends, Exploding Topics, Google Keyword Planner, Ahrefs, SEMrush, Ubersuggest, AnswerThePublic, Also Asked, Glimpse, Treendly, SparkToro, BuzzSumo, Keywords Everywhere.

### 5. Failure & Market Analysis (Post-Mortems)
Did someone try this and fail? Why?
- **Sites:** Failory, Autopsy, Our Incredible Journey, Startup Cemetery, CB Insights Failure, Crunchbase, PitchBook, AngelList.

### 6. Niche Communities & Forums (Industry Specific Insights)
If the idea targets a specific niche, search their dedicated forums.
- **Examples:** Dental Town, Bigger Pockets (Real Estate), Bogleheads (Finance), Spiceworks (IT), Seroundtable (SEO), WebmasterWorld, Ecommerce Fuel, Chef's Forum, Contractor Talk, Accountant Forums, Physician Side Gig, r/MSP (IT providers), Trainual Community.

### 7. Other Rich Data Sources (For Advanced Context)
- **Freelance/Job Sites:** Upwork, Fiverr, Toptal (Look for highly requested manual work that could be a SaaS).
- **Revenue/Transparency:** OpenStartups, Baremetrics Open Startups, MRR.fyi.
- **Government/Industry:** SBA.gov, US Census Data, SEC Filings (EDGAR).
- **AI-Specific:** Hugging Face Discussions, OpenAI Community, r/ChatGPT, r/LocalLLaMA.

### Validation Output Structure
After researching, ALWAYS synthesize your findings to answer:
1. **Is this a real problem?** (Cite specific complaints/discussions).
2. **What is the competitive landscape?** (Who's already doing it).
3. **What is the gap?** (Based on negative reviews or missing features).
4. **Is the market trending up?**
5. **Red-flag honestly:** If the market is dead, the problem isn't real, or you easily found 5 identical active solutions, say so and suggest a pivot. Never just validate whatever the user says. Challenge weak ideas hard — it saves them months.
