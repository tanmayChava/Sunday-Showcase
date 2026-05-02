/**
 * Core Agent Loop — Provider-Agnostic with 3-Tier Memory, Skills, and MCP
 *
 * Context Assembly Order:
 *   1. System rules (soul.md)
 *   2. Active Skills
 *   3. Tool usage rules
 *   4. Tier 1 Core Memory
 *   5. Tier 2 Rolling Summary
 *   6. Tier 3 Top 3-5 Semantic Memories
 *   7. Current user message
 *
 * Provider Routing:
 *   - Gemini models  → @google/genai SDK (with key rotation)
 *   - OpenRouter models → OpenAI SDK (native, first-class)
 *   - Automatic fallback: Gemini → OpenRouter on failure
 *
 * Tool Registry:
 *   Built-in tools are registered centrally via initBuiltinTools() in
 *   tools/registry.ts. MCP tools are merged dynamically on each iteration.
 *   An optional `allowedToolNames` filter restricts which tools are
 *   visible/executable (used by sub-agents).
 */

import { readFileSync, statSync } from "fs";
import { resolve } from "path";

// Provider-agnostic types + router
import type {
  LLMMessage,
  LLMToolResult,
  LLMToolSchema,
  LLMResponse,
} from "../lib/llm.js";
import { routedChat, getProviderName } from "../lib/router.js";
import { geminiToolsToSchemas } from "../lib/tool-bridge.js";

import { ENV } from "../config.js";
import { getRuntimeConfig } from "../lib/config-sync.js";

// Centralized tool registry
import {
  initBuiltinTools,
  getFilteredToolEntries,
  getToolDefinitions,
  getToolExecutor,
} from "../tools/registry.js";

// Memory tiers
import { buildCoreMemoryPrompt, getCoreMemory } from "../memory/core.js";
import { saveMessage, getRecentMessages } from "../memory/buffer.js";
import {
  buildSemanticPrompt,
  triggerFactExtraction,
} from "../memory/semantic.js";
import {
  buildUserProfilePrompt,
  triggerUserProfileUpdate,
} from "../memory/user-profile.js";

// Skills system
import { buildSkillsPrompt } from "../skills/loader.js";

// MCP system
import { mcpManager } from "../mcp/mcp-manager.js";

// Session stats tracking
import { recordTokenUsage } from "../commands/session-stats.js";

// Slash commands — model override
import { getEffectiveModel } from "../commands/slash-commands.js";

const MAX_ITERATIONS = 5;
const MAX_LOOP_TIMEOUT_MS = 300_000; // 300 seconds (5 min) — job searches can take 2–5 min across platforms

// ─── Soul (loaded once at startup) ───────────────────────────────
//
// IMP-06: soul.md is loaded from the filesystem with no prior validation.
// A corrupted, oversized, or adversarially crafted file would silently
// poison the system prompt for EVERY LLM call. Guards added:
//   1. Max file size of 64 KB — anything larger is almost certainly wrong.
//   2. NUL-byte rejection — NUL bytes break context parsing and may indicate
//      binary corruption or an injection attempt.
//   3. Minimum content check — an empty file would wipe the agent's identity.

const SOUL_MAX_BYTES = 64 * 1024; // 64 KB

