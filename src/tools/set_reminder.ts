/**
 * set_reminder tool — Schedule a one-time reminder.
 *
 * Reminders are persisted to Supabase so they survive bot restarts.
 * On startup, call `restoreReminders()` to reload and reschedule
 * any pending reminders from the database.
 *
 * Table: reminders
 *   id         uuid primary key default gen_random_uuid()
 *   chat_id    text not null
 *   message    text not null
 *   fire_at    timestamptz not null
 *   fired      boolean default false
 *   created_at timestamptz default now()
 */

import { Type, Tool } from "@google/genai";
import { getSupabase } from "../lib/supabase.js";

export const setReminderDefinition: Tool = {
  functionDeclarations: [
    {
      name: "set_reminder",
      description:
        "Set a one-time reminder that will be sent to the user after a specified number of minutes. Use this when the user asks to be reminded about something later. The reminder message will be sent directly to the chat.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          message: {
            type: Type.STRING,
            description:
              "The reminder message to send (e.g. 'Time to drink water!')",
          },
          minutes: {
            type: Type.NUMBER,
            description:
              "Number of minutes from now to send the reminder (e.g. 30)",
          },
        },
        required: ["message", "minutes"],
      },
    },
  ],
};

// ─── Callback ─────────────────────────────────────────────────────

type ReminderSendFn = (chatId: string, message: string) => Promise<void>;

let sendCallback: ReminderSendFn | null = null;

/**
 * Register the send callback. Must be called once during bot initialization.
 */
export function initReminderCallback(fn: ReminderSendFn): void {
  sendCallback = fn;
  console.log("[Reminder] Callback registered.");
}

// ─── In-memory tracking ───────────────────────────────────────────

interface PendingReminder {
  id: string;
  chatId: string;
  message: string;
  fireAt: Date;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingReminder>();

/** Return the number of currently pending reminders. */
export function getPendingReminderCount(): number {
  return pending.size;
}

// ─── Helpers ─────────────────────────────────────────────────────

function scheduleTimer(
  id: string,
  chatId: string,
  message: string,
  fireAt: Date,
): void {
  const delayMs = Math.max(0, fireAt.getTime() - Date.now());

  const timer = setTimeout(async () => {
    pending.delete(id);
    // Mark as fired in DB
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("reminders").update({ fired: true }).eq("id", id);
      if (error) console.error("[Reminder] Failed to mark fired in DB:", error.message);
    }

    if (!sendCallback) return;
    try {
      await sendCallback(chatId, `⏰ **Reminder:** ${message}`);
      console.log(`[Reminder] Fired: "${message}" → chat ${chatId}`);
    } catch (err) {
      console.error(`[Reminder] Failed to send:`, err);
    }
  }, delayMs);

  pending.set(id, { id, chatId, message, fireAt, timer });
}

// ─── Restore on startup ───────────────────────────────────────────

/**
 * Load all unfired reminders from Supabase and reschedule them.
 * Call this once at startup — AFTER initReminderCallback().
 */
export async function restoreReminders(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    // Fetch ALL unfired reminders — including ones that fired while we were offline
    const { data, error } = await sb
      .from("reminders")
      .select("id, chat_id, message, fire_at")
      .eq("fired", false);

    if (error) {
      // Table may not exist yet — that's fine
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        console.log("[Reminder] 'reminders' table not found — skipping restore. Create it to enable persistence.");
      } else {
        console.warn("[Reminder] Failed to restore reminders:", error.message);
      }
      return;
    }

    if (!data || data.length === 0) {
      console.log("[Reminder] No pending reminders to restore.");
      return;
    }

    const now = new Date();
    let upcoming = 0;
    let missed = 0;

    for (const row of data) {
      const fireAt = new Date(row.fire_at);

      if (fireAt <= now) {
        // Missed while bot was offline — fire immediately with a note
        missed++;
        const id = row.id;
        const chatId = row.chat_id;
        const message = row.message;

        // Mark as fired in DB then deliver
        sb.from("reminders").update({ fired: true }).eq("id", id)
          .then(({ error: e }) => {
            if (e) console.error("[Reminder] Failed to mark missed reminder fired:", e.message);
          });

        // Deliver after a short stagger so bot is fully ready
        setTimeout(async () => {
          if (!sendCallback) return;
          try {
            await sendCallback(chatId, `⏰ **Missed Reminder** _(delivered late — bot was offline)_:\n${message}`);
            console.log(`[Reminder] Delivered missed reminder: "${message}" → chat ${chatId}`);
          } catch (err) {
            console.error(`[Reminder] Failed to deliver missed reminder:`, err);
          }
        }, 3000 + missed * 500); // stagger by 500 ms each
      } else {
        // Future reminder — schedule normally
        upcoming++;
        scheduleTimer(row.id, row.chat_id, row.message, fireAt);
      }
    }

    console.log(`[Reminder] ✅ Restored ${upcoming} upcoming + ${missed} missed reminder(s).`);
  } catch (err) {
    console.error("[Reminder] Unexpected restore error:", err);
  }
}

