/**
 * Runtime Config — Simple ENV-driven configuration store
 *
 * Previously this module synced with a Mission Control dashboard via Supabase.
 * That dependency has been removed. Configuration is now read directly from
 * environment variables at startup and can be updated at runtime via slash
 * commands (e.g. /model) or programmatic calls to setRuntimeConfig().
 */

import { ENV } from "../config.js";

// ─── Runtime Config Store ────────────────────────────────────────

export interface RuntimeConfig {
    primaryModel: string;
    temperature: number;
    autoCompact: boolean;
    semanticMemory: boolean;
    factThreshold: number;
    delegation: boolean;
    showModelFooter: boolean;
}

/** Live runtime config — initialised from ENV, mutable at runtime. */
let runtimeConfig: RuntimeConfig = {
    primaryModel: ENV.GEMINI_MODEL,
    temperature: 0.7,
    autoCompact: true,
    semanticMemory: true,
    factThreshold: 4,
    delegation: true,
    showModelFooter: ENV.SHOW_MODEL_FOOTER,
};

/** Get the current runtime config (used by agent loop, slash commands, etc.). */
export function getRuntimeConfig(): Readonly<RuntimeConfig> {
    return runtimeConfig;
}

/**
 * Update one or more runtime config values at runtime.
 * Accepts a partial object — only the provided keys are changed.
 */
export function setRuntimeConfig(patch: Partial<RuntimeConfig>): void {
    runtimeConfig = { ...runtimeConfig, ...patch };
}

/**
 * No-op stub kept for backwards compatibility with any call sites that
 * previously called initConfigSync() at startup. Safe to leave in index.ts
 * or simply remove the call — either way nothing breaks.
 */
export async function initConfigSync(): Promise<void> {
    console.log("[Config] Runtime config initialised from ENV (no external sync).");
}
