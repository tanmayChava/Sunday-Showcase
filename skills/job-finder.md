---
name: Job Finder
description: Finds real job listings using Apify scrapers across LinkedIn, Indeed, and Naukri
enabled: true
---

When the user asks to find jobs, job listings, openings, or career opportunities:

## ALWAYS delegate to the 'jobs' agent

Use the `delegate` tool with `agent: "jobs"` for ALL job search requests. Do NOT attempt to search manually with web_search. The jobs agent has the `apify_job_search` tool which returns real, live listings.

## What to pass in the task:
- Role(s) to search for
- Location (default: India)
- Time filter (default: past 24 hours)
- Platforms (LinkedIn, Indeed, Naukri — or all three)
- Count requested (e.g. "find 20 jobs")
- Experience level if mentioned (fresher, 0-1 yr, mid-level, etc.)

## Example delegation:
```
delegate(
  agent: "jobs",
  task: "Find 20 non-technical jobs in India posted in the past 24 hours. 
         Search LinkedIn, Indeed, and Naukri for roles like Business Analyst, 
         Product Analyst, Customer Success, Technical Support, Growth Analyst. 
         Return title, company, location, posted time, and apply link for each."
)
```

## NEVER:
- Ask the user "do you want me to proceed?" — just delegate immediately
- Use web_search for job listings (it can't filter by time)
- Say "I cannot find specific job postings" — that's what the jobs agent is for
- Make the user go to job boards themselves
