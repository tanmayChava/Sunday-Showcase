/**
 * Webhook Trigger — HTTP endpoint for external event notifications.
 *
 * Starts a lightweight Express-free HTTP server that receives POST
 * requests and forwards the payload as a Telegram message.
 *
 * Usage:
 *   POST http://your-server:PORT/webhook
 *   Headers: Authorization: Bearer YOUR_WEBHOOK_SECRET
 *   Body: { "message": "Deployment complete ✅" }
 *
 * This lets SUNDAY act as a notification hub for:
 *   - CI/CD events (GitHub Actions, Vercel deployments)
 *   - Server monitoring alerts
 *   - Home automation triggers
 *   - Cron job completions
 *   - Anything that can make an HTTP request
 *
 * Security:
 *   - Auth via Authorization header (not query string — avoids logging leaks)
 *   - Body size capped at 64 KB to prevent DoS
 *   - Per-IP rate limiting (30 requests/minute) to prevent abuse
 *   - No external dependencies — uses Node's built-in http module
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { Bot } from "grammy";

// ─── Types ────────────────────────────────────────────────────────

interface WebhookPayload {
    /** The message to send to Telegram */
    message: string;
    /** Optional title/source label */
    source?: string;
}

interface WebhookConfig {
    /** Port to listen on */
    port: number;
    /** Secret token for authentication */
    token: string;
    /** Telegram chat ID to send notifications to */
    chatId: string;
    /** Grammy bot instance for sending messages */
    bot: Bot;
}

// ─── Rate Limiter ─────────────────────────────────────────────────

/** Max requests allowed per IP within the time window. */
const RATE_LIMIT_MAX = 30;
/** Time window in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
/** How often to prune stale entries (5 minutes). */
const RATE_LIMIT_CLEANUP_MS = 5 * 60 * 1000;

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

/** Per-IP request counters. Exported for testability. */
export const rateLimitMap = new Map<string, RateLimitEntry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check whether an IP is rate-limited. Returns true if the request should
 * be allowed, false if the IP has exceeded the limit.
 */
export function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        // First request or window expired — start a new window
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return true;
    }

    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return false;
    }
    return true;
}

/**
 * Start a periodic cleanup of stale rate limit entries.
 * Prevents unbounded memory growth from many unique IPs.
 */
function startRateLimitCleanup(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [ip, entry] of rateLimitMap.entries()) {
            if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
                rateLimitMap.delete(ip);
            }
        }
    }, RATE_LIMIT_CLEANUP_MS);
    // Don't keep the process alive just for cleanup
    cleanupTimer.unref();
}

// ─── Server ───────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024; // 64 KB

let server: ReturnType<typeof createServer> | null = null;

/**
 * Start the webhook HTTP server.
 * Call this after Telegram is connected.
 */
export function startWebhookServer(config: WebhookConfig): void {
    const { port, token, chatId, bot } = config;

    // Start background cleanup of expired rate limit entries
    startRateLimitCleanup();

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // Only accept POST /webhook
        const url = new URL(req.url || "/", `http://localhost:${port}`);

        if (url.pathname !== "/webhook" || req.method !== "POST") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found. Use POST /webhook" }));
            return;
        }

        // ── Rate limiting (before auth to throttle brute-force guessing) ──
        const clientIp = req.headers["x-forwarded-for"]
            ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
            : req.socket.remoteAddress || "unknown";

        if (!checkRateLimit(clientIp)) {
            console.warn(`[Webhook] Rate limited IP: ${clientIp}`);
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Too many requests. Max 30 per minute." }));
            return;
        }

        // Validate token via Authorization header (secure — not in URL/logs)
        // Supports both "Bearer TOKEN" and plain "TOKEN" formats
        //
        // NOTE: Query string ?token= support was removed (security risk).
        // Tokens in URLs leak to HTTP access logs, proxy/CDN logs, and
        // Referrer headers. Use the Authorization header exclusively.
        const authHeader = req.headers["authorization"] || "";
        const reqToken = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (reqToken !== token) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid or missing token. Use Authorization: Bearer <token> header." }));
            return;
        }

        // Read body with size limit
        let body: string;
        try {
            body = await readBody(req, MAX_BODY_BYTES);
        } catch (err) {
            if ((err as Error).message === "Body too large") {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Payload too large (max 64 KB)" }));
                return;
            }
            console.error("[Webhook] Error reading body:", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
            return;
        }

        // Parse JSON — malformed body is a 400 (client error), not 500
        let payload: WebhookPayload;
        try {
            payload = JSON.parse(body);
        } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
            return;
        }

        if (!payload.message) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing 'message' in body" }));
            return;
        }

        // Build notification
        const source = payload.source ? `<b>${payload.source}</b>` : "<b>Webhook</b>";
        const notification = `🔔 ${source}\n\n${payload.message}`;

        // Send to Telegram with HTML parsing
        try {
            try {
                await bot.api.sendMessage(chatId, notification, { parse_mode: "HTML" });
            } catch {
                // HTML parsing failed — send plain text
                const plain = notification.replace(/<[^>]+>/g, "");
                await bot.api.sendMessage(chatId, plain);
            }

            console.log(
                `[Webhook] Received from ${payload.source || "unknown"}: ${payload.message.substring(0, 80)}`,
            );

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, sent: true }));
        } catch (err) {
            console.error("[Webhook] Error sending to Telegram:", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to deliver notification" }));
        }
    });

    server.listen(port, () => {
        console.log(`[Webhook] Listening on port ${port} — POST /webhook (Authorization: Bearer ****)`);
    });
}

/**
 * Stop the webhook server gracefully.
 */
export function stopWebhookServer(): void {
    if (server) {
        server.close();
        server = null;
        console.log("[Webhook] Server stopped.");
    }
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    rateLimitMap.clear();
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Read the request body with a byte size limit to prevent DoS.
 * Rejects with "Body too large" if the limit is exceeded.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
                req.destroy();
                reject(new Error("Body too large"));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}
