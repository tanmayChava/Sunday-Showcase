import { Type, Tool } from "@google/genai";

/**
 * Definition of the get_current_time tool for Gemini API.
 */
export const getCurrentTimeDefinition: Tool = {
  functionDeclarations: [
    {
      name: "get_current_time",
      description:
        "Get the current local time of the bot. Use this to determine the current date and time when the user asks.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
  ],
};

/**
 * Implementation of the get_current_time tool.
 * Returns the current date and time in Indian Standard Time (IST).
 */
export async function executeGetCurrentTime(): Promise<string> {
  const now = new Date();
  return now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "long",
  }); // e.g., "Monday, 2 March 2026 at 7:08:34 pm IST"
}