// ─── Execute ─────────────────────────────────────────────────────

/**
 * Execute the set_reminder tool.
 */
export async function executeSetReminder(
  args: { message: string; minutes: number },
  chatId: string,
): Promise<string> {
  if (!sendCallback) {
    return "Error: Reminder system is not initialized.";
  }

  const { message, minutes } = args;

  if (!message || message.trim().length === 0) {
    return "Error: Reminder message cannot be empty.";
  }

  if (!minutes || minutes <= 0) {
    return "Error: Minutes must be a positive number.";
  }

  if (minutes > 1440) {
    return "Error: Reminders can be set for up to 24 hours (1440 minutes). For longer durations, ask me to set it again later.";
  }

  const fireAt = new Date(Date.now() + Math.round(minutes * 60 * 1000));
  const fireAtStr = fireAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    timeStyle: "short",
    dateStyle: "short",
  });

  // ── Persist to Supabase ──────────────────────────────────────
  const sb = getSupabase();
  let reminderId = crypto.randomUUID();

  if (sb) {
    try {
      const { data, error } = await sb
        .from("reminders")
        .insert({
          chat_id: chatId,
          message,
          fire_at: fireAt.toISOString(),
          fired: false,
        })
        .select("id")
        .single();

      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          console.warn("[Reminder] 'reminders' table not found — reminder will not survive restarts.");
        } else {
          console.error("[Reminder] Failed to persist:", error.message);
        }
      } else if (data?.id) {
        reminderId = data.id;
      }
    } catch (err) {
      console.error("[Reminder] Persist error:", err);
    }
  }

  // ── Schedule in-process timer ────────────────────────────────
  scheduleTimer(reminderId, chatId, message, fireAt);

  console.log(
    `[Reminder] Scheduled "${message}" at ${fireAt.toISOString()} for chat ${chatId}`,
  );
  return `Reminder set! I'll remind you "${message}" at ${fireAtStr} (in ${minutes} minute${minutes === 1 ? "" : "s"}).`;
}

// ─── List pending reminders ───────────────────────────────────────

/**
 * Return a formatted list of all pending (in-process) reminders.
 * Used by the /reminders slash command.
 */
export function listPendingReminders(): string {
  if (pending.size === 0) {
    return "No pending reminders. Set one by asking me: \"Remind me to [task] in [X] minutes.\"";
  }

  const now = Date.now();
  const lines: string[] = ["⏰ **Pending Reminders**\n"];

  const sorted = Array.from(pending.values()).sort(
    (a, b) => a.fireAt.getTime() - b.fireAt.getTime(),
  );

  for (const r of sorted) {
    const fireAtStr = r.fireAt.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      timeStyle: "short",
      dateStyle: "short",
    });
    const minsLeft = Math.ceil((r.fireAt.getTime() - now) / 60000);
    const timeLeft = minsLeft < 60
      ? `${minsLeft}m`
      : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`;

    lines.push(`• "${r.message}"\n  🕐 ${fireAtStr} (in ${timeLeft})`);
  }

  return lines.join("\n");
}
