/**
 * Session Statistics Tracker
 *
 * Tracks per-chat token consumption and cost in memory.
 * Resets when the bot restarts or when a user runs /new.
 *
 * Per-call records capture:
 *   - Model used
 *   - Prompt / completion / total token counts
 *   - Estimated cost in USD
 *   - Wall-clock latency in ms
 *   - Timestamp
 *
 * This is intentionally kept in-memory (no DB) because the data
 * is session-scoped and ephemeral.
 */

// ─── Pricing Table ────────────────────────────────────────────────
// Prices in USD per 1 000 000 tokens (as of April 2026).
// Prompt / Completion prices listed separately.
//
// Sources: https://ai.google.dev/pricing, https://openrouter.ai/models

interface ModelPricing {
    /** USD per 1M prompt tokens */
    promptPer1M: number;
    /** USD per 1M completion tokens */
    completionPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
    // ── Gemini 3.x ────────────────────────────────────────────────
    "gemini-3.1-pro-preview": { promptPer1M: 2.00, completionPer1M: 12.00 },
    "gemini-3-flash-preview": { promptPer1M: 0.50, completionPer1M: 3.00 },
    "gemini-3.1-flash-lite-preview": { promptPer1M: 0.10, completionPer1M: 0.40 },

    // ── Gemini 2.5 ────────────────────────────────────────────────
    "gemini-2.5-pro": { promptPer1M: 1.25, completionPer1M: 10.00 },
    "gemini-2.5-flash": { promptPer1M: 0.30, completionPer1M: 2.50 },
    "gemini-2.5-flash-lite": { promptPer1M: 0.10, completionPer1M: 0.40 },

    // ── Gemini 2.0 ────────────────────────────────────────────────
    "gemini-2.0-flash": { promptPer1M: 0.075, completionPer1M: 0.30 },
    "gemini-2.0-flash-lite": { promptPer1M: 0.025, completionPer1M: 0.10 },

    // ── Gemini 1.5 (legacy) ───────────────────────────────────────
    "gemini-1.5-pro": { promptPer1M: 1.25, completionPer1M: 5.00 },
    "gemini-1.5-flash": { promptPer1M: 0.075, completionPer1M: 0.30 },
    "gemini-1.5-flash-8b": { promptPer1M: 0.0375, completionPer1M: 0.15 },

    // ── OpenRouter Free Tier ($0) ─────────────────────────────────
    // Llama 4
    "meta-llama/llama-4-maverick:free": { promptPer1M: 0, completionPer1M: 0 },
    "meta-llama/llama-4-scout:free": { promptPer1M: 0, completionPer1M: 0 },
    // DeepSeek
    "deepseek/deepseek-chat-v3-0324:free": { promptPer1M: 0, completionPer1M: 0 },
    "deepseek/deepseek-r1-0528:free": { promptPer1M: 0, completionPer1M: 0 },
    "deepseek/deepseek-r1-zero:free": { promptPer1M: 0, completionPer1M: 0 },
    // Qwen
    "qwen/qwen3-235b-a22b:free": { promptPer1M: 0, completionPer1M: 0 },
    "qwen/qwen3-coder-480b-a35b:free": { promptPer1M: 0, completionPer1M: 0 },
    // Mistral
    "mistralai/mistral-small-3.1-24b-instruct:free": { promptPer1M: 0, completionPer1M: 0 },
    "mistralai/mistral-7b-instruct:free": { promptPer1M: 0, completionPer1M: 0 },
    // Microsoft
    "microsoft/phi-4-reasoning-plus:free": { promptPer1M: 0, completionPer1M: 0 },
    // NVIDIA
    "nvidia/nemotron-3-super:free": { promptPer1M: 0, completionPer1M: 0 },
    // Google via OpenRouter
    "google/gemini-3-flash-preview:free": { promptPer1M: 0, completionPer1M: 0 },
    "google/gemini-2.0-flash-exp:free": { promptPer1M: 0, completionPer1M: 0 },
    // Misc free
    "openai/gpt-oss-20b:free": { promptPer1M: 0, completionPer1M: 0 },
    "stepfun/step-3.5-flash:free": { promptPer1M: 0, completionPer1M: 0 },
    "arcee-ai/trinity-mini:free": { promptPer1M: 0, completionPer1M: 0 },

