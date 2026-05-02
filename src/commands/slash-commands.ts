/**
 * Slash Command System — Single Source of Truth
 *
 * ALL slash commands are handled here. Channel adapters (Telegram, Discord)
 * call handleSlashCommand() and only deal with sending the result.
 * This ensures every command works on every channel without duplication.
 *
 * Supported commands:
 *   /start    — alias for /new
 *   /new      — clear conversation history and reset session stats
 *   /reset    — alias for /new
 *   /status   — session stats: uptime, message count, token usage
 *   /usage    — focused token breakdown
 *   /compact  — manually compact buffer into a rolling summary
 *   /model    — show active model, or switch it for this session
 *   /heartbeat     — show heartbeat scheduler status
 *   /heartbeat_set — change morning check-in time
 *   /agents   — list available sub-agents
 *   /pin      — save something to permanent core memory
 *   /help     — list all available commands
 */

import { ENV } from "../config.js";
import { getProviderName } from "../lib/router.js";
import { getRuntimeConfig } from "../lib/config-sync.js";
import { PROFILES } from "../agent/profiles.js";
import {
  getSessionStats,
  resetSessionStats,
  formatSessionStatus,
  formatUsageReport,
} from "./session-stats.js";
import {
  clearChatHistory,
  compactChatHistory,
  getMessageCount,
} from "../memory/buffer.js";
import { setCoreMemory } from "../memory/core.js";
import {
  getHeartbeatStatus,
  updateHeartbeatTime,
} from "../heartbeat/scheduler.js";
import {
  getUserProfile,
  clearUserProfile,
} from "../memory/user-profile.js";
import { listAutoSkills } from "../skills/auto-generator.js";
import { applySkillFeedback, manuallyRefineSkill } from "../skills/feedback.js";

// ─── Per-session Model Override ───────────────────────────────────

/**
 * In-memory map of chatId → model override.
 * When set, this model is used instead of ENV.GEMINI_MODEL for that chat.
 * Resets when the bot restarts or the user runs /new.
 */
const sessionModelOverrides = new Map<string, string>();

/**
 * Get the effective model for a given chat (override takes precedence).
 */
export function getEffectiveModel(chatId: string): string {
  return sessionModelOverrides.get(chatId) ?? getRuntimeConfig().primaryModel;
}

/**
 * Clear any model override for a chat (called on /new).
 */
export function clearModelOverride(chatId: string): void {
  sessionModelOverrides.delete(chatId);
}

// ─── Known Model Shortcuts ────────────────────────────────────────

