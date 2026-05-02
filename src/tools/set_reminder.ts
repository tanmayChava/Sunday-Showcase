/**
 * set_reminder tool — Natural Language Schedule + Recurring Cron Support (Feature 4.4)
 *
 * Reminders are persisted to Supabase so they survive bot restarts.
 * On startup, call `restoreReminders()` to reload and reschedule
 * any pending reminders from the database.
 *
 * Supports both one-time and recurring reminders via natural language:
 *   - "in 30 minutes"
 *   - "tomorrow at 9am"
 *   - "every Monday at 10:00"
 *   - "every day at 8:30am"
 *   - "at 6pm"
 *   Falls back to legacy `minutes` param if `when` is omitted.
 *
 * Table: reminders
 *   id            uuid primary key default gen_random_uuid()
 *   chat_id       text not null
 *   message       text not null
 *   fire_at       timestamptz not null          (next fire time)
 *   fired         boolean default false
 *   is_recurring  boolean default false
 *   cron_expr     text                          (null for one-off)
 *   schedule_desc text                          (human-readable)
 *   created_at    timestamptz default now()
 */

import { Type, Tool } from "@google/genai";
import { getSupabase } from "../lib/supabase.js";
import { parseNaturalSchedule, scheduleToMinutes } from "./nl-scheduler.js";

export const setReminderDefinition: Tool = {
  functionDeclarations: [
    {
      name: "set_reminder",
      description:
        "Set a reminder for the user. Supports natural language scheduling: " +
        "'in 30 minutes', 'tomorrow at 9am', 'on Monday at 10:00', " +
        "'every day at 8:30am', 'every weekday at 9am', 'every Monday at 10'. " +
        "Use `when` for natural language expressions. Use `minutes` only as a fallback " +
        "when the user says something like 'remind me in X minutes'. " +
        "Recurring reminders (every day / every week etc.) are supported.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          message: {
            type: Type.STRING,
            description:
              "The reminder message to send (e.g. 'Time to drink water!')",
          },
          when: {
            type: Type.STRING,
            description:
              "Natural language schedule: 'in 30 minutes', 'tomorrow at 9am', " +
              "'every day at 8am', 'on Monday at 10:00', 'next Friday at 3pm'. " +
              "Preferred over `minutes` for all cases except plain 'in X minutes'.",
          },
          minutes: {
            type: Type.NUMBER,
            description:
              "Fallback: Number of minutes from now (only use when `when` can't express it).",
          },
        },
        required: ["message"],
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
  isRecurring: boolean;
  cronExpression: string | null;
  scheduleDesc: string;
}

const pending = new Map<string, PendingReminder>();

/** Return the number of currently pending reminders. */
export function getPendingReminderCount(): number {
  return pending.size;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Parse a cron expression and compute the next UTC fire Date.
 * Simple implementation for: "M H * * DOW" and "M H * * *" patterns.
 * For full cron support a library like `cron-parser` is recommended;
 * this handles the patterns produced by nl-scheduler.ts.
 */
function nextCronFire(cronExpr: string): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(Date.now() + 60_000);

  const [minPart, hourPart, , , dowPart] = parts;
  const now = new Date();
  const utcHour = parseInt(hourPart, 10);
  const utcMin = parseInt(minPart, 10);

  // Allowed days of week (0=Sun..6=Sat, * = all)
  let allowedDows: Set<number>;
  if (dowPart === "*") {
    allowedDows = new Set([0, 1, 2, 3, 4, 5, 6]);
  } else if (dowPart.includes("-")) {
    const [lo, hi] = dowPart.split("-").map(Number);
    allowedDows = new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
  } else if (dowPart.includes(",")) {
    allowedDows = new Set(dowPart.split(",").map(Number));
  } else {
    allowedDows = new Set([parseInt(dowPart, 10)]);
  }

  // Handle "*/N" minute patterns (e.g. "*/30 * * * *")
  // MED-05 Fix: the original calculation mixed UTC timestamp arithmetic with
  // getMinutes()/getSeconds() local field reads, producing wrong results when
  // now.getUTCMinutes() > interval. The correct approach: compute the total
  // minutes elapsed today (UTC), find the next N-aligned minute, then build
  // a clean Date from year/month/day + that aligned minute.
  if (minPart.startsWith("*/")) {
    const interval = parseInt(minPart.slice(2), 10);
    if (!Number.isFinite(interval) || interval <= 0) return new Date(Date.now() + 60_000);

    const todayMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    // Round up to the next exact interval boundary (never fire "now")
    const nextAlignedMinute = Math.ceil((todayMinutes + 1) / interval) * interval;

    const nextDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));
    nextDate.setUTCMinutes(nextAlignedMinute, 0, 0); // handles overnight rollover automatically
    return nextDate;
  }

  // Handle "0 * * * *" (every hour at minute 0)
  if (hourPart === "*") {
    const candidate = new Date(now);
    candidate.setUTCSeconds(0, 0);
    candidate.setUTCMinutes(utcMin);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setUTCHours(candidate.getUTCHours() + 1);
    }
    return candidate;
  }

  // Standard: find next day matching DOW with the given HH:MM UTC
  for (let d = 0; d <= 7; d++) {
    const candidate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, utcHour, utcMin, 0, 0),
    );
    if (candidate.getTime() <= now.getTime()) continue;
    if (allowedDows.has(candidate.getUTCDay())) return candidate;
  }

  // Fallback: next day at the specified time
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, utcHour, utcMin));
}

