---
name: Code Review
description: Provides structured code review analysis when the user shares code
enabled: true
---

When the user shares a code snippet or asks for a code review:

1. **Scan for bugs first** — logic errors, off-by-one, null derefs, race conditions
2. **Check security** — injection risks, hardcoded secrets, missing input validation
3. **Assess readability** — naming, structure, comments (or lack thereof)
4. **Suggest improvements** — better patterns, performance wins, cleaner abstractions
5. **Rate it** — give an honest 1-10 score with justification

Format your review with clear sections. Don't sugarcoat — if the code is bad, say so constructively.