const KNOWN_MODELS: Record<string, string> = {
  // ── Gemini 3.1 (❌ hard 404 on Gemini API — model IDs do not exist) ─────────
  // Verified 2026-04-29: all gemini-3.1-* IDs return HTTP 404 on every API version.
  // Aliases redirect to nearest working model so users get a response, not an error.
  "pro-3.1": "gemini-2.5-pro",               // ❌ 404 → redirect to 2.5 Pro
  "flash-3.1": "gemini-3-flash-preview",     // ❌ 404 → redirect to 3 Flash
  "flash-lite-3.1": "gemini-2.5-flash-lite", // ❌ 404 → redirect to 2.5 Lite
  "pro-3.1-preview": "gemini-2.5-pro",       // ❌ 404 → redirect to 2.5 Pro
  "flash-image-3.1": "gemini-3-flash-preview", // ❌ 404 → redirect to 3 Flash
  "pro-image-3": "gemini-3-flash-preview",   // ❌ shut down → redirect to 3 Flash

  // ── Gemini 3 Flash ────────────────────────────────────────────────────
  "flash-3": "gemini-3-flash-preview",            // ✅ confirmed valid on Gemini API
  "flash-3.0": "gemini-3-flash-preview",

  // ── Gemini 2.5 (stable — "flash" default) ────────────────────────────
  "flash": "gemini-2.5-flash",                    // default fast model
  "pro": "gemini-2.5-pro",
  "flash-2.5": "gemini-2.5-flash",
  "pro-2.5": "gemini-2.5-pro",
  "flash-lite": "gemini-2.5-flash-lite",
  "flash-lite-2.5": "gemini-2.5-flash-lite",

  // ── Gemini 2.0 (DEPRECATED — redirected to 2.5 equivalents) ──────────
  "flash-2.0": "gemini-2.5-flash",               // 2.0 Flash deprecated → 2.5 Flash
  "flash-lite-2.0": "gemini-2.5-flash-lite",     // 2.0 Flash-Lite deprecated → 2.5 Lite

  // ── Gemini 1.5 (legacy) ────────────────────────────────────────────────────
  // ❌ -latest suffix returns HTTP 404 — Gemini API removed that alias.
  // Use bare model ID instead (e.g. gemini-1.5-pro, not gemini-1.5-pro-latest).
  "pro-1.5": "gemini-1.5-pro",
  "flash-1.5": "gemini-1.5-flash",
  "flash-8b": "gemini-1.5-flash-8b",

  // ── OpenRouter Free Tier ────────────────────────────────────────────────────
  // Live-verified 2026-04-29. ALL former free models are now dead (HTTP 404).
  // Only confirmed working free model: openai/gpt-oss-20b:free
  //
  // ✅ WORKING
  "gpt-oss": "openai/gpt-oss-20b:free",
  //
  // ❌ DEAD — redirected to gpt-oss-20b:free (the only live free fallback)
  "llama": "openai/gpt-oss-20b:free",         // was llama-4-maverick:free (404)
  "llama-maverick": "openai/gpt-oss-20b:free",
  "llama-scout": "openai/gpt-oss-20b:free",   // was llama-4-scout:free (404)
  "deepseek": "openai/gpt-oss-20b:free",      // was deepseek-chat-v3:free (404)
  "deepseek-v3": "openai/gpt-oss-20b:free",
  "deepseek-r1": "openai/gpt-oss-20b:free",   // was deepseek-r1-0528:free (404)
  "deepseek-r1-zero": "openai/gpt-oss-20b:free",
  "qwen": "openai/gpt-oss-20b:free",          // was qwen3-235b:free (404)
  "qwen3": "openai/gpt-oss-20b:free",
  "qwen-coder": "openai/gpt-oss-20b:free",    // was qwen3-coder:free (400 invalid)
  "mistral": "openai/gpt-oss-20b:free",       // was mistral-small-3.1:free (404)
  "mistral-small": "openai/gpt-oss-20b:free",
  "mistral-7b": "openai/gpt-oss-20b:free",
  "phi": "openai/gpt-oss-20b:free",           // was phi-4-reasoning:free (404)
  "nemotron": "openai/gpt-oss-20b:free",      // was nemotron-3-super:free (400 invalid)
  "step-flash": "openai/gpt-oss-20b:free",    // was step-3.5-flash:free (404)
  "trinity": "openai/gpt-oss-20b:free",       // was trinity-mini:free (404)

  // ── OpenRouter Paid — Claude ───────────────────────────────────────────
  "claude": "anthropic/claude-3.7-sonnet",
  "claude-sonnet": "anthropic/claude-3.7-sonnet",
  "claude-opus": "anthropic/claude-3.7-opus",
  "claude-haiku": "anthropic/claude-3.5-haiku",
  "claude-3.5": "anthropic/claude-3.5-sonnet",

  // ── OpenRouter Paid — OpenAI / GPT ────────────────────────────────────
  "gpt": "openai/gpt-4o",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-5": "openai/gpt-5.4",
  "gpt-5-mini": "openai/gpt-5.4-mini",
  "o3": "openai/o3",
  "o4-mini": "openai/o4-mini",

  // ── OpenRouter Paid — Llama paid ──────────────────────────────────────
  "llama-paid": "meta-llama/llama-4-maverick",
  "llama-3.3": "meta-llama/llama-3.3-70b-instruct",

  // ── OpenRouter Paid — Mistral ──────────────────────────────────────────
  "mistral-large": "mistralai/mistral-large",

  // ── OpenRouter Paid — Qwen ────────────────────────────────────────────
  "qwq": "qwen/qwq-32b",
  "qwen-paid": "qwen/qwen3-235b-a22b",

  // ── OpenRouter Paid — DeepSeek ────────────────────────────────────────
  "deepseek-paid": "deepseek/deepseek-chat-v3-0324",
  "deepseek-r1-paid": "deepseek/deepseek-r1",

  // ── Google models via OpenRouter ──────────────────────────────────────
  "gemini-or": "google/gemini-3-flash-preview",
  "gemini-pro-or": "google/gemini-2.5-pro",
};

