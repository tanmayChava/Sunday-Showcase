/**
 * Model-Agnostic Embeddings — Feature 4.5
 *
 * Provides a unified `embed(text)` function that works across providers:
 *   1. Gemini (gemini-embedding-001, 768-dim)  — default
 *   2. OpenAI-compatible (text-embedding-ada-002 / OpenRouter)
 *   3. Sentence-Transformers via self-hosted API (optional)
 *
 * Provider selection (in order of priority):
 *   1. EMBEDDING_PROVIDER env var ("gemini" | "openai" | "openrouter" | "custom")
 *   2. If OpenRouter is configured and EMBEDDING_PROVIDER not set → Gemini (gemini has better quota)
 *   3. Falls back to Gemini always
 *
 * Dimension compatibility:
 *   - Gemini: 768 dims (configured in pgvector)
 *   - OpenAI ada-002: 1536 dims — will NOT work with existing 768-dim pgvector index
 *   - OpenAI text-embedding-3-small with outputDimensions=768: works!
 *   - Custom: must match EMBEDDING_DIMENSIONS env var (default 768)
 *
 * IMPORTANT: Changing provider requires a DB migration to drop and re-create
 * the pgvector index and re-embed all existing memories.
 */

import { ENV } from "../config.js";
import { getAI } from "./gemini.js";

// ─── Provider Config ──────────────────────────────────────────────

const PROVIDER = (process.env.EMBEDDING_PROVIDER || "gemini").toLowerCase();
const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || "768", 10);
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const CUSTOM_EMBEDDING_URL = process.env.CUSTOM_EMBEDDING_URL || "";
const CUSTOM_EMBEDDING_KEY = process.env.CUSTOM_EMBEDDING_API_KEY || "";


// ─── Provider Implementations ─────────────────────────────────────

async function embedWithGemini(text: string): Promise<number[] | null> {
  try {
    const { client } = getAI();
    const result = await client.models.embedContent({
      model: "gemini-embedding-001",
      contents: text,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS <= 768 ? EMBEDDING_DIMENSIONS : 768,
      },
    });
    return result.embeddings?.[0]?.values || null;
  } catch (err) {
    console.error("[Embeddings/Gemini] Error:", err);
    return null;
  }
}

async function embedWithOpenAI(
  text: string,
  baseUrlOverride?: string,
): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY || ENV.OPENROUTER_API_KEY;
  // HIGH-04: Accept baseUrl as an explicit parameter instead of reading from
  // process.env, which is mutable global state. The original code temporarily
  // wrote to process.env.OPENAI_EMBEDDING_BASE_URL across an async gap, causing
  // concurrent embedWithOpenRouter() calls to corrupt each other's base URL.
  const baseUrl = baseUrlOverride
    || process.env.OPENAI_EMBEDDING_BASE_URL
    || "https://api.openai.com/v1";

  if (!apiKey) {
    console.warn("[Embeddings/OpenAI] No API key found — falling back to Gemini.");
    return embedWithGemini(text);
  }

  try {
    const body: Record<string, unknown> = {
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    };

    // For text-embedding-3-* models, we can request specific dimensions
    if (OPENAI_EMBEDDING_MODEL.startsWith("text-embedding-3") && EMBEDDING_DIMENSIONS !== 1536) {
      body.dimensions = EMBEDDING_DIMENSIONS;
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Embeddings/OpenAI] API error:", response.status, err);
      return null;
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.error("[Embeddings/OpenAI] Fetch error:", err);
    return null;
  }
}

async function embedWithOpenRouter(text: string): Promise<number[] | null> {
  if (!ENV.OPENROUTER_API_KEY) {
    console.warn("[Embeddings/OpenRouter] No API key — falling back to Gemini.");
    return embedWithGemini(text);
  }

  // HIGH-04: Pass the OpenRouter base URL directly as a parameter.
  // The old code temporarily mutated process.env.OPENAI_EMBEDDING_BASE_URL
  // across an await gap, which caused concurrent calls to corrupt each other.
  return embedWithOpenAI(text, "https://openrouter.ai/api/v1");
}

async function embedWithCustom(text: string): Promise<number[] | null> {
  if (!CUSTOM_EMBEDDING_URL) {
    console.warn("[Embeddings/Custom] CUSTOM_EMBEDDING_URL not set — falling back to Gemini.");
    return embedWithGemini(text);
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (CUSTOM_EMBEDDING_KEY) {
      headers["Authorization"] = `Bearer ${CUSTOM_EMBEDDING_KEY}`;
    }

    const response = await fetch(CUSTOM_EMBEDDING_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, input: text }), // support both field names
    });

    if (!response.ok) {
      console.error("[Embeddings/Custom] API error:", response.status);
      return null;
    }

    const data = await response.json() as {
      embedding?: number[];
      data?: Array<{ embedding: number[] }>;
      embeddings?: number[][];
    };

    // Support multiple response shapes
    if (Array.isArray(data.embedding)) return data.embedding;
    if (data.data?.[0]?.embedding) return data.data[0].embedding;
    if (data.embeddings?.[0]) return data.embeddings[0];

    console.error("[Embeddings/Custom] Unrecognized response shape:", Object.keys(data));
    return null;
  } catch (err) {
    console.error("[Embeddings/Custom] Error:", err);
    return null;
  }
}

// ─── Unified Embed Function ───────────────────────────────────────

/**
 * Generate an embedding for the given text using the configured provider.
 * Falls back to Gemini on any error.
 *
 * @returns float32 vector matching EMBEDDING_DIMENSIONS, or null on failure
 */
export async function embed(text: string): Promise<number[] | null> {
  if (!text?.trim()) return null;

  switch (PROVIDER) {
    case "openai":
      return embedWithOpenAI(text);
    case "openrouter":
      return embedWithOpenRouter(text);
    case "custom":
      return embedWithCustom(text);
    case "gemini":
    default:
      return embedWithGemini(text);
  }
}

/**
 * Returns the currently configured embedding provider name.
 * Used for status/logging.
 */
export function getEmbeddingProvider(): string {
  return PROVIDER;
}

/**
 * Returns the configured embedding dimensions.
 * Must match the pgvector index dimension.
 */
export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}
