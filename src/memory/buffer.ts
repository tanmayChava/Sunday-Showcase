/**
 * Tier 2 — Conversation Buffer
 *
 * Keeps the last 20 messages verbatim per chat.
 * When buffer overflows, older messages are compacted into a rolling summary.
 * Summary retains decisions, commitments, and unresolved items.
 */

import { getSupabase } from "../lib/supabase.js";
import { setCoreMemory, deleteCoreMemory, getCoreMemory } from "./core.js";
import { routedChat } from "../lib/router.js";
import { ENV } from "../config.js";

const MAX_BUFFER_SIZE = 20;

interface BufferMessage {
  role: string;
  content: string;
  created_at: string;
}

/**
 * Save a message to the conversation buffer.
 */
export async function saveMessage(
  chatId: string,
  role: "user" | "model",
  content: string,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from("messages").insert({
      chat_id: chatId,
      role,
      content,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Buffer] Failed to save message:", error.message);
      return;
    }

    // Check if compaction is needed
    await maybeCompact(chatId);
  } catch (err) {
    console.error("[Buffer] Unexpected error:", err);
  }
}

/**
 * Get the most recent messages for a chat.
 */
export async function getRecentMessages(
  chatId: string,
): Promise<BufferMessage[]> {
  const sb = getSupabase();
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from("messages")
      .select("role, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(MAX_BUFFER_SIZE);

    if (error) {
      console.error("[Buffer] Failed to fetch messages:", error.message);
      return [];
    }

    // Reverse so oldest is first (chronological order)
    return (data || []).reverse();
  } catch (err) {
    console.error("[Buffer] Unexpected error:", err);
    return [];
  }
}

/**
 * Compact old messages into a rolling summary when buffer exceeds MAX_BUFFER_SIZE.
 * Preserves decisions, commitments, and unresolved items.
 */
async function maybeCompact(chatId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    // Count total messages for this chat
    const { count, error: countError } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId);

    if (countError || !count || count <= MAX_BUFFER_SIZE) {
      // Only compact when buffer exceeds limit
      return;
    }

    // Fetch the oldest messages that exceed the buffer
    const overflowCount = count - MAX_BUFFER_SIZE;
    const { data: oldMessages, error: fetchError } = await sb
      .from("messages")
      .select("id, role, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(overflowCount);

    if (fetchError || !oldMessages || oldMessages.length === 0) return;

    // Build text to summarize
    const transcript = oldMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Use LLM to create a structured rolling summary (provider-agnostic)
    const response = await routedChat({
      model: ENV.GEMINI_MODEL,
      messages: [
        {
          role: "user",
          content: `Summarize this conversation into a structured memory block. Use these sections (skip empty ones):

## Decisions Made
- ...

## Active Projects / Tasks
- ...

## Action Items & Commitments
- ...

## Key Context
- ...

Do NOT include greetings, small talk, or irrelevant chatter. Be concise but preserve all important details.

${transcript}`,
        },
      ],
      temperature: 0.3,
    });

    const summary = response.text?.trim() || "";

    if (!summary) {
      // LLM failed to produce a summary — do NOT delete messages (data loss prevention)
      console.warn("[Buffer] Compaction aborted: LLM returned empty summary. Messages preserved.");
      return;
    }

    // Save rolling summary to core memory FIRST (before deleting anything)
    await setCoreMemory(`rolling_summary_${chatId}`, summary);
    console.log(
      `[Buffer] Compacted ${oldMessages.length} messages into rolling summary.`,
    );

    // Only NOW delete the old messages (summary is safely persisted)
    const idsToDelete = oldMessages.map((m) => m.id);
    const { error: deleteError } = await sb
      .from("messages")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      console.error(
        "[Buffer] Failed to delete old messages:",
        deleteError.message,
      );
    }
  } catch (err) {
    console.error("[Buffer] Compaction error:", err);
  }
}

/**
 * Clear all conversation history for a chat.
 * Deletes all messages from the buffer and removes the rolling summary.
 */
export async function clearChatHistory(chatId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from("messages").delete().eq("chat_id", chatId);

    if (error) {
      console.error("[Buffer] Failed to clear history:", error.message);
    } else {
      console.log(`[Buffer] Cleared all messages for chat ${chatId}.`);
    }

    // Also delete the rolling summary from core memory
    await deleteCoreMemory(`rolling_summary_${chatId}`);
  } catch (err) {
    console.error("[Buffer] Clear history error:", err);
  }
}

/**
 * Get the total message count for a chat.
 * Used by /status to display buffer size.
 */
export async function getMessageCount(chatId: string): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;

  try {
    const { count, error } = await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("chat_id", chatId);

    if (error) {
      console.error("[Buffer] Failed to count messages:", error.message);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error("[Buffer] Message count error:", err);
    return 0;
  }
}

/**
 * Compact all chat history into a rolling summary on demand.
 * Unlike maybeCompact (which triggers automatically), this is user-invoked
 * via the /compact command. Summarizes ALL messages, merges with any existing
 * rolling summary, then clears the raw message buffer.
 *
 * @returns A status message describing what happened.
 */
export async function compactChatHistory(chatId: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) return "⚠️ Database unavailable — cannot compact.";

  try {
    // Fetch all messages for this chat
    const { data: allMessages, error: fetchError } = await sb
      .from("messages")
      .select("id, role, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });

    if (fetchError) {
      console.error("[Buffer] Failed to fetch messages for compaction:", fetchError.message);
      return "❌ Failed to fetch messages for compaction.";
    }

    if (!allMessages || allMessages.length === 0) {
      return "ℹ️ No messages to compact.";
    }

    // Build transcript from all messages
    const transcript = allMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Merge with any existing rolling summary
    const existingSummary = getCoreMemory(`rolling_summary_${chatId}`);
    const contextPrefix = existingSummary
      ? `Previous summary:\n${existingSummary}\n\nNew messages:\n`
      : "";

    const response = await routedChat({
      model: ENV.GEMINI_MODEL,
      messages: [
        {
          role: "user",
          content: `Summarize this conversation into a structured memory block. Use these sections (skip empty ones):

## Decisions Made
- ...

## Active Projects / Tasks
- ...

## Action Items & Commitments
- ...

## Key Context
- ...

Do NOT include greetings, small talk, or irrelevant chatter. Be concise but preserve all important details.

${contextPrefix}${transcript}`,
        },
      ],
      temperature: 0.3,
    });

    const summary = response.text?.trim() || "";

    if (!summary) {
      return "⚠️ Could not generate summary from messages.";
    }

    // Save the rolling summary to core memory
    await setCoreMemory(`rolling_summary_${chatId}`, summary);

    // Delete all raw messages from the buffer
    const idsToDelete = allMessages.map((m) => m.id);
    const { error: deleteError } = await sb
      .from("messages")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      console.error("[Buffer] Failed to delete messages after compaction:", deleteError.message);
      return `⚠️ Summary saved but failed to clear ${allMessages.length} messages.`;
    }

    console.log(
      `[Buffer] Compacted ${allMessages.length} messages into rolling summary (manual).`,
    );

    return `✅ Compacted **${allMessages.length} messages** into a summary.\n\nThe conversation context has been preserved in condensed form. Future requests will use fewer tokens.`;
  } catch (err) {
    console.error("[Buffer] Manual compaction error:", err);
    return "❌ Compaction failed. Check logs for details.";
  }
}
