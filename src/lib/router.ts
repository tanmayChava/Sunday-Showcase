/**
 * LLM Router — Smart Provider Dispatcher
 *
 * Routes LLM calls to the correct provider (Gemini or OpenRouter)
 * based on the model name. Handles automatic fallback when Gemini
 * keys are exhausted.
 *
 * Model routing logic:
 *   - Names starting with "gemini-" → Gemini provider
 *   - Everything else → OpenRouter provider
 *   - Gemini 429 fallback → OpenRouter (if configured)
 *
 * Usage:
 *   import { routedChat } from "../lib/router.js";
 *   const response = await routedChat({ model, messages, ... });
 */

import type { LLMCallParams, LLMResponse } from "./llm.js";
import { geminiProvider } from "./gemini.js";
import { openRouterProvider } from "./openrouter.js";
import { ENV } from "../config.js";

/**
 * Determine which provider should serve a given model.
 */
function isGeminiModel(model: string): boolean {
    return model.startsWith("gemini-");
}

/** HTTP status codes that warrant an automatic OpenRouter fallback. */
const FALLBACK_STATUSES = new Set([404, 429, 503]);

/**
 * Route an LLM call to the appropriate provider.
 *
 * - Gemini models go to the Gemini provider.
 * - Non-Gemini models go to OpenRouter directly (first-class, not fallback).
 * - If Gemini fails with 404 (model not found), 429 (quota), or 503 (service unavailable),
 *   automatically retries with OpenRouter using the configured fallback model.
 * - All other errors (400, 401, 500, etc.) propagate immediately so real
 *   bugs are not silently hidden behind a fallback.
 */
export async function routedChat(params: LLMCallParams): Promise<LLMResponse> {
    // ── Non-Gemini model → OpenRouter directly ──────────────────────
    if (!isGeminiModel(params.model)) {
        console.log(`[Router] ${params.model} → OpenRouter (native)`);
        return openRouterProvider.chat(params);
    }

    // ── Gemini model ────────────────────────────────────────────────
    try {
        return await geminiProvider.chat(params);
    } catch (error: unknown) {
        const status = (error as { status?: number }).status;

        // Only fall back on quota/service errors — propagate everything else
        if (!ENV.OPENROUTER_API_KEY || !FALLBACK_STATUSES.has(status ?? 0)) {
            throw error;
        }

        const reason = status === 404 ? "model not found" : `HTTP ${status}`;
        console.log(
            `[Router] Gemini failed (${reason}) — falling back to OpenRouter (${ENV.OPENROUTER_MODEL})...`,
        );

        try {
            return await openRouterProvider.chat({
                ...params,
                model: ENV.OPENROUTER_MODEL,
            });
        } catch (fallbackError) {
            console.error("[Router] OpenRouter fallback also failed:", fallbackError);
            // Throw the original Gemini error, not the fallback error
            throw error;
        }
    }
}

/**
 * Get the provider name for a model (for display / logging purposes).
 */
export function getProviderName(model: string): string {
    return isGeminiModel(model) ? "Gemini" : "OpenRouter";
}