function resolveModel(raw: string): string | null {
  const lower = raw.toLowerCase().trim();

  // Short aliases
  if (KNOWN_MODELS[lower]) return KNOWN_MODELS[lower];

  // Full Gemini model name (e.g. "gemini-2.0-flash")
  if (lower.startsWith("gemini-")) return lower;

  // Full OpenRouter model name (e.g. "anthropic/claude-3-haiku")
  // OpenRouter models always contain a "/" (provider/model format)
  if (lower.includes("/")) return lower;

  return null;
}

// ─── Command Definitions ──────────────────────────────────────────

export interface SlashCommandResult {
  /** True if the input was a slash command and was handled. */
  handled: boolean;
  /** The response to send back to the user (if handled). */
  response?: string;
}

/**
 * Attempt to parse and execute a slash command.
 *
 * @param text   Raw input from the user
 * @param chatId The chat ID for scoping session data
 * @returns SlashCommandResult — if handled is false, route to the LLM as normal
 */
/**
 * Plain-text keyword aliases → equivalent slash command.
 * Supports:
 *   - Exact single-word matches: "status" → /status
 *   - Multi-word phrases:  "show status" → /status
 *   - Prefix matching:     "model info" → /model
 *   - Common typos/variations: "heartbeat status" → /heartbeat
 *
 * Evaluated in order — first match wins. Longer phrases listed first
 * to avoid a shorter prefix stealing the match.
 */
const PLAIN_TEXT_ALIASES: [RegExp, string][] = [
  // Multi-word first (longer patterns before shorter)
  [/^show\s+(my\s+)?status$/i, "/status"],
  [/^check\s+(my\s+)?status$/i, "/status"],
  [/^show\s+(my\s+)?usage$/i, "/usage"],
  [/^check\s+(my\s+)?usage$/i, "/usage"],
  [/^token\s*usage$/i, "/usage"],
  [/^show\s+(my\s+)?model$/i, "/model"],
  [/^current\s+model$/i, "/model"],
  [/^which\s+model$/i, "/model"],
  [/^switch\s+model$/i, "/model"],
  [/^change\s+model$/i, "/model"],
  [/^model\s+info$/i, "/model"],
  [/^heartbeat\s*(status|info)?$/i, "/heartbeat"],
  [/^scheduler?\s*(status|info)?$/i, "/heartbeat"],
  [/^show\s+agents?$/i, "/agents"],
  [/^list\s+agents?$/i, "/agents"],
  [/^sub\s*agents?$/i, "/agents"],
  [/^show\s+(my\s+)?memories$/i, "/memories"],
  [/^list\s+(my\s+)?memories$/i, "/memories"],
  [/^core\s+memory$/i, "/memories"],
  [/^export\s+(my\s+)?memory$/i, "/export"],
  [/^export\s+memories$/i, "/export"],
  [/^memory\s+export$/i, "/export"],
  [/^show\s+(my\s+)?profile$/i, "/profile"],
  [/^my\s+profile$/i, "/profile"],
  [/^user\s+profile$/i, "/profile"],
  [/^show\s+skills?$/i, "/skills"],
  [/^auto\s+skills?$/i, "/skills"],
  [/^learned\s+skills?$/i, "/skills"],
  [/^show\s+(my\s+)?reminders?$/i, "/reminders"],
  [/^list\s+(my\s+)?reminders?$/i, "/reminders"],
  [/^pending\s+reminders?$/i, "/reminders"],
  [/^start\s+over$/i, "/new"],
  [/^new\s+(session|chat|conversation)$/i, "/new"],
  [/^clear\s+(history|chat|session)$/i, "/new"],
  [/^compact\s+(history|buffer|chat)$/i, "/compact"],
  [/^forget\s+all$/i, "/forget all"],
  [/^clear\s+(my\s+)?memor(y|ies)$/i, "/clear_memories"],
  [/^reset\s+memory$/i, "/clear_memories"],
  [/^wipe\s+(session|history|memory)$/i, "/clear_memories"],
  [/^show\s+help$/i, "/help"],
  [/^all\s+commands$/i, "/help"],

  // Single-word exact matches (fallback)
  [/^status$/i, "/status"],
  [/^stats$/i, "/status"],
  [/^usage$/i, "/usage"],
  [/^tokens?$/i, "/usage"],
  [/^help$/i, "/help"],
  [/^commands$/i, "/help"],
  [/^agents?$/i, "/agents"],
  [/^compact$/i, "/compact"],
  [/^new$/i, "/new"],
  [/^reset$/i, "/reset"],
  [/^clear$/i, "/new"],
  [/^model$/i, "/model"],
  [/^forget$/i, "/forget"],
  [/^memories$/i, "/memories"],
  [/^reminders?$/i, "/reminders"],
  [/^heartbeat$/i, "/heartbeat"],
  [/^schedule$/i, "/heartbeat"],
  [/^scheduler$/i, "/heartbeat"],
];

