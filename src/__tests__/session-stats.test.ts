/**
 * Tests for Session Stats — Cost Estimation & Token Tracking
 *
 * Validates financial accuracy, accumulation, and formatting.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    estimateCost,
    recordTokenUsage,
    getSessionStats,
    resetSessionStats,
    getCallLog,
    formatCost,
    formatDuration,
} from "../commands/session-stats.js";

describe("estimateCost", () => {
    it("calculates Gemini 2.5 Flash cost correctly", () => {
        // 1,000,000 prompt @ $0.30 + 1,000,000 completion @ $2.50
        const cost = estimateCost("gemini-2.5-flash", 1_000_000, 1_000_000);
        expect(cost).toBeCloseTo(0.30 + 2.50, 4);
    });

    it("handles small token counts without floating point errors", () => {
        // 100 prompt + 50 completion on Flash
        const cost = estimateCost("gemini-2.5-flash", 100, 50);
        expect(cost).toBeGreaterThan(0);
        expect(cost).toBeLessThan(0.001);
    });

    it("returns $0 for free-tier models (OpenRouter :free suffix)", () => {
        const cost = estimateCost(
            "mistralai/mistral-small-3.1-24b-instruct:free",
            10_000_000,
            5_000_000,
        );
        expect(cost).toBe(0);
    });

    it("uses default pricing for completely unknown models", () => {
        const cost = estimateCost("some/totally-unknown-model", 1_000_000, 1_000_000);
        // Default pricing should be used — cost should be non-zero
        expect(cost).toBeGreaterThan(0);
    });

    it("handles zero tokens gracefully", () => {
        const cost = estimateCost("gemini-2.5-flash", 0, 0);
        expect(cost).toBe(0);
    });
});

describe("recordTokenUsage", () => {
    const CHAT_ID = "test-chat-stats";

    beforeEach(() => {
        resetSessionStats(CHAT_ID);
    });

    it("records a single API call correctly", () => {
        recordTokenUsage(CHAT_ID, "gemini-2.5-flash", 100, 50, 150, 500);

        const stats = getSessionStats(CHAT_ID);
        expect(stats.promptTokens).toBe(100);
        expect(stats.completionTokens).toBe(50);
        expect(stats.totalTokens).toBe(150);
        expect(stats.requestCount).toBe(1);
        expect(stats.totalLatencyMs).toBe(500);
        expect(stats.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("accumulates tokens across multiple calls", () => {
        recordTokenUsage(CHAT_ID, "gemini-2.5-flash", 100, 50, 150, 500);
        recordTokenUsage(CHAT_ID, "gemini-2.5-flash", 200, 100, 300, 700);

        const stats = getSessionStats(CHAT_ID);
        expect(stats.promptTokens).toBe(300);
        expect(stats.completionTokens).toBe(150);
        expect(stats.totalTokens).toBe(450);
        expect(stats.requestCount).toBe(2);
        expect(stats.totalLatencyMs).toBe(1200);
    });

    it("maintains a call log", () => {
        recordTokenUsage(CHAT_ID, "model-a", 100, 50, 150, 200);
        recordTokenUsage(CHAT_ID, "model-b", 200, 100, 300, 400);

        const log = getCallLog(CHAT_ID);
        expect(log.length).toBe(2);
        // Most recent first
        expect(log[0].model).toBe("model-b");
        expect(log[1].model).toBe("model-a");
    });

    it("resets correctly", () => {
        recordTokenUsage(CHAT_ID, "gemini-2.5-flash", 100, 50, 150, 500);
        resetSessionStats(CHAT_ID);

        const stats = getSessionStats(CHAT_ID);
        expect(stats.promptTokens).toBe(0);
        expect(stats.completionTokens).toBe(0);
        expect(stats.requestCount).toBe(0);
        expect(stats.callLog.length).toBe(0);
    });
});

describe("formatCost", () => {
    it("shows 4 decimal places for small costs", () => {
        const result = formatCost(0.0001);
        expect(result).toMatch(/0\.0001/);
    });

    it("shows 2 decimal places for larger costs", () => {
        const result = formatCost(1.5);
        expect(result).toMatch(/1\.50/);
    });
});

describe("formatDuration", () => {
    it("formats seconds correctly", () => {
        const result = formatDuration(5000);
        expect(result).toContain("5");
    });

    it("formats minutes correctly", () => {
        const result = formatDuration(90_000);
        // Should mention "1" minute and "30" seconds
        expect(result).toMatch(/1.*m/i);
    });
});