    // ── OpenRouter Paid — Anthropic / Claude ─────────────────────
    "anthropic/claude-3.7-opus": { promptPer1M: 15.00, completionPer1M: 75.00 },
    "anthropic/claude-3.7-sonnet": { promptPer1M: 3.00, completionPer1M: 15.00 },
    "anthropic/claude-3.5-sonnet": { promptPer1M: 3.00, completionPer1M: 15.00 },
    "anthropic/claude-3.5-haiku": { promptPer1M: 0.80, completionPer1M: 4.00 },
    "anthropic/claude-3-haiku": { promptPer1M: 0.25, completionPer1M: 1.25 },
    "anthropic/claude-3-opus": { promptPer1M: 15.00, completionPer1M: 75.00 },

    // ── OpenRouter Paid — OpenAI / GPT ───────────────────────────
    "openai/gpt-5.4": { promptPer1M: 10.00, completionPer1M: 30.00 },
    "openai/gpt-5.4-mini": { promptPer1M: 0.40, completionPer1M: 1.60 },
    "openai/gpt-4o": { promptPer1M: 2.50, completionPer1M: 10.00 },
    "openai/gpt-4o-mini": { promptPer1M: 0.15, completionPer1M: 0.60 },
    "openai/o3": { promptPer1M: 10.00, completionPer1M: 40.00 },
    "openai/o4-mini": { promptPer1M: 1.10, completionPer1M: 4.40 },

    // ── OpenRouter Paid — Meta / Llama ───────────────────────────
    "meta-llama/llama-4-maverick": { promptPer1M: 0.18, completionPer1M: 0.60 },
    "meta-llama/llama-4-scout": { promptPer1M: 0.10, completionPer1M: 0.35 },
    "meta-llama/llama-3.3-70b-instruct": { promptPer1M: 0.12, completionPer1M: 0.30 },

    // ── OpenRouter Paid — DeepSeek ────────────────────────────────
    "deepseek/deepseek-chat-v3-0324": { promptPer1M: 0.27, completionPer1M: 1.10 },
    "deepseek/deepseek-r1": { promptPer1M: 0.55, completionPer1M: 2.19 },

    // ── OpenRouter Paid — Mistral ─────────────────────────────────
    "mistralai/mistral-large": { promptPer1M: 2.00, completionPer1M: 6.00 },
    "mistralai/mistral-small-3.1-24b-instruct": { promptPer1M: 0.10, completionPer1M: 0.30 },

    // ── OpenRouter Paid — Qwen ────────────────────────────────────
    "qwen/qwen3-235b-a22b": { promptPer1M: 0.14, completionPer1M: 0.60 },
    "qwen/qwq-32b": { promptPer1M: 0.12, completionPer1M: 0.18 },

    // ── OpenRouter Paid — Google via OR ──────────────────────────
    "google/gemini-3-flash-preview": { promptPer1M: 0.50, completionPer1M: 3.00 },
    "google/gemini-2.5-pro": { promptPer1M: 1.25, completionPer1M: 10.00 },
    "google/gemini-2.5-flash": { promptPer1M: 0.30, completionPer1M: 2.50 },
};

/** Fallback pricing for unknown models. */
const DEFAULT_PRICING: ModelPricing = { promptPer1M: 0.075, completionPer1M: 0.30 };

/** Free-tier models via OpenRouter have ":free" suffix. */
const FREE_PRICING: ModelPricing = { promptPer1M: 0, completionPer1M: 0 };

function getPricing(model: string): ModelPricing {
    // Free-tier OpenRouter models
    if (model.endsWith(":free")) return FREE_PRICING;
    // Exact match
    if (PRICING[model]) return PRICING[model];
    // Prefix match (handles versioned suffixes like -preview, -exp, etc.)
    for (const [key, price] of Object.entries(PRICING)) {
        if (model.startsWith(key)) return price;
    }
    return DEFAULT_PRICING;
}

export function estimateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
): number {
    const p = getPricing(model);
    return (promptTokens / 1_000_000) * p.promptPer1M +
        (completionTokens / 1_000_000) * p.completionPer1M;
}

// ─── Types ────────────────────────────────────────────────────────

/** One logged LLM API call. */
export interface CallRecord {
    /** ISO timestamp of when the call completed */
    timestamp: string;
    /** The Gemini model used */
    model: string;
    /** Prompt tokens sent */
    promptTokens: number;
    /** Completion tokens received */
    completionTokens: number;
    /** Total tokens (prompt + completion) */
    totalTokens: number;
    /** Estimated USD cost for this call */
    estimatedCostUsd: number;
    /** Wall-clock latency in ms */
    latencyMs: number;
}

