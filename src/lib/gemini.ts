/**
 * Gemini LLM Provider
 *
 * Implements LLMProvider using the @google/genai SDK.
 * Handles:
 *   - Proactive round-robin API key rotation
 *   - 429 retry with exponential back-off
 *   - Transparent conversion between LLM-agnostic types and Gemini types
 *
 * Usage:
 *   import { geminiProvider } from "../lib/gemini.js";
 *   const response = await geminiProvider.chat({ model, messages, ... });
 */

import { GoogleGenAI, Content, Part, Tool, Type } from "@google/genai";
import { ENV } from "../config.js";
import type {
  LLMProvider,
  LLMCallParams,
  LLMResponse,
  LLMMessage,
  LLMToolCall,
  LLMToolResult,
  LLMToolSchema,
} from "./llm.js";

// ─── Key Rotation ─────────────────────────────────────────────────

// HIGH-01 Fix: Concurrency-safe key rotation.
//
// The old design used a shared `lastUsedKeyIndex` variable that was read by
// rotateKey() after an async gap (the await inside chat()). Under concurrent
// calls, two coroutines could race:
//   - Call A reads lastUsedKeyIndex=0, starts request
//   - Call B reads lastUsedKeyIndex=0, starts request (same key)
//   - Call A gets 429, rotateKey() reads lastUsedKeyIndex=0 → exhausts key 0
//   - Call B gets 429, rotateKey() reads lastUsedKeyIndex=1 (already advanced)
//     → exhausts key 1 by mistake
//
// Fix: getAI() returns { client, keyIndex } so each chat() call owns its key
// index snapshot. rotateKey() takes an explicit ownedKeyIndex instead of
// reading shared mutable state. No global lastUsedKeyIndex needed.

let currentKeyIndex = 0;
const exhaustedKeys = new Set<number>();
let lastResetTime = Date.now();
const RESET_INTERVAL_MS = 60 * 1000;

/** Cached GoogleGenAI clients — one per API key index. */
const clientCache = new Map<number, GoogleGenAI>();

interface AIHandle {
  /** The GoogleGenAI client to use for this call. */
  client: GoogleGenAI;
  /** The key index this handle was allocated for — pass to rotateKey(). */
  keyIndex: number;
}

/**
 * Allocate a GoogleGenAI client for one call.
 * Returns both the client AND the key index it selected, so the caller
 * can pass the exact index to rotateKey() after an async gap without
 * racing against other concurrent callers.
 *
 * Exported so vision path and semantic embeddings can share rotation.
 */
export function getAI(): AIHandle {
  if (Date.now() - lastResetTime > RESET_INTERVAL_MS) {
    if (exhaustedKeys.size > 0) {
      console.log(
        `[Gemini] Resetting ${exhaustedKeys.size} exhausted key(s) after cooldown.`,
      );
    }
    exhaustedKeys.clear();
    lastResetTime = Date.now();
  }

  const keys = ENV.GEMINI_API_KEYS;

  // Skip exhausted keys proactively — find the next available one
  for (let i = 0; i < keys.length; i++) {
    const idx = (currentKeyIndex + i) % keys.length;
    if (!exhaustedKeys.has(idx)) {
      currentKeyIndex = (idx + 1) % keys.length;
      return { client: getOrCreateClient(idx, keys[idx]), keyIndex: idx };
    }
  }

  // All exhausted — allocate current anyway (retry / router fallback handles it)
  const idx = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return { client: getOrCreateClient(idx, keys[idx]), keyIndex: idx };
}

function getOrCreateClient(index: number, apiKey: string): GoogleGenAI {
  let client = clientCache.get(index);
  if (!client) {
    client = new GoogleGenAI({ apiKey });
    clientCache.set(index, client);
  }
  return client;
}

/**
 * Mark ownedKeyIndex as exhausted (429) and select the next available key.
 * Takes the caller's owned index to avoid race conditions with shared state.
 * @returns true if a new key was found, false if all keys are exhausted.
 */
function rotateKey(ownedKeyIndex: number): boolean {
  const keys = ENV.GEMINI_API_KEYS;
  exhaustedKeys.add(ownedKeyIndex);

  console.log(
    `[Gemini] Key ${ownedKeyIndex + 1}/${keys.length} hit rate limit. Rotating...`,
  );

  for (let i = 0; i < keys.length; i++) {
    const nextIndex = (ownedKeyIndex + 1 + i) % keys.length;
    if (!exhaustedKeys.has(nextIndex)) {
      currentKeyIndex = nextIndex;
      console.log(`[Gemini] Switched to key ${nextIndex + 1}/${keys.length}.`);
      return true;
    }
  }
  return false;
}

function getRetryDelay(error: unknown): number {
  try {
    const message = String((error as Error).message || "");
    const match = message.match(/retry in (\d+(?:\.\d+)?)/i);
    if (match) {
      return Math.min(Math.ceil(parseFloat(match[1])) * 1000, 60000);
    }
  } catch { }
  return 30000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Conversion: LLM Types → Gemini Types ─────────────────────────

function messagesToContents(messages: LLMMessage[]): {
  systemInstruction?: string;
  contents: Content[];
} {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    // System messages become Gemini's systemInstruction
    if (msg.role === "system") {
      systemInstruction = (systemInstruction ? systemInstruction + "\n\n" : "") + (msg.content || "");
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];

    // Text content
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    // Inline images (vision / multimodal)
    if (msg.inlineImages && msg.inlineImages.length > 0) {
      for (const img of msg.inlineImages) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }
    }

    // Outgoing tool calls (assistant → model)
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        if (tc._rawParts) {
          // Gemini 3: echo the exact parts (functionCall + thoughtSignature)
          parts.push(...(tc._rawParts as Part[]));
        } else {
          parts.push({
            functionCall: {
              // @ts-ignore — 'id' exists at runtime in Gemini 3 SDK responses
              id: tc.id,
              name: tc.name,
              args: tc.args,
            },
          });
        }
      }
    }

    // Incoming tool results (user → function responses)
    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        parts.push({
          functionResponse: {
            // @ts-ignore — 'id' is required by Gemini 3 to match the functionCall
            id: tr.callId,
            name: tr.name,
            response: { result: tr.content },
          },
        });
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return { systemInstruction, contents };
}

