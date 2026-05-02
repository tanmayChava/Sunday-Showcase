/**
 * Centralized Tool Registry
 *
 * Bundles tool definitions and executors in one place, replacing the
 * inline Map + array that lived in loop.ts.  Provides filtered access
 * so sub-agents can be restricted to a subset of tools.
 *
 * Call `initBuiltinTools()` once at startup (from loop.ts) to register
 * all built-in tools. This keeps the registry self-contained and
 * decouples tool registration from the agent loop module.
 */

import { Tool } from "@google/genai";

// ─── Types ───────────────────────────────────────────────────────

/** Executor function signature — takes args + chatId, returns text. */
export type ToolExecutor = (
    args: Record<string, unknown>,
    chatId: string,
) => Promise<string>;

/** A single registered tool: its Gemini definition + executor. */
export interface ToolEntry {
    /** Unique tool name (must match the functionDeclarations name) */
    name: string;
    /** Gemini-compatible tool definition */
    definition: Tool;
    /** The function that actually runs the tool */
    executor: ToolExecutor;
}

// ─── Registry ────────────────────────────────────────────────────

/** All registered built-in tools, keyed by name. */
const entries = new Map<string, ToolEntry>();

/**
 * Register a built-in tool.  Duplicate names overwrite silently.
 */
export function registerTool(entry: ToolEntry): void {
    entries.set(entry.name, entry);
}

/**
 * Get every registered tool entry.
 */
export function getAllToolEntries(): ToolEntry[] {
    return Array.from(entries.values());
}

/**
 * Get tool entries filtered by an allow/deny list.
 *
 * - If `allowedTools` is provided, only those tools are returned (allowlist).
 * - Else if `deniedTools` is provided, those tools are excluded (denylist).
 * - If neither is provided, all tools are returned.
 */
export function getFilteredToolEntries(
    allowedTools?: string[],
    deniedTools?: string[],
): ToolEntry[] {
    if (allowedTools && allowedTools.length > 0) {
        const allowed = new Set(allowedTools);
        return getAllToolEntries().filter((e) => allowed.has(e.name));
    }
    if (deniedTools && deniedTools.length > 0) {
        const denied = new Set(deniedTools);
        return getAllToolEntries().filter((e) => !denied.has(e.name));
    }
    return getAllToolEntries();
}

/**
 * Extract Gemini `Tool[]` definitions from a set of entries.
 */
export function getToolDefinitions(toolEntries: ToolEntry[]): Tool[] {
    return toolEntries.map((e) => e.definition);
}

/**
 * Look up an executor by tool name. Returns undefined if not found.
 */
export function getToolExecutor(name: string): ToolExecutor | undefined {
    return entries.get(name)?.executor;
}

/**
 * Check whether a tool name is registered in the built-in registry.
 */
export function isRegisteredTool(name: string): boolean {
    return entries.has(name);
}

// ─── Built-in Tool Initializer ───────────────────────────────────

/**
 * Register all built-in tools.
 *
 * Must be called once at startup before the agent loop runs.
 * Idempotent — calling multiple times is harmless (duplicate names overwrite).
 *
 * Importing the tool modules here (rather than in loop.ts) keeps the agent
 * loop focused on orchestration and makes this file the single source of
 * truth for which tools exist in the system.
 */
export async function initBuiltinTools(): Promise<void> {
    const [
        { getCurrentTimeDefinition, executeGetCurrentTime },
        { rememberFactDefinition, executeRememberFact },
        { webSearchDefinition, executeWebSearch, webResearchDefinition, executeWebResearch },
        { readUrlDefinition, executeReadUrl },
        { setReminderDefinition, executeSetReminder },
        { browsePageDefinition, executeBrowsePage },
        { delegateDefinition, executeDelegate },
        { apifyJobSearchDefinition, executeApifyJobSearch },
    ] = await Promise.all([
        import("./get_current_time.js"),
        import("./remember_fact.js"),
        import("./web_search.js"),
        import("./read_url.js"),
        import("./set_reminder.js"),
        import("./browse_page.js"),
        import("./delegate.js"),
        import("./apify_job_search.js"),
    ]);

    registerTool({
        name: "get_current_time",
        definition: getCurrentTimeDefinition,
        executor: async () => executeGetCurrentTime(),
    });
    registerTool({
        name: "remember_fact",
        definition: rememberFactDefinition,
        executor: async (args) =>
            executeRememberFact(args as { key: string; value: string }),
    });
    registerTool({
        name: "web_search",
        definition: webSearchDefinition,
        executor: async (args) => executeWebSearch((args as { query: string }).query),
    });
    registerTool({
        name: "web_research",
        definition: webResearchDefinition,
        executor: async (args) =>
            executeWebResearch((args as { query: string }).query),
    });
    registerTool({
        name: "read_url",
        definition: readUrlDefinition,
        executor: async (args) => executeReadUrl((args as { url: string }).url),
    });
    registerTool({
        name: "set_reminder",
        definition: setReminderDefinition,
        executor: async (args, chatId) =>
            executeSetReminder(
                args as { message: string; when?: string; minutes?: number },
                chatId,
            ),
    });
    registerTool({
        name: "browse_page",
        definition: browsePageDefinition,
        executor: async (args) =>
            executeBrowsePage(
                args as { url: string; wait_for?: string; extract_selector?: string },
            ),
    });
    registerTool({
        name: "delegate",
        definition: delegateDefinition,
        executor: async (args, chatId) =>
            executeDelegate(
                args as { agent: string; task: string; context?: string },
                chatId,
            ),
    });
    registerTool({
        name: "apify_job_search",
        definition: apifyJobSearchDefinition,
        executor: async (args) =>
            executeApifyJobSearch(
                args as {
                    role: string;
                    location?: string;
                    platform?: string;
                    date_posted?: string;
                    max_results?: number;
                    experience_level?: string;
                    experience_min?: number;
                    experience_max?: number;
                    keywords?: string;
                },
            ),
    });

    console.log(`[Registry] ${entries.size} built-in tools registered.`);
}
