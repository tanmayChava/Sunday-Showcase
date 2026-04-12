/**
 * delegate tool — Spawns a specialized sub-agent for complex tasks.
 *
 * The main agent calls this when a task would benefit from a focused,
 * specialized approach — deep research, code generation, summarization,
 * or creative writing.
 *
 * The sub-agent runs its own independent agent loop with:
 *   - A specialized system prompt tailored to its role
 *   - Restricted tool access (e.g. research agent gets web tools only)
 *   - Its own temperature and iteration settings
 *   - No memory context (receives only the delegated task + context)
 *
 * The sub-agent's response is returned to the main agent as a tool
 * result, which can then be incorporated into the final response.
 *
 * Note: Uses dynamic import of loop.ts to avoid circular dependency
 * (loop.ts → delegate.ts → loop.ts).
 */

import { Type, Tool } from "@google/genai";
import {
    getProfile,
    getProfileNames,
    formatProfileList,
} from "../agent/profiles.js";
import type { SubAgentProfile } from "../agent/profiles.js";
import { ENV } from "../config.js";
import { getEffectiveModel } from "../commands/slash-commands.js";

// ─── Tool Definition ─────────────────────────────────────────────

export const delegateDefinition: Tool = {
    functionDeclarations: [
        {
            name: "delegate",
            description:
                `Delegate a task to a specialized sub-agent for deeper, focused work. ` +
                `Use this when a task requires expertise beyond quick answers — ` +
                `e.g. multi-step research, code generation, content summarization, ` +
                `data analysis, or creative writing. ` +
                `Available agents: ${getProfileNames().join(", ")}. ` +
                `The sub-agent runs independently with specialized tools and returns its result.`,
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agent: {
                        type: Type.STRING,
                        description:
                            `The type of sub-agent to delegate to. Options: ` +
                            getProfileNames()
                                .map((n) => `"${n}"`)
                                .join(", "),
                    },
                    task: {
                        type: Type.STRING,
                        description:
                            "A clear, specific description of what the sub-agent should do. " +
                            "Be detailed — the sub-agent has no conversation context beyond this.",
                    },
                    context: {
                        type: Type.STRING,
                        description:
                            "Optional additional context from the conversation that the sub-agent " +
                            "needs to complete the task (e.g. user preferences, prior decisions, " +
                            "specific constraints). Keep it relevant and concise.",
                    },
                },
                required: ["agent", "task"],
            },
        },
    ],
};

// ─── Executor ────────────────────────────────────────────────────

/**
 * Execute the delegate tool — spawn a sub-agent loop.
 *
 * @param args.agent   Sub-agent type (research, code, summary, creative, analyst)
 * @param args.task    The task description for the sub-agent
 * @param args.context Optional additional context
 * @param chatId       The parent chat ID (for model resolution)
 */
export async function executeDelegate(
    args: { agent: string; task: string; context?: string },
    chatId: string,
): Promise<string> {
    const { agent, task, context } = args;

    // Validate agent type
    const profile = getProfile(agent);
    if (!profile) {
        return (
            `Error: Unknown agent type "${agent}". ` +
            `Available agents:\n${formatProfileList()}`
        );
    }

    if (!task || task.trim().length === 0) {
        return "Error: Task description cannot be empty.";
    }

    console.log(`[Delegate] Spawning ${profile.icon} ${profile.label} for task: "${task.substring(0, 80)}..."`);
    const startTime = Date.now();

    try {
        // Build the sub-agent's input message
        const subAgentMessage = buildSubAgentMessage(task, context, profile);

        // Determine the model for the sub-agent
        const model = profile.modelOverride || getEffectiveModel(chatId);

        // Dynamic import to break circular dependency (loop → delegate → loop)
        const { runSubAgentLoop } = await import("../agent/sub-loop.js");

        const result = await runSubAgentLoop({
            message: subAgentMessage,
            chatId,
            profile,
            model,
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Delegate] ${profile.icon} ${profile.label} completed in ${elapsed}s`);

        // Format the result with metadata
        return formatSubAgentResult(profile, result, elapsed);
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[Delegate] ${profile.label} failed after ${elapsed}s:`, error);
        return `Error: ${profile.label} failed — ${String(error)}`;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildSubAgentMessage(
    task: string,
    context: string | undefined,
    profile: SubAgentProfile,
): string {
    const parts: string[] = [];

    parts.push(`## Task\n${task}`);

    if (context) {
        parts.push(`\n## Additional Context\n${context}`);
    }

    parts.push(
        `\n## Instructions`,
        `You are the ${profile.label}. Complete the task above thoroughly.`,
        `Provide your complete findings/output directly — do not say "I'll look into it" or ask for clarification.`,
        `Your response will be passed back to the main agent who will present it to the user.`,
    );

    return parts.join("\n");
}

function formatSubAgentResult(
    profile: SubAgentProfile,
    result: string,
    elapsedSeconds: string,
): string {
    return [
        `--- ${profile.icon} ${profile.label} Report (${elapsedSeconds}s) ---`,
        "",
        result,
        "",
        `--- End of ${profile.label} Report ---`,
    ].join("\n");
}
