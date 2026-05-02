/**
 * Skill Refinement Feedback Loop — Feature 4.6
 *
 * Tracks how often auto-generated skills are actually used (effectiveness),
 * allows the agent to mark skills as helpful/unhelpful, and periodically
 * triggers LLM-driven refinement of low-quality or high-value skills.
 *
 * Mechanism:
 *   1. Tracking — Every time a skill is referenced in a response, increment its
 *      `effectiveness` counter in the skill file (debounced, async).
 *   2. Degradation — Skills with effectiveness == 0 after 30 days are deprecated.
 *   3. Refinement — Skills with effectiveness > 5 are candidates for LLM refinement
 *      to make them more precise and actionable.
 *   4. User Feedback — `/skill_feedback good|bad <slug>` signals are incorporated
 *      into the effectiveness score directly.
 *   5. Commands:
 *      /skills             — list all skills with effectiveness scores
 *      /skill_feedback     — mark a skill helpful (+2) or unhelpful (-2)
 *      /skill_refine       — manually trigger LLM refinement of a specific skill
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "fs";
import { resolve, basename } from "path";
import { routedChat } from "../lib/router.js";
import { getRuntimeConfig } from "../lib/config-sync.js";

// ─── Config ──────────────────────────────────────────────────────

const AUTO_SKILLS_DIR = resolve(process.cwd(), "skills", "auto");
const DEPRECATION_DAYS = 30;      // Days before zero-use skills are deprecated
const REFINEMENT_THRESHOLD = 5;   // Min effectiveness to trigger refinement
const FEEDBACK_GOOD_DELTA = 2;    // Points added for positive feedback
const FEEDBACK_BAD_DELTA = -2;    // Points added for negative feedback (can go negative)

// ─── Types ───────────────────────────────────────────────────────

export interface SkillFeedback {
  slug: string;
  signal: "good" | "bad";
  reason?: string;
}

// ─── Frontmatter R/W ─────────────────────────────────────────────

interface SkillMeta {
  name: string;
  slug: string;
  description: string;
  category: string;
  enabled: boolean;
  effectiveness: number;
  created_at: string;
  source_agent: string;
  /** ISO date of last effectiveness update */
  last_used?: string;
  /** Whether skill has been through LLM refinement */
  refined?: boolean;
  /** Number of times refined */
  refine_count?: number;
  /** User feedback score delta */
  feedback_score?: number;
}

function readSkillFile(filepath: string): { meta: SkillMeta; content: string } | null {
  try {
    const raw = readFileSync(filepath, "utf-8");
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("---")) return null;

    const endIdx = trimmed.indexOf("---", 3);
    if (endIdx === -1) return null;

    const fmBlock = trimmed.substring(3, endIdx).trim();
    const content = trimmed.substring(endIdx + 3).trim();

    const meta: Record<string, string> = {};
    for (const line of fmBlock.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        meta[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
      }
    }

    return {
      meta: {
        name: meta.name || basename(filepath, ".md"),
        slug: meta.slug || basename(filepath, ".md"),
        description: meta.description || "",
        category: meta.category || "general",
        enabled: meta.enabled !== "false",
        effectiveness: parseInt(meta.effectiveness || "0", 10),
        created_at: meta.created_at || new Date().toISOString(),
        source_agent: meta.source_agent || "unknown",
        last_used: meta.last_used,
        refined: meta.refined === "true",
        refine_count: parseInt(meta.refine_count || "0", 10),
        feedback_score: parseInt(meta.feedback_score || "0", 10),
      },
      content,
    };
  } catch {
    return null;
  }
}

function writeSkillFile(filepath: string, meta: SkillMeta, content: string): void {
  const lines = [
    "---",
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    `category: ${meta.category}`,
    `enabled: ${meta.enabled}`,
    `auto_generated: true`,
    `created_at: ${meta.created_at}`,
    `source_agent: ${meta.source_agent}`,
    `effectiveness: ${meta.effectiveness}`,
    `feedback_score: ${meta.feedback_score ?? 0}`,
  ];
  if (meta.last_used) lines.push(`last_used: ${meta.last_used}`);
  if (meta.refined) lines.push(`refined: true`);
  if (meta.refine_count) lines.push(`refine_count: ${meta.refine_count}`);
  lines.push("---", "", content, "");
  writeFileSync(filepath, lines.join("\n"), "utf-8");
}