export async function handleSlashCommand(
  text: string,
  chatId: string,
): Promise<SlashCommandResult> {
  let trimmed = text.trim();

  // Plain-text alias check (regex-based, supports multi-word phrases)
  for (const [pattern, command] of PLAIN_TEXT_ALIASES) {
    if (pattern.test(trimmed)) {
      trimmed = command;
      break;
    }
  }

  // Slash commands must start with '/'
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  // Split on whitespace: ["/command", ...args]
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case "/start":
    case "/new":
    case "/reset":
      return handleNew(chatId);

    case "/status":
      return handleStatus(chatId);

    case "/usage":
      return handleUsage(chatId);

    case "/compact":
      return handleCompact(chatId);

    case "/model":
      return handleModel(chatId, args);

    case "/heartbeat":
      return handleHeartbeat();

    case "/heartbeat_set":
      return handleHeartbeatSet(args);

    case "/agents":
      return handleAgents();

    case "/pin":
      return handlePin(chatId, args);

    case "/help":
      return handleHelp();

    case "/forget":
      return handleForget(args);

    case "/memories":
      return handleMemories();

    case "/reminders":
      return handleReminders();

    case "/clear_memories":
      return handleClearMemories(chatId);

    case "/export":
      return handleExport(chatId);

    case "/profile":
      return handleProfile(args);

    case "/skills":
      return await handleSkills();

    case "/skill_feedback":
      return handleSkillFeedback(args);

    case "/skill_refine":
      return await handleSkillRefine(args);

    default:
      // Unknown slash command — let the LLM handle it naturally
      return { handled: false };
  }
}

// ─── Handlers ─────────────────────────────────────────────────────

async function handleStatus(chatId: string): Promise<SlashCommandResult> {
  const messageCount = await getMessageCount(chatId);
  const { getPendingReminderCount } = await import("../tools/set_reminder.js");
  const { getCoreMemoryCount } = await import("../memory/core.js");
  const reminderCount = getPendingReminderCount();
  const memoryCount = getCoreMemoryCount();
  const response = formatSessionStatus(chatId, messageCount, reminderCount, memoryCount);
  return { handled: true, response };
}

async function handleUsage(chatId: string): Promise<SlashCommandResult> {
  const response = formatUsageReport(chatId);
  return { handled: true, response };
}

async function handleNew(chatId: string): Promise<SlashCommandResult> {
  // Clear DB history + rolling summary
  await clearChatHistory(chatId);

  // Reset in-memory session stats
  resetSessionStats(chatId);

  // Reset model override
  clearModelOverride(chatId);

  const response = [
    "🆕 **New session started.**\n",
    "✅ Conversation history cleared",
    "✅ Session stats reset",
    "✅ Model override cleared",
    "",
    `Active model: \`${getEffectiveModel(chatId)}\``,
  ].join("\n");

  return { handled: true, response };
}

async function handleCompact(chatId: string): Promise<SlashCommandResult> {
  const response = await compactChatHistory(chatId);
  return { handled: true, response };
}

