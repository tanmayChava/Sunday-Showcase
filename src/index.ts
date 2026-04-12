import { TelegramChannel } from "./channels/telegram.js";

import { ENV } from "./config.js";
import { loadCoreMemories } from "./memory/core.js";
import { isSupabaseReady } from "./lib/supabase.js";
import { initConfigSync } from "./lib/config-sync.js";
import { initSkillsSystem } from "./skills/loader.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat/scheduler.js";
import { heartbeatJobs } from "./heartbeat/jobs.js";
import type { IncomingMessage, Channel } from "./channels/types.js";
import { runAgentLoop, runAgentLoopWithImage } from "./agent/loop.js";
import { mcpManager } from "./mcp/mcp-manager.js";
import { handleSlashCommand, getEffectiveModel } from "./commands/slash-commands.js";
import { getProviderName } from "./lib/router.js";
import { startWebhookServer, stopWebhookServer } from "./channels/webhook.js";
import { restoreReminders } from "./tools/set_reminder.js";

console.log("============== SUNDAY — Superior Universal Neural Digital Assistant Yield ==============");
console.log("Initializing secure local environment...");
console.log(`Allowed Users: ${Array.from(ENV.ALLOWED_USER_IDS).join(", ")}`);

// ─── Friendly Model Name Map ──────────────────────────────────────

const FRIENDLY_NAMES: Record<string, string> = {
  // Gemini
  "gemini-3-flash-preview": "Gemini 3 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.0-flash-lite": "Gemini 2.0 Flash Lite",
  "gemini-1.5-pro": "Gemini 1.5 Pro",
  "gemini-1.5-flash": "Gemini 1.5 Flash",
  "gemini-1.5-flash-8b": "Gemini 1.5 Flash 8B",
  // Claude
  "anthropic/claude-3.7-sonnet": "Claude 3.7 Sonnet",
  "anthropic/claude-3.7-opus": "Claude 3.7 Opus",
  "anthropic/claude-3.5-haiku": "Claude 3.5 Haiku",
  "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet",
  // GPT
  "openai/gpt-4o": "GPT-4o",
  "openai/gpt-4o-mini": "GPT-4o Mini",
  "openai/gpt-5.4": "GPT-5",
  "openai/gpt-5.4-mini": "GPT-5 Mini",
  "openai/o3": "o3",
  "openai/o4-mini": "o4 Mini",
  // Llama
  "meta-llama/llama-4-maverick:free": "Llama 4 Maverick (free)",
  "meta-llama/llama-4-scout:free": "Llama 4 Scout (free)",
  "meta-llama/llama-4-maverick": "Llama 4 Maverick",
  // DeepSeek
  "deepseek/deepseek-chat-v3-0324:free": "DeepSeek V3 (free)",
  "deepseek/deepseek-r1-0528:free": "DeepSeek R1 (free)",
  "deepseek/deepseek-r1-zero:free": "DeepSeek R1 Zero (free)",
  // Qwen
  "qwen/qwen3-235b-a22b:free": "Qwen 3 235B (free)",
  "qwen/qwen3-coder-480b-a35b:free": "Qwen 3 Coder (free)",
  // Mistral
  "mistralai/mistral-small-3.1-24b-instruct:free": "Mistral Small 3.1 (free)",
  "mistralai/mistral-7b-instruct:free": "Mistral 7B (free)",
  "mistralai/mistral-large": "Mistral Large",
  // Other
  "microsoft/phi-4-reasoning-plus:free": "Phi-4 Reasoning+ (free)",
  "nvidia/nemotron-3-super:free": "Nemotron 3 Super (free)",
};

/**
 * Convert a raw model ID into a human-friendly display name.
 * Falls back to a cleaned-up version of the raw ID if not in the map.
 */
