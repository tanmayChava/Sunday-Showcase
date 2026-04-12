/**
 * Tests for Message Utilities — Chunking & Error Formatting
 *
 * Validates the shared chunkMessage and friendlyError functions
 * used by both Telegram and Discord adapters.
 */

import { describe, it, expect } from "vitest";
import { chunkMessage, friendlyError } from "../channels/message-utils.js";

describe("chunkMessage", () => {
    it("returns single chunk for short messages", () => {
        const chunks = chunkMessage("Hello, world!", 4096);
        expect(chunks).toEqual(["Hello, world!"]);
    });

    it("returns single chunk at exact max length", () => {
        const text = "a".repeat(4096);
        const chunks = chunkMessage(text, 4096);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe(text);
    });

    it("splits at paragraph boundaries when possible", () => {
        const para1 = "First paragraph. ".repeat(50);
        const para2 = "Second paragraph. ".repeat(50);
        const text = `${para1}\n\n${para2}`;
        const chunks = chunkMessage(text, 1000);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        // Each chunk should be within limit
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(1000);
        }
    });

    it("splits at newlines when no paragraph break available", () => {
        const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: some content here`);
        const text = lines.join("\n");
        const chunks = chunkMessage(text, 500);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(500);
        }
    });

    it("hard-splits at max length when no good boundary exists", () => {
        // One long line with no spaces, newlines, or periods
        const text = "x".repeat(3000);
        const chunks = chunkMessage(text, 1000);
        expect(chunks.length).toBe(3);
        expect(chunks[0].length).toBe(1000);
        expect(chunks[1].length).toBe(1000);
        expect(chunks[2].length).toBe(1000);
    });

    it("handles empty string", () => {
        const chunks = chunkMessage("", 4096);
        expect(chunks).toEqual([""]);
    });

    it("handles Discord's 2000 char limit", () => {
        const text = "Hello! ".repeat(500); // ~3500 chars
        const chunks = chunkMessage(text, 2000);
        expect(chunks.length).toBe(2);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(2000);
        }
    });
});

describe("friendlyError", () => {
    it("maps 429 errors to rate limit message", () => {
        const result = friendlyError(new Error("HTTP 429 Too Many Requests"), "test");
        expect(result).toContain("heavy load");
    });

    it("maps timeout errors correctly", () => {
        const result = friendlyError(new Error("Request timed out: ETIMEDOUT"), "test");
        expect(result).toContain("timed out");
    });

    it("maps network errors correctly", () => {
        const result = friendlyError(new Error("ECONNREFUSED 127.0.0.1:443"), "test");
        expect(result).toContain("Network error");
    });

    it("maps auth errors correctly", () => {
        const result = friendlyError(new Error("401 Unauthorized"), "test");
        expect(result).toContain("API");
    });

    it("maps Supabase errors correctly", () => {
        const result = friendlyError(new Error("Supabase connection failed"), "test");
        expect(result).toContain("Database");
    });

    it("provides generic fallback for unknown errors", () => {
        const result = friendlyError(new Error("Something weird happened"), "processing");
        expect(result).toContain("processing");
        expect(result).not.toContain("weird"); // Should NOT leak internal error
    });

    it("handles non-Error objects gracefully", () => {
        const result = friendlyError("string error", "test");
        expect(result).toBeTruthy();
    });

    it("handles null/undefined errors", () => {
        const result = friendlyError(null, "test");
        expect(result).toBeTruthy();
    });
});
