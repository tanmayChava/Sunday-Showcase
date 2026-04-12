/**
 * Heartbeat Scheduler
 *
 * A lightweight scheduler that checks every 60 seconds if any
 * heartbeat job is due. Uses IST (Asia/Kolkata) for all scheduling.
 *
 * No external cron dependencies — pure Node.js setInterval.
 */

import { Bot } from "grammy";

export interface HeartbeatJob {
  name: string;
  /** Hour in IST (0-23) */
  hour: number;
  /** Minute in IST (0-59) */
  minute: number;
  /** The function to execute when the job is due */
  execute: (bot: Bot, chatId: string) => Promise<void>;
}

// Track last run date per job to prevent duplicate sends
const lastRunDates = new Map<string, string>();

// Module-level reference to active jobs (set during startHeartbeat)
let activeJobs: HeartbeatJob[] = [];
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Get a formatted status string of all heartbeat jobs.
 */
export function getHeartbeatStatus(): string {
  if (activeJobs.length === 0) {
    return "⏸️ No heartbeat jobs are active.";
  }

  const lines: string[] = ["**⏱️ Heartbeat Status**\n"];
  const { dateKey: today } = getISTNow();

  for (const job of activeJobs) {
    const timeStr = `${String(job.hour).padStart(2, "0")}:${String(job.minute).padStart(2, "0")}`;
    const runKey = `${job.name}_${today}`;
    const ranToday = lastRunDates.has(runKey);
    const status = ranToday ? "✅ Ran today" : "⏳ Pending";
    lines.push(`• **${job.name}** — ${timeStr} IST (${status})`);
  }

  return lines.join("\n");
}

/**
 * Update the scheduled time for a job by name.
 * Returns true if the job was found and updated.
 */
export function updateHeartbeatTime(
  jobName: string,
  newHour: number,
  newMinute: number,
): boolean {
  const job = activeJobs.find((j) => j.name === jobName);
  if (!job) return false;

  const oldTime = `${String(job.hour).padStart(2, "0")}:${String(job.minute).padStart(2, "0")}`;
  job.hour = newHour;
  job.minute = newMinute;
  const newTime = `${String(newHour).padStart(2, "0")}:${String(newMinute).padStart(2, "0")}`;

  // Clear today's run flag so it can fire again at the new time
  const { dateKey: today } = getISTNow();
  lastRunDates.delete(`${jobName}_${today}`);

  console.log(
    `[Heartbeat] "${jobName}" rescheduled: ${oldTime} → ${newTime} IST`,
  );
  return true;
}

/**
 * Get the current date and time in IST using Intl.DateTimeFormat.
 * This is reliable across Node.js versions and Docker environments
 * (unlike parsing toLocaleString which is locale-dependent).
 */
function getISTNow(): { hour: number; minute: number; dateKey: string } {
  const now = new Date();

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );

  return {
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Start the heartbeat scheduler.
 * Checks every 60 seconds if any job should fire.
 */
export function startHeartbeat(
  bot: Bot,
  chatId: string,
  jobs: HeartbeatJob[],
): void {
  console.log(`[Heartbeat] Scheduler started with ${jobs.length} job(s).`);
  console.log(`[Heartbeat] Target chat: ${chatId}`);

  // Store reference for runtime introspection and updates
  activeJobs = jobs;

  for (const job of jobs) {
    const timeStr = `${String(job.hour).padStart(2, "0")}:${String(job.minute).padStart(2, "0")}`;
    console.log(`[Heartbeat]   → "${job.name}" scheduled at ${timeStr} IST`);
  }

  // Check every 60 seconds
  heartbeatTimer = setInterval(() => {
    const { hour, minute, dateKey } = getISTNow();

    for (const job of jobs) {
      // Check if it's within the scheduled minute window
      if (hour === job.hour && minute === job.minute) {
        const runKey = `${job.name}_${dateKey}`;

        // Skip if already ran today
        if (lastRunDates.has(runKey)) continue;

        // Mark as ran
        lastRunDates.set(runKey, dateKey);

        console.log(`[Heartbeat] Firing job: "${job.name}"`);

        job.execute(bot, chatId).catch((err) => {
          console.error(`[Heartbeat] Job "${job.name}" failed:`, err);
        });
      }
    }

    // Clean up old entries (keep only today's)
    const { dateKey: today } = getISTNow();
    for (const [key, date] of lastRunDates) {
      if (date !== today) lastRunDates.delete(key);
    }
  }, 60_000); // Every 60 seconds
}

/**
 * Stop the heartbeat scheduler.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("[Heartbeat] Scheduler stopped.");
  }
}
