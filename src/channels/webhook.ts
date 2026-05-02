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
 *
 * IMP-01 — HTTPS requirement:
 *   This server itself speaks plain HTTP. It MUST be placed behind a
 *   TLS-terminating reverse proxy (nginx, Caddy, Cloudflare Tunnel, Railway,
 *   etc.) before being exposed to the internet. The bearer token travels in an
 *   HTTP header and will be readable in plaintext if TLS is not enforced.
 *   Set WEBHOOK_BEHIND_PROXY=true in .env to silence this warning once you
 *   have confirmed TLS termination is in place.
 *
 * IMP-02 — X-Forwarded-For trust:
 *   X-Forwarded-For can be forged by any client unless it is stripped and
 *   re-written by a trusted upstream proxy. SUNDAY only reads XFF for
 *   rate-limiting when WEBHOOK_TRUSTED_PROXY=true is explicitly set, signalling
 *   that a trusted proxy is rewriting the header. Without it, the raw TCP
 *   socket address is used exclusively.
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

    // ── IMP-01: HTTPS enforcement warning ─────────────────────────────────
    // This server speaks plain HTTP. If it is reachable from the internet
    // without a TLS-terminating proxy in front of it, the bearer token and
    // all payloads travel in cleartext. Emit a loud warning unless the
    // operator has explicitly acknowledged proxy-based TLS termination.
    const behindProxy = process.env.WEBHOOK_BEHIND_PROXY === "true";
    if (!behindProxy) {
        console.warn(
            "[Webhook] ⚠️  SECURITY WARNING (IMP-01): The webhook server is running on",
            `plain HTTP (port ${port}). This is only safe if a TLS-terminating`,
            "reverse proxy (nginx, Caddy, Cloudflare Tunnel, Railway HTTPS) sits",
            "in front of it. Set WEBHOOK_BEHIND_PROXY=true in .env once TLS is",
            "confirmed to silence this warning.",
        );
    }

    // ── IMP-02: Trusted-proxy guard for X-Forwarded-For ──────────────────
    // Only trust XFF when an explicit env var confirms a controlled proxy
    // is sanitising the header. Without this, any client can spoof the
    // header to bypass per-IP rate limits.
    const trustProxy = process.env.WEBHOOK_TRUSTED_PROXY === "true";
    if (!trustProxy) {
        console.log(
            "[Webhook] Rate limiter using raw socket IP (WEBHOOK_TRUSTED_PROXY not set).",
        );
    }

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
        // IMP-02: Only read X-Forwarded-For when WEBHOOK_TRUSTED_PROXY=true.
        // Blindly trusting XFF lets any attacker forge the header and evade
        // per-IP rate limits entirely. A controlled upstream proxy must strip
        // and re-inject the header before it can be trusted.
        const rawSocketIp = req.socket.remoteAddress || "unknown";
        const clientIp = trustProxy && req.headers["x-forwarded-for"]
            ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
            : rawSocketIp;

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

        // IMP-04: Prompt Injection via payload.message
        // payload.message is delivered to Telegram with parse_mode:"HTML".
        // A malicious caller (or compromised CI system) could embed HTML tags
        // that Telegram renders — e.g. <a href="...">, <b>, hidden characters,
        // or ANSI escape sequences that might affect log parsing.
        // Strip all HTML tags and control chars before building the notification.
        const MAX_MESSAGE_LENGTH = 2000;
        const MAX_SOURCE_LENGTH = 100;

        const sanitizeText = (raw: string): string =>
            raw
                .replace(/<[^>]*>/g, "")           // strip all HTML tags
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars
                .trim();

        const safeMessage = sanitizeText(payload.message).substring(0, MAX_MESSAGE_LENGTH);
        const safeSource  = payload.source
            ? sanitizeText(payload.source).substring(0, MAX_SOURCE_LENGTH)
            : null;

        if (!safeMessage) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "'message' is empty after sanitisation" }));
            return;
        }

        // Build notification — use sanitised values only, escape for HTML
        const escapeHtml = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const source = safeSource
            ? `<b>${escapeHtml(safeSource)}</b>`
            : "<b>Webhook</b>";
        const notification = `🔔 ${source}\n\n${escapeHtml(safeMessage)}`;

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
                `[Webhook] Received from ${safeSource || "unknown"}: ${safeMessage.substring(0, 80)}`,
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
