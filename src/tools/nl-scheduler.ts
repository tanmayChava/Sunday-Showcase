/**
 * Natural Language Schedule Parser — Feature 4.4
 *
 * Converts human-readable time expressions to structured schedule objects.
 * All times are interpreted in IST (UTC+5:30).
 *
 * Supported patterns:
 *   One-off:
 *     "in 30 minutes" / "in 2 hours" / "in 3 days"
 *     "tomorrow at 9am" / "tomorrow at 9:30"
 *     "today at 6pm"
 *     "on Monday at 10am"
 *     "next Friday at 3:30pm"
 *     "April 25 at 8am" / "25th April at 9:00"
 *     "at 5pm" (today if in the future, tomorrow if passed)
 *
 *   Recurring (cron):
 *     "every day at 9am"
 *     "every Monday at 10:00"
 *     "every weekday at 8:30am"
 *     "every weekend at 11am"
 *     "every hour"
 *     "every 30 minutes"
 *     "every morning" → "every day at 08:00"
 *     "every evening" → "every day at 20:00"
 *     "every night"   → "every day at 22:00"
 */

export interface ParsedSchedule {
  /** UTC timestamp for one-time reminders (null for recurring-only) */
  fireAt: Date | null;
  /** Whether this is a recurring schedule */
  isRecurring: boolean;
  /** Standard cron expression (null for one-off) */
  cronExpression: string | null;
  /** Human-readable description of the schedule */
  description: string;
  /** Original input for logging */
  rawInput: string;
}

// ─── IST Helpers ─────────────────────────────────────────────────

const IST_OFFSET_MINUTES = 5 * 60 + 30; // UTC+5:30

function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MINUTES * 60_000);
}

/**
 * Construct a Date from an IST date/time and convert to UTC.
 */
function istToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
): Date {
  // Date.UTC treats inputs as UTC, so we subtract IST offset to get actual UTC
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * 60_000);
}

