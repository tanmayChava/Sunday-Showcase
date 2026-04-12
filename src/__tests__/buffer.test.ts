/**
 * Tests for Conversation Buffer (Tier 2 Memory)
 *
 * buffer.ts is the most data-critical module in SUNDAY.
 * These tests validate:
 *   - Save and retrieve round-trips
 *   - Supabase offline graceful degradation (returns [], no crash)
 *   - Message chronological ordering
 *   - Clear chat history + rolling summary deletion
 *   - Message count
 *   - compactChatHistory edge cases (null Supabase, empty messages)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────

const mockSetCoreMemory = vi.fn();
const mockDeleteCoreMemory = vi.fn();
const mockGetCoreMemory = vi.fn(() => null as string | null);

vi.mock("../memory/core.js", () => ({
    setCoreMemory: (...args: any[]) => mockSetCoreMemory(...args),
    deleteCoreMemory: (...args: any[]) => mockDeleteCoreMemory(...args),
    getCoreMemory: (key: string) => (mockGetCoreMemory as any)(key),
}));

const mockRoutedChat = vi.fn();
vi.mock("../lib/router.js", () => ({
    routedChat: (...args: any[]) => mockRoutedChat(...args),
}));

vi.mock("../config.js", () => ({
    ENV: { GEMINI_MODEL: "gemini-2.5-flash" },
}));

// ─── Supabase mock ────────────────────────────────────────────────

/**
 * Builds a flat Supabase mock where every chainable method is thenable.
 * This matches how the real Supabase PostgREST builder works: any
 * step in the chain can be awaited.
 */
function makeSupabase(overrides: {
    insertResult?: { error: null | { message: string } };
    selectData?: any[];
    selectCount?: number | null;
    selectError?: { message: string } | null;
    deleteError?: { message: string } | null;
} = {}) {
    const {
        insertResult = { error: null },
        selectData = [],
        selectCount = null,
        selectError = null,
        deleteError = null,
    } = overrides;

    // A thenable chain node - awaiting it resolves to { data, error }
    const makeDataChain = (): any => new Proxy({}, {
        get(_target, prop) {
            if (prop === "then") {
                return (resolve: Function) =>
                    Promise.resolve({ data: selectData, error: selectError }).then(resolve);
            }
            // Any chainable method returns a fresh thenable chain
            return vi.fn(() => makeDataChain());
        },
    });

    // Count query chain - resolves to { count, error }
    const makeCountChain = (): any => new Proxy({}, {
        get(_target, prop) {
            if (prop === "then") {
                return (resolve: Function) =>
                    Promise.resolve({ count: selectCount, error: selectError }).then(resolve);
            }
            return vi.fn(() => makeCountChain());
        },
    });

    // Delete chain - resolves to { error }
    const makeDeleteChain = (): any => new Proxy({}, {
        get(_target, prop) {
            if (prop === "then") {
                return (resolve: Function) =>
                    Promise.resolve({ error: deleteError }).then(resolve);
            }
            return vi.fn(() => makeDeleteChain());
        },
    });

    // Insert - resolves to insertResult
    const insertFn = vi.fn(() => ({
        then: (resolve: Function) => Promise.resolve(insertResult).then(resolve),
    }));

    const fromFn = vi.fn(() => ({
        insert: insertFn,
        delete: vi.fn(() => makeDeleteChain()),
        select: vi.fn((cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) return makeCountChain();
            return makeDataChain();
        }),
    }));

    return { from: fromFn, insertFn };
}

// ─── Supabase module mock ─────────────────────────────────────────

let mockSb: ReturnType<typeof makeSupabase> | null = null;

vi.mock("../lib/supabase.js", () => ({
    getSupabase: () => mockSb,
}));

// ─── Import after mocks ───────────────────────────────────────────

import {
    saveMessage,
    getRecentMessages,
    clearChatHistory,
    getMessageCount,
    compactChatHistory,
} from "../memory/buffer.js";

// ─── Tests ────────────────────────────────────────────────────────

describe("saveMessage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does nothing when Supabase is null (offline mode)", async () => {
        mockSb = null;
        await expect(saveMessage("chat-1", "user", "hello")).resolves.toBeUndefined();
    });

    it("calls insert on the messages table", async () => {
        mockSb = makeSupabase({ selectCount: 1 });
        await saveMessage("chat-1", "user", "hello");
        expect(mockSb.from).toHaveBeenCalledWith("messages");
        expect(mockSb.insertFn).toHaveBeenCalled();
    });

    it("handles insert error gracefully without throwing", async () => {
        mockSb = makeSupabase({
            insertResult: { error: { message: "DB write failure" } },
        });
        await expect(saveMessage("chat-1", "user", "hi")).resolves.toBeUndefined();
    });
});