function handleModel(chatId: string, args: string[]): SlashCommandResult {
  const currentModel = getEffectiveModel(chatId);
  const defaultModel = ENV.GEMINI_MODEL;
  const override = sessionModelOverrides.get(chatId);
  const provider = getProviderName(currentModel);

  // /model — show current state
  if (args.length === 0) {
    const lines = [
      "🤖 **Model Info**\n",
      `🟢 **Active model:**   \`${currentModel}\``,
      `🔌 **Provider:**        ${provider}`,
      `⚙️  **Config default:**  \`${defaultModel}\``,
    ];

    if (override) {
      lines.push(`🔄 **Session override:** \`${override}\``);
    }

    lines.push(
      "",
      "**Gemini 3.1 (❌ hard 404 — redirects to nearest working):** `/model pro-3.1` | `/model flash-3.1` | `/model flash-lite-3.1`",
      "**Gemini 3 Flash (✅ verified):** `/model flash-3`",
      "**Gemini 2.5 (✅ default):** `/model flash` | `/model pro` | `/model flash-lite`",
      "**Gemini 2.5 (explicit):** `/model flash-2.5` | `/model pro-2.5` | `/model flash-lite-2.5`",
      "**Gemini 1.5 (legacy):** `/model pro-1.5` | `/model flash-1.5` | `/model flash-8b`",
      "",
      "**Free — Only working free OR model (✅):** `gpt-oss` (openai/gpt-oss-20b:free)",
      "**Free — Dead aliases → redirect to gpt-oss:** `llama` | `deepseek` | `qwen` | `mistral` | `phi` | `nemotron` | `trinity`",
      "",
      "**Paid — Claude:**    `claude` | `claude-opus` | `claude-haiku` | `claude-3.5`",
      "**Paid — GPT:**       `gpt` | `gpt-4o-mini` | `gpt-5` | `gpt-5-mini` | `o3` | `o4-mini`",
      "**Paid — Llama:**     `llama-paid` | `llama-3.3`",
      "**Paid — Other:**     `mistral-large` | `qwq` | `deepseek-paid` | `deepseek-r1-paid`",
      "",
      "**Any model:**        `/model provider/model-name` (e.g. `/model anthropic/claude-3.5-sonnet`)",
      "**Reset to default:** `/model reset`",
    );

    return { handled: true, response: lines.join("\n") };
  }

  // /model reset — remove override
  if (args[0].toLowerCase() === "reset") {
    clearModelOverride(chatId);
    return {
      handled: true,
      response: `✅ Model reset to default: \`${defaultModel}\``,
    };
  }

  // /model <name> — set override
  const resolved = resolveModel(args[0]);
  if (!resolved) {
    return {
      handled: true,
      response: [
        `❌ Unknown model: \`${args[0]}\`\n`,
        "**Gemini:**    `flash`, `flash-2.5`, `flash-2.0`, `flash-lite`, `pro`, `pro-3.1`, `pro-1.5`",
        "**Free OR:**   `llama`, `deepseek`, `deepseek-r1`, `qwen`, `mistral`, `phi`, `nemotron`",
        "**Paid OR:**   `claude`, `claude-opus`, `gpt`, `gpt-5`, `o3`, `mistral-large`, `qwq`",
        "**Full name:** e.g. `gemini-2.5-flash` or `anthropic/claude-3.7-sonnet`",
      ].join("\n"),
    };
  }

  const resolvedProvider = getProviderName(resolved);
  sessionModelOverrides.set(chatId, resolved);
  return {
    handled: true,
    response: `✅ Model switched to \`${resolved}\` (${resolvedProvider}) for this session.\n\n_Use \`/model reset\` to revert to the config default._`,
  };
}

function handleHeartbeat(): SlashCommandResult {
  const status = getHeartbeatStatus();
  return { handled: true, response: status };
}

function handleHeartbeatSet(args: string[]): SlashCommandResult {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "**Usage:** `/heartbeat_set HH:MM`",
        "Sets the morning check-in time (IST, 24-hour format).",
        "",
        "Example: `/heartbeat_set 09:00`",
        "Evening briefing time is set via `HEARTBEAT_EVENING_TIME` in your environment.",
      ].join("\n"),
    };
  }

  const timeArg = args[0];
  const timeMatch = timeArg.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return {
      handled: true,
      response: "Invalid format. Use HH:MM (24-hour IST). Example: `/heartbeat_set 09:00`",
    };
  }

  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return {
      handled: true,
      response: "Invalid time. Hour: 0\u201323, Minute: 0\u201359.",
    };
  }

  const updated = updateHeartbeatTime("Morning Check-in", hour, minute);
  if (updated) {
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return {
      handled: true,
      response: `\u2705 Morning check-in updated to **${timeStr} IST**.`,
    };
  } else {
    return {
      handled: true,
      response: "Could not find the Morning Check-in job. Is the heartbeat scheduler running?",
    };
  }
}

