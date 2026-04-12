/**
 * Skills / Plugin System — Supabase Hot-Reload Edition
 *
 * Loads skills from two sources, merged together:
 *   1. Local `/skills/*.md` files (filesystem fallback)
 *   2. Supabase `skills` table (primary, with Realtime hot-reload)
 *
 * On startup:
 *   - Loads local skills as a baseline
 *   - Fetches Supabase skills (overrides local by slug if both exist)
 *   - Subscribes to Realtime changes for instant hot-reload
 *
 * When Mission Control creates/updates/deletes/toggles a skill,
 * the bot's active skills update in real-time — no restart needed.
 *
 * Exports:
 *   - initSkillsSystem()   – call once at startup (after Supabase is ready)
 *   - getActiveSkills()     – returns current merged skill list
 *   - buildSkillsPrompt()   – returns the prompt section for the agent loop
 *   - loadSkills()          – legacy: loads local files only (still used as fallback)
 */

import { readdirSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { getSupabase, isSupabaseReady } from "../lib/supabase.js";

export interface Skill {
  /** Skill name (from frontmatter or Supabase) */
  name: string;
  /** URL-safe slug (used as dedup key) */
  slug: string;
  /** Optional description */
  description: string;
  /** The markdown content (the actual skill prompt) */
  content: string;
  /** Source: 'local' or 'supabase' */
  source: "local" | "supabase";
  /** Whether the skill is enabled */
  enabled: boolean;
  /** Category for organization */
  category: string;
}

// ─── In-Memory Skill Store ────────────────────────────────────────

/** Local skills loaded from filesystem */
let localSkills: Map<string, Skill> = new Map();
/** Supabase skills loaded from DB */
let supabaseSkills: Map<string, Skill> = new Map();
/** Cached merged prompt (rebuilt on any change) */
let cachedPrompt: string = "";
/** Whether the Realtime subscription is active */
let realtimeActive = false;

// ─── Frontmatter Parser ──────────────────────────────────────────

function parseFrontmatter(raw: string): {
  metadata: Record<string, string>;
  content: string;
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { metadata: {}, content: raw };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { metadata: {}, content: raw };
  }

  const frontmatterBlock = trimmed.substring(3, endIndex).trim();
  const content = trimmed.substring(endIndex + 3).trim();

  const metadata: Record<string, string> = {};
  for (const line of frontmatterBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      metadata[key] = value;
    }
  }

  return { metadata, content };
}

// ─── Slug Generator ──────────────────────────────────────────────

function toSlug(filename: string): string {
  return basename(filename, ".md")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Local File Loader ───────────────────────────────────────────

/**
 * Load all `.md` skill files from the given directory.
 * Returns an array of parsed Skill objects (only enabled skills).
 * This is the legacy function — still works standalone as a fallback.
 */
export function loadSkills(dir: string): Skill[] {
  const skills: Skill[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    console.log(`[Skills] No skills directory found at ${dir} — skipping.`);
    return [];
  }

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(dir, file), "utf-8");
      const { metadata, content } = parseFrontmatter(raw);

      // Skip disabled skills
      if (metadata.enabled === "false") {
        console.log(`[Skills] Skipping disabled skill: ${file}`);
        continue;
      }

      const skill: Skill = {
        name: metadata.name || basename(file, ".md"),
        slug: toSlug(file),
        description: metadata.description || "",
        content,
        source: "local",
        enabled: metadata.enabled !== "false",
        category: metadata.category || "general",
      };

      skills.push(skill);
      console.log(`[Skills] Loaded local: ${skill.name} (${file})`);
    } catch (err) {
      console.warn(`[Skills] Failed to load ${file}:`, err);
    }
  }

  console.log(`[Skills] ${skills.length} local skill(s) loaded.`);
  return skills;
}

// ─── Supabase Skills Loader ──────────────────────────────────────

async function loadSupabaseSkills(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .order("name");

  if (error) {
    console.warn("[Skills] Failed to load from Supabase:", error.message);
    return;
  }

  if (data) {
    supabaseSkills.clear();
    for (const row of data) {
      supabaseSkills.set(row.slug, {
        name: row.name,
        slug: row.slug,
        description: row.description || "",
        content: row.content || "",
        source: "supabase",
        enabled: row.enabled ?? true,
        category: row.category || "general",
      });
    }
    console.log(
      `[Skills] Loaded ${supabaseSkills.size} skill(s) from Supabase.`,
    );
  }

  rebuildPromptCache();
}

