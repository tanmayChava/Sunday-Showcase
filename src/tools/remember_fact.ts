/**
 * remember_fact tool — lets the agent explicitly save a core memory.
 *
 * The agent calls this when the user states a clear preference,
 * defines a long-term goal, provides personal info, or explicitly
 * asks to remember something.
 */

import { Type, Tool } from "@google/genai";
import { setCoreMemory } from "../memory/core.js";

export const rememberFactDefinition: Tool = {
  functionDeclarations: [
    {
      name: "remember_fact",
      description:
        "Save an important fact about the user to permanent memory. Use ONLY when the user states a clear preference, defines a long-term goal, provides personal profile information, sets a recurring routine, or explicitly asks you to remember something. Do NOT use for casual conversation, jokes, small talk, or one-time details.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          key: {
            type: Type.STRING,
            description:
              "A short, descriptive key for this fact (e.g. 'user_name', 'favorite_language', 'timezone')",
          },
          value: {
            type: Type.STRING,
            description: "The value to remember (e.g. 'TypeScript', 'PST')",
          },
        },
        required: ["key", "value"],
      },
    },
  ],
};

/**
 * Execute the remember_fact tool.
 */
export async function executeRememberFact(args: {
  key: string;
  value: string;
}): Promise<string> {
  try {
    await setCoreMemory(args.key, args.value);
    return `Saved to core memory: ${args.key} = ${args.value}`;
  } catch (err) {
    return `Error saving to memory: ${String(err)}`;
  }
}
