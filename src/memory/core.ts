/**
 * Tier 1 — Core Memory (KV Store)
 *
 * Stable identity and preference data.
 * Always included in system context. Never summarized away.
 * Small, high-priority, persistent.
 */

import { getSupabase } from "../lib/supabase.js";

// In-memory cache so we don't hit Supabase on every message
let cache: Map<string, string> = new Map();
let cacheLoaded = false;

/** Return the number of entries in the core memory cache. */
export function getCoreMemoryCount(): number {
  return cache.size;
}

/**
 * Load all core memories into the local cache.
 * Called once at startup.
 */
export async function loadCoreMemories(): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn(
      "[CoreMemory] Supabase unavailable — using empty core memory.",
    );
    cacheLoaded = true;
    return;
  }

  try {
    const { data, error } = await sb.from("core_memories").select("key, value");

    if (error) {
      console.error("[CoreMemory] Failed to load:", error.message);
    } else if (data) {
      cache = new Map(data.map((row) => [row.key, row.value]));
      console.log(`[CoreMemory] Loaded ${cache.size} entries.`);
    }
  } catch (err) {
    console.error("[CoreMemory] Unexpected error:", err);
  }

  cacheLoaded = true;
}

/**
 * Get a single core memory value.
 */
export function getCoreMemory(key: string): string | undefined {
  return cache.get(key);
}

/**
 * Set a core memory (upsert).
 * Updates both the cache and Supabase.
 */
export async function setCoreMemory(key: string, value: string): Promise<void> {
  cache.set(key, value);

  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb
      .from("core_memories")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) {
      console.error("[CoreMemory] Failed to save:", error.message);
    }
  } catch (err) {
    console.error("[CoreMemory] Unexpected error saving:", err);
  }
}

/**
 * Delete a core memory entry.
 * Removes from both cache and Supabase.
 */
export async function deleteCoreMemory(key: string): Promise<void> {
  cache.delete(key);

  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb
      .from("core_memories")
      .delete()
      .eq("key", key);
    if (error) {
      console.error("[CoreMemory] Failed to delete:", error.message);
    }
  } catch (err) {
    console.error("[CoreMemory] Unexpected error deleting:", err);
  }
}

/**
 * Clear ALL core memory entries.
 * Wipes the in-memory cache and deletes all rows from Supabase.
 * Used by /forget all.
 */
export async function clearAllCoreMemories(): Promise<void> {
  cache.clear();

  const sb = getSupabase();
  if (!sb) return;

  try {
    // Supabase requires a filter for DELETE — use neq on a sentinel value
    const { error } = await sb
      .from("core_memories")
      .delete()
      .neq("key", "__never_matches_this__");
    if (error) {
      console.error("[CoreMemory] Failed to clear all:", error.message);
    } else {
      console.log("[CoreMemory] All entries cleared.");
    }
  } catch (err) {
    console.error("[CoreMemory] Unexpected error clearing all:", err);
  }
}

/**
 * Build the core memory block for the system prompt.
 * Groups entries by prefix for cleaner display.
 */
export function buildCoreMemoryPrompt(): string {
  if (cache.size === 0) return "";

  // Group entries by prefix (before first underscore)
  const groups = new Map<string, string[]>();
  for (const [key, value] of cache.entries()) {
    const prefix = key.includes("_") ? key.split("_")[0] : "other";
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(`- ${key}: ${value}`);
  }

  const sections: string[] = ["## Core Memory (Always Active)"];
  for (const [group, entries] of groups.entries()) {
    sections.push(`### ${group}`);
    sections.push(entries.join("\n"));
  }

  return sections.join("\n");
}