/** Aggregated session-level stats. */
export interface SessionStats {
    /** Cumulative prompt tokens sent to the model */
    promptTokens: number;
    /** Cumulative completion tokens received from the model */
    completionTokens: number;
    /** Cumulative total tokens (prompt + completion) */
    totalTokens: number;
    /** Cumulative estimated cost in USD */
    estimatedCostUsd: number;
    /** Number of LLM requests made in this session */
    requestCount: number;
    /** Total latency across all calls (ms) */
    totalLatencyMs: number;
    /** When this session was started or last reset */
    sessionStartedAt: Date;
    /** Rolling log of individual calls (last MAX_CALL_LOG entries) */
    callLog: CallRecord[];
}

// ─── Storage ──────────────────────────────────────────────────────

const MAX_CALL_LOG = 20;
const sessions = new Map<string, SessionStats>();

function emptyStats(): SessionStats {
    return {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        requestCount: 0,
        totalLatencyMs: 0,
        sessionStartedAt: new Date(),
        callLog: [],
    };
}

function ensureSession(chatId: string): SessionStats {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, emptyStats());
    }
    return sessions.get(chatId)!;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Record token usage, cost and latency from a single LLM API response.
 *
 * @param chatId           Chat to attribute the call to
 * @param model            The model that served the request
 * @param promptTokens     Tokens in the prompt
 * @param completionTokens Tokens in the completion
 * @param totalTokens      Total tokens (as reported by the API)
 * @param latencyMs        Wall-clock time from request start to response
 */
export function recordTokenUsage(
    chatId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    latencyMs: number,
): void {
    const stats = ensureSession(chatId);
    const costUsd = estimateCost(model, promptTokens, completionTokens);

    // Update aggregates
    stats.promptTokens += promptTokens;
    stats.completionTokens += completionTokens;
    stats.totalTokens += totalTokens;
    stats.estimatedCostUsd += costUsd;
    stats.requestCount += 1;
    stats.totalLatencyMs += latencyMs;

    // Append to call log (ring buffer)
    const record: CallRecord = {
        timestamp: new Date().toISOString(),
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: costUsd,
        latencyMs,
    };

    stats.callLog.push(record);
    if (stats.callLog.length > MAX_CALL_LOG) {
        stats.callLog.shift(); // drop oldest
    }

    console.log(
        `[Usage] model=${model} prompt=${promptTokens} compl=${completionTokens}` +
        ` total=${totalTokens} cost=$${costUsd.toFixed(6)} latency=${latencyMs}ms`,
    );

    // Persist to Supabase for Mission Control dashboard (fire-and-forget)
    persistUsageLog(chatId, record).catch((err) =>
        console.warn("[Usage] Failed to persist usage log:", err),
    );
}

/**
 * Write a usage record to Supabase so Mission Control can display real cost data.
 * This is fire-and-forget — never blocks the agent response.
 */
async function persistUsageLog(chatId: string, record: CallRecord): Promise<void> {
    // Dynamic import to avoid circular dependencies at module load time
    const { getSupabase } = await import("../lib/supabase.js");
    const sb = getSupabase();
    if (!sb) return;

    const { error } = await sb.from("usage_logs").insert({
        chat_id: chatId,
        model: record.model,
        prompt_tokens: record.promptTokens,
        completion_tokens: record.completionTokens,
        total_tokens: record.totalTokens,
        estimated_cost_usd: record.estimatedCostUsd,
        latency_ms: record.latencyMs,
        created_at: record.timestamp,
    });

    if (error) {
        // Table might not exist yet — that's fine, just log once
        if (!error.message?.includes("usage_logs")) {
            console.warn("[Usage] Supabase insert error:", error.message);
        }
    }
}

/**
 * Get the current session stats for a chat.
 */
export function getSessionStats(chatId: string): SessionStats {
    return ensureSession(chatId);
}

/**
 * Get the call log for a chat (most recent first).
 */
export function getCallLog(chatId: string): CallRecord[] {
    return [...ensureSession(chatId).callLog].reverse();
}

/**
 * Reset session stats (called on /new).
 */
export function resetSessionStats(chatId: string): void {
    sessions.set(chatId, emptyStats());
}

// ─── Formatters ───────────────────────────────────────────────────

/**
 * Format a cost value to a sensible number of decimal places.
 * Shows 4 decimal places for small values to avoid showing "$0.0000".
 */
export function formatCost(usd: number): string {
    if (usd === 0) return "$0.00";
    if (usd < 0.0001) return `$${usd.toFixed(8)}`;
    if (usd < 0.01) return `$${usd.toFixed(5)}`;
    return `$${usd.toFixed(4)}`;
}

