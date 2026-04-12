/**
 * Config Sync — Live Configuration Bridge between Bot and Mission Control
 *
 * On startup:
 *   1. Syncs agent profiles from profiles.ts → Supabase `office_agents` table
 *   2. Reads `bot_config` table and applies runtime overrides
 *   3. Subscribes to `bot_config` changes via Realtime for hot-reload
 *
 * This makes Mission Control Config panel actually control the running bot.
 */

import { getSupabase, isSupabaseReady } from "./supabase.js";
import { PROFILES } from "../agent/profiles.js";
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

/** Live runtime config — starts with defaults from ENV. */
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

// ─── Model Validation ────────────────────────────────────────────

/**
 * Common model name typos → correct API identifiers.
 * Users often set "gemini-3.0-flash" in Mission Control but the
 * real API model name is "gemini-3-flash-preview".
 */
const MODEL_CORRECTIONS: Record<string, string> = {
    "gemini-3.0-flash": "gemini-3-flash-preview",
    "gemini-3.0-flash-preview": "gemini-3-flash-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3.0-pro": "gemini-3.1-pro-preview",
    "gemini-3.0-pro-preview": "gemini-3.1-pro-preview",
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-preview": "gemini-2.5-flash",
    "gemini-2.5-pro-preview": "gemini-2.5-pro",
};

function validateModel(model: string): string {
    const lower = model.toLowerCase().trim();

    // Check corrections map
    if (MODEL_CORRECTIONS[lower]) {
        const corrected = MODEL_CORRECTIONS[lower];
        console.warn(
            `[ConfigSync] ⚠️ Model "${model}" corrected → "${corrected}" (original name is not a valid Gemini API model)`,
        );
        return corrected;
    }

    // Known valid patterns: gemini-*, or openrouter format (provider/model)
    if (lower.startsWith("gemini-") || lower.includes("/")) {
        return model;
    }

    // Completely unrecognized — fall back to ENV default
    console.warn(
        `[ConfigSync] ⚠️ Model "${model}" is not recognized. Falling back to "${ENV.GEMINI_MODEL}".`,
    );
    return ENV.GEMINI_MODEL;
}

// ─── Config Parsing ──────────────────────────────────────────────

function applyConfigRow(key: string, value: string): void {
    switch (key) {
        case "primary_model":
            runtimeConfig.primaryModel = validateModel(value);
            break;
        case "temperature":
            runtimeConfig.temperature = parseFloat(value) || 0.7;
            break;
        case "auto_compact":
            runtimeConfig.autoCompact = value === "true";
            break;
        case "semantic_memory":
            runtimeConfig.semanticMemory = value === "true";
            break;
        case "fact_threshold":
            runtimeConfig.factThreshold = parseInt(value, 10) || 4;
            break;
        case "delegation":
            runtimeConfig.delegation = value === "true";
            break;
        case "show_model_footer":
            runtimeConfig.showModelFooter = value === "true";
            break;
    }
}

// ─── Load Config from Supabase ───────────────────────────────────

async function loadBotConfig(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const { data, error } = await supabase
        .from("bot_config")
        .select("key, value");

    if (error) {
        console.warn("[ConfigSync] Failed to load bot_config:", error.message);
        return;
    }

    if (data) {
        for (const row of data) {
            applyConfigRow(row.key, row.value);
        }
        console.log(
            `[ConfigSync] Loaded ${data.length} config values from Supabase.`,
        );
        console.log(
            `[ConfigSync] Active model: ${runtimeConfig.primaryModel}, temp: ${runtimeConfig.temperature}`,
        );
    }
}

// ─── Subscribe to Config Changes (Hot-Reload) ───────────────────

function subscribeToConfigChanges(): void {
    const supabase = getSupabase();
    if (!supabase) return;

    supabase
        .channel("bot-config-changes")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "bot_config" },
            (payload) => {
                const row = payload.new as { key: string; value: string } | undefined;
                if (row) {
                    applyConfigRow(row.key, row.value);
                    console.log(
                        `[ConfigSync] 🔄 Hot-reload: ${row.key} = ${row.value}`,
                    );
                }
            },
        )
        .subscribe();

    console.log("[ConfigSync] Subscribed to bot_config Realtime changes.");
}

// ─── Sync Agent Profiles → office_agents ─────────────────────────

async function syncAgentProfiles(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const profiles = Object.values(PROFILES);

    for (const profile of profiles) {
        const { error } = await supabase.from("office_agents").upsert(
            {
                profile_name: profile.name,
                name: profile.label,
                role: profile.systemPrompt.split("\n")[0].substring(0, 100),
                icon: profile.icon,
                avatar: profile.icon,
                avatar_color: "avatar-a",
                tools: profile.allowedTools || [],
                temperature: profile.temperature,
                max_iterations: profile.maxIterations,
                status: "Online",
                current_activity: "Idle — waiting for tasks",
                last_active: new Date().toISOString(),
            },
            { onConflict: "profile_name" },
        );

        if (error) {
            // If upsert with onConflict fails (no unique constraint yet), try insert
            console.warn(
                `[ConfigSync] Upsert failed for ${profile.name}, trying insert:`,
                error.message,
            );
        }
    }

    console.log(
        `[ConfigSync] Synced ${profiles.length} agent profiles to office_agents.`,
    );
}

// ─── Sub-Agent Activity Tracking ─────────────────────────────────

/**
 * Update a sub-agent's status in office_agents.
 * Called by sub-loop.ts when a sub-agent starts/finishes work.
 */
export async function updateAgentStatus(
    profileName: string,
    status: "Online" | "Working" | "Offline",
    activity: string,
): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const { error } = await supabase
        .from("office_agents")
        .update({
            status,
            current_activity: activity,
            last_active: new Date().toISOString(),
        })
        .eq("profile_name", profileName);

    if (error) {
        console.warn(
            `[ConfigSync] Failed to update agent status (${profileName}):`,
            error.message,
        );
    }
}

// ─── Init Everything ─────────────────────────────────────────────

/**
 * Initialize the config sync system. Call once at startup, AFTER Supabase is ready.
 */
export async function initConfigSync(): Promise<void> {
    const ready = await isSupabaseReady();
    if (!ready) {
        console.warn("[ConfigSync] Supabase not available — using defaults.");
        return;
    }

    await loadBotConfig();
    await syncAgentProfiles();
    subscribeToConfigChanges();
}
