/**
 * Heartbeat Jobs — Define all scheduled proactive messages here.
 *
 * Each job runs at a specific IST time and sends a message
 * to the user's Telegram chat.
 */

import { Bot } from "grammy";
import { routedChat } from "../lib/router.js";
import { executeWebSearch } from "../tools/web_search.js";
import { executeSerperSearch } from "../tools/serper_search.js";
import { ENV } from "../config.js";
import { getRuntimeConfig } from "../lib/config-sync.js";
import { buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
import { saveMessage } from "../memory/buffer.js";
import { HeartbeatJob } from "./scheduler.js";

/**
 * Morning Check-in — Configurable via HEARTBEAT_MORNING_TIME env var
 * Default: 08:00 IST
 *
 * 1. Fetches today's global news
 * 2. Checks core memory for context (past goals, preferences)
 * 3. Generates a personalized morning message
 * 4. Asks "What is the biggest goal you want to achieve today?"
 */
async function morningCheckin(bot: Bot, chatId: string): Promise<void> {
  console.log("[Heartbeat] Running morning check-in...");

  // 1. Fetch global news
  let newsContext = "";
  try {
    // Prefer Serper (Google) for news links, fall back to Tavily
    const searchFn = ENV.SERPER_API_KEY
      ? executeSerperSearch
      : executeWebSearch;
    newsContext = await searchFn(
      "top global news headlines today " +
      new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
    );
  } catch (err) {
    console.error("[Heartbeat] News fetch failed:", err);
    newsContext = "Unable to fetch news today.";
  }

  // 2. Load core memory for personalization
  const coreMemory = buildCoreMemoryPrompt();
  const previousGoal = getCoreMemory("last_daily_goal");

  // 3. Generate morning message via LLM (provider-agnostic)
  const prompt = `You are SUNDAY (Superior Universal Neural Digital Assistant Yield), a sharp personal AI assistant. Generate a concise morning check-in message for your user.

${coreMemory ? `## What you know about the user:\n${coreMemory}\n` : ""}
${previousGoal ? `## Their last stated goal:\n${previousGoal}\n` : ""}

## Today's Global News Summary:
${newsContext}

## Instructions:
1. Start with a brief, energetic greeting (1 line)
2. Give a concise summary of 3-5 most important global news items (bullet points, 1 line each)
3. If they had a previous goal, briefly ask about it
4. End by asking: "What is the biggest goal you want to achieve today?"

Keep it SHORT and punchy. No fluff, no filler. Total message should be under 300 words.`;

  try {
    const response = await routedChat({
      model: getRuntimeConfig().primaryModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const message =
      response.text?.trim() || "Good morning! What's your biggest goal today?";

    await bot.api.sendMessage(chatId, message);
    // Save to conversation buffer so bot has context when user replies
    await saveMessage(chatId, "model", message);
    console.log("[Heartbeat] Morning check-in sent successfully.");
  } catch (err) {
    console.error("[Heartbeat] Failed to send morning check-in:", err);

    // Fallback: Send a simple message if AI fails
    try {
      await bot.api.sendMessage(
        chatId,
        "☀️ Good morning! What is the biggest goal you want to achieve today?",
      );
    } catch {
      console.error("[Heartbeat] Even fallback message failed.");
    }
  }
}

/**
 * Parse the HEARTBEAT_MORNING_TIME env var (format: "HH:MM").
 * Falls back to 08:00 if not set or malformed.
 */
function parseMorningTime(): { hour: number; minute: number } {
  const raw = process.env.HEARTBEAT_MORNING_TIME || "08:00";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    console.warn(`[Heartbeat] Invalid HEARTBEAT_MORNING_TIME="${raw}" — using 08:00`);
    return { hour: 8, minute: 0 };
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`[Heartbeat] HEARTBEAT_MORNING_TIME out of range — using 08:00`);
    return { hour: 8, minute: 0 };
  }
  return { hour, minute };
}

const morningTime = parseMorningTime();

/**
 * All heartbeat jobs.
 */
export const heartbeatJobs: HeartbeatJob[] = [
  {
    name: "Morning Check-in",
    hour: morningTime.hour,
    minute: morningTime.minute,
    execute: morningCheckin,
  },
];
