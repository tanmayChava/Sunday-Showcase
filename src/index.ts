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
import { runDeprecationSweep } from "./skills/feedback.js";
import { getEmbeddingProvider, getEmbeddingDimensions } from "./lib/embeddings.js";
import { prettifyModelName } from "./lib/model-names.js";

console.log("============== SUNDAY — Superior Universal Neural Digital Assistant Yield ==============");
console.log("Initializing secure local environment...");
console.log(`Allowed Users: ${Array.from(ENV.ALLOWED_USER_IDS).join(", ")}`);

// ─── Startup ─────────────────────────────────────────────────────

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

    // Run deprecation sweep on startup (4.6 — disables zero-use old skills)
    runDeprecationSweep();
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

  // Log embedding provider info (4.5)
  console.log(`[Embeddings] Provider: ${getEmbeddingProvider()} · Dimensions: ${getEmbeddingDimensions()}`);

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
