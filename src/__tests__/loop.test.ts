/**
 * Tests for Agent Loop — Core Logic, Tool Execution, Iteration Guard
 *
 * The agent loop is the heart of SUNDAY. These tests mock the LLM
 * provider (routedChat) and Supabase to validate loop control flow without
 * making real API calls or requiring a database.
 *
 * Key scenarios:
 *   - Happy path: LLM returns text → response propagated
 *   - Tool calls: LLM requests tools → tools execute → loop continues
 *   - Max iterations guard: prevents infinite tool loops
 *   - Tool permission enforcement (allowedToolNames)
 *   - Empty/error responses handled gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────

// Mock Supabase — agent loop calls memory APIs which call Supabase
vi.mock("../lib/supabase.js", () => ({
    getSupabase: () => null,           // null = Supabase offline
    isSupabaseReady: async () => false,
}));

// Mock config-sync — returns defaults
vi.mock("../lib/config-sync.js", () => ({
    getRuntimeConfig: () => ({
        primaryModel: "gemini-2.5-flash",
        temperature: 0.7,
        semanticMemory: false,       // Disable semantic memory in tests
        delegation: true,
    }),
    initConfigSync: async () => { },
}));

// Mock the router — this is the key mock, captures all LLM calls
const mockRoutedChat = vi.fn();
vi.mock("../lib/router.js", () => ({
    routedChat: (...args: unknown[]) => mockRoutedChat(...args),
    getProviderName: (model: string) => model.startsWith("gemini-") ? "Gemini" : "OpenRouter",
}));

// Mock slash-commands to return default model
vi.mock("../commands/slash-commands.js", () => ({
    getEffectiveModel: () => "gemini-2.5-flash",
}));

// Mock session-stats to no-op
vi.mock("../commands/session-stats.js", () => ({
    recordTokenUsage: () => { },
}));

// Mock MCP manager — no MCP tools
vi.mock("../mcp/mcp-manager.js", () => ({
    mcpManager: {
        init: async () => { },
        getAllMcpTools: () => [],
        isMcpTool: () => false,
        executeMcpTool: async () => "Error: no MCP tools",
        shutdown: async () => { },
    },
}));

// Mock skills loader
vi.mock("../skills/loader.js", () => ({
    buildSkillsPrompt: () => "",
    initSkillsSystem: async () => { },
}));

// Mock memory modules
vi.mock("../memory/core.js", () => ({
    buildCoreMemoryPrompt: () => "",
    getCoreMemory: () => null,
    loadCoreMemories: async () => { },
}));

vi.mock("../memory/buffer.js", () => ({
    saveMessage: async () => { },
    getRecentMessages: async () => [],
}));

vi.mock("../memory/semantic.js", () => ({
    buildSemanticPrompt: async () => "",
    triggerFactExtraction: () => { },
}));

// ─── Import after mocks ───────────────────────────────────────────

import { runAgentLoop } from "../agent/loop.js";
import type { LLMResponse, LLMCallParams } from "../lib/llm.js";

// ─── Tests ────────────────────────────────────────────────────────

describe("runAgentLoop — Happy Path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns text response from LLM on first iteration", async () => {
        mockRoutedChat.mockResolvedValue({
            text: "The answer is 42.",
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        } satisfies LLMResponse);

        const result = await runAgentLoop("What is the meaning of life?", "chat-1");

        expect(result).toBe("The answer is 42.");
        expect(mockRoutedChat).toHaveBeenCalledTimes(1);
    });

    it("returns fallback message when LLM returns empty text", async () => {
        mockRoutedChat.mockResolvedValue({
            text: "",
        } satisfies LLMResponse);

        const result = await runAgentLoop("Hello", "chat-2");

        expect(result).toBe("No text response generated.");
    });

    it("returns fallback message when text is undefined", async () => {
        mockRoutedChat.mockResolvedValue({} satisfies LLMResponse);

        const result = await runAgentLoop("Hello", "chat-3");

        expect(result).toBe("No text response generated.");
    });

    it("trims whitespace from LLM response", async () => {
        mockRoutedChat.mockResolvedValue({
            text: "   trimmed answer   \n",
        } satisfies LLMResponse);

        const result = await runAgentLoop("test", "chat-4");

        expect(result).toBe("trimmed answer");
    });
});

describe("runAgentLoop — Tool Calls", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("executes tool calls and loops back to LLM with results", async () => {
        // First call: LLM requests a tool
        mockRoutedChat.mockResolvedValueOnce({
            text: "",
            toolCalls: [
                { id: "call-1", name: "get_current_time", args: {} },
            ],
        } satisfies LLMResponse);

        // Second call: LLM returns final answer after receiving tool result
        mockRoutedChat.mockResolvedValueOnce({
            text: "The current time is 11:00 PM IST.",
        } satisfies LLMResponse);

        const result = await runAgentLoop("What time is it?", "chat-5");

        expect(result).toBe("The current time is 11:00 PM IST.");
        expect(mockRoutedChat).toHaveBeenCalledTimes(2);
    });

    it("handles multiple tool calls in parallel", async () => {
        // LLM requests two tools at once
        mockRoutedChat.mockResolvedValueOnce({
            toolCalls: [
                { id: "call-a", name: "get_current_time", args: {} },
                { id: "call-b", name: "get_current_time", args: {} },
            ],
        } satisfies LLMResponse);

        // Then returns final answer
        mockRoutedChat.mockResolvedValueOnce({
            text: "Both calls done.",
        } satisfies LLMResponse);

        const result = await runAgentLoop("multiple tools", "chat-6");

        expect(result).toBe("Both calls done.");
        expect(mockRoutedChat).toHaveBeenCalledTimes(2);
    });

    it("returns error string for unknown tools (does NOT throw)", async () => {
        // LLM requests a tool that doesn't exist
        mockRoutedChat.mockResolvedValueOnce({
            toolCalls: [
                { id: "call-x", name: "nonexistent_tool", args: {} },
            ],
        } satisfies LLMResponse);

        // LLM gets the error and responds
        mockRoutedChat.mockResolvedValueOnce({
            text: "Sorry, that tool is unavailable.",
        } satisfies LLMResponse);

        const result = await runAgentLoop("use unknown tool", "chat-7");

        expect(result).toBe("Sorry, that tool is unavailable.");
        // Second call's messages should include the tool error
        const secondCallParams = mockRoutedChat.mock.calls[1][0] as LLMCallParams;
        const toolResultMsg = secondCallParams.messages.find(
            (m) => m.toolResults && m.toolResults.length > 0,
        );
        expect(toolResultMsg).toBeDefined();
        expect(toolResultMsg!.toolResults![0].content).toContain("Error:");
    });
});

describe("runAgentLoop — Max Iterations Guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns error after exceeding MAX_ITERATIONS (5)", async () => {
        // LLM always returns tool calls, never a text answer
        mockRoutedChat.mockResolvedValue({
            toolCalls: [
                { id: "call-loop", name: "get_current_time", args: {} },
            ],
        } satisfies LLMResponse);

        const result = await runAgentLoop("infinite loop test", "chat-8");

        expect(result).toContain("Error: Agent reached maximum iterations");
        expect(result).toContain("5");
        expect(mockRoutedChat).toHaveBeenCalledTimes(5);
    });

    it("respects custom maxIterations override", async () => {
        mockRoutedChat.mockResolvedValue({
            toolCalls: [
                { id: "call-loop", name: "get_current_time", args: {} },
            ],
        } satisfies LLMResponse);

        const result = await runAgentLoop(
            "custom limit test",
            "chat-9",
            undefined, // allowedToolNames
            undefined, // deniedToolNames
            2,         // maxIterations = 2
        );

        expect(result).toContain("Error: Agent reached maximum iterations (2)");
        expect(mockRoutedChat).toHaveBeenCalledTimes(2);
    });

    it("resolves before max iterations if LLM eventually returns text", async () => {
        // Three tool calls, then a text response
        mockRoutedChat
            .mockResolvedValueOnce({
                toolCalls: [{ id: "c1", name: "get_current_time", args: {} }],
            })
            .mockResolvedValueOnce({
                toolCalls: [{ id: "c2", name: "get_current_time", args: {} }],
            })
            .mockResolvedValueOnce({
                toolCalls: [{ id: "c3", name: "get_current_time", args: {} }],
            })
            .mockResolvedValueOnce({
                text: "Finally done after 4 iterations.",
            });

        const result = await runAgentLoop("multi-step", "chat-10");

        expect(result).toBe("Finally done after 4 iterations.");
        expect(mockRoutedChat).toHaveBeenCalledTimes(4);
    });
});

describe("runAgentLoop — Tool Permissions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("blocks tools not in allowedToolNames", async () => {
        // LLM tries to use web_search, but only get_current_time is allowed
        mockRoutedChat.mockResolvedValueOnce({
            toolCalls: [
                { id: "call-blocked", name: "web_search", args: { query: "test" } },
            ],
        } satisfies LLMResponse);

        mockRoutedChat.mockResolvedValueOnce({
            text: "Tool was blocked.",
        } satisfies LLMResponse);

        const result = await runAgentLoop(
            "restricted test",
            "chat-11",
            ["get_current_time"], // Only this tool is allowed
        );

        expect(result).toBe("Tool was blocked.");

        // Verify the tool result contains the permission error
        const secondCallParams = mockRoutedChat.mock.calls[1][0] as LLMCallParams;
        const toolResultMsg = secondCallParams.messages.find(
            (m) => m.toolResults && m.toolResults.length > 0,
        );
        expect(toolResultMsg!.toolResults![0].content).toContain("not permitted");
    });
});

describe("runAgentLoop — Empty Message", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("handles empty string message without crashing", async () => {
        mockRoutedChat.mockResolvedValue({
            text: "You sent an empty message.",
        } satisfies LLMResponse);

        const result = await runAgentLoop("", "chat-12");

        expect(result).toBe("You sent an empty message.");
    });
});
