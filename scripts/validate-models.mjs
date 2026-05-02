/**
 * validate-models.mjs
 *
 * Probes every unique model ID in KNOWN_MODELS against the live APIs.
 * Sends a minimal one-token prompt and checks for a valid response.
 *
 * Usage:
 *   node scripts/validate-models.mjs
 *
 * Reads GEMINI_API_KEYS (or GEMINI_API_KEY) and OPENROUTER_API_KEY from .env
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env manually (no dotenv dependency needed) ─────────────────────────
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    console.error("⚠️  Could not load .env — make sure it exists in the project root.");
  }
}
loadEnv();

// ── API keys ──────────────────────────────────────────────────────────────────
const GEMINI_KEY = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")[0].trim();
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";

if (!GEMINI_KEY)    console.warn("⚠️  GEMINI_API_KEYS not set — Gemini models will fail.");
if (!OPENROUTER_KEY) console.warn("⚠️  OPENROUTER_API_KEY not set — OpenRouter models will fail.");

// ── All unique model IDs from KNOWN_MODELS (slash-commands.ts) ───────────────
// Gemini models (startsWith "gemini-")
const GEMINI_MODELS = [
  // 3.1 (reported 404)
  "gemini-3.1-pro-latest",
  "gemini-3.1-flash-latest",
  "gemini-3.1-flash-lite-latest",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-image-preview",
  // 3.0
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  // 2.5
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  // 2.0 (deprecated)
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  // 1.5 (legacy)
  "gemini-1.5-pro-latest",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b",
];

// OpenRouter models (contain "/")
const OPENROUTER_MODELS = [
  // Llama 4
  "meta-llama/llama-4-maverick:free",
  "meta-llama/llama-4-scout:free",
  "meta-llama/llama-4-maverick",
  "meta-llama/llama-3.3-70b-instruct",
  // DeepSeek
  "deepseek/deepseek-chat-v3-0324:free",
  "deepseek/deepseek-r1-0528:free",
  "deepseek/deepseek-r1-zero:free",
  // Qwen
  "qwen/qwen3-235b-a22b:free",
  "qwen/qwen3-coder-480b-a35b:free",
  // Mistral free
  "mistralai/mistral-small-3.1-24b-instruct:free",
  // Mistral paid
  "mistralai/mistral-large",
  // Microsoft / NVIDIA
  "microsoft/phi-4-reasoning-plus:free",
  "nvidia/nemotron-3-super:free",
  // Misc free
  "openai/gpt-oss-20b:free",
  "stepfun/step-3.5-flash:free",
  "arcee-ai/trinity-mini:free",
  // Claude
  "anthropic/claude-3.7-sonnet",
  "anthropic/claude-3.5-haiku",
  // GPT
  "openai/gpt-4o",
  "openai/o4-mini",
  // Google via OpenRouter
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
];

const PROBE_PROMPT = "Reply with exactly one word: OK";
const TIMEOUT_MS = 15_000;

// ── Gemini probe ──────────────────────────────────────────────────────────────
async function probeGemini(model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
    generationConfig: { maxOutputTokens: 8, temperature: 0 },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      return { ok: true, detail: `"${text.substring(0, 30)}"` };
    } else {
      const json = await res.json().catch(() => ({}));
      const msg = json?.error?.message || res.statusText;
      return { ok: false, detail: `HTTP ${res.status} — ${msg.substring(0, 80)}` };
    }
  } catch (err) {
    clearTimeout(timer);
    const name = err.name === "AbortError" ? "TIMEOUT" : err.message?.substring(0, 60);
    return { ok: false, detail: name };
  }
}

// ── OpenRouter probe ──────────────────────────────────────────────────────────
async function probeOpenRouter(model) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: PROBE_PROMPT }],
    max_tokens: 8,
    temperature: 0,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": "https://sunday-agent.app",
        "X-Title": "SUNDAY Model Validator",
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content?.trim() || "";
      return { ok: true, detail: `"${text.substring(0, 30)}"` };
    } else {
      const json = await res.json().catch(() => ({}));
      const msg = json?.error?.message || res.statusText;
      return { ok: false, detail: `HTTP ${res.status} — ${msg.substring(0, 80)}` };
    }
  } catch (err) {
    clearTimeout(timer);
    const name = err.name === "AbortError" ? "TIMEOUT" : err.message?.substring(0, 60);
    return { ok: false, detail: name };
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
function pad(str, len) {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

async function runAll() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║        SUNDAY Model Validator — Live API Probe                  ║");
  console.log(`║  Probe: "${PROBE_PROMPT}"  (${TIMEOUT_MS/1000}s timeout)         ║`);
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  let pass = 0, fail = 0;
  const results = [];

  // ── Gemini ──────────────────────────────────────────────────────────────────
  console.log("━━━  GEMINI MODELS  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  if (!GEMINI_KEY) {
    console.log("  [SKIP] No GEMINI_API_KEY found.\n");
  } else {
    for (const model of GEMINI_MODELS) {
      process.stdout.write(`  ${pad(model, 42)} … `);
      const { ok, detail } = await probeGemini(model);
      if (ok) { pass++; console.log(`✅  ${detail}`); }
      else     { fail++; console.log(`❌  ${detail}`); }
      results.push({ provider: "Gemini", model, ok, detail });
      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── OpenRouter ──────────────────────────────────────────────────────────────
  console.log("\n━━━  OPENROUTER MODELS  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  if (!OPENROUTER_KEY) {
    console.log("  [SKIP] No OPENROUTER_API_KEY found.\n");
  } else {
    for (const model of OPENROUTER_MODELS) {
      process.stdout.write(`  ${pad(model, 42)} … `);
      const { ok, detail } = await probeOpenRouter(model);
      if (ok) { pass++; console.log(`✅  ${detail}`); }
      else     { fail++; console.log(`❌  ${detail}`); }
      results.push({ provider: "OpenRouter", model, ok, detail });
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const total = pass + fail;
  console.log("\n━━━  SUMMARY  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`  Total tested : ${total}`);
  console.log(`  ✅ Working   : ${pass}`);
  console.log(`  ❌ Broken    : ${fail}`);

  if (fail > 0) {
    console.log("\n  BROKEN MODELS (remove/redirect these):");
    for (const r of results) {
      if (!r.ok) console.log(`    ❌  [${r.provider}]  ${r.model}`);
    }
  }
  console.log("");
}

runAll().catch(console.error);
