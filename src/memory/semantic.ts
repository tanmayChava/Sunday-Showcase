/**
 * Tier 3 — Semantic Memory (pgvector)
 *
 * Long-term facts and important events with vector embeddings.
 * Retrieval uses: score = similarity + importance + recency.
 * Embeddings are created asynchronously — response never waits.
 *
 * Storage rules:
 *   Store only if importance >= 4
 *   Types: 'fact' | 'event'
 *   Categories: 'personal' | 'project' | 'preference' | 'goal' | 'event' | 'general'
 *   Do NOT store: casual chat, jokes, small talk, temporary emotions
 *
 * Note: Embeddings always use the Gemini SDK directly (embedContent API).
 *       Fact extraction uses the provider-agnostic router.
 */

import { getSupabase } from "../lib/supabase.js";
import { getAI } from "../lib/gemini.js";
import { routedChat } from "../lib/router.js";
import { ENV } from "../config.js";
import { getRuntimeConfig } from "../lib/config-sync.js";

/**
 * Generate an embedding for a given text using Gemini.
 * Uses gemini-embedding-001 with 768 dimensions for pgvector compatibility.
 *
 * Note: Embeddings are Gemini-specific — OpenRouter doesn't support them.
 * We use the Gemini SDK directly here, not the provider-agnostic router.
 */
async function embed(text: string): Promise<number[] | null> {
  try {
    const ai = getAI();

    const result = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
      config: {
        outputDimensionality: 768,
      },
    });
    return result.embeddings?.[0]?.values || null;
  } catch (err) {
    console.error("[Semantic] Embedding error:", err);
    return null;
  }
}

/**
 * Store a fact or event into semantic memory.
 * Only stores if importance >= 4.
 */
export async function storeFact(
  content: string,
  type: "fact" | "event",
  importance: number,
  category: string = "general",
  tags: string[] = [],
  expiresAt?: string,
): Promise<void> {
  if (importance < 4) {
    console.log(
      `[Semantic] Skipping low-importance (${importance}): ${content}`,
    );
    return;
  }

  const sb = getSupabase();
  if (!sb) return;

  // Generate embedding asynchronously
  const embedding = await embed(content);
  if (!embedding) {
    console.error(
      "[Semantic] Failed to generate embedding, storing without vector.",
    );
  }

  try {
    const insertData: Record<string, unknown> = {
      content,
      embedding: embedding ? `[${embedding.join(",")}]` : null,
      type,
      importance,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: expiresAt || null,
    };

    // Add category and tags if the columns exist (graceful)
    insertData.category = category;
    insertData.tags = tags;

    const { error } = await sb.from("memories").insert(insertData);

    if (error) {
      // If category/tags columns don't exist yet, retry without them
      if (
        error.message?.includes("category") ||
        error.message?.includes("tags")
      ) {
        console.warn(
          "[Semantic] category/tags columns not found — storing without them.",
        );
        const { error: retryError } = await sb.from("memories").insert({
          content,
          embedding: embedding ? `[${embedding.join(",")}]` : null,
          type,
          importance,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at: expiresAt || null,
        });
        if (retryError) {
          console.error("[Semantic] Failed to store fact:", retryError.message);
        } else {
          console.log(
            `[Semantic] Stored (importance=${importance}, no tags): ${content}`,
          );
        }
      } else {
        console.error("[Semantic] Failed to store fact:", error.message);
      }
    } else {
      console.log(
        `[Semantic] Stored (importance=${importance}, category=${category}): ${content}`,
      );
    }
  } catch (err) {
    console.error("[Semantic] Unexpected error:", err);
  }
}

/**
 * Search semantic memories using vector similarity + importance + recency.
 * Returns the top N most relevant memories with timestamps and categories.
 */
export async function searchMemories(
  query: string,
  limit: number = 10,
): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const queryEmbedding = await embed(query);
  if (!queryEmbedding) return [];

  try {
    // Use Supabase RPC for vector similarity search
    const { data, error } = await sb.rpc("search_memories", {
      query_embedding: queryEmbedding,
      match_count: limit,
    });

    if (error) {
      console.error("[Semantic] Search error:", error.message);
      return [];
    }

    return (data || []).map(
      (row: {
        content: string;
        importance: number;
        category?: string;
        created_at?: string;
      }) => {
        const timeAgo = row.created_at ? formatTimeAgo(row.created_at) : "";
        const cat = row.category ? `[${row.category}]` : "";
        return `${cat}[importance=${row.importance}]${timeAgo ? `[${timeAgo}]` : ""} ${row.content}`;
      },
    );
  } catch (err) {
    console.error("[Semantic] Unexpected search error:", err);
    return [];
  }
}