let soulPrompt = "";
try {
  const soulPath = resolve(process.cwd(), "soul.md");
  const stat = statSync(soulPath);

  if (stat.size > SOUL_MAX_BYTES) {
    throw new Error(
      `soul.md is oversized (${stat.size} bytes, max ${SOUL_MAX_BYTES}). ` +
      "Refusing to load — truncated system prompts cause undefined behaviour.",
    );
  }

  const raw = readFileSync(soulPath, "utf-8");

  if (raw.includes("\x00")) {
    throw new Error(
      "soul.md contains NUL bytes — possible file corruption or injection attempt. Refusing to load.",
    );
  }

  const trimmed = raw.trim();
  if (trimmed.length < 20) {
    throw new Error(
      `soul.md appears empty or too short (${trimmed.length} chars). ` +
      "Refusing to use it as a system prompt.",
    );
  }

  soulPrompt = trimmed;
  console.log(`[Soul] Loaded personality from soul.md (${stat.size} bytes).`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[Soul] soul.md not loaded — ${msg}`);
  console.warn("[Soul] Falling back to built-in default personality.");
  soulPrompt = "You are SUNDAY (Superior Universal Neural Digital Assistant Yield), a sharp personal AI agent.";
}

// ─── Register Built-in Tools ─────────────────────────────────────
// Tools are now registered via initBuiltinTools() in tools/registry.ts.
// This call is the only coupling point — loop.ts no longer imports or
// registers individual tool modules directly.
await initBuiltinTools();

// Tool usage rules (appended after soul + skills)
const toolRules =
  "## Tool Usage Rules\n\n" +

  "### NEVER refuse a task you have tools to handle.\n" +
  "If the user asks for real-time data, job listings, news, prices, search results, " +
  "or any live/current information — USE YOUR TOOLS. Do NOT say 'I cannot browse the web' " +
  "or 'I don't have access to real-time data'. You DO have web_search, web_research, " +
  "browse_page, and read_url tools. USE THEM.\n\n" +

  "### Job Searches & Aggregation Tasks:\n" +
  "When asked to find jobs, listings, or aggregate data from multiple sources — " +
  "use web_search or web_research to search each source (LinkedIn, Naukri, Indeed, " +
  "company career portals, etc.) and compile real results. For deep multi-source " +
  "research tasks, delegate to the 'research' agent. Never refuse these tasks — " +
  "just start searching and report what you find.\n\n" +

  "### General Tool Rules:\n" +
  "- Use web_search for quick lookups of current/real-time information.\n" +
  "- Use web_research for structured deep dives (it does multiple searches).\n" +
  "- Use browse_page to read a specific URL or page.\n" +
  "- Use read_url to extract content from a direct link.\n" +
  "- Use remember_fact ONLY when the user states a clear preference, defines a long-term goal, " +
  "provides personal profile info, sets a recurring routine, or explicitly asks you to remember something.\n" +
  "- Do NOT save casual conversation, jokes, small talk, or temporary emotions.\n" +
  "- You CAN answer general knowledge questions directly from training data — no tool needed.\n\n" +

  "### Delegation (delegate tool):\n" +
  "Use the delegate tool for deep multi-step work: thorough research (use 'research' agent), " +
  "code generation/review (use 'code' agent), content summarization (use 'summary' agent), " +
  "creative writing (use 'creative' agent), data analysis (use 'analyst' agent), " +
  "job searching / job scraping tasks (use 'jobs' agent — it has the apify_job_search tool), " +
  "or news/current events/breaking news (use 'news' agent — it aggressively searches for the latest headlines). " +
  "For quick, simple questions — answer directly.";

// ─── System Instruction Builder ──────────────────────────────────

/**
 * Build the full system instruction with all memory tiers injected.
 */
async function buildSystemInstruction(
  chatId: string,
  userMessage: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Soul + system rules
  parts.push(soulPrompt);

  // 2. Current date/time (injected fresh on every request)
  const nowIST = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "long",
  });
  parts.push(
    `## Current Date & Time\n` +
    `The current date and time is: **${nowIST}** (Indian Standard Time).\n` +
    `Always use this as the authoritative date. When searching for news or current events, ` +
    `always include the current year (${new Date().getFullYear()}) and month in your search queries ` +
    `to ensure you get fresh results and not stale/old articles.`,
  );

  // 3. Skills (hot-reloaded from Supabase + local files)
  const currentSkillsPrompt = buildSkillsPrompt();
  if (currentSkillsPrompt) {
    parts.push(currentSkillsPrompt);
  }

  // 4. Tool usage rules
  parts.push(toolRules);

  // 5. Tier 1 Core Memory
  const coreMemory = buildCoreMemoryPrompt();
  if (coreMemory) {
    parts.push(coreMemory);
  }

  // 5b. User Profile (always active, injected after core memory)
  const userProfileBlock = buildUserProfilePrompt();
  if (userProfileBlock) {
    parts.push(userProfileBlock);
  }

  // 6. Tier 2 Rolling Summary
  const rollingSummary = getCoreMemory(`rolling_summary_${chatId}`);
  if (rollingSummary) {
    parts.push(`## Conversation Summary (Older Context)\n${rollingSummary}`);
  }

  // 7. Tier 3 Semantic Memories (top 3-5)
  if (getRuntimeConfig().semanticMemory) {
    try {
      const semanticBlock = await buildSemanticPrompt(userMessage);
      if (semanticBlock) {
        parts.push(semanticBlock);
      }
    } catch (err) {
      console.warn("[Loop] Semantic memory unavailable, skipping Tier 3.");
    }
  }

  return parts.join("\n\n");
}

// ─── Tool Execution Helper ───────────────────────────────────────

/**
 * Execute a tool by name, checking the registry first, then MCP.
 * If `permittedNames` is provided, the tool must be in that set.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  chatId: string,
  permittedNames?: Set<string>,
): Promise<string> {
  // Runtime permission guard
  if (permittedNames && !permittedNames.has(name)) {
    console.warn(`[Agent] Blocked tool call "${name}" — not permitted.`);
    return `Error: Tool "${name}" is not permitted in this context.`;
  }

  // Check built-in registry
  const executor = getToolExecutor(name);
  if (executor) {
    return executor(args, chatId);
  }

  // Check MCP tools
  if (mcpManager.isMcpTool(name)) {
    return mcpManager.executeMcpTool(name, args);
  }

  return `Error: Unknown tool "${name}"`;
}

// ─── Tool Schema Builder ─────────────────────────────────────────

/**
 * Get available tool schemas + permitted names, respecting allow/deny lists.
 *
 * @param allowedToolNames  Optional list of tool names to include.
 *                          If omitted, all tools are returned.
 * @param deniedToolNames   Optional list of tool names to exclude.
 *                          Ignored if allowedToolNames is set.
 */
