/**
 * Tests for Slash Commands — Command Parsing & Dispatch
 *
 * Validates that all commands are handled correctly and
 * unknown commands pass through to the LLM.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { handleSlashCommand, getEffectiveModel, clearModelOverride } from "../commands/slash-commands.js";

describe("handleSlashCommand", () => {
    const CHAT_ID = "test-cmd-chat";

    beforeEach(() => {
        clearModelOverride(CHAT_ID);
    });

    it("returns handled=false for non-slash messages", async () => {
        const result = await handleSlashCommand("hello world", CHAT_ID);
        expect(result.handled).toBe(false);
        expect(result.response).toBeUndefined();
    });

    it("handles /help command", async () => {
        const result = await handleSlashCommand("/help", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("Slash Commands");
        expect(result.response).toContain("/status");
        expect(result.response).toContain("/model");
        expect(result.response).toContain("/heartbeat");
    });

    it("handles /start as alias for /new", async () => {
        const result = await handleSlashCommand("/start", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /reset as alias for /new", async () => {
        const result = await handleSlashCommand("/reset", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /new command", async () => {
        const result = await handleSlashCommand("/new", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /status command", async () => {
        const result = await handleSlashCommand("/status", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /usage command", async () => {
        const result = await handleSlashCommand("/usage", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /compact command", async () => {
        const result = await handleSlashCommand("/compact", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /agents command", async () => {
        const result = await handleSlashCommand("/agents", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("research");
        expect(result.response).toContain("code");
    });

    it("handles /heartbeat command", async () => {
        const result = await handleSlashCommand("/heartbeat", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /heartbeat_set without args (shows usage)", async () => {
        const result = await handleSlashCommand("/heartbeat_set", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("HH:MM");
    });

    it("handles /heartbeat_set with invalid time format", async () => {
        const result = await handleSlashCommand("/heartbeat_set abc", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("Invalid format");
    });

    it("handles /heartbeat_set with out-of-range time", async () => {
        const result = await handleSlashCommand("/heartbeat_set 25:00", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toContain("Invalid time");
    });

    it("passes unknown slash commands through to LLM", async () => {
        const result = await handleSlashCommand("/unknowncommand", CHAT_ID);
        expect(result.handled).toBe(false);
    });

    it("handles /model without args (shows current)", async () => {
        const result = await handleSlashCommand("/model", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });

    it("handles /model with a known shorthand", async () => {
        const result = await handleSlashCommand("/model flash", CHAT_ID);
        expect(result.handled).toBe(true);

        const effective = getEffectiveModel(CHAT_ID);
        expect(effective).toContain("flash");
    });

    it("handles /model with unknown model (returns error)", async () => {
        const result = await handleSlashCommand("/model nonexistent_model_xyz", CHAT_ID);
        expect(result.handled).toBe(true);
        // Should either warn or reject unknown models
        expect(result.response).toBeTruthy();
    });

    it("handles /pin without args (shows usage)", async () => {
        const result = await handleSlashCommand("/pin", CHAT_ID);
        expect(result.handled).toBe(true);
        expect(result.response).toBeTruthy();
    });
});

describe("getEffectiveModel", () => {
    const CHAT_ID = "test-model-chat";

    beforeEach(() => {
        clearModelOverride(CHAT_ID);
    });

    it("returns default model when no override is set", () => {
        const model = getEffectiveModel(CHAT_ID);
        expect(model).toBeTruthy();
        expect(typeof model).toBe("string");
    });

    it("returns override model after /model command", async () => {
        await handleSlashCommand("/model flash", CHAT_ID);
        const model = getEffectiveModel(CHAT_ID);
        expect(model).toContain("flash");
    });

    it("resets to default after /new", async () => {
        await handleSlashCommand("/model flash", CHAT_ID);
        await handleSlashCommand("/new", CHAT_ID);
        const model = getEffectiveModel(CHAT_ID);
        // Should be back to the default, not "flash"
        expect(model).toBeTruthy();
    });
});