/**
 * Format a duration in ms into a human-readable string.
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

/**
 * Format the quick session status block shown by /status.
 */
export function formatSessionStatus(
    chatId: string,
    messageCount: number,
    reminderCount: number = 0,
    memoryCount: number = 0,
): string {
    const stats = getSessionStats(chatId);
    const sessionUptime = formatDuration(Date.now() - stats.sessionStartedAt.getTime());
    const processUptime = formatDuration(Math.round(process.uptime() * 1000));
    const avgLatency = stats.requestCount > 0
        ? `${Math.round(stats.totalLatencyMs / stats.requestCount).toLocaleString()} ms`
        : "—";

    const lines = [
        "📊 **Session Status**\n",
        `🤖 **Bot Uptime:**         ${processUptime}`,
        `⏱️ **Session Duration:**   ${sessionUptime}`,
        `💬 **Messages in Buffer:** ${messageCount}`,
        `🧠 **Core Memories:**      ${memoryCount}`,
        `⏰ **Pending Reminders:**  ${reminderCount}`,
        `🔢 **LLM Requests:**       ${stats.requestCount}`,
        `⚡ **Avg Latency:**         ${avgLatency}`,
        "",
        "📈 **Token Consumption:**",
        `   → Prompt tokens:       ${stats.promptTokens.toLocaleString()}`,
        `   → Completion tokens:   ${stats.completionTokens.toLocaleString()}`,
        `   → **Total tokens:**    ${stats.totalTokens.toLocaleString()}`,
        "",
        `💰 **Estimated Cost:**     ${formatCost(stats.estimatedCostUsd)}`,
    ];

    return lines.join("\n");
}

/**
 * Format the full /usage report: summary block + per-call breakdown table.
 */
export function formatUsageReport(chatId: string): string {
    const stats = getSessionStats(chatId);

    if (stats.requestCount === 0) {
        return "📈 **Usage** — No LLM calls recorded yet this session.";
    }

    const avgTokens = Math.round(stats.totalTokens / stats.requestCount);
    const avgLatency = Math.round(stats.totalLatencyMs / stats.requestCount);

    // ── Header summary ──────────────────────────────────────────────
    const lines: string[] = [
        "📈 **Usage Report** (this session)\n",
        `🔢 **LLM Requests:**       ${stats.requestCount}`,
        `📥 **Prompt tokens:**      ${stats.promptTokens.toLocaleString()}`,
        `📤 **Completion tokens:**  ${stats.completionTokens.toLocaleString()}`,
        `⚡ **Total tokens:**       ${stats.totalTokens.toLocaleString()}`,
        `📊 **Avg tokens/request:** ${avgTokens.toLocaleString()}`,
        `🕐 **Avg latency:**        ${avgLatency.toLocaleString()} ms`,
        `💰 **Total est. cost:**    ${formatCost(stats.estimatedCostUsd)}`,
    ];

    // ── Per-model breakdown ─────────────────────────────────────────
    const byModel = new Map<string, { count: number; tokens: number; cost: number }>();
    for (const r of stats.callLog) {
        const existing = byModel.get(r.model) ?? { count: 0, tokens: 0, cost: 0 };
        existing.count += 1;
        existing.tokens += r.totalTokens;
        existing.cost += r.estimatedCostUsd;
        byModel.set(r.model, existing);
    }

    if (byModel.size > 0) {
        lines.push("", "**By model:**");
        for (const [model, agg] of byModel.entries()) {
            lines.push(
                `  \`${model}\`  ×${agg.count}  —  ${agg.tokens.toLocaleString()} tok  ${formatCost(agg.cost)}`
            );
        }
    }

    // ── Per-call log (last MAX_CALL_LOG, most recent first) ─────────
    const log = getCallLog(chatId);
    if (log.length > 0) {
        lines.push("", `**Last ${log.length} call${log.length === 1 ? "" : "s"}:**`);

        for (let i = 0; i < log.length; i++) {
            const r = log[i];
            const time = new Date(r.timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });

            lines.push(
                `  **#${i + 1}** \`${time}\`  \`${r.model}\`` +
                `  in=${r.promptTokens.toLocaleString()} out=${r.completionTokens.toLocaleString()}` +
                `  ${formatCost(r.estimatedCostUsd)}  ${r.latencyMs.toLocaleString()}ms`
            );
        }
    }

    return lines.join("\n");
}
