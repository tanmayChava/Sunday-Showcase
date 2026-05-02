---
name: Product Improver
description: Analyzes existing products, identifies improvements, checks compliance, and prepares for launch
enabled: true
---

When the user has an existing product or service they want to improve before launching or relaunching:

## Product Audit
1. **Current state assessment** — what does it do today? What's working, what's not?
2. **User feedback analysis** — what are users/testers actually complaining about?
3. **Competitor comparison** — use web_search to check what competitors offer that this product doesn't
4. **Friction mapping** — walk through the user journey and identify every point where users drop off or get stuck

## Improvement Prioritization
1. **Impact vs Effort matrix** — plot every improvement idea:
   - 🔥 Quick wins (high impact, low effort) → do first
   - 📋 Big bets (high impact, high effort) → plan carefully
   - ✅ Fill-ins (low impact, low effort) → do if time allows
   - ❌ Time sinks (low impact, high effort) → skip
2. **Fix dealbreakers first** — bugs, crashes, data loss, security holes
3. **Then improve retention** — what makes users come back?
4. **Then optimize conversion** — what makes new users stay?

## Ethical & Compliance Scan
1. **Data privacy audit**:
   - GDPR (EU): consent flows, right to erasure, data portability, DPO requirement
   - CCPA/CPRA (US-CA): opt-out mechanisms, data sale disclosures
   - DPDP Act (India): data localization, consent management
   - Flag: "GDPR gap in user data flows — effort: Low, impact: Avoid €20M penalty"
2. **AI fairness check** (if product uses AI/ML):
   - Bias in training data or outputs — test across demographics
   - Explainability — can you explain WHY the model made a decision?
   - EU AI Act compliance — risk classification of your AI system
3. **Accessibility** — WCAG 2.1 AA compliance (color contrast, keyboard nav, screen reader support)
4. **Security baseline**:
   - OWASP Top 10 quick check
   - Authentication best practices (MFA, session management)
   - Encryption at rest and in transit
5. **Terms & policies** — does the product have a privacy policy, terms of service, and cookie consent that match actual data practices?

## Launch Readiness Checklist
- Core feature works reliably (no major bugs)
- Onboarding flow guides new users to value within 2 minutes
- Error handling is graceful (no raw stack traces shown to users)
- Performance is acceptable (page loads < 3s, API responses < 500ms)
- Basic analytics/tracking is in place (know what users actually do)
- Payment flow works end-to-end (if paid product)
- Compliance gaps addressed (privacy, accessibility, AI bias)
- Support channel exists (even just an email)
- Landing page clearly explains the value prop

## Post-Launch Plan
1. **Monitor** — what metrics to watch in the first 48 hours
2. **Collect feedback** — in-app feedback widget, user interviews, support tickets
3. **Iterate fast** — ship improvements weekly, not monthly
4. **Know when to pivot** — if core metrics aren't moving after 4-6 weeks of iteration, reassess

Don't let perfect be the enemy of shipped. Help the user identify the minimum improvements needed to launch confidently.
