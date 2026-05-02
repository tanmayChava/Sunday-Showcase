/**
 * Model Display Names
 *
 * Maps raw LLM model IDs to human-friendly display names for use in
 * footers, status messages, and UI. Extracted from index.ts so the
 * entry point stays lean and this map can be reused by other modules
 * (e.g. slash-commands, session-stats) without importing the entry point.
 */

// ─── Friendly Name Map ────────────────────────────────────────────

export const FRIENDLY_NAMES: Record<string, string> = {
  // Gemini 3.1
  "gemini-3.1-pro-latest": "Gemini 3.1 Pro (Latest)",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "gemini-3.1-flash-latest": "Gemini 3.1 Flash (Latest)",
  "gemini-3.1-flash-lite-latest": "Gemini 3.1 Flash Lite (Latest)",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image (Nano Banana 2)",
  // Gemini 3
  "gemini-3-flash-preview": "Gemini 3 Flash Preview",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Image (Nano Banana Pro)",
  // Gemini 2.5
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  // Gemini 2.0 (deprecated)
  "gemini-2.0-flash": "Gemini 2.0 Flash (deprecated)",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite (deprecated)",
  // Gemini 1.5
  "gemini-1.5-pro-latest": "Gemini 1.5 Pro",
  "gemini-1.5-flash-latest": "Gemini 1.5 Flash",
  "gemini-1.5-flash-8b": "Gemini 1.5 Flash 8B",
  // Legacy exact IDs (keep for backwards compat)
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
  // Claude
  "anthropic/claude-3.7-sonnet": "Claude 3.7 Sonnet",
  "anthropic/claude-3.7-opus": "Claude 3.7 Opus",
  "anthropic/claude-3.5-haiku": "Claude 3.5 Haiku",
  "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet",
  // GPT
  "openai/gpt-4o": "GPT-4o",
  "openai/gpt-4o-mini": "GPT-4o Mini",
  "openai/gpt-5.4": "GPT-5",
  "openai/gpt-5.4-mini": "GPT-5 Mini",
  "openai/o3": "o3",
  "openai/o4-mini": "o4 Mini",
  // Llama
  "meta-llama/llama-4-maverick:free": "Llama 4 Maverick (free)",
  "meta-llama/llama-4-scout:free": "Llama 4 Scout (free)",
  "meta-llama/llama-4-maverick": "Llama 4 Maverick",
  // DeepSeek
  "deepseek/deepseek-chat-v3-0324:free": "DeepSeek V3 (free)",
  "deepseek/deepseek-r1-0528:free": "DeepSeek R1 (free)",
  "deepseek/deepseek-r1-zero:free": "DeepSeek R1 Zero (free)",
  // Qwen
  "qwen/qwen3-235b-a22b:free": "Qwen 3 235B (free)",
  "qwen/qwen3-coder-480b-a35b:free": "Qwen 3 Coder (free)",
  // Mistral
  "mistralai/mistral-small-3.1-24b-instruct:free": "Mistral Small 3.1 (free)",
  // mistral-7b-instruct:free retired — alias now redirects to mistral-small-3.1
  "mistralai/mistral-large": "Mistral Large",
  // Other
  "microsoft/phi-4-reasoning-plus:free": "Phi-4 Reasoning+ (free)",
  "nvidia/nemotron-3-super:free": "Nemotron 3 Super (free)",
};

/**
 * Convert a raw model ID into a human-friendly display name.
 * Falls back to a cleaned-up version of the raw ID if not in the map.
 */
export function prettifyModelName(model: string): string {
  if (FRIENDLY_NAMES[model]) return FRIENDLY_NAMES[model];

  // Fallback: strip provider prefix and clean up
  const name = model.includes("/") ? model.split("/").pop()! : model;
  return name
    .replace(/:free$/, " (free)")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