function handleHelp(): SlashCommandResult {
  const response = [
    "⚡ **SUNDAY Commands**\n",
    "**Memory**",
    "`/pin <text>`       — Save something to permanent core memory",
    "`/forget <key>`    — Remove a core memory entry (`/forget all` clears all)",
    "`/memories`        — View all pinned core memory entries",
    "`/export`          — Full dump of all memory tiers (profile + core + long-term)",
    "`/profile`         — View your auto-built user profile",
    "`/profile clear`   — Reset the user profile (rebuilds automatically)",
    "",
    "**Session**",
    "`/status`          — Uptime, token usage, memory stats",
    "`/usage`           — Focused token breakdown",
    "`/new`             — Start fresh (clear history, reset overrides)",
    "`/compact`         — Compress buffer into a rolling summary",
    "`/clear_memories`  — Clear session buffer + summary (core stays)",
    "`/model [name]`    — Show or switch model for this session",
    "",
    "**Heartbeat**",
    "`/heartbeat`       — Show scheduler status (morning + evening jobs)",
    "`/heartbeat_set`   — Change morning check-in time: `/heartbeat_set 09:00`",
    "`/reminders`       — View pending reminders",
    "",
    "**Agents & Skills**",
    "`/agents`          — List available sub-agents",
    "`/skills`          — List auto-generated skills SUNDAY has learned",
    "",
    "_Commands are handled locally and never sent to the LLM._",
  ].join("\n");

  return { handled: true, response };
}


async function handlePin(chatId: string, args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "📌 **Pin to Memory**\n",
        "Save anything to permanent core memory.\n",
        "**Usage:**",
        "`/pin <key> <value>` — Save with a specific key",
        "`/pin <value>`       — Auto-generate a key (pin_1, pin_2, ...)",
        "",
        "**Examples:**",
        "`/pin api_key My API key is in .env.local`",
        "`/pin Buy groceries on Sunday`",
      ].join("\n"),
    };
  }

  let key: string;
  let value: string;

  // If first arg looks like a key (no spaces, short), use it as the key
  if (args.length >= 2 && !args[0].includes(" ") && args[0].length <= 30) {
    key = `pin_${args[0]}`;
    value = args.slice(1).join(" ");
  } else {
    // Auto-generate key with timestamp
    key = `pin_${Date.now()}`;
    value = args.join(" ");
  }

  try {
    await setCoreMemory(key, value);
    return {
      handled: true,
      response: `📌 **Pinned to core memory.**\n\n🔑 \`${key}\`\n📝 ${value}`,
    };
  } catch (err) {
    return {
      handled: true,
      response: `❌ Failed to pin: ${String(err)}`,
    };
  }
}

function handleAgents(): SlashCommandResult {
  const agentLines: string[] = [];

  for (const profile of Object.values(PROFILES)) {
    // Pull the first meaningful description line from the system prompt
    const description = profile.systemPrompt
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("You are"))
      ?.trim() ?? "";

    const toolInfo = profile.allowedTools
      ? profile.allowedTools.join(", ")
      : profile.deniedTools
        ? `All tools except: ${profile.deniedTools.join(", ")}`
        : "All tools";

    agentLines.push(
      `${profile.icon} **${profile.label}** — \`${profile.name}\``,
      `> ${description}`,
      `> 🛠 ${toolInfo}`,
      `> ⚙️ temp \`${profile.temperature}\` · max \`${profile.maxIterations}\` iterations`,
      "",
    );
  }

  const response = [
    "🤖 **Sub-Agent Directory**\n",
    "SUNDAY automatically delegates to the right specialist.",
    "You don't need to invoke agents manually — just ask naturally.\n",
    "───────────────────────────",
    "",
    ...agentLines,
    "───────────────────────────",
    "",
    "**When to use each agent:**",
    "🔬 Research  → Deep dives, fact-checking, news, documentation",
    "💻 Code      → Write, review, debug, or explain code",
    "📋 Summary   → Condense articles, docs, or long content",
    "🎨 Creative  → Stories, poems, copy, or any creative writing",
    "📊 Analysis  → Compare options, spot patterns, make recommendations",
    "💼 Jobs      → Find real job listings via Apify (LinkedIn, Indeed, Naukri)",
    "",
    "_Tasks are matched to the best agent automatically._",
  ].join("\n");

  return { handled: true, response };
}

// ─── Memory & Reminders Commands ──────────────────────────────────

