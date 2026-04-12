/**
 * Sub-Agent Loop — Lightweight agent loop for delegated tasks
 *
 * Unlike the main agent loop, the sub-agent loop:
 *   - Has NO memory context (no Tier 1/2/3 — just the task)
 *   - Has NO soul.md personality (uses the profile's system prompt)
 *   - Does NOT save messages to the buffer
 *   - Does NOT trigger fact extraction
 *   - Has restricted tool access (defined by the profile)
 *   - Runs independently and returns a text result
 *
 * This keeps sub-agents fast, focused, and cheap on tokens.
 */

import type {
    LLMMessage,
    LLMToolCall,
    LLMToolResult,
    LLMToolSchema,
    LLMResponse,
} from "../lib/llm.js";
import { routedChat, getProviderName } from "../lib/router.js";
import { geminiToolsToSchemas } from "../lib/tool-bridge.js";

import {
    getFilteredToolEntries,
    getToolDefinitions,
    getToolExecutor,
} from "../tools/registry.js";
import { mcpManager } from "../mcp/mcp-manager.js";
import { recordTokenUsage } from "../commands/session-stats.js";
import type { SubAgentProfile } from "./profiles.js";
import { updateAgentStatus } from "../lib/config-sync.js";

// ─── Types ───────────────────────────────────────────────────────

export interface SubAgentParams {
    /** The task message to send to the sub-agent. */
    message: string;
    /** Parent chat ID (used for token tracking). */
    chatId: string;
    /** The sub-agent's profile (system prompt, tool restrictions, etc.). */
    profile: SubAgentProfile;
    /** The model to use for this sub-agent. */
    model: string;
}

// ─── Tool Resolution ─────────────────────────────────────────────

function getSubAgentTools(
    profile: SubAgentProfile,
): { schemas: LLMToolSchema[]; permittedNames: Set<string> } {
    // Filter built-in tools based on the profile
    const filteredEntries = getFilteredToolEntries(
        profile.allowedTools,
        profile.deniedTools,
    );
    const builtinGeminiDefs = getToolDefinitions(filteredEntries);
    const builtinSchemas = geminiToolsToSchemas(builtinGeminiDefs);
    const permittedNames = new Set(filteredEntries.map((e) => e.name));

    // MCP tools — apply same filtering
    const mcpGeminiTools = mcpManager.getAllMcpTools();
    const mcpSchemas: LLMToolSchema[] = [];

    for (const mcpTool of mcpGeminiTools) {
        if (!mcpTool.functionDeclarations) continue;

        const filteredDecls = mcpTool.functionDeclarations.filter((decl) => {
            const name = decl.name!;
            if (profile.allowedTools && profile.allowedTools.length > 0) {
                return profile.allowedTools.includes(name);
            }
            if (profile.deniedTools && profile.deniedTools.length > 0) {
                return !profile.deniedTools.includes(name);
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

    // IMPORTANT: Never give a sub-agent the `delegate` tool (prevent recursion)
    const allSchemas = [...builtinSchemas, ...mcpSchemas].filter(
        (s) => s.name !== "delegate",
    );
    permittedNames.delete("delegate");

    return { schemas: allSchemas, permittedNames };
}

// ─── Tool Execution ──────────────────────────────────────────────

async function executeSubAgentTool(
    name: string,
    args: Record<string, unknown>,
    chatId: string,
    permittedNames: Set<string>,
): Promise<string> {
    if (!permittedNames.has(name)) {
        return `Error: Tool "${name}" is not available to this sub-agent.`;
    }

    // Built-in tool
    const executor = getToolExecutor(name);
    if (executor) {
        return executor(args, chatId);
    }

    // MCP tool
    if (mcpManager.isMcpTool(name)) {
        return mcpManager.executeMcpTool(name, args);
    }

    return `Error: Unknown tool "${name}"`;
}

// ─── Sub-Agent Loop ──────────────────────────────────────────────

/**
 * Run a sub-agent loop for a delegated task.
 *
 * This is a stripped-down version of the main agent loop:
 * no memory loading, no message saving, no fact extraction.
 * Just the task, tools, and a focused system prompt.
 *
 * @returns The sub-agent's final text response.
 */
export async function runSubAgentLoop(params: SubAgentParams): Promise<string> {
    const { message, chatId, profile, model } = params;
    const { schemas: tools, permittedNames } = getSubAgentTools(profile);

    const provider = getProviderName(model);
    console.log(
        `[SubAgent/${profile.name}] Starting — model=${model} (${provider}), ` +
        `tools=${tools.length}, maxIter=${profile.maxIterations}`,
    );

    // Update agent status in Supabase for Mission Control
    updateAgentStatus(
        profile.name,
        "Working",
        `Processing: ${message.substring(0, 80)}...`,
    ).catch(() => { });

    // Build conversation — just the task, no history
    const messages: LLMMessage[] = [{ role: "user", content: message }];

    let iterationCount = 0;

    while (iterationCount < profile.maxIterations) {
        iterationCount++;
        console.log(
            `[SubAgent/${profile.name}] Iteration ${iterationCount}/${profile.maxIterations}`,
        );

        const llmStart = Date.now();
        const response: LLMResponse = await routedChat({
            model,
            systemInstruction: profile.systemPrompt,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: profile.temperature,
        });
        const llmLatencyMs = Date.now() - llmStart;

        // Track tokens under the parent chat's session stats
        if (response.usage) {
            recordTokenUsage(
                chatId,
                model,
                response.usage.promptTokens,
                response.usage.completionTokens,
                response.usage.totalTokens,
                llmLatencyMs,
            );
        }

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
            messages.push({
                role: "assistant",
                content: response.text,
                toolCalls: response.toolCalls,
            });

            const toolResults: LLMToolResult[] = await Promise.all(
                response.toolCalls.map(async (call) => {
                    console.log(`[SubAgent/${profile.name}] Tool: ${call.name}`);

                    let output = "";
                    try {
                        output = await executeSubAgentTool(
                            call.name,
                            call.args,
                            chatId,
                            permittedNames,
                        );
                    } catch (error) {
                        output = `Error: ${String(error)}`;
                    }

                    return {
                        callId: call.id,
                        name: call.name,
                        content: output,
                    };
                }),
            );

            messages.push({ role: "user", toolResults });
        } else {
            // Final response — no tool calls
            const result = response.text?.trim() || "";
            console.log(
                `[SubAgent/${profile.name}] Complete — ${iterationCount} iteration(s), ` +
                `${result.length} chars`,
            );
            // Update status back to idle
            updateAgentStatus(
                profile.name,
                "Online",
                "Idle — waiting for tasks",
            ).catch(() => { });
            return result || "Sub-agent produced no output.";
        }
    }

    // Max iterations reached — return whatever we have
    console.warn(
        `[SubAgent/${profile.name}] Hit max iterations (${profile.maxIterations})`,
    );
    return "Sub-agent reached its iteration limit without producing a final response.";
}