function toolSchemasToGeminiTools(schemas: LLMToolSchema[]): Tool[] {
  if (schemas.length === 0) return [];

  return [
    {
      functionDeclarations: schemas.map((s) => ({
        name: s.name,
        description: s.description,
        parameters: s.parameters,
      })),
    },
  ];
}

function parseGeminiResponse(
  candidate: { content?: { parts?: Part[] } },
  usageMeta?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number },
): LLMResponse {
  const parts = candidate.content?.parts || [];
  const result: LLMResponse = {};

  // Text parts
  const textParts = parts.filter((p) => p.text).map((p) => p.text!);
  if (textParts.length > 0) {
    result.text = textParts.join("\n");
  }

  // Tool call parts
  const fnCallParts = parts.filter((p) => p.functionCall);
  if (fnCallParts.length > 0) {
    result.toolCalls = fnCallParts.map((p) => ({
      id: (p.functionCall as any).id,
      name: p.functionCall!.name!,
      args: (p.functionCall!.args as Record<string, unknown>) || {},
      // Stash the raw parts (functionCall + thoughtSignature) for the next turn
      _rawParts: parts.filter(
        (rp) =>
          (rp.functionCall && (rp.functionCall as any).id === (p.functionCall as any).id) ||
          rp.thoughtSignature,
      ),
    }));
  }

  // Usage metadata
  if (usageMeta) {
    result.usage = {
      promptTokens: usageMeta.promptTokenCount || 0,
      completionTokens: usageMeta.candidatesTokenCount || 0,
      totalTokens: usageMeta.totalTokenCount || 0,
    };
  }

  return result;
}

// ─── Provider Implementation ──────────────────────────────────────

class GeminiProvider implements LLMProvider {
  async chat(params: LLMCallParams): Promise<LLMResponse> {
    const { systemInstruction: msgSystemInstruction, contents } =
      messagesToContents(params.messages);

    // Merge explicit system instruction with any from messages
    const systemInstruction = [params.systemInstruction, msgSystemInstruction]
      .filter(Boolean)
      .join("\n\n") || undefined;

    const tools =
      params.tools && params.tools.length > 0
        ? toolSchemasToGeminiTools(params.tools)
        : undefined;

    const keys = ENV.GEMINI_API_KEYS;
    const maxAttempts = keys.length * 2;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // HIGH-01: capture our own key snapshot — concurrent calls each get
      // their own {client, keyIndex} and never share lastUsedKeyIndex.
      const { client, keyIndex: ownedIndex } = getAI();
      try {
        const response = await client.models.generateContent({
          model: params.model,
          contents,
          config: {
            tools,
            systemInstruction,
            temperature: params.temperature ?? 0.7,
          },
        });

        if (!response.candidates || response.candidates.length === 0) {
          return { text: "Error: Empty response from Gemini." };
        }

        const candidate = response.candidates[0];
        if (!candidate.content || !candidate.content.parts) {
          return { text: "Error: Empty content from Gemini." };
        }

        const usageMeta = (
          response as {
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          }
        ).usageMetadata;

        return parseGeminiResponse(candidate, usageMeta);
      } catch (error: unknown) {
        lastError = error;
        const status = (error as { status?: number }).status;

        if (status === 429) {
          const rotated = rotateKey(ownedIndex);
          if (!rotated) {
            // All keys exhausted — do NOT block the event loop for 30-60s.
            // Wait a short fixed delay (5s) to avoid hammering the API, then
            // re-throw so the router can immediately fall back to OpenRouter.
            // The exhaustion state is preserved; keys will auto-reset after
            // RESET_INTERVAL_MS (60s) via the next getAI() call.
            const shortDelay = 5_000;
            console.warn(
              `[Gemini] All keys exhausted. Yielding for ${shortDelay / 1000}s then re-throwing for OpenRouter fallback.`,
            );
            await sleep(shortDelay);
            // Re-throw with status 429 intact so router fallback activates
            throw lastError;
          }
          await sleep(500);
          continue;
        }

        if (status === 404) {
          // 404 = model not found — rotating keys won't help (it's the model name that's wrong).
          // Re-throw the original error (with .status intact) so the router can fall back to OpenRouter.
          throw error;
        }

        // Non-retryable — throw immediately
        throw error;
      }
    }

    throw lastError || new Error("Gemini: All retries exhausted.");
  }
}

/** Singleton Gemini provider instance. */
export const geminiProvider: LLMProvider = new GeminiProvider();

/**
 * Check if all Gemini API keys are currently exhausted.
 * Used by the router to decide whether to fall back.
 */
export function areAllKeysExhausted(): boolean {
  return exhaustedKeys.size >= ENV.GEMINI_API_KEYS.length;
}
