/**
 * User Profile System — Hermes-Inspired USER.md
 *
 * Maintains a curated, LLM-updated profile of the user's preferences,
 * communication style, domains of interest, and working patterns.
 *
 * This is stored in Supabase core_memories under the key "user_profile"
 * and injected into the system prompt on every request — so SUNDAY always
 * knows who it's talking to, without the user having to repeat themselves.
 *
 * The profile is updated in the background (non-blocking) every
 * USER_PROFILE_UPDATE_INTERVAL non-trivial turns, using the LLM to
 * synthesize new observations into the existing profile.
 *
 * Design philosophy (from Hermes):
 *   - Small, curated, high-signal content (NOT a dump of everything)
 *   - Updated by the agent, readable/editable by the user
 *   - Injected into every system prompt for continuity
 */

import { setCoreMemory, getCoreMemory } from "./core.js";
import { routedChat } from "../lib/router.js";
import { getRuntimeConfig } from "../lib/config-sync.js";

// ─── Config ──────────────────────────────────────────────────────

/** Update user profile every N non-trivial turns */
const USER_PROFILE_UPDATE_INTERVAL = 5;

/** Max character length for user profile (keep it tight) */
const USER_PROFILE_MAX_CHARS = 1200;

/** Core memory key for the user profile */
const USER_PROFILE_KEY = "user_profile";

/** Per-chat turn counters for debouncing */
const turnCounters = new Map<string, number>();

/** Trivial messages to skip */
const TRIVIAL_PATTERN =
  /^(hi|hello|hey|yo|sup|hola|ok|okay|k|yes|no|yep|nope|yeah|nah|sure|cool|nice|great|thanks|thank you|thx|ty|bye|👍|🙏|😂|❤️|🔥|✅|👎|\.+|!+|\?+)$/i;

// ─── Profile Injection ────────────────────────────────────────────

/**
 * Build the user profile section for the system prompt.
 * Returns an empty string if no profile exists yet.
 */
export function buildUserProfilePrompt(): string {
  const profile = getCoreMemory(USER_PROFILE_KEY);
  if (!profile || profile.trim().length === 0) return "";

  return `## User Profile (Always Active)\n${profile}`;
}

/**
 * Get the raw user profile text (for /export command).
 */
export function getUserProfile(): string {
  return getCoreMemory(USER_PROFILE_KEY) || "";
}

// ─── Profile Update Trigger ───────────────────────────────────────

/**
 * Trigger a background user profile update.
 * Called after each assistant response — debounced per chat.
 * Never blocks the response.
 */
export function triggerUserProfileUpdate(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
): void {
  // Skip trivial inputs
  const trimmed = userMessage.trim();
  if (TRIVIAL_PATTERN.test(trimmed)) return;
  if (trimmed.length < 10) return;

  // Debounce: only update every N turns
  const count = (turnCounters.get(chatId) ?? 0) + 1;
  turnCounters.set(chatId, count);
  if (count % USER_PROFILE_UPDATE_INTERVAL !== 0) return;

  // Fire and forget
  updateUserProfile(userMessage, assistantResponse).catch((err) =>
    console.error("[UserProfile] Background update error:", err),
  );
}

// ─── Profile Update Logic ─────────────────────────────────────────

async function updateUserProfile(
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const existing = getCoreMemory(USER_PROFILE_KEY) || "";

  const prompt = `You maintain a concise user profile for an AI assistant called SUNDAY. The profile captures what makes this user unique — their preferences, expertise, communication style, and recurring interests.

## Existing Profile
${existing || "(no profile yet — create one from scratch)"}

## New Conversation Exchange
User: ${userMessage.substring(0, 600)}
Assistant: ${assistantResponse.substring(0, 400)}

## Your Task
Update the user profile based on any NEW observations from this exchange.
Only add information that is clearly revealed and worth retaining long-term.

Profile sections to maintain:
- **Communication Style:** How they prefer responses (concise, detailed, casual, formal)
- **Expertise & Background:** Domains they're clearly knowledgeable in
- **Active Projects:** What they're currently working on (high-level)
- **Preferences:** Tools, languages, frameworks, habits they've expressed
- **Timezone & Region:** If revealed (e.g., IST, India)

Rules:
- Keep total length under ${USER_PROFILE_MAX_CHARS} characters
- Be specific, not generic ("prefers TypeScript over JavaScript" not "likes programming")
- Remove stale or contradicted info
- If nothing new was revealed, return the existing profile unchanged
- Use bullet points, not prose paragraphs

Return ONLY the updated profile text — no explanation, no headers like "## User Profile".`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const updatedProfile = response.text?.trim() || "";
    if (!updatedProfile || updatedProfile.length < 20) return;

    // Enforce max length
    const truncated =
      updatedProfile.length > USER_PROFILE_MAX_CHARS
        ? updatedProfile.substring(0, USER_PROFILE_MAX_CHARS)
        : updatedProfile;

    await setCoreMemory(USER_PROFILE_KEY, truncated);
    console.log(
      `[UserProfile] ✅ Updated (${truncated.length} chars)`,
    );
  } catch (err) {
    console.error("[UserProfile] Update failed:", err);
  }
}

// ─── Manual Profile Operations ────────────────────────────────────

/**
 * Manually set or replace the user profile.
 * Called by /profile set command.
 */
export async function setUserProfile(content: string): Promise<void> {
  const truncated =
    content.length > USER_PROFILE_MAX_CHARS
      ? content.substring(0, USER_PROFILE_MAX_CHARS)
      : content;
  await setCoreMemory(USER_PROFILE_KEY, truncated);
}

/**
 * Clear the user profile entirely.
 */
export async function clearUserProfile(): Promise<void> {
  await setCoreMemory(USER_PROFILE_KEY, "");
}
