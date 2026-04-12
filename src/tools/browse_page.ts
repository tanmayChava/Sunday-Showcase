/**
 * browse_page tool — Uses Puppeteer for headless browser page rendering.
 *
 * Handles JavaScript-heavy pages, SPAs, and dynamic content that
 * simple fetch-based tools can't handle.
 */

import { Type, Tool } from "@google/genai";

export const browsePageDefinition: Tool = {
  functionDeclarations: [
    {
      name: "browse_page",
      description:
        "Open a web page in a headless browser and extract its rendered content. " +
        "Use this for JavaScript-heavy pages, SPAs, or pages that block simple HTTP requests. " +
        "For static pages, prefer read_url instead (it's faster and lighter).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: {
            type: Type.STRING,
            description: "The URL of the page to browse",
          },
          wait_for: {
            type: Type.STRING,
            description:
              "Optional CSS selector to wait for before extracting content (e.g. '#main-content'). Defaults to 'body'.",
          },
          extract_selector: {
            type: Type.STRING,
            description:
              "Optional CSS selector to extract content from (e.g. 'article'). Defaults to 'body' (full page).",
          },
        },
        required: ["url"],
      },
    },
  ],
};

const MAX_CONTENT_LENGTH = 4000;
const PAGE_TIMEOUT_MS = 30000;

/**
 * Execute a headless browser page fetch using Puppeteer.
 */
export async function executeBrowsePage(args: {
  url: string;
  wait_for?: string;
  extract_selector?: string;
}): Promise<string> {
  // Dynamic import to avoid loading Puppeteer if the tool is never used
  let puppeteer;
  try {
    puppeteer = await import("puppeteer");
  } catch {
    return "Error: Puppeteer is not installed. Run: npm install puppeteer";
  }

  const { url, wait_for = "body", extract_selector = "body" } = args;

  let browser;
  try {
    console.log(`[BrowsePage] Opening: ${url}`);

    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    // Set a reasonable viewport and user agent
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    );

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: PAGE_TIMEOUT_MS,
    });

    // Wait for the specified selector
    try {
      await page.waitForSelector(wait_for, { timeout: 10000 });
    } catch {
      console.warn(
        `[BrowsePage] Selector "${wait_for}" not found within timeout, proceeding anyway.`,
      );
    }

    // Extract text content from the target selector
    const content = await page.evaluate((selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return `No element found matching selector: ${selector}`;

      // Get text content, cleaning up excessive whitespace
      return (el as HTMLElement).innerText || el.textContent || "";
    }, extract_selector);

    await browser.close();
    browser = null;

    // Clean up whitespace and truncate
    const cleaned = content
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim();

    if (!cleaned) {
      return `Page loaded but no text content found at selector: ${extract_selector}`;
    }

    if (cleaned.length > MAX_CONTENT_LENGTH) {
      return (
        cleaned.substring(0, MAX_CONTENT_LENGTH) +
        `\n\n[... truncated — ${cleaned.length} total characters]`
      );
    }

    return cleaned;
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
    console.error("[BrowsePage] Error:", error);
    return `Browse failed: ${String(error)}`;
  }
}