/** Parse "9am", "9:30", "9:30pm", "21:00" → { hour, minute } in 24h, or null */
function parseTimeString(s: string): { hour: number; minute: number } | null {
  s = s.trim().toLowerCase();

  // HH:MM(am|pm)?
  const hhmm = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (hhmm) {
    let hour = parseInt(hhmm[1], 10);
    const minute = parseInt(hhmm[2], 10);
    const period = hhmm[3];
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  // HH(am|pm)
  const ham = s.match(/^(\d{1,2})\s*(am|pm)$/);
  if (ham) {
    let hour = parseInt(ham[1], 10);
    const period = ham[2];
    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) return null;
    return { hour, minute: 0 };
  }

  return null;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// ─── One-off Parsers ─────────────────────────────────────────────

/** "in 30 minutes" / "in 2 hours" / "in 3 days" / "in 1 week" */
function tryRelative(input: string): ParsedSchedule | null {
  const match = input.match(/\bin\s+(\d+(?:\.\d+)?)\s+(minute|hour|day|week)s?\b/i);
  if (!match) return null;

  const qty = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let ms: number;

  switch (unit) {
    case "minute": ms = qty * 60_000; break;
    case "hour":   ms = qty * 3_600_000; break;
    case "day":    ms = qty * 86_400_000; break;
    case "week":   ms = qty * 7 * 86_400_000; break;
    default: return null;
  }

  const fireAt = new Date(Date.now() + ms);
  const desc = `in ${qty} ${unit}${qty !== 1 ? "s" : ""}`;
  return { fireAt, isRecurring: false, cronExpression: null, description: desc, rawInput: input };
}

/** "tomorrow at 9am" / "today at 6pm" */
function tryTodayTomorrow(input: string): ParsedSchedule | null {
  const match = input.match(/\b(today|tomorrow)\b.*?\bat\s+(.+)/i);
  if (!match) return null;

  const when = match[1].toLowerCase();
  const timeStr = match[2].trim();
  const parsed = parseTimeString(timeStr);
  if (!parsed) return null;

  const ist = nowIST();
  let day = ist.getUTCDate();
  if (when === "tomorrow") day++;

  const fireAt = istToUtc(ist.getUTCFullYear(), ist.getUTCMonth() + 1, day, parsed.hour, parsed.minute);
  const desc = `${when} at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`;
  return { fireAt, isRecurring: false, cronExpression: null, description: desc, rawInput: input };
}

/** "on Monday at 10am" / "next Friday at 3pm" / "this Saturday at noon" */
function tryWeekday(input: string): ParsedSchedule | null {
  const match = input.match(/\b(?:on\s+|next\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*?\bat\s+(.+)/i);
  if (!match) return null;

  const dayName = match[1].toLowerCase();
  const timeStr = match[2].trim();
  const targetWd = WEEKDAYS[dayName];
  if (targetWd === undefined) return null;

  const parsed = parseTimeString(timeStr);
  if (!parsed) return null;

  const ist = nowIST();
  const currentWd = ist.getUTCDay();
  let daysUntil = (targetWd - currentWd + 7) % 7;
  // "next Monday" always means the following week
  if (daysUntil === 0 && input.toLowerCase().includes("next")) daysUntil = 7;
  // If same day but time has passed, schedule next week
  if (daysUntil === 0) {
    const nowMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const targetMinutes = parsed.hour * 60 + parsed.minute;
    if (targetMinutes <= nowMinutes) daysUntil = 7;
  }

  const fireAt = new Date(Date.now() + daysUntil * 86_400_000);
  // Set IST time
  const fireDate = istToUtc(
    fireAt.getUTCFullYear(),
    fireAt.getUTCMonth() + 1,
    fireAt.getUTCDate(),
    parsed.hour,
    parsed.minute,
  );
  // Recalculate cleanly using ist day offset
  const ist_date = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + daysUntil),
  );
  const cleanFireAt = istToUtc(
    ist_date.getUTCFullYear(),
    ist_date.getUTCMonth() + 1,
    ist_date.getUTCDate(),
    parsed.hour,
    parsed.minute,
  );

  const desc = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`;
  return { fireAt: cleanFireAt, isRecurring: false, cronExpression: null, description: desc, rawInput: input };
}

/** "April 25 at 8am" / "25th April at 9:00" / "25 April at 9" */
function tryAbsoluteDate(input: string): ParsedSchedule | null {
  // "April 25 at ..." or "Apr 25th at ..."
  let match = input.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b.*?\bat\s+(.+)/i);
  if (!match) {
    // "25 April at ..." or "25th April at ..."
    match = input.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b.*?\bat\s+(.+)/i);
    if (!match) return null;
    // Swap month/day for day-first format
    const [m0, m1, m2, m3] = match;
    match = [m0, m2, m1, m3]; // [full, month, day, time]
  }

  const monthStr = match[1].toLowerCase();
  const dayNum = parseInt(match[2], 10);
  const timeStr = match[3].trim();

  const month = MONTHS[monthStr];
  if (!month) return null;

  const parsed = parseTimeString(timeStr);
  if (!parsed) return null;

  const ist = nowIST();
  let year = ist.getUTCFullYear();
  const fireAt = istToUtc(year, month, dayNum, parsed.hour, parsed.minute);

  // If the date has already passed this year, schedule for next year
  if (fireAt.getTime() <= Date.now()) {
    year++;
    return {
      fireAt: istToUtc(year, month, dayNum, parsed.hour, parsed.minute),
      isRecurring: false,
      cronExpression: null,
      description: `${dayNum} ${monthStr} ${year} at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`,
      rawInput: input,
    };
  }

  return {
    fireAt,
    isRecurring: false,
    cronExpression: null,
    description: `${dayNum} ${monthStr} ${year} at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`,
    rawInput: input,
  };
}

/** "at 5pm" / "at 09:30" — today if future, tomorrow if past */
function tryTimeOnly(input: string): ParsedSchedule | null {
  const match = input.match(/^at\s+(.+)$/i) || input.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (!match) return null;

  const timeStr = match[1].trim();
  const parsed = parseTimeString(timeStr);
  if (!parsed) return null;

  const ist = nowIST();
  let fireAt = istToUtc(
    ist.getUTCFullYear(),
    ist.getUTCMonth() + 1,
    ist.getUTCDate(),
    parsed.hour,
    parsed.minute,
  );

  // Already passed today? → tomorrow
  if (fireAt.getTime() <= Date.now()) {
    fireAt = new Date(fireAt.getTime() + 86_400_000);
  }

  const label = fireAt.getTime() - Date.now() < 86_400_000 ? "today" : "tomorrow";
  const desc = `${label} at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`;
  return { fireAt, isRecurring: false, cronExpression: null, description: desc, rawInput: input };
}

// ─── Recurring Parsers ───────────────────────────────────────────

/**
 * Build a cron expression (minute hour dom month dow).
 * IST → cron needs UTC offset subtraction.
 * E.g. 9am IST = 3:30 UTC → cron "30 3 * * *"
 */
function istTimeToCron(istHour: number, istMinute: number, dowExpr: string = "*"): string {
  const totalMinutes = istHour * 60 + istMinute - IST_OFFSET_MINUTES;
  let utcHour = Math.floor(((totalMinutes % (24 * 60)) + 24 * 60) / 60) % 24;
  let utcMinute = ((totalMinutes % 60) + 60) % 60;
  return `${utcMinute} ${utcHour} * * ${dowExpr}`;
}

/**
 * Parse "every day at 9am" / "every Monday at 10:00" / "every weekday at 8:30am"
 */
function tryRecurring(input: string): ParsedSchedule | null {
  const lower = input.toLowerCase().trim();
  if (!lower.startsWith("every")) return null;

  // "every hour"
  if (/^every\s+hour$/.test(lower)) {
    return {
      fireAt: null,
      isRecurring: true,
      cronExpression: "0 * * * *",
      description: "every hour",
      rawInput: input,
    };
  }

  // "every N minutes"
  const everyMinutes = lower.match(/^every\s+(\d+)\s+minutes?$/);
  if (everyMinutes) {
    const n = parseInt(everyMinutes[1], 10);
    if (n > 0 && n <= 60) {
      return {
        fireAt: null,
        isRecurring: true,
        cronExpression: `*/${n} * * * *`,
        description: `every ${n} minute${n !== 1 ? "s" : ""}`,
        rawInput: input,
      };
    }
  }

  // Named period shorthand: "every morning/evening/night"
  const periods: Record<string, [number, number]> = {
    morning: [8, 0],
    afternoon: [14, 0],
    evening: [20, 0],
    night: [22, 0],
    midnight: [0, 0],
    noon: [12, 0],
  };
  for (const [word, [h, m]] of Object.entries(periods)) {
    if (new RegExp(`^every\\s+${word}$`).test(lower)) {
      return {
        fireAt: null,
        isRecurring: true,
        cronExpression: istTimeToCron(h, m),
        description: `every ${word} (${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} IST)`,
        rawInput: input,
      };
    }
  }

  // Extract time component
  const atMatch = lower.match(/\bat\s+(.+)$/);
  if (!atMatch) return null;
  const parsed = parseTimeString(atMatch[1].trim());
  if (!parsed) return null;

  // "every day at ..."
  if (/^every\s+day\s+at/.test(lower)) {
    return {
      fireAt: null,
      isRecurring: true,
      cronExpression: istTimeToCron(parsed.hour, parsed.minute, "*"),
      description: `every day at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`,
      rawInput: input,
    };
  }

  // "every weekday at ..."
  if (/^every\s+weekday\s+at/.test(lower)) {
    return {
      fireAt: null,
      isRecurring: true,
      cronExpression: istTimeToCron(parsed.hour, parsed.minute, "1-5"),
      description: `every weekday at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`,
      rawInput: input,
    };
  }

  // "every weekend at ..."
  if (/^every\s+weekend\s+at/.test(lower)) {
    return {
      fireAt: null,
      isRecurring: true,
      cronExpression: istTimeToCron(parsed.hour, parsed.minute, "0,6"),
      description: `every weekend at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`,
      rawInput: input,
    };
  }

  // "every Monday at ...", "every Monday and Wednesday at ..."
  const dayPattern = Object.keys(WEEKDAYS).join("|");
  const multiDayMatch = lower.match(
    new RegExp(`^every\\s+((?:(?:${dayPattern})(?:\\s+and\\s+|,\\s*)?)+)\\s+at`, "i"),
  );
  if (multiDayMatch) {
    const daysStr = multiDayMatch[1];
    const dayNums: number[] = [];
    const dayRegex = new RegExp(dayPattern, "gi");
    let dm: RegExpExecArray | null;
    while ((dm = dayRegex.exec(daysStr)) !== null) {
      const dn = WEEKDAYS[dm[0].toLowerCase()];
      if (dn !== undefined) dayNums.push(dn);
    }
    if (dayNums.length > 0) {
      const dowExpr = [...new Set(dayNums)].sort().join(",");
      const dayNames = [...new Set(dayNums)].sort().map((d) =>
        Object.entries(WEEKDAYS).find(([, v]) => v === d && !["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(Object.entries(WEEKDAYS).find(([k]) => k.length === 3)?.[0] ?? ""))?.[0] ||
        Object.entries(WEEKDAYS).find(([, v]) => v === d)?.[0] || String(d)
      );

      return {
        fireAt: null,
        isRecurring: true,
        cronExpression: istTimeToCron(parsed.hour, parsed.minute, dowExpr),
        description: `every ${daysStr.trim()} at ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} IST`,
        rawInput: input,
      };
    }
  }

  return null;
}

// ─── Main Parser ─────────────────────────────────────────────────

/**
 * Parse a natural language schedule expression.
 *
 * Returns null if the expression is unrecognizable (caller should fall back
 * to asking for minutes explicitly or using an LLM to parse it).
 */
export function parseNaturalSchedule(input: string): ParsedSchedule | null {
  const clean = input.trim();
  if (!clean) return null;

  // Try parsers in priority order
  return (
    tryRecurring(clean) ||
    tryRelative(clean) ||
    tryTodayTomorrow(clean) ||
    tryWeekday(clean) ||
    tryAbsoluteDate(clean) ||
    tryTimeOnly(clean) ||
    null
  );
}

/**
 * Estimate minutes until a fireAt date (for backward compat with set_reminder).
 * Returns null for recurring schedules.
 */
export function scheduleToMinutes(schedule: ParsedSchedule): number | null {
  if (schedule.isRecurring || !schedule.fireAt) return null;
  const ms = schedule.fireAt.getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 60_000));
}