function scheduleTimer(
  id: string,
  chatId: string,
  message: string,
  fireAt: Date,
  isRecurring: boolean = false,
  cronExpression: string | null = null,
  scheduleDesc: string = "",
): void {
  const delayMs = Math.max(0, fireAt.getTime() - Date.now());

  const timer = setTimeout(async () => {
    pending.delete(id);
    const sb = getSupabase();

    if (isRecurring && cronExpression) {
      // ── Recurring: update next fire_at in DB FIRST, then reschedule ──
      // Updating before re-scheduling means if the bot crashes during send,
      // restoreReminders() will load the NEXT fire time, not the already-fired one.
      const nextFire = nextCronFire(cronExpression);
      console.log(`[Reminder] Recurring "${message}" — next fire at ${nextFire.toISOString()}`);

      if (sb) {
        const { error } = await sb
          .from("reminders")
          .update({ fire_at: nextFire.toISOString() })
          .eq("id", id);
        if (error) console.error("[Reminder] Failed to update recurring fire_at:", error.message);
      }
      scheduleTimer(id, chatId, message, nextFire, true, cronExpression, scheduleDesc);
    } else {
      // ── One-off: mark fired BEFORE sending Telegram message ──
      // If the bot crashes between the DB write and the send, the reminder
      // will NOT be re-delivered on next restart. A missed delivery is
      // preferable to a duplicate (which is confusing and annoying).
      if (sb) {
        const { error } = await sb
          .from("reminders")
          .update({ fired: true, fired_at: new Date().toISOString() })
          .eq("id", id);
        if (error) {
          // Log but continue — still send even if DB write failed
          console.error("[Reminder] Failed to mark fired in DB:", error.message);
        }
      }
    }

    if (!sendCallback) return;
    try {
      const recurringNote = isRecurring ? ` _(recurring: ${scheduleDesc})_` : "";
      await sendCallback(chatId, `⏰ **Reminder:** ${message}${recurringNote}`);
      console.log(`[Reminder] Fired: "${message}" → chat ${chatId}`);
    } catch (err) {
      console.error(`[Reminder] Failed to send:`, err);
    }
  }, delayMs);

  pending.set(id, { id, chatId, message, fireAt, timer, isRecurring, cronExpression, scheduleDesc });
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
    const { data, error } = await sb
      .from("reminders")
      .select("id, chat_id, message, fire_at, is_recurring, cron_expr, schedule_desc")
      .eq("fired", false);

    if (error) {
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
      const isRecurring = row.is_recurring ?? false;
      const cronExpr = row.cron_expr ?? null;
      const scheduleDesc = row.schedule_desc ?? "";

      if (fireAt <= now) {
        missed++;
        const { id, chat_id: chatId, message } = row;

        if (isRecurring && cronExpr) {
          // Missed recurring — compute next and reschedule
          const nextFire = nextCronFire(cronExpr);
          sb.from("reminders").update({ fire_at: nextFire.toISOString() }).eq("id", id)
            .then(({ error: e }) => {
              if (e) console.error("[Reminder] Failed to update recurring reminder:", e.message);
            });
          scheduleTimer(id, chatId, message, nextFire, true, cronExpr, scheduleDesc);
        } else {
          // Missed one-off — fire immediately with a note
          sb.from("reminders").update({ fired: true }).eq("id", id)
            .then(({ error: e }) => {
              if (e) console.error("[Reminder] Failed to mark missed reminder fired:", e.message);
            });

          setTimeout(async () => {
            if (!sendCallback) return;
            try {
              await sendCallback(chatId, `⏰ **Missed Reminder** _(delivered late — bot was offline)_:\n${message}`);
              console.log(`[Reminder] Delivered missed reminder: "${message}" → chat ${chatId}`);
            } catch (err) {
              console.error(`[Reminder] Failed to deliver missed reminder:`, err);
            }
          }, 3000 + missed * 500);
        }
      } else {
        upcoming++;
        scheduleTimer(row.id, row.chat_id, row.message, fireAt, isRecurring, cronExpr, scheduleDesc);
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
  args: { message: string; when?: string; minutes?: number },
  chatId: string,
): Promise<string> {
  if (!sendCallback) {
    return "Error: Reminder system is not initialized.";
  }

  const { message, when, minutes } = args;

  if (!message || message.trim().length === 0) {
    return "Error: Reminder message cannot be empty.";
  }

  // ── Parse schedule ────────────────────────────────────────────
  let fireAt: Date;
  let isRecurring = false;
  let cronExpression: string | null = null;
  let scheduleDesc = "";

  if (when) {
    // Natural language scheduling
    const schedule = parseNaturalSchedule(when);

    if (!schedule) {
      // LLM gave a `when` we couldn't parse — try falling back to minutes
      if (minutes && minutes > 0) {
        fireAt = new Date(Date.now() + Math.round(minutes * 60_000));
        scheduleDesc = `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
      } else {
        return `Error: Could not understand schedule "${when}". Try "in 30 minutes", "tomorrow at 9am", or "every day at 8am".`;
      }
    } else if (schedule.isRecurring) {
      isRecurring = true;
      cronExpression = schedule.cronExpression!;
      scheduleDesc = schedule.description;
      fireAt = nextCronFire(cronExpression);
    } else {
      fireAt = schedule.fireAt!;
      scheduleDesc = schedule.description;
    }
  } else if (minutes && minutes > 0) {
    // Legacy minutes path
    if (minutes > 10080) { // 7 days
      return "Error: One-off reminders can be set for up to 7 days. For longer, use a recurring reminder.";
    }
    fireAt = new Date(Date.now() + Math.round(minutes * 60_000));
    scheduleDesc = `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  } else {
    return "Error: Please specify when: use `when` (e.g. 'tomorrow at 9am') or `minutes` (e.g. 30).";
  }

  // Sanity: fire_at must be in the future (for non-recurring)
  if (!isRecurring && fireAt.getTime() <= Date.now()) {
    return "Error: That time is already in the past. Please specify a future time.";
  }

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
      const insertPayload: Record<string, unknown> = {
        chat_id: chatId,
        message,
        fire_at: fireAt.toISOString(),
        fired: false,
      };

      // Try to insert with new columns (is_recurring, cron_expr, schedule_desc)
      // Gracefully falls back if columns don't exist yet
      try {
        insertPayload.is_recurring = isRecurring;
        insertPayload.cron_expr = cronExpression;
        insertPayload.schedule_desc = scheduleDesc;
      } catch { /* columns may not exist — skip */ }

      const { data, error } = await sb
        .from("reminders")
        .insert(insertPayload)
        .select("id")
        .single();

      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          console.warn("[Reminder] 'reminders' table not found — reminder will not survive restarts.");
        } else if (error.message?.includes("column")) {
          // New columns don't exist yet — retry with base columns only
          const { data: d2, error: e2 } = await sb
            .from("reminders")
            .insert({ chat_id: chatId, message, fire_at: fireAt.toISOString(), fired: false })
            .select("id")
            .single();
          if (!e2 && d2?.id) reminderId = d2.id;
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
  scheduleTimer(reminderId, chatId, message, fireAt, isRecurring, cronExpression, scheduleDesc);

  console.log(
    `[Reminder] Scheduled "${message}" at ${fireAt.toISOString()} for chat ${chatId}` +
    (isRecurring ? ` (recurring: ${scheduleDesc})` : ""),
  );

  if (isRecurring) {
    return `🔁 Recurring reminder set! I'll remind you "${message}" ${scheduleDesc}.\nNext: ${fireAtStr} IST.`;
  }
  return `✅ Reminder set! I'll remind you "${message}" ${scheduleDesc} (at ${fireAtStr} IST).`;
}

// ─── List pending reminders ───────────────────────────────────────

/**
 * Return a formatted list of all pending (in-process) reminders.
 * Used by the /reminders slash command.
 */
export function listPendingReminders(): string {
  if (pending.size === 0) {
    return "No pending reminders. Set one by asking me: \"Remind me to [task] in [X] minutes\" or \"Remind me every day at 9am to [task]\".";
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

    const recurIcon = r.isRecurring ? "🔁 " : "";
    const desc = r.scheduleDesc ? ` _(${r.scheduleDesc})_` : "";
    lines.push(`• ${recurIcon}"${r.message}"${desc}\n  🕐 ${fireAtStr} (in ${timeLeft})`);
  }

  return lines.join("\n");
}
