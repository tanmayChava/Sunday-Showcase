/**
 * Tests for Tool Validation — Input checks & edge cases
 *
 * Covers set_reminder and read_url input validation.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { executeSetReminder, initReminderCallback } from "../tools/set_reminder.js";
import { executeReadUrl } from "../tools/read_url.js";

describe("executeSetReminder", () => {
    // Initialize a no-op callback so we can test input validation
    // (Without this, all calls fail with "not initialized")
    beforeAll(() => {
        initReminderCallback(async () => { });
    });

    it("rejects empty message", async () => {
        const result = await executeSetReminder({ message: "", minutes: 10 }, "chat-1");
        expect(result).toContain("Error");
        expect(result).toContain("empty");
    });

    it("rejects zero minutes", async () => {
        const result = await executeSetReminder({ message: "test", minutes: 0 }, "chat-1");
        expect(result).toContain("Error");
        expect(result).toContain("positive");
    });

    it("rejects negative minutes", async () => {
        const result = await executeSetReminder({ message: "test", minutes: -5 }, "chat-1");
        expect(result).toContain("Error");
    });

    it("rejects minutes > 1440 (24 hours)", async () => {
        const result = await executeSetReminder({ message: "test", minutes: 1441 }, "chat-1");
        expect(result).toContain("Error");
        expect(result).toContain("24 hours");
    });

    it("accepts valid reminder and returns confirmation", async () => {
        const result = await executeSetReminder({ message: "Drink water", minutes: 5 }, "chat-1");
        expect(result).toContain("Reminder set");
        expect(result).toContain("Drink water");
        expect(result).toContain("5 minute");
    });
});

describe("executeReadUrl", () => {
    it("rejects non-HTTP URLs", async () => {
        const result = await executeReadUrl("ftp://example.com/file");
        expect(result).toContain("Error");
        expect(result).toContain("http");
    });

    it("rejects URLs without protocol", async () => {
        const result = await executeReadUrl("example.com");
        expect(result).toContain("Error");
    });

    it("rejects javascript: protocol", async () => {
        const result = await executeReadUrl("javascript:alert(1)");
        expect(result).toContain("Error");
    });
});