// ─── Realtime Subscription ───────────────────────────────────────

function subscribeToSkillChanges(): void {
  const supabase = getSupabase();
  if (!supabase || realtimeActive) return;

  supabase
    .channel("skills-hot-reload")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "skills" },
      (payload) => {
        const eventType = payload.eventType;

        if (eventType === "DELETE") {
          const old = payload.old as { slug?: string; name?: string };
          if (old?.slug) {
            supabaseSkills.delete(old.slug);
            console.log(`[Skills] 🔴 Hot-reload: Removed "${old.name || old.slug}"`);
          }
        } else {
          // INSERT or UPDATE
          const row = payload.new as {
            slug: string;
            name: string;
            description?: string;
            content?: string;
            enabled?: boolean;
            category?: string;
          };

          if (row?.slug) {
            supabaseSkills.set(row.slug, {
              name: row.name,
              slug: row.slug,
              description: row.description || "",
              content: row.content || "",
              source: "supabase",
              enabled: row.enabled ?? true,
              category: row.category || "general",
            });

            const action = eventType === "INSERT" ? "🟢 Added" : "🔄 Updated";
            console.log(
              `[Skills] ${action}: "${row.name}" (enabled: ${row.enabled})`,
            );
          }
        }

        rebuildPromptCache();
      },
    )
    .subscribe();

  realtimeActive = true;
  console.log("[Skills] Subscribed to Supabase Realtime — hot-reload active.");
}

// ─── Merged Skill Resolution ─────────────────────────────────────

/**
 * Get the current active skills (merged: Supabase overrides local by slug).
 * Only returns enabled skills.
 */
export function getActiveSkills(): Skill[] {
  const merged = new Map<string, Skill>();

  // 1. Start with local skills
  for (const [slug, skill] of localSkills) {
    if (skill.enabled) {
      merged.set(slug, skill);
    }
  }

  // 2. Override/extend with Supabase skills
  for (const [slug, skill] of supabaseSkills) {
    if (skill.enabled) {
      merged.set(slug, skill);
    } else {
      // If Supabase explicitly disables a skill, remove it even if local has it
      merged.delete(slug);
    }
  }

  return Array.from(merged.values());
}

// ─── Prompt Builder ──────────────────────────────────────────────

function rebuildPromptCache(): void {
  const active = getActiveSkills();

  if (active.length === 0) {
    cachedPrompt = "";
    return;
  }

  const parts = ["## Active Skills"];

  for (const skill of active) {
    parts.push(`### ${skill.name}`);
    if (skill.description) {
      parts.push(`_${skill.description}_`);
    }
    parts.push(skill.content);
  }

  cachedPrompt = parts.join("\n\n");
  console.log(
    `[Skills] Prompt rebuilt — ${active.length} active skill(s).`,
  );
}

/**
 * Build a prompt section from loaded skills to inject into the system instruction.
 * If called with a skills array (legacy), uses that directly.
 * If called with no args, uses the live merged cache.
 */
export function buildSkillsPrompt(skills?: Skill[]): string {
  if (skills && skills.length > 0) {
    // Legacy path: caller provided skills directly
    const parts = ["## Active Skills"];
    for (const skill of skills) {
      parts.push(`### ${skill.name}`);
      if (skill.description) {
        parts.push(`_${skill.description}_`);
      }
      parts.push(skill.content);
    }
    return parts.join("\n\n");
  }

  // Hot-reload path: use cached prompt
  return cachedPrompt;
}

// ─── Init System ─────────────────────────────────────────────────

/**
 * Initialize the full skills system with Supabase hot-reload.
 * Call once at startup, AFTER Supabase is ready.
 *
 * @param localDir  Path to the local skills directory (e.g. `resolve(cwd, 'skills')`)
 */
export async function initSkillsSystem(localDir: string): Promise<void> {
  // 1. Load local skills as baseline
  const locals = loadSkills(localDir);
  localSkills = new Map(locals.map((s) => [s.slug, s]));

  // 2. Try loading from Supabase
  const ready = await isSupabaseReady();
  if (ready) {
    await loadSupabaseSkills();
    subscribeToSkillChanges();
    console.log("[Skills] ✅ Supabase hot-reload active.");
  } else {
    console.log("[Skills] Supabase unavailable — using local files only.");
    rebuildPromptCache();
  }
}