async function handleForget(args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "🗑 **Forget Memory**\n",
        "**Usage:**",
        "`/forget <key>`   — Remove one memory entry",
        "`/forget all`     — Wipe ALL core memories\n",
        "Use `/memories` to see your current keys.",
      ].join("\n"),
    };
  }

  const { deleteCoreMemory, getCoreMemory, clearAllCoreMemories, buildCoreMemoryPrompt } = await import("../memory/core.js");

  // /forget all — nuclear option
  if (args[0].toLowerCase() === "all") {
    await clearAllCoreMemories();
    return { handled: true, response: "🗑 All core memories cleared." };
  }

  // Join all args — supports keys with spaces
  const key = args.join(" ");

  if (!getCoreMemory(key)) {
    // Show available keys to help the user
    const memoriesStr = buildCoreMemoryPrompt();
    const keyHint = memoriesStr
      ? `\n\n**Available keys:**\n${memoriesStr.replace("## Core Memory (Always Active)\n", "")}`
      : "\n\nYour core memory is empty.";
    return { handled: true, response: `❌ No memory found with the key \`${key}\`.${keyHint}` };
  }

  await deleteCoreMemory(key);
  return { handled: true, response: `✅ Forgot memory: \`${key}\`` };
}

async function handleMemories(): Promise<SlashCommandResult> {
  const { buildCoreMemoryPrompt } = await import("../memory/core.js");
  const memoriesStr = buildCoreMemoryPrompt();

  if (!memoriesStr) {
    return { handled: true, response: "📭 Your core memory is completely empty.\n\nUse `/pin <key> <value>` to pin long-term traits, preferences, or goals." };
  }

  return { handled: true, response: `🧠 **Your Core Memory**\n\n${memoriesStr.replace("## Core Memory (Always Active)\n", "")}\n\n_Use \`/forget <key>\` to remove an item._` };
}

async function handleReminders(): Promise<SlashCommandResult> {
  const { listPendingReminders } = await import("../tools/set_reminder.js");
  const response = listPendingReminders();
  return { handled: true, response };
}

/**
 * Clear session-level memory (conversation buffer + rolling summary)
 * but preserve core memory (long-term identity & preferences).
 *
 * This is softer than /new — it doesn't reset stats or model override.
 */
async function handleClearMemories(chatId: string): Promise<SlashCommandResult> {
  const { clearChatHistory, getMessageCount } = await import("../memory/buffer.js");

  const countBefore = await getMessageCount(chatId);
  await clearChatHistory(chatId);

  return {
    handled: true,
    response: [
      "🧹 **Session Memory Cleared**\n",
      `Removed **${countBefore}** buffered messages and rolling summary.`,
      "",
      "✅ Core memories are **untouched** (use `/forget` to manage those).",
      "✅ Session stats and model override are **preserved**.",
      "",
      "_I'll start fresh context from your next message._",
    ].join("\n"),
  };
}

// ─── Export, Profile & Skills Commands ───────────────────────────

/**
 * /export — Produce a full, human-readable dump of all memory tiers.
 * Inspired by Hermes' transparent MEMORY.md + USER.md approach.
 *
 * Semantic facts are fetched by importance (no vector search needed
 * for a full dump — avoids the empty-query embedding problem).
 */
async function handleExport(chatId: string): Promise<SlashCommandResult> {
  const { buildCoreMemoryPrompt, getCoreMemory } = await import("../memory/core.js");
  const { getSupabase } = await import("../lib/supabase.js");

  const sections: string[] = ["📦 **Memory Export** — _SUNDAY Brain Snapshot_\n"];

  // ── User Profile ───────────────────────────────────────────────
  const profile = getUserProfile();
  if (profile) {
    sections.push("## 👤 User Profile\n" + profile);
  } else {
    sections.push("## 👤 User Profile\n_Not built yet — it auto-generates after ~5 messages._");
  }

  // ── Core Memories (KV) ─────────────────────────────────────────
  const coreBlock = buildCoreMemoryPrompt();
  if (coreBlock) {
    sections.push(coreBlock.replace("## Core Memory (Always Active)", "## 🧠 Core Memories (Always Active)"));
  } else {
    sections.push("## 🧠 Core Memories\n_Empty — use `/pin` to add permanent entries._");
  }

  // ── Rolling Summary (buffer compaction) ───────────────────────
  const rollingSummary = getCoreMemory(`rolling_summary_${chatId}`);
  if (rollingSummary) {
    sections.push("## 📜 Conversation Summary\n" + rollingSummary);
  }

  // ── Top Semantic Memories (direct DB query, no embedding needed) ──
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb
        .from("memories")
        .select("content, type, importance, category, created_at")
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);

      if (!error && data && data.length > 0) {
        const facts = data.map((row: {
          content: string;
          type: string;
          importance: number;
          category?: string;
          created_at?: string;
        }) => {
          const cat = row.category ? `[${row.category}]` : "";
          const ago = row.created_at ? formatTimeAgo(row.created_at) : "";
          return `• ${cat}[⭐${row.importance}]${ago ? ` (${ago})` : ""} ${row.content}`;
        });
        sections.push("## 💾 Long-Term Memories (Top 10 by Importance)\n" + facts.join("\n"));
      } else {
        sections.push("## 💾 Long-Term Memories\n_None stored yet — facts are extracted from your conversations._");
      }
    }
  } catch {
    // Supabase unavailable — skip silently
    sections.push("## 💾 Long-Term Memories\n_Unavailable (Supabase offline)._");
  }

  sections.push("_Use `/forget <key>` to remove core entries · `/profile clear` to reset profile · `/memories` for quick core view_");

  return { handled: true, response: sections.join("\n\n") };
}