// ─── User Feedback ────────────────────────────────────────────────

/**
 * Apply user feedback signal to a skill's effectiveness.
 * Returns a human-readable result string.
 */
export function applySkillFeedback(feedback: SkillFeedback): string {
  if (!existsSync(AUTO_SKILLS_DIR)) {
    return "No auto-generated skills exist yet.";
  }

  const filepath = resolve(AUTO_SKILLS_DIR, `${feedback.slug}.md`);
  if (!existsSync(filepath)) {
    return `❌ Skill \`${feedback.slug}\` not found. Use \`/skills\` to see available skills.`;
  }

  const parsed = readSkillFile(filepath);
  if (!parsed) {
    return `❌ Could not read skill \`${feedback.slug}\`.`;
  }

  const delta = feedback.signal === "good" ? FEEDBACK_GOOD_DELTA : FEEDBACK_BAD_DELTA;
  const oldScore = parsed.meta.feedback_score ?? 0;
  const oldEffectiveness = parsed.meta.effectiveness;

  parsed.meta.feedback_score = oldScore + delta;
  parsed.meta.effectiveness = Math.max(0, oldEffectiveness + delta);
  parsed.meta.last_used = new Date().toISOString();

  // Auto-disable skills with very negative feedback
  if (parsed.meta.effectiveness <= 0 && delta < 0) {
    parsed.meta.enabled = false;
    writeSkillFile(filepath, parsed.meta, parsed.content);
    console.log(`[SkillFeedback] 🔴 Disabled skill "${parsed.meta.name}" due to negative feedback.`);
    return `🔴 Skill **${parsed.meta.name}** has been disabled due to consistently poor feedback.`;
  }

  writeSkillFile(filepath, parsed.meta, parsed.content);

  const icon = feedback.signal === "good" ? "👍" : "👎";
  const action = feedback.signal === "good" ? "improved" : "reduced";
  console.log(`[SkillFeedback] ${icon} ${feedback.slug}: effectiveness ${action} to ${parsed.meta.effectiveness}`);

  return `${icon} Feedback recorded for **${parsed.meta.name}**.\nEffectiveness: ${oldEffectiveness} → ${parsed.meta.effectiveness}`;
}

// ─── LLM Refinement ──────────────────────────────────────────────

/**
 * Use an LLM to refine a skill's instructions based on its effectiveness data.
 * Non-blocking — called asynchronously.
 */
async function triggerSkillRefinement(
  slug: string,
  filepath: string,
  meta: SkillMeta,
  content: string,
): Promise<void> {
  console.log(`[SkillFeedback] 🔬 Triggering refinement for skill: "${meta.name}" (effectiveness=${meta.effectiveness})`);

  const prompt = `You are an AI assistant specialized in improving reusable AI skill definitions.

A skill has been used ${meta.effectiveness} times and is proving valuable. Refine its instructions to make them more precise, actionable, and effective.

## Current Skill
**Name:** ${meta.name}
**Description:** ${meta.description}
**Category:** ${meta.category}
**Source Agent:** ${meta.source_agent}
**Effectiveness Score:** ${meta.effectiveness}

## Current Instructions
${content}

## Refinement Goals
1. Make steps more concrete and specific (less vague)
2. Add edge case handling if applicable
3. Improve clarity — each step should be unambiguous
4. If any step is redundant, merge or remove it
5. Keep it 5-15 lines max — skills must be concise

## Output Format
Return ONLY the refined skill instructions in markdown (no JSON, no frontmatter, no explanation).
Do NOT change the overall structure — just refine the wording and specificity.`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const refined = response.text?.trim();
    if (!refined || refined.length < 50) {
      console.warn(`[SkillFeedback] Refinement produced empty/short result for ${slug} — skipping.`);
      return;
    }

    meta.refined = true;
    meta.refine_count = (meta.refine_count ?? 0) + 1;
    writeSkillFile(filepath, meta, refined);
    console.log(`[SkillFeedback] ✅ Refined skill "${meta.name}" (${slug})`);
  } catch (err) {
    console.error(`[SkillFeedback] Refinement LLM call failed for ${slug}:`, err);
  }
}

