/**
 * Apify Job Search Tool
 *
 * Uses Apify actors to scrape real job listings from multiple platforms:
 *
 *   Platform         Actor ID
 *   ─────────────    ──────────────────────────────────────────
 *   linkedin         curious_coder/linkedin-jobs-scraper
 *   indeed           valig/indeed-jobs-scraper
 *   naukri           codemaverick/naukri-job-scraper-latest
 *   glassdoor        memo23/glassdoor-scraper-ppr
 *   google           johnvc/Google-Jobs-Scraper
 *   career-sites     fantastic-jobs/career-site-job-listing-api
 *   career-feed      fantastic-jobs/career-site-job-listing-feed
 *   seek             websift/seek-job-scraper
 *   aggregator       assertive_analogy/Job-Listings-Aggregator
 *
 * Supports time filters: past24hours, pastWeek, pastMonth
 */

import { Type, Tool } from "@google/genai";
import { ENV } from "../config.js";

// ─── Tool Definition ─────────────────────────────────────────────

export const apifyJobSearchDefinition: Tool = {
    functionDeclarations: [
        {
            name: "apify_job_search",
            description:
                "Search for real live job postings across LinkedIn, Indeed, Naukri, Glassdoor, " +
                "Google Jobs, company career sites, Seek, and aggregators using Apify scrapers. " +
                "Use this for ANY job search request. Returns actual listings with title, company, " +
                "location, posted date, salary (if available), and apply link. " +
                "Supports 'past 24 hours', 'past week', 'past month' filters. " +
                "ALWAYS prefer this tool over web_search for job hunting tasks.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    role: {
                        type: Type.STRING,
                        description:
                            "Job title or role to search for. E.g. 'Business Analyst', 'Product Manager', 'Data Analyst', 'Customer Success'",
                    },
                    location: {
                        type: Type.STRING,
                        description:
                            "Location to search in. E.g. 'India', 'Bangalore', 'Mumbai, India'. Defaults to 'India'.",
                    },
                    platform: {
                        type: Type.STRING,
                        description:
                            "Which platform to search: " +
                            "'linkedin' (LinkedIn Jobs), " +
                            "'indeed' (Indeed India), " +
                            "'naukri' (Naukri.com), " +
                            "'glassdoor' (Glassdoor), " +
                            "'google' (Google Jobs), " +
                            "'career-sites' (Company career portals via fantastic-jobs API), " +
                            "'career-feed' (Company career RSS feeds), " +
                            "'seek' (Seek.com.au), " +
                            "'aggregator' (Multi-source Job Listings Aggregator). " +
                            "Defaults to 'linkedin'.",
                    },
                    date_posted: {
                        type: Type.STRING,
                        description:
                            "Filter by posting date: 'past24hours', 'pastWeek', 'pastMonth'. Defaults to 'past24hours'.",
                    },
                    max_results: {
                        type: Type.NUMBER,
                        description:
                            "Maximum number of job listings to return (1–25). Defaults to 10.",
                    },
                    experience_level: {
                        type: Type.STRING,
                        description:
                            "Optional experience filter (LinkedIn): 'internship', 'entry_level', 'associate', 'mid_senior_level', 'director'",
                    },
                    keywords: {
                        type: Type.STRING,
                        description:
                            "Optional extra keywords to refine the search, e.g. 'non-technical', 'fresher', 'remote'",
                    },
                },
                required: ["role"],
            },
        },
    ],
};

// ─── Actor Registry ───────────────────────────────────────────────

const ACTORS: Record<string, string> = {
    linkedin: "curious_coder/linkedin-jobs-scraper",
    indeed: "valig/indeed-jobs-scraper",
    naukri: "codemaverick/naukri-job-scraper-latest",
    glassdoor: "memo23/glassdoor-scraper-ppr",
    google: "johnvc/Google-Jobs-Scraper",
    "career-sites": "fantastic-jobs/career-site-job-listing-api",
    "career-feed": "fantastic-jobs/career-site-job-listing-feed",
    seek: "websift/seek-job-scraper",
    aggregator: "assertive_analogy/Job-Listings-Aggregator",
};