/**
 * Format a timestamp into a human-readable "time ago" string.
 */
function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Messages too trivial to contain any useful facts.
 * Skipping these avoids wasting an LLM call on every "hi" or "ok".
 */
const TRIVIAL_PATTERN =
  /^(hi|hello|hey|yo|sup|hola|ok|okay|k|yes|no|yep|nope|yea|yeah|nah|sure|cool|nice|great|thanks|thank you|thx|ty|bye|goodbye|see ya|lol|lmao|haha|hehe|hmm|ah|oh|wow|ooh|bruh|👍|🙏|😂|❤️|🔥|✅|👎|\.+|!+|\?+)$/i;

/** Per-chat debounce counters — only extract facts every N-th non-trivial message per chat. */
const extractionCounters = new Map<string, number>();
const EXTRACTION_INTERVAL = 3;

/**
 * Background fact extraction.
 * Analyzes a conversation snippet and extracts facts worth remembering.
 * Runs asynchronously — never blocks the response.
 *
 * Skips trivial / very short exchanges and debounces to avoid wasting tokens.
 *
 * @param userMessage      The user's message
 * @param assistantResponse The assistant's response
 * @param chatId           Chat ID for per-chat debounce (defaults to "global" for backward compat)
 */
export function triggerFactExtraction(
  userMessage: string,
  assistantResponse: string,
  chatId: string = "global",
): void {
  // Skip trivial messages — no facts to extract
  const trimmed = userMessage.trim();
  if (TRIVIAL_PATTERN.test(trimmed)) return;
  if (trimmed.length < 15 && assistantResponse.length < 200) return;

  // Per-chat debounce — only run extraction every EXTRACTION_INTERVAL non-trivial turns
  const count = (extractionCounters.get(chatId) ?? 0) + 1;
  extractionCounters.set(chatId, count);
  if (count % EXTRACTION_INTERVAL !== 0) return;

  // Fire and forget — do not await
  extractFacts(userMessage, assistantResponse).catch((err) =>
    console.error("[Semantic] Background extraction error:", err),
  );
}

async function extractFacts(
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const prompt = `Analyze this conversation exchange and extract any facts worth remembering long-term.

User: ${userMessage}
Assistant: ${assistantResponse}

Rules:
- Extract if the user states a preference, long-term goal, personal info, project update, decision, deadline, recurring routine, or explicitly asks to remember something.
- Do NOT extract: casual chat, jokes, small talk, temporary emotions, one-time irrelevant details.
- Tasks are NOT semantic memories.

For each fact, provide:
- content: the fact to remember (clear, standalone sentence)
- type: "fact" or "event"
- importance: 1-10 (only include if >= 4)
- category: one of "personal", "project", "preference", "goal", "event", "general"
- tags: array of relevant keywords/project names (e.g. ["sunday", "react"])

Return JSON array. If nothing worth saving, return empty array [].

Format: [{"content": "...", "type": "fact|event", "importance": N, "category": "...", "tags": ["..."]}]
Return ONLY the JSON array, no other text.`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const text = response.text?.trim() || "[]";

    // Clean markdown fencing if present
    const cleanJson = text
      .replace(/```json?\n?/g, "")
      .replace(/```/g, "")
      .trim();

    const facts = JSON.parse(cleanJson);

    if (Array.isArray(facts)) {
      for (const fact of facts) {
        if (fact.content && fact.type && fact.importance >= 4) {
          await storeFact(
            fact.content,
            fact.type,
            fact.importance,
            fact.category || "general",
            fact.tags || [],
          );
        }
      }
    }
  } catch (err) {
    console.error("[Semantic] Fact extraction failed:", err);
  }
}

/**
 * Build a semantic memory context block for the system prompt.
 */
export async function buildSemanticPrompt(query: string): Promise<string> {
  const results = await searchMemories(query, 5);
  if (results.length === 0) return "";

  return `## Long-Term Memories (Relevant to this message)\n${results.join("\n")}`;
}
