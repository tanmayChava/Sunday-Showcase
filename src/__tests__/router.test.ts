/**
 * Tests for LLM Router — Provider Dispatch & Fallback Logic
 *
 * Validates that models are routed to the correct provider and
 * that Gemini failures trigger the OpenRouter fallback correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the router by mocking both provider modules before importing the router.
// This avoids hitting real APIs while verifying dispatch + fallback behavior.

// ─── Mocks ────────────────────────────────────────────────────────

const mockGeminiChat = vi.fn();
const mockOpenRouterChat = vi.fn();

vi.mock("../lib/gemini.js", () => ({
    geminiProvider: { chat: (...args: unknown[]) => mockGeminiChat(...args) },
}));

vi.mock("../lib/openrouter.js", () => ({
    openRouterProvider: { chat: (...args: unknown[]) => mockOpenRouterChat(...args) },
}));

// Mock ENV to provide an OpenRouter fallback model and key
vi.mock("../config.js", () => ({
    ENV: {
        OPENROUTER_API_KEY: "test-openrouter-key",
        OPENROUTER_MODEL: "mistralai/mistral-small:free",
        GEMINI_API_KEYS: ["key-1", "key-2"],
    },
}));

// ─── Import after mocks ───────────────────────────────────────────

import { routedChat, getProviderName } from "../lib/router.js";
import type { LLMCallParams, LLMResponse } from "../lib/llm.js";

// ─── Helpers ──────────────────────────────────────────────────────

function makeParams(model: string): LLMCallParams {
    return {
        model,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
    };
}

const MOCK_RESPONSE: LLMResponse = {
    text: "Mock response",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

// ─── Tests ────────────────────────────────────────────────────────

describe("getProviderName", () => {
    it("returns 'Gemini' for gemini- prefixed models", () => {
        expect(getProviderName("gemini-2.5-flash")).toBe("Gemini");
        expect(getProviderName("gemini-3-flash-preview")).toBe("Gemini");
    });

    it("returns 'OpenRouter' for non-Gemini models", () => {
        expect(getProviderName("anthropic/claude-3.7-sonnet")).toBe("OpenRouter");
        expect(getProviderName("meta-llama/llama-4-maverick:free")).toBe("OpenRouter");
    });
});

describe("routedChat — Model Routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGeminiChat.mockResolvedValue(MOCK_RESPONSE);
        mockOpenRouterChat.mockResolvedValue(MOCK_RESPONSE);
    });

    it("routes gemini- models to Gemini provider", async () => {
        await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockGeminiChat).toHaveBeenCalledTimes(1);
        expect(mockOpenRouterChat).not.toHaveBeenCalled();
    });

    it("routes non-Gemini models directly to OpenRouter", async () => {
        await routedChat(makeParams("anthropic/claude-3.7-sonnet"));

        expect(mockOpenRouterChat).toHaveBeenCalledTimes(1);
        expect(mockGeminiChat).not.toHaveBeenCalled();
    });

    it("routes free-tier OpenRouter models to OpenRouter", async () => {
        await routedChat(makeParams("meta-llama/llama-4-maverick:free"));

        expect(mockOpenRouterChat).toHaveBeenCalledTimes(1);
        expect(mockGeminiChat).not.toHaveBeenCalled();
    });

    it("returns the LLM response from the correct provider", async () => {
        const geminiResult: LLMResponse = { text: "From Gemini" };
        const orResult: LLMResponse = { text: "From OpenRouter" };
        mockGeminiChat.mockResolvedValue(geminiResult);
        mockOpenRouterChat.mockResolvedValue(orResult);

        const r1 = await routedChat(makeParams("gemini-2.5-flash"));
        expect(r1.text).toBe("From Gemini");

        const r2 = await routedChat(makeParams("anthropic/claude-3.7-sonnet"));
        expect(r2.text).toBe("From OpenRouter");
    });
});

describe("routedChat — Fallback Behavior", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockOpenRouterChat.mockResolvedValue(MOCK_RESPONSE);
    });

    it("falls back to OpenRouter on Gemini 429", async () => {
        mockGeminiChat.mockRejectedValue({ status: 429, message: "quota exceeded" });

        const result = await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockGeminiChat).toHaveBeenCalledTimes(1);
        expect(mockOpenRouterChat).toHaveBeenCalledTimes(1);
        // Verify fallback used the configured fallback model
        expect(mockOpenRouterChat.mock.calls[0][0].model).toBe("mistralai/mistral-small:free");
        expect(result.text).toBe("Mock response");
    });

    it("falls back to OpenRouter on Gemini 404 (model not found)", async () => {
        mockGeminiChat.mockRejectedValue({ status: 404, message: "model not found" });

        const result = await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockOpenRouterChat).toHaveBeenCalledTimes(1);
        expect(result.text).toBe("Mock response");
    });

    it("falls back to OpenRouter on Gemini 503 (service unavailable)", async () => {
        mockGeminiChat.mockRejectedValue({ status: 503, message: "service unavailable" });

        const result = await routedChat(makeParams("gemini-2.5-flash"));

        expect(mockOpenRouterChat).toHaveBeenCalledTimes(1);
        expect(result.text).toBe("Mock response");
    });

    it("does NOT fall back on Gemini 400 (bad request — real bug)", async () => {
        const error = { status: 400, message: "invalid request" };
        mockGeminiChat.mockRejectedValue(error);

        await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(error);
        expect(mockOpenRouterChat).not.toHaveBeenCalled();
    });

    it("does NOT fall back on Gemini 401 (unauthorized — config error)", async () => {
        const error = { status: 401, message: "unauthorized" };
        mockGeminiChat.mockRejectedValue(error);

        await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(error);
        expect(mockOpenRouterChat).not.toHaveBeenCalled();
    });

    it("throws original Gemini error when fallback also fails", async () => {
        const geminiError = { status: 429, message: "quota exceeded" };
        const orError = new Error("OpenRouter exploded");
        mockGeminiChat.mockRejectedValue(geminiError);
        mockOpenRouterChat.mockRejectedValue(orError);

        // Should throw the ORIGINAL Gemini error, not the fallback error
        await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(geminiError);
    });

    it("does NOT attempt fallback for non-Gemini model failures", async () => {
        const error = new Error("OpenRouter is down");
        mockOpenRouterChat.mockRejectedValue(error);

        await expect(routedChat(makeParams("anthropic/claude-3.7-sonnet"))).rejects.toThrow("OpenRouter is down");
        // Should have called OpenRouter once and not tried Gemini
        expect(mockOpenRouterChat).toHaveBeenCalledTimes(1);
        expect(mockGeminiChat).not.toHaveBeenCalled();
    });
});

describe("routedChat — No OpenRouter Key", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does NOT fall back when OPENROUTER_API_KEY is empty", async () => {
        // Temporarily override the mock to remove the key
        const configModule = await import("../config.js");
        const original = configModule.ENV.OPENROUTER_API_KEY;
        (configModule.ENV as any).OPENROUTER_API_KEY = "";

        const error = { status: 429, message: "quota" };
        mockGeminiChat.mockRejectedValue(error);

        try {
            await expect(routedChat(makeParams("gemini-2.5-flash"))).rejects.toEqual(error);
            expect(mockOpenRouterChat).not.toHaveBeenCalled();
        } finally {
            (configModule.ENV as any).OPENROUTER_API_KEY = original;
        }
    });
});
