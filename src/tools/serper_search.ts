/**
 * Serper Search — Google Search results via Serper.dev API.
 *
 * Used for queries that need direct, fresh, clickable links
 * (news, latest releases, site-specific searches, etc.).
 */

import { ENV } from "../config.js";

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperKnowledgeGraph {
  title?: string;
  type?: string;
  description?: string;
}

interface SerperResponse {
  organic: SerperOrganicResult[];
  knowledgeGraph?: SerperKnowledgeGraph;
  answerBox?: { answer?: string; snippet?: string; title?: string };
}

/**
 * Execute a web search using the Serper.dev Google Search API.
 * Returns formatted results optimized for direct links.
 */
export async function executeSerperSearch(query: string): Promise<string> {
  if (!ENV.SERPER_API_KEY) {
    return "Error: SERPER_API_KEY is not configured. Add it to your .env file.";
  }

  try {
    console.log(`[WebSearch] Serper/Google search: "${query}"`);

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": ENV.SERPER_API_KEY,
      },
      body: JSON.stringify({
        q: query,
        num: 7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[WebSearch] Serper API error ${response.status}: ${errorText}`,
      );
      return `Search failed (HTTP ${response.status}): ${errorText}`;
    }

    const data = (await response.json()) as SerperResponse;
    const parts: string[] = [];

    // ── Header
    parts.push(`🔍 **Web Search Results** for: _"${query}"_`);
    parts.push("---");

    // ── Quick Answer (Google answer box or knowledge graph)
    const quickAnswer = data.answerBox?.answer || data.answerBox?.snippet;
    if (quickAnswer || data.knowledgeGraph?.description) {
      parts.push("📌 **Quick Answer:**");
      if (quickAnswer) {
        parts.push(quickAnswer);
      }
      if (data.knowledgeGraph?.description) {
        parts.push(data.knowledgeGraph.description);
      }
      parts.push("");
    }

    // ── Numbered results with links
    if (data.organic && data.organic.length > 0) {
      parts.push("📎 **Top Results:**");
      parts.push("");
      for (let i = 0; i < data.organic.length; i++) {
        const result = data.organic[i];
        parts.push(`**${i + 1}.** [${result.title}](${result.link})`);
        if (result.snippet) {
          const snippet =
            result.snippet.length > 200
              ? result.snippet.substring(0, 200) + "..."
              : result.snippet;
          parts.push(`   _${snippet}_`);
        }
        parts.push("");
      }
    }

    // ── Footer
    const sourceCount = data.organic?.length || 0;
    parts.push(`---`);
    parts.push(`_${sourceCount} sources found via Google • Powered by Serper_`);

    const output = parts.join("\n").trim();
    if (!output) {
      return "No search results found for: " + query;
    }

    return output;
  } catch (error) {
    console.error("[WebSearch] Serper error:", error);
    return `Search failed: ${String(error)}`;
  }
}