/**
 * Format a timestamp into a human-readable "N ago" string (used by /export).
 */
function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

/**
 * /profile — View or clear the auto-built user profile.
 */
async function handleProfile(args: string[]): Promise<SlashCommandResult> {
  // /profile clear
  if (args[0]?.toLowerCase() === "clear") {
    await clearUserProfile();
    return {
      handled: true,
      response: "🗑 **User profile cleared.** It will rebuild automatically as you chat.",
    };
  }

  // /profile (view)
  const profile = getUserProfile();
  if (!profile || profile.trim().length === 0) {
    return {
      handled: true,
      response: [
        "👤 **User Profile**\n",
        "_No profile built yet._",
        "",
        "SUNDAY auto-builds your profile as you chat — it captures your preferences,",
        "expertise, timezone, active projects, and communication style.",
        "",
        "It updates every 5 messages in the background and is injected into every",
        "response so I always remember who you are.",
        "",
        "Use `/profile clear` to reset it.",
      ].join("\n"),
    };
  }

  return {
    handled: true,
    response: [
      "👤 **Your User Profile** _(auto-built by SUNDAY)_\n",
      profile,
      "",
      "_Updates automatically every 5 turns · `/profile clear` to reset_",
    ].join("\n"),
  };
}

/**
 * /skills — List auto-generated skills SUNDAY has learned from delegated tasks.
 */
async function handleSkills(): Promise<SlashCommandResult> {
  const skillsText = await listAutoSkills();
  return {
    handled: true,
    response: skillsText +
      "\n\n_💡 Rate skills with `/skill_feedback good|bad <slug>` · Refine with `/skill_refine <slug>`_",
  };
}

/**
 * /skill_feedback good|bad <slug> [optional reason]
 * Apply user feedback to a skill's effectiveness score.
 */
function handleSkillFeedback(args: string[]): SlashCommandResult {
  if (args.length < 2) {
    return {
      handled: true,
      response: [
        "📊 **Skill Feedback**\n",
        "Rate a skill to help SUNDAY improve its learning:\n",
        "**Usage:**",
        "`/skill_feedback good <slug>`  — Mark a skill as helpful (+2 effectiveness)",
        "`/skill_feedback bad <slug>`   — Mark a skill as unhelpful (−2 effectiveness)\n",
        "Use `/skills` to see skill slugs.",
      ].join("\n"),
    };
  }

  const signal = args[0].toLowerCase();
  if (signal !== "good" && signal !== "bad") {
    return {
      handled: true,
      response: "❌ Invalid signal. Use `good` or `bad`.\nExample: `/skill_feedback good research-assistant`",
    };
  }

  const slug = args[1].toLowerCase().replace(/\.md$/, "");
  const reason = args.slice(2).join(" ") || undefined;

  const result = applySkillFeedback({ slug, signal, reason });
  return { handled: true, response: result };
}

/**
 * /skill_refine <slug>
 * Trigger LLM-based refinement of a specific auto-generated skill.
 */
async function handleSkillRefine(args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: [
        "🔬 **Skill Refinement**\n",
        "Trigger LLM-based refinement to improve a skill's instructions.\n",
        "**Usage:** `/skill_refine <slug>`\n",
        "Use `/skills` to see skill slugs.",
      ].join("\n"),
    };
  }

  const slug = args[0].toLowerCase().replace(/\.md$/, "");
  const result = await manuallyRefineSkill(slug);
  return { handled: true, response: result };
}
