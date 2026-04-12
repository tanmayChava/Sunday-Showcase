/**
 * Vitest setup — sets minimal environment variables
 * so config.ts doesn't throw during test imports.
 */

// Set the minimum required environment variables before any test imports
process.env.TELEGRAM_BOT_TOKEN = "test-token-telegram";
process.env.GEMINI_API_KEYS = "test-key-1,test-key-2";
process.env.ALLOWED_USER_IDS = "12345";
