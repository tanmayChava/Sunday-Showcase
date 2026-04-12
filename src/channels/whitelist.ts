import { Context, NextFunction } from "grammy";
import { ENV } from "../config.js";

/**
 * Grammy middleware to silently drop messages from unauthorized users.
 * Satisfies security requirement #1: User ID whitelist - only respond
 * to authorized Telegram user IDs. Silently ignore everyone else.
 */
export async function whitelistMiddleware(ctx: Context, next: NextFunction) {
  const userId = ctx.from?.id;

  // If we can't determine the user ID or it's not in our explicit whitelist, drop it.
  if (!userId || !ENV.ALLOWED_USER_IDS.has(String(userId))) {
    console.log(`[Security] Dropped message from unauthorized user: ${userId}`);
    return; // Stop the middleware chain, never call next()
  }

  // Proceed to next middleware/handler
  await next();
}
