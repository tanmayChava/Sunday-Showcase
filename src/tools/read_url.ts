/**
 * read_url tool — Fetch and extract text content from a webpage.
 *
 * Strips HTML tags and returns clean text the agent can reason over.
 * No external dependencies — uses native fetch + regex stripping.
 */

import { Type, Tool } from "@google/genai";

export const readUrlDefinition: Tool = {
  functionDeclarations: [
    {
      name: "read_url",
      description:
        "Fetch and read the text content of a webpage. Use this when the user shares a URL and wants you to read, summarize, or analyze its content. Also useful when web_search returns a relevant link you need to dig deeper into.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: {
            type: Type.STRING,
            description:
              "The full URL to fetch (must start with http:// or https://)",
          },
        },
        required: ["url"],
      },
    },
  ],
};

const MAX_CONTENT_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Strip HTML tags and collapse whitespace into clean readable text.
 */
function htmlToText(html: string): string {
  return (
    html
      // Remove script and style blocks entirely
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Convert common block elements to newlines
      .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Strip remaining tags
      .replace(/<[^>]+>/g, "")
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Fetch a URL and return its text content.
 */
export async function executeReadUrl(url: string): Promise<string> {
  // Basic URL validation
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "Error: URL must start with http:// or https://";
  }

  try {
    console.log(`[ReadUrl] Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SUNDAY/1.0; +https://sunday.dev)",
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!response.ok) {
      return `Error: HTTP ${response.status} — ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();

    let text: string;
    if (contentType.includes("text/html") || contentType.includes("xhtml")) {
      text = htmlToText(body);
    } else {
      // Plain text, JSON, etc. — return as-is
      text = body.trim();
    }

    if (!text) {
      return "The page returned no readable text content.";
    }

    // Truncate if too long
    if (text.length > MAX_CONTENT_LENGTH) {
      text = text.substring(0, MAX_CONTENT_LENGTH) + "\n\n[...truncated]";
    }

    return `**Source:** ${url}\n\n${text}`;
  } catch (error) {
    const msg = String(error);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return `Error: Request timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${url}`;
    }
    console.error("[ReadUrl] Error:", error);
    return `Error fetching URL: ${msg}`;
  }
}