// ─── Date Filter Maps ─────────────────────────────────────────────

/** LinkedIn uses seconds-since-now */
const LINKEDIN_DATE_MAP: Record<string, string> = {
    past24hours: "r86400",
    pastweek: "r604800",
    pastmonth: "r2592000",
};

/** Indeed uses days back */
const INDEED_DAYS_MAP: Record<string, string> = {
    past24hours: "1",
    pastweek: "7",
    pastmonth: "30",
};

/** Glassdoor uses integer days */
const GLASSDOOR_DAYS_MAP: Record<string, number> = {
    past24hours: 1,
    pastweek: 7,
    pastmonth: 30,
};

// ─── Input Builder ────────────────────────────────────────────────

function buildActorInput(
    platform: string,
    role: string,
    location: string,
    dateKey: string,
    maxResults: number,
    experienceLevel?: string,
    keywords?: string,
): Record<string, unknown> {
    const query = keywords ? `${role} ${keywords}` : role;

    switch (platform) {
        case "linkedin": {
            const dateFilter = LINKEDIN_DATE_MAP[dateKey] ?? LINKEDIN_DATE_MAP.past24hours;
            return {
                searchQueries: [`${query} ${location}`],
                location,
                dateSincePosted: dateFilter,
                limit: maxResults,
                ...(experienceLevel && { experienceLevel }),
            };
        }

        case "indeed": {
            const fromDays = INDEED_DAYS_MAP[dateKey] ?? "1";
            return {
                country: "IN",
                keyword: query,
                location,
                maxItems: maxResults,
                fromDays,
            };
        }

        case "naukri": {
            return {
                keyword: query,
                location,
                maxItems: maxResults,
                // Naukri actor accepts jobAge in days
                jobAge: dateKey === "past24hours" ? 1 : dateKey === "pastweek" ? 7 : 30,
            };
        }

        case "glassdoor": {
            const daysAgo = GLASSDOOR_DAYS_MAP[dateKey] ?? 1;
            return {
                keyword: query,
                location,
                maxResults,
                postedInDays: daysAgo,
            };
        }

        case "google": {
            return {
                query: `${query} jobs in ${location}`,
                maxResults,
                // Google Jobs date filter: d = day, w = week, m = month
                datePosted:
                    dateKey === "past24hours" ? "d" :
                        dateKey === "pastweek" ? "w" : "m",
            };
        }

        case "career-sites": {
            return {
                jobTitle: query,
                location,
                limit: maxResults,
                postedWithinDays: dateKey === "past24hours" ? 1 : dateKey === "pastweek" ? 7 : 30,
            };
        }

        case "career-feed": {
            return {
                jobTitle: query,
                location,
                limit: maxResults,
                freshOnly: dateKey === "past24hours",
            };
        }

        case "seek": {
            return {
                keyword: query,
                location,
                maxResults,
                dateRange:
                    dateKey === "past24hours" ? "24h" :
                        dateKey === "pastweek" ? "7d" : "30d",
            };
        }

        case "aggregator": {
            return {
                jobTitle: query,
                location,
                maxListings: maxResults,
                postedWithin: dateKey === "past24hours" ? "24h" : dateKey === "pastweek" ? "7d" : "30d",
                sources: ["linkedin", "indeed", "naukri", "glassdoor", "google"],
            };
        }

        default:
            return { query, location, maxResults };
    }
}

// ─── Result Normalizer ────────────────────────────────────────────

interface NormalizedJob {
    title: string;
    company: string;
    location: string;
    posted: string;
    salary: string;
    link: string;
}

function normalizeJob(job: Record<string, unknown>): NormalizedJob {
    return {
        title: String(job.positionName || job.title || job.jobTitle || job.position || "Unknown Role"),
        company: String(job.company || job.companyName || job.employer || job.organization || "Unknown Company"),
        location: String(job.location || job.city || job.jobLocation || job.place || ""),
        posted: String(job.postedAt || job.publishedAt || job.datePosted || job.date || job.postedDate || ""),
        salary: String(job.salary || job.salaryRange || job.compensation || ""),
        link: String(job.jobUrl || job.url || job.applyUrl || job.link || job.jobLink || ""),
    };
}

