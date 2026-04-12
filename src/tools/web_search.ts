/**
 * Web Search Tools — Dual Provider: Serper (links) + Tavily (research)
 *
 * Two tools are exposed to the LLM:
 *   - web_search  → Serper (Google) for direct, fresh links
 *   - web_research → Tavily for AI-summarized structured answers
 *
 * Fallback: If only one API key is configured, both tools route to
 * whichever provider is available.
 */

import { Type, Tool } from "@google/genai";
import { ENV } from "../config.js";
import { executeSerperSearch } from "./serper_search.js";

// ─── Tool Definitions ───────────────────────────────────────────

export const webSearchDefinition: Tool = {
  functionDeclarations: [
    {
      name: "web_search",
      description:
        "Search the web for direct links, latest news URLs, fresh articles, " +
        "trending topics, or site-specific results. Returns clickable source " +
        "links with snippets. Best when you need current URLs to share.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: "The search query to look up on Google",
          },
        },
        required: ["query"],
      },
    },
  ],
};

export const webResearchDefinition: Tool = {
  functionDeclarations: [
    {
      name: "web_research",
      description:
        "Research a topic using AI-powered search. Returns structured answers " +
        "with synthesized summaries and source snippets. Best for factual " +
        "questions, comparisons, analysis, or when you need a comprehensive " +
        "answer rather than just links.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: "The research query to investigate",
          },
        },
        required: ["query"],
      },
    },
  ],
};

// ─── Tavily Client (for web_research) ───────────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
}

async function executeTavilySearch(query: string): Promise<string> {
  if (!ENV.TAVILY_API_KEY) {
    return "Error: TAVILY_API_KEY is not configured. Add it to your .env file.";
  }

  try {
    console.log(`[WebSearch] Tavily research: "${query}"`);

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[WebSearch] Tavily API error ${response.status}: ${errorText}`,
      );
      return `Search failed (HTTP ${response.status}): ${errorText}`;
    }

    const data = (await response.json()) as TavilyResponse;
    const parts: string[] = [];

    // ── Header
    parts.push(`🔬 **Research Results** for: _"${query}"_`);
    parts.push("---");

    // ── AI-Synthesized Answer
    if (data.answer) {
      parts.push("💡 **Summary:**");
      parts.push(data.answer);
      parts.push("");
    }

    // ── Key Findings from Sources
    if (data.results && data.results.length > 0) {
      parts.push("📚 **Key Findings:**");
      parts.push("");
      for (let i = 0; i < data.results.length; i++) {
        const result = data.results[i];
        parts.push(`**${i + 1}.** ${result.title}`);
        if (result.content) {
          const snippet =
            result.content.length > 250
              ? result.content.substring(0, 250) + "..."
              : result.content;
          parts.push(`   ${snippet}`);
        }
        parts.push(`   🔗 ${result.url}`);
        parts.push("");
      }
    }

    // ── Footer
    const sourceCount = data.results?.length || 0;
    parts.push("---");
    parts.push(`_${sourceCount} sources analyzed • Powered by Tavily AI_`);

    const output = parts.join("\n").trim();
    return output || "No search results found for: " + query;
  } catch (error) {
    console.error("[WebSearch] Tavily error:", error);
    return `Search failed: ${String(error)}`;
  }
}

// ─── Smart Executors (with fallback) ────────────────────────────

/**
 * Execute web_search — prefers Serper (Google links), falls back to Tavily.
 */
export async function executeWebSearch(query: string): Promise<string> {
  if (ENV.SERPER_API_KEY) {
    return executeSerperSearch(query);
  }
  // Fallback to Tavily if Serper key not configured
  console.log("[WebSearch] Serper key missing, falling back to Tavily.");
  return executeTavilySearch(query);
}

/**
 * Execute web_research — prefers Tavily (structured), falls back to Serper.
 */
export async function executeWebResearch(query: string): Promise<string> {
  if (ENV.TAVILY_API_KEY) {
    return executeTavilySearch(query);
  }
  // Fallback to Serper if Tavily key not configured
  console.log("[WebSearch] Tavily key missing, falling back to Serper.");
  return executeSerperSearch(query);
}
