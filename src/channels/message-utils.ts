/**
 * Shared Message Utilities for Channel Adapters
 *
 * Extracted from telegram.ts and discord.ts to eliminate duplication.
 */

/**
 * Split a long message into chunks that fit a platform's character limit.
 * Splits at paragraph boundaries first, then sentence boundaries.
 */
export function chunkMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Find a good split point: paragraph break > newline > sentence end > hard cut
        let splitAt = remaining.lastIndexOf("\n\n", maxLength);
        if (splitAt < maxLength * 0.3) {
            splitAt = remaining.lastIndexOf("\n", maxLength);
        }
        if (splitAt < maxLength * 0.3) {
            splitAt = remaining.lastIndexOf(". ", maxLength);
            if (splitAt > 0) splitAt += 1; // include the period
        }
        if (splitAt < maxLength * 0.3) {
            splitAt = maxLength;
        }

        chunks.push(remaining.substring(0, splitAt).trimEnd());
        remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
}

/**
 * Convert a raw Error into a clean, user-facing message.
 * Never leaks stack traces or internal paths.
 */
export function friendlyError(error: unknown, context: string): string {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();

    if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit")) {
        return "⚠️ The AI is under heavy load right now. All API keys are busy — try again in a moment.";
    }
    if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("api key")) {
        return "🔑 API authentication issue. Check your API keys in the config.";
    }
    if (lower.includes("403") || lower.includes("forbidden") || lower.includes("permission")) {
        return "🚫 Permission denied by the AI provider. The model may not be accessible with your API key.";
    }
    if (lower.includes("404") || (lower.includes("model") && lower.includes("not found")) || (lower.includes("model") && lower.includes("does not exist"))) {
        return "🤖 The selected AI model is unavailable or not found. Use /model to switch to a different one (e.g. /model flash-2.5).";
    }
    if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("econnreset")) {
        return "⏱️ The request timed out. The server might be slow — please try again.";
    }
    if (lower.includes("network") || lower.includes("enotfound") || lower.includes("econnrefused")) {
        return "📡 Network error. Check your internet connection and try again.";
    }
    if (lower.includes("supabase") || lower.includes("postgres")) {
        return "🗄️ Database error. Memory features may be temporarily unavailable.";
    }

    // Generic fallback — log internally but never expose raw error text to users
    console.error(`[Channel] ${context} error:`, error);
    return `❌ Something went wrong during ${context}. The issue has been logged.`;
}
