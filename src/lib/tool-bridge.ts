/**
 * Tool Schema Bridge
 *
 * Converts existing Gemini-format Tool definitions (which use
 * @google/genai's Tool type) to the provider-agnostic LLMToolSchema
 * format used by the LLM router.
 *
 * This lets us keep existing tool definition files unchanged while
 * the agent loop works with provider-agnostic types.
 */

import type { Tool } from "@google/genai";
import type { LLMToolSchema } from "./llm.js";

/**
 * Convert a Gemini Tool[] (with functionDeclarations) to LLMToolSchema[].
 * Flattens all declarations across all Tool entries into a single list.
 */
export function geminiToolsToSchemas(tools: Tool[]): LLMToolSchema[] {
    const schemas: LLMToolSchema[] = [];

    for (const tool of tools) {
        if (!tool.functionDeclarations) continue;
        for (const fd of tool.functionDeclarations) {
            schemas.push({
                name: fd.name!,
                description: fd.description || "",
                parameters: (fd.parameters as Record<string, unknown>) || {},
            });
        }
    }

    return schemas;
}