function getAvailableTools(
  allowedToolNames?: string[],
  deniedToolNames?: string[],
): { schemas: LLMToolSchema[]; permittedNames: Set<string> } {
  // Filter built-in tools (these are still stored as Gemini Tool objects)
  const filteredEntries = getFilteredToolEntries(
    allowedToolNames,
    deniedToolNames,
  );
  const builtinGeminiDefs = getToolDefinitions(filteredEntries);

  // Convert Gemini Tool[] → LLMToolSchema[]
  const builtinSchemas = geminiToolsToSchemas(builtinGeminiDefs);

  // Collect permitted built-in names
  const permittedNames = new Set(filteredEntries.map((e) => e.name));

  // MCP tools: apply the same allow/deny logic, then convert
  const mcpGeminiTools = mcpManager.getAllMcpTools();
  const mcpSchemas: LLMToolSchema[] = [];

  for (const mcpTool of mcpGeminiTools) {
    if (!mcpTool.functionDeclarations) continue;

    const filteredDecls = mcpTool.functionDeclarations.filter((decl) => {
      const name = decl.name!;
      if (allowedToolNames && allowedToolNames.length > 0) {
        return allowedToolNames.includes(name);
      }
      if (deniedToolNames && deniedToolNames.length > 0) {
        return !deniedToolNames.includes(name);
      }
      return true;
    });

    for (const decl of filteredDecls) {
      mcpSchemas.push({
        name: decl.name!,
        description: decl.description || "",
        parameters: (decl.parameters as Record<string, unknown>) || {},
      });
      permittedNames.add(decl.name!);
    }
  }

  let allSchemas = [...builtinSchemas, ...mcpSchemas];

  // If delegation is disabled via Mission Control, strip the delegate tool
  if (!getRuntimeConfig().delegation) {
    allSchemas = allSchemas.filter((s) => s.name !== "delegate");
    permittedNames.delete("delegate");
  }

  return { schemas: allSchemas, permittedNames };
}

// ─── Shared Inner Loop Core ──────────────────────────────────────

/**
 * The shared agentic iteration engine used by both text and vision entry points.
 *
 * Accepts a pre-built messages array (the first user message may or may not
 * include inline images) and runs the tool-call → LLM → tool-result cycle
 * until a final text response is produced or the iteration limit is reached.
 *
 * @param chatId           Chat ID for memory scoping and token tracking
 * @param userMessage      The raw user text (used for background triggers)
 * @param systemInstruction Full assembled system prompt
 * @param initialMessages  Pre-built LLMMessage[] including the first user turn
 * @param availableTools   Schemas + permitted names from getAvailableTools()
 * @param iterLimit        Max iterations before giving up
 * @param logPrefix        Log tag — "[Agent]" or "[Agent/Vision]"
 */
async function runLoop(
  chatId: string,
  userMessage: string,
  systemInstruction: string,
  initialMessages: LLMMessage[],
  availableTools: { schemas: LLMToolSchema[]; permittedNames: Set<string> },
  iterLimit: number,
  logPrefix: string,
): Promise<string> {
  const messages: LLMMessage[] = [...initialMessages];
  const { schemas, permittedNames } = availableTools;
  let iterationCount = 0;

  while (iterationCount < iterLimit) {
    iterationCount++;

    const activeModel = getEffectiveModel(chatId);
    const provider = getProviderName(activeModel);
    console.log(
      `${logPrefix} Iteration ${iterationCount}/${iterLimit} — ${activeModel} (${provider})`,
    );

    // Ask LLM via the smart router (Gemini or OpenRouter, with fallback)
    const llmStart = Date.now();
    const response: LLMResponse = await routedChat({
      model: activeModel,
      systemInstruction,
      messages,
      tools: schemas,
      temperature: getRuntimeConfig().temperature,
    });
    const llmLatencyMs = Date.now() - llmStart;

    // Track token usage (works for both providers)
    if (response.usage) {
      recordTokenUsage(
        chatId,
        activeModel,
        response.usage.promptTokens,
        response.usage.completionTokens,
        response.usage.totalTokens,
        llmLatencyMs,
      );
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      // Append the model's response (with tool calls) to history
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      const toolResults: LLMToolResult[] = await Promise.all(
        response.toolCalls.map(async (call) => {
          console.log(`${logPrefix} Tool requested: ${call.name}`);

          let toolOutputText = "";
          try {
            toolOutputText = await executeTool(
              call.name,
              call.args,
              chatId,
              permittedNames,
            );
          } catch (error) {
            toolOutputText = `Error calling tool: ${String(error)}`;
          }

          const preview = toolOutputText.length > 200
            ? toolOutputText.substring(0, 200) + "..."
            : toolOutputText;
          console.log(`${logPrefix} Tool result (${toolOutputText.length} chars): ${preview}`);

          return {
            callId: call.id,
            name: call.name,
            content: toolOutputText,
          };
        }),
      );

      // Append tool results to history
      messages.push({ role: "user", toolResults });
    } else {
      // Final text response — no tool calls
      const finalResponse = response.text?.trim() || "";

      // Save assistant response to buffer (Tier 2)
      if (finalResponse) {
        await saveMessage(chatId, "model", finalResponse);
      }

      // Trigger background fact extraction (Tier 3 — async, never blocks)
      triggerFactExtraction(userMessage, finalResponse || "", chatId);

      // Trigger background user profile update (async, never blocks)
      triggerUserProfileUpdate(chatId, userMessage, finalResponse || "");

      return finalResponse || "No text response generated.";
    }
  }

  return (
    "Error: Agent reached maximum iterations (" +
    iterLimit +
    ") without answering."
  );
}

