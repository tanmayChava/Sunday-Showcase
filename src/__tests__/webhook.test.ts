/**
 * Tests for Webhook Server — HTTP API, Auth, Rate Limiting, Error Handling
 *
 * Uses Node's built-in http module to make real HTTP requests against
 * the webhook server. Grammy bot is mocked so no Telegram API calls are made.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer } from "http";
import {
    startWebhookServer,
    stopWebhookServer,
    checkRateLimit,
    rateLimitMap,
} from "../channels/webhook.js";

// ─── Test Config ──────────────────────────────────────────────────

const TEST_PORT = 19876; // High port unlikely to collide
const TEST_TOKEN = "test-webhook-secret-token";
const TEST_CHAT_ID = "123456";
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Track messages sent via the mock bot
const sentMessages: Array<{ chatId: string | number; text: string; opts?: unknown }> = [];

// Grammy Bot mock — only needs api.sendMessage
const mockBot = {
    api: {
        sendMessage: async (chatId: string | number, text: string, opts?: unknown) => {
            sentMessages.push({ chatId, text, opts });
            return { message_id: 1 };
        },
    },
} as any;

// ─── Helpers ──────────────────────────────────────────────────────

async function webhookRequest(opts: {
    method?: string;
    path?: string;
    token?: string;
    body?: unknown;
    rawBody?: string;
}): Promise<{ status: number; body: any }> {
    const {
        method = "POST",
        path = "/webhook",
        token = TEST_TOKEN,
        body,
        rawBody,
    } = opts;

    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const payload = rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined);

    const response = await fetch(url, {
        method,
        headers,
        body: payload,
    });

    let responseBody: any;
    try {
        responseBody = await response.json();
    } catch {
        responseBody = null;
    }

    return { status: response.status, body: responseBody };
}

// ─── Lifecycle ────────────────────────────────────────────────────

beforeAll(() => {
    startWebhookServer({
        port: TEST_PORT,
        token: TEST_TOKEN,
        chatId: TEST_CHAT_ID,
        bot: mockBot,
    });
});

afterAll(() => {
    stopWebhookServer();
});

beforeEach(() => {
    sentMessages.length = 0;
    rateLimitMap.clear();
});

// ─── Tests ────────────────────────────────────────────────────────

describe("Webhook — Happy Path", () => {
    it("accepts valid POST with Bearer token and sends message", async () => {
        const { status, body } = await webhookRequest({
            body: { message: "Deploy complete ✅", source: "GitHub Actions" },
        });

        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.sent).toBe(true);

        // Verify Telegram message was sent
        expect(sentMessages.length).toBe(1);
        expect(sentMessages[0].chatId).toBe(TEST_CHAT_ID);
        expect(sentMessages[0].text).toContain("Deploy complete");
        expect(sentMessages[0].text).toContain("GitHub Actions");
    });

    it("uses default 'Webhook' label when source is missing", async () => {
        const { status } = await webhookRequest({
            body: { message: "Something happened" },
        });

        expect(status).toBe(200);
        expect(sentMessages[0].text).toContain("Webhook");
    });
});

describe("Webhook — Authentication", () => {
    it("returns 401 for missing Authorization header", async () => {
        const { status, body } = await webhookRequest({
            token: "",
            body: { message: "test" },
        });

        expect(status).toBe(401);
        expect(body.error).toContain("Invalid or missing token");
        expect(sentMessages.length).toBe(0);
    });

    it("returns 401 for wrong token", async () => {
        const { status } = await webhookRequest({
            token: "wrong-token",
            body: { message: "test" },
        });

        expect(status).toBe(401);
        expect(sentMessages.length).toBe(0);
    });

    it("accepts plain token (without Bearer prefix) in header", async () => {
        // The server strips "Bearer " prefix, so a plain token should match
        // only if it equals the configured token exactly
        const url = `${BASE_URL}/webhook`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": TEST_TOKEN, // No "Bearer " prefix
            },
            body: JSON.stringify({ message: "plain header" }),
        });

        expect(response.status).toBe(200);
    });
});

describe("Webhook — Route Validation", () => {
    it("returns 404 for GET /webhook", async () => {
        const { status, body } = await webhookRequest({ method: "GET" });
        expect(status).toBe(404);
        expect(body.error).toContain("Not found");
    });

    it("returns 404 for POST /other-path", async () => {
        const { status } = await webhookRequest({ path: "/other" });
        expect(status).toBe(404);
    });

    it("returns 404 for POST /", async () => {
        const { status } = await webhookRequest({ path: "/" });
        expect(status).toBe(404);
    });
});

describe("Webhook — Body Validation", () => {
    it("returns 400 for non-JSON body", async () => {
        const { status, body } = await webhookRequest({
            rawBody: "this is not json",
        });

        expect(status).toBe(400);
        expect(body.error).toContain("Invalid JSON");
        expect(sentMessages.length).toBe(0);
    });

    it("returns 400 for missing 'message' field", async () => {
        const { status, body } = await webhookRequest({
            body: { source: "test" }, // no 'message'
        });

        expect(status).toBe(400);
        expect(body.error).toContain("Missing 'message'");
    });

    it("returns 400 for empty object body", async () => {
        const { status } = await webhookRequest({ body: {} });
        expect(status).toBe(400);
    });
});

describe("Webhook — Query String Token Removed", () => {
    it("does NOT accept token via query string (security fix)", async () => {
        const url = `${BASE_URL}/webhook?token=${TEST_TOKEN}`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "should not work" }),
        });

        // No Authorization header → must fail, even with correct token in query string
        expect(response.status).toBe(401);
        expect(sentMessages.length).toBe(0);
    });
});

// ─── Rate Limiter Unit Tests ──────────────────────────────────────

describe("checkRateLimit", () => {
    beforeEach(() => {
        rateLimitMap.clear();
    });

    it("allows first request from a new IP", () => {
        expect(checkRateLimit("1.2.3.4")).toBe(true);
    });

    it("allows up to 30 requests from the same IP", () => {
        for (let i = 0; i < 30; i++) {
            expect(checkRateLimit("10.0.0.1")).toBe(true);
        }
    });

    it("blocks the 31st request from the same IP", () => {
        for (let i = 0; i < 30; i++) {
            checkRateLimit("10.0.0.2");
        }
        expect(checkRateLimit("10.0.0.2")).toBe(false);
    });

    it("does not affect different IPs", () => {
        for (let i = 0; i < 30; i++) {
            checkRateLimit("10.0.0.3");
        }
        // 10.0.0.3 is now rate-limited
        expect(checkRateLimit("10.0.0.3")).toBe(false);
        // But a different IP is fine
        expect(checkRateLimit("10.0.0.4")).toBe(true);
    });

    it("resets after the time window expires", () => {
        // Manually set an entry with an old windowStart
        rateLimitMap.set("10.0.0.5", {
            count: 30,
            windowStart: Date.now() - 61_000, // 61 seconds ago (window is 60s)
        });

        // Should be allowed again (window expired)
        expect(checkRateLimit("10.0.0.5")).toBe(true);

        // Counter should have been reset to 1
        const entry = rateLimitMap.get("10.0.0.5")!;
        expect(entry.count).toBe(1);
    });
});

describe("Webhook — Rate Limiting Integration", () => {
    beforeEach(() => {
        rateLimitMap.clear();
        sentMessages.length = 0;
    });

    it("returns 429 after exceeding rate limit", async () => {
        // Exhaust rate limit by submitting 30 requests directly
        for (let i = 0; i < 30; i++) {
            checkRateLimit("127.0.0.1");
        }

        // The next real HTTP request from the same local IP should be rate-limited
        // Note: in tests, the client IP will be 127.0.0.1 or ::1
        // We pre-fill both to be safe
        for (let i = 0; i < 30; i++) {
            checkRateLimit("::1");
            checkRateLimit("::ffff:127.0.0.1");
        }

        const { status, body } = await webhookRequest({
            body: { message: "should be rate limited" },
        });

        expect(status).toBe(429);
        expect(body.error).toContain("Too many requests");
        expect(sentMessages.length).toBe(0);
    });
});