/**
 * Manually trigger refinement of a skill by slug.
 * Returns a result string for the /skill_refine command.
 */
export async function manuallyRefineSkill(slug: string): Promise<string> {
  if (!existsSync(AUTO_SKILLS_DIR)) {
    return "No auto-generated skills exist yet.";
  }

  const filepath = resolve(AUTO_SKILLS_DIR, `${slug}.md`);
  if (!existsSync(filepath)) {
    return `❌ Skill \`${slug}\` not found. Use \`/skills\` to see available skills.`;
  }

  const parsed = readSkillFile(filepath);
  if (!parsed) {
    return `❌ Could not read skill \`${slug}\`.`;
  }

  await triggerSkillRefinement(slug, filepath, parsed.meta, parsed.content);

  // Re-read to confirm
  const updated = readSkillFile(filepath);
  if (updated?.meta.refined) {
    return `✅ Skill **${parsed.meta.name}** has been refined.\nRefinement count: ${updated.meta.refine_count}`;
  }
  return `⚠️ Refinement attempted for **${parsed.meta.name}** but could not confirm — check logs.`;
}

// ─── Deprecation Sweep ────────────────────────────────────────────

/**
 * Scan auto-skills and deprecate (disable) ones that:
 *   - Have effectiveness == 0
 *   - Are older than DEPRECATION_DAYS days
 *
 * Safe to call periodically (e.g. daily startup). Never deletes files.
 */
export function runDeprecationSweep(): void {
  if (!existsSync(AUTO_SKILLS_DIR)) return;

  const files = readdirSync(AUTO_SKILLS_DIR).filter((f) => f.endsWith(".md"));
  const cutoff = Date.now() - DEPRECATION_DAYS * 86_400_000;
  let deprecated = 0;

  for (const file of files) {
    const filepath = resolve(AUTO_SKILLS_DIR, file);
    const parsed = readSkillFile(filepath);
    if (!parsed) continue;

    const { meta, content } = parsed;

    // Skip already-disabled
    if (!meta.enabled) continue;

    // Skip skills with any positive effectiveness or feedback
    if (meta.effectiveness > 0 || (meta.feedback_score ?? 0) > 0) continue;

    // Only deprecate if old enough
    const createdAt = new Date(meta.created_at).getTime();
    if (createdAt > cutoff) continue;

    meta.enabled = false;
    writeSkillFile(filepath, meta, content);
    deprecated++;
    console.log(`[SkillFeedback] 🗑 Deprecated unused skill: "${meta.name}" (0 uses, ${DEPRECATION_DAYS}d old)`);
  }

  if (deprecated > 0) {
    console.log(`[SkillFeedback] Deprecation sweep complete: ${deprecated} skill(s) disabled.`);
  }
}

// ─── Stats Summary ────────────────────────────────────────────────

export interface SkillStats {
  slug: string;
  name: string;
  effectiveness: number;
  feedbackScore: number;
  refined: boolean;
  enabled: boolean;
  daysOld: number;
  lastUsed: string | null;
}

/** Get stats for all auto-generated skills. */
export function getSkillStats(): SkillStats[] {
  if (!existsSync(AUTO_SKILLS_DIR)) return [];

  const stats: SkillStats[] = [];
  const now = Date.now();

  for (const file of readdirSync(AUTO_SKILLS_DIR).filter((f) => f.endsWith(".md"))) {
    const filepath = resolve(AUTO_SKILLS_DIR, file);
    const parsed = readSkillFile(filepath);
    if (!parsed) continue;

    const { meta } = parsed;
    const daysOld = Math.floor((now - new Date(meta.created_at).getTime()) / 86_400_000);
    stats.push({
      slug: meta.slug || basename(file, ".md"),
      name: meta.name,
      effectiveness: meta.effectiveness,
      feedbackScore: meta.feedback_score ?? 0,
      refined: meta.refined ?? false,
      enabled: meta.enabled,
      daysOld,
      lastUsed: meta.last_used || null,
    });
  }

  return stats.sort((a, b) => b.effectiveness - a.effectiveness);
}