function prettifyModelName(model: string): string {
  // Check exact match first
  if (FRIENDLY_NAMES[model]) return FRIENDLY_NAMES[model];

  // Fallback: strip provider prefix and clean up
  const name = model.includes("/") ? model.split("/").pop()! : model;
  return name
    .replace(/:free$/, " (free)")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Initialize memory system before starting the bot
async function start() {
  // Check Supabase connection
  const supabaseOk = await isSupabaseReady();
  if (supabaseOk) {
    console.log("[Memory] Supabase connected — all 3 memory tiers active.");
    await loadCoreMemories();
    // Load live config from bot_config table + sync agent profiles
    await initConfigSync();
    // Initialize skills system with Supabase hot-reload
    await initSkillsSystem("skills");
  } else {
    console.warn(
      "[Memory] Supabase unavailable — running without persistent memory.",
    );
  }

  // Initialize MCP servers (loads mcp.json)
  await mcpManager.init();

  // Shared message handler for all channels
  const messageHandler = async (msg: IncomingMessage): Promise<string> => {
    // ── Slash command interception (zero token cost) ──────────────
    if (msg.text) {
      const slashResult = await handleSlashCommand(msg.text, msg.chatId);
      if (slashResult.handled) {
        return slashResult.response ?? "";
        // Note: no model footer on slash commands — they're local, no LLM used
      }
    }

    // ── LLM response path ────────────────────────────────────────
    let response: string;
    if (msg.imageBase64 && msg.imageMimeType) {
      response = await runAgentLoopWithImage(
        msg.text || "What's in this image? Describe and analyze it.",
        msg.chatId,
        msg.imageBase64,
        msg.imageMimeType,
      );
    } else {
      response = await runAgentLoop(msg.text || "", msg.chatId);
    }

    // ── Optional model footer ─────────────────────────────────────
    // Set SHOW_MODEL_FOOTER=false in .env to disable
    if (ENV.SHOW_MODEL_FOOTER && response && !response.startsWith("Error:")) {
      const model = getEffectiveModel(msg.chatId);
      const provider = getProviderName(model);
      const displayModel = prettifyModelName(model);
      response = `${response}\n\n\`✦ ${displayModel} · ${provider}\``;
    }

    return response;
  };

  // Track active channels for shutdown
  const activeChannels: Channel[] = [];

  // ── Telegram Channel ───────────────────────────────────────────
  if (ENV.TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel();
    telegram.onMessage(messageHandler);
    await telegram.start();
    activeChannels.push(telegram);

    // Start heartbeat scheduler after Telegram is connected
    if (ENV.HEARTBEAT_CHAT_ID) {
      startHeartbeat(telegram.getBot(), ENV.HEARTBEAT_CHAT_ID, heartbeatJobs);
    } else {
      console.warn(
        "[Heartbeat] No HEARTBEAT_CHAT_ID set — scheduler disabled.",
      );
    }

    // Start webhook server if configured
    if (ENV.WEBHOOK_SECRET && ENV.HEARTBEAT_CHAT_ID) {
      startWebhookServer({
        port: ENV.WEBHOOK_PORT,
        token: ENV.WEBHOOK_SECRET,
        chatId: ENV.HEARTBEAT_CHAT_ID,
        bot: telegram.getBot(),
      });
    } else if (ENV.WEBHOOK_SECRET && !ENV.HEARTBEAT_CHAT_ID) {
      console.warn(
        "[Webhook] WEBHOOK_SECRET set but no HEARTBEAT_CHAT_ID — webhook disabled.",
      );
    }
  }

  // Restore pending reminders from Supabase (must happen after channel init)
  await restoreReminders();

  if (activeChannels.length === 0) {
    throw new Error("No channels started — check your .env for bot tokens.");
  }

  console.log(
    `[Channels] Active: ${activeChannels.map((c) => c.name).join(", ")}`,
  );
  console.log("==========================================");

  // Graceful shutdown handlers
  const shutdown = () => {
    console.log("🔴 SUNDAY shutdown signal received — cleaning up...");
    stopHeartbeat();
    stopWebhookServer();
    mcpManager.shutdown().catch(() => { });
    for (const channel of activeChannels) {
      channel.stop();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("[Fatal] Failed to start:", err);
  process.exit(1);
});