// ─── Executor ─────────────────────────────────────────────────────

export async function executeApifyJobSearch(args: {
    role: string;
    location?: string;
    platform?: string;
    date_posted?: string;
    max_results?: number;
    experience_level?: string;
    keywords?: string;
}): Promise<string> {
    if (!ENV.APIFY_API_TOKEN) {
        return "Error: APIFY_API_TOKEN is not configured. Add it to your .env file.\nGet your free token at: https://console.apify.com/account/integrations";
    }

    const platform = (args.platform || "linkedin").toLowerCase().trim();
    const location = args.location || "India";
    const dateRaw = (args.date_posted || "past24hours").toLowerCase().replace(/[\s_-]/g, "");
    const maxResults = Math.min(args.max_results || 10, 25);
    const actorId = ACTORS[platform];

    if (!actorId) {
        const supported = Object.keys(ACTORS).join(", ");
        return `Error: Unknown platform "${platform}". Supported: ${supported}`;
    }

    const actorInput = buildActorInput(
        platform,
        args.role,
        location,
        dateRaw,
        maxResults,
        args.experience_level,
        args.keywords,
    );

    try {
        console.log(`[ApifyJobSearch] Actor: ${actorId} | Role: "${args.role}" | Location: ${location} | Date: ${dateRaw}`);

        const encodedActor = encodeURIComponent(actorId);
        const runUrl =
            `https://api.apify.com/v2/acts/${encodedActor}/run-sync-get-dataset-items` +
            `?token=${ENV.APIFY_API_TOKEN}&timeout=60&memory=256`;

        const response = await fetch(runUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(actorInput),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[ApifyJobSearch] HTTP ${response.status}:`, errText.slice(0, 400));
            return (
                `Job search failed on ${platform} (HTTP ${response.status}).\n` +
                `Details: ${errText.slice(0, 300)}\n\n` +
                `Try a different platform: ${Object.keys(ACTORS).join(", ")}`
            );
        }

        const items = (await response.json()) as Record<string, unknown>[];

        if (!Array.isArray(items) || items.length === 0) {
            return (
                `No results found for "${args.role}" in ${location} on ${platform} ` +
                `(filter: ${args.date_posted || "past24hours"}).\n` +
                `Suggestions:\n` +
                `• Try a broader role keyword (e.g. "Analyst" instead of "Business Analyst")\n` +
                `• Try a different platform: ${Object.keys(ACTORS).join(", ")}\n` +
                `• Expand the time window to 'pastWeek'`
            );
        }

        // ── Format output ────────────────────────────────────────────
        const dateLabel =
            dateRaw === "past24hours" ? "Past 24 Hours" :
                dateRaw === "pastweek" ? "Past Week" : "Past Month";

        const header = [
            `💼 **${args.role} Jobs** · ${location} · ${dateLabel}`,
            `📡 Source: **${platform}** · Found **${items.length}** listing${items.length !== 1 ? "s" : ""}`,
            "",
        ];

        const body = items.slice(0, maxResults).map((raw, i) => {
            const job = normalizeJob(raw);
            const lines = [`**${i + 1}. ${job.title}**`];
            lines.push(`   🏢 ${job.company}${job.location ? ` · 📍 ${job.location}` : ""}`);
            if (job.posted) lines.push(`   🕐 ${job.posted}`);
            if (job.salary) lines.push(`   💰 ${job.salary}`);
            if (job.link) lines.push(`   🔗 ${job.link}`);
            return lines.join("\n");
        });

        const footer = [
            "",
            "---",
            `_Scraped via Apify · ${platform} · ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}_`,
        ];

        return [...header, ...body, ...footer].join("\n");

    } catch (error) {
        console.error("[ApifyJobSearch] Error:", error);
        return `Job search failed: ${String(error)}`;
    }
}