describe("getRecentMessages", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns empty array when Supabase is null", async () => {
        mockSb = null;
        const result = await getRecentMessages("chat-1");
        expect(result).toEqual([]);
    });

    it("returns messages in chronological order (oldest first after reverse)", async () => {
        // Supabase returns in DESC order (newest first)
        const msgs = [
            { role: "user", content: "newest", created_at: "2026-04-09T03:00:00Z" },
            { role: "model", content: "middle", created_at: "2026-04-09T02:00:00Z" },
            { role: "user", content: "oldest", created_at: "2026-04-09T01:00:00Z" },
        ];
        mockSb = makeSupabase({ selectData: msgs });
        const result = await getRecentMessages("chat-1");
        // buffer.ts calls .reverse() on DESC data → oldest first
        expect(result[0].content).toBe("oldest");
        expect(result[2].content).toBe("newest");
    });

    it("returns empty array on Supabase fetch error", async () => {
        mockSb = makeSupabase({ selectError: { message: "connection refused" } });
        const result = await getRecentMessages("chat-1");
        expect(result).toEqual([]);
    });

    it("returns empty array when no messages exist", async () => {
        mockSb = makeSupabase({ selectData: [] });
        const result = await getRecentMessages("chat-1");
        expect(result).toEqual([]);
    });
});

describe("clearChatHistory", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does nothing when Supabase is null", async () => {
        mockSb = null;
        await expect(clearChatHistory("chat-1")).resolves.toBeUndefined();
    });

    it("calls delete on the messages table and removes rolling summary", async () => {
        mockSb = makeSupabase();
        await clearChatHistory("chat-42");
        expect(mockSb.from).toHaveBeenCalledWith("messages");
        expect(mockDeleteCoreMemory).toHaveBeenCalledWith("rolling_summary_chat-42");
    });
});

describe("getMessageCount", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 0 when Supabase is null", async () => {
        mockSb = null;
        const count = await getMessageCount("chat-1");
        expect(count).toBe(0);
    });

    it("returns 0 on Supabase count error", async () => {
        mockSb = makeSupabase({ selectError: { message: "timeout" } });
        const count = await getMessageCount("chat-1");
        expect(count).toBe(0);
    });
});

describe("compactChatHistory (manual /compact)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCoreMemory.mockReturnValue(null);
        mockRoutedChat.mockResolvedValue({ text: "## Summary\n- Key fact" });
    });

    it("returns unavailable message when Supabase is null", async () => {
        mockSb = null;
        const result = await compactChatHistory("chat-1");
        expect(result).toContain("unavailable");
        expect(mockRoutedChat).not.toHaveBeenCalled();
    });

    it("returns info message when there are no messages to compact", async () => {
        mockSb = makeSupabase({ selectData: [] });
        const result = await compactChatHistory("chat-1");
        expect(result).toContain("No messages");
        expect(mockRoutedChat).not.toHaveBeenCalled();
    });

    it("calls routedChat to generate summary when messages exist", async () => {
        const messages = [
            { id: "1", role: "user", content: "Build a React app" },
            { id: "2", role: "model", content: "Let's start with Vite" },
        ];
        mockSb = makeSupabase({ selectData: messages });
        mockRoutedChat.mockResolvedValue({ text: "## Key Context\n- Building React app" });

        const result = await compactChatHistory("chat-1");

        expect(mockRoutedChat).toHaveBeenCalledTimes(1);
        expect(mockSetCoreMemory).toHaveBeenCalledWith(
            "rolling_summary_chat-1",
            expect.stringContaining("React"),
        );
        expect(result).toContain("Compacted");
        expect(result).toContain("2 messages");
    });

    it("returns warning when LLM returns empty summary (data loss prevention)", async () => {
        const messages = [{ id: "1", role: "user", content: "Hello" }];
        mockSb = makeSupabase({ selectData: messages });
        mockRoutedChat.mockResolvedValue({ text: "" });

        const result = await compactChatHistory("chat-1");

        expect(result).toContain("Could not generate summary");
        // Summary should NOT be saved
        expect(mockSetCoreMemory).not.toHaveBeenCalled();
    });

    it("includes existing rolling summary in prompt when one exists", async () => {
        const messages = [{ id: "1", role: "user", content: "Project update" }];
        (mockGetCoreMemory as any).mockReturnValue("Existing: working on React");
        mockSb = makeSupabase({ selectData: messages });

        await compactChatHistory("chat-1");

        const callArgs = mockRoutedChat.mock.calls[0][0];
        expect(callArgs.messages[0].content).toContain("Previous summary");
        expect(callArgs.messages[0].content).toContain("Project update");
    });
});