// ─── Public Entry Points ─────────────────────────────────────────

/**
 * The core agentic loop with memory integration.
 *
 * @param userMessage      The message text from the user
 * @param chatId           The chat ID for memory scoping
 * @param allowedToolNames Optional allowlist of tool names (sub-agent restriction)
 * @param deniedToolNames  Optional denylist of tool names (sub-agent restriction)
 * @param maxIterations    Optional override for max loop iterations
 * @returns The final text response from the agent
 */
export async function runAgentLoop(
  userMessage: string,
  chatId: string,
  allowedToolNames?: string[],
  deniedToolNames?: string[],
  maxIterations?: number,
): Promise<string> {
  const run = async (): Promise<string> => {
    const iterLimit = maxIterations ?? MAX_ITERATIONS;

    // Load Tier 2 recent messages as conversation history (before saving current)
    const recentMessages = await getRecentMessages(chatId);

    // Save user message to buffer (Tier 2) — after loading to avoid duplication
    await saveMessage(chatId, "user", userMessage);

    // Build system instruction with all memory tiers
    const systemInstruction = await buildSystemInstruction(chatId, userMessage);

    // Build conversation as provider-agnostic LLMMessage[]
    const messages: LLMMessage[] = recentMessages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // Append current user message (it wasn't in DB when we loaded)
    messages.push({ role: "user", content: userMessage });

    const availableTools = getAvailableTools(allowedToolNames, deniedToolNames);

    return runLoop(chatId, userMessage, systemInstruction, messages, availableTools, iterLimit, "[Agent]");
  };

  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("Agent loop timed out (300s limit)")), MAX_LOOP_TIMEOUT_MS),
  );
  return Promise.race([run(), timeoutPromise]);
}

/**
 * Agent loop variant that accepts an image for multimodal (vision) queries.
 *
 * Routes through the same provider-agnostic `routedChat()` as text,
 * using the `inlineImages` field on LLMMessage. This gives vision the
 * same automatic fallback, retry, and token-tracking behavior as text.
 *
 * @param userMessage Text accompanying the image (or a default prompt)
 * @param chatId The chat ID
 * @param imageBase64 Base64-encoded image data
 * @param mimeType The image MIME type (e.g. "image/jpeg")
 */
export async function runAgentLoopWithImage(
  userMessage: string,
  chatId: string,
  imageBase64: string,
  mimeType: string,
): Promise<string> {
  const run = async (): Promise<string> => {
    // Load Tier 2 recent messages for conversation context (before saving current)
    const recentMessages = await getRecentMessages(chatId);

    // Save a text note to buffer (we can't store binary images)
    await saveMessage(chatId, "user", `[Sent an image] ${userMessage}`);

    const systemInstruction = await buildSystemInstruction(chatId, userMessage);
    const availableTools = getAvailableTools();

    // Build conversation — prepend history, then append image message
    const messages: LLMMessage[] = recentMessages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // Append current user message with inline image (it wasn't in DB when we loaded)
    messages.push({
      role: "user",
      content: userMessage,
      inlineImages: [{ data: imageBase64, mimeType }],
    });

    return runLoop(chatId, userMessage, systemInstruction, messages, availableTools, MAX_ITERATIONS, "[Agent/Vision]");
  };

  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("Agent loop timed out (300s limit)")), MAX_LOOP_TIMEOUT_MS),
  );
  return Promise.race([run(), timeoutPromise]);
}
