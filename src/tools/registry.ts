/**
 * Centralized Tool Registry
 *
 * Bundles tool definitions and executors in one place, replacing the
 * inline Map + array that lived in loop.ts.  Provides filtered access
 * so sub-agents can be restricted to a subset of tools.
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
