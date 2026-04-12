/**
 * OpenRouter LLM Provider
 *
 * Implements LLMProvider using the OpenAI SDK pointed at OpenRouter.
 * No Gemini types involved — speaks OpenAI-native throughout.
 *
 * Usage:
 *   import { openRouterProvider } from "../lib/openrouter.js";
 *   const response = await openRouterProvider.chat({ model, messages, ... });
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { ENV } from "../config.js";
import type {
  LLMProvider,
  LLMCallParams,
  LLMResponse,
  LLMMessage,
  LLMToolSchema,
} from "./llm.js";

// ─── OpenAI Client ────────────────────────────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: ENV.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://sunday.dev",
        "X-OpenRouter-Title": "SUNDAY",
      },
    });
  }
  return client;
}

// ─── Conversion: LLM Types → OpenAI Types ─────────────────────────

function messagesToOpenAI(messages: LLMMessage[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    // System message
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content || "" });
      continue;
    }

    // Assistant with tool calls
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });
      continue;
    }

    // Tool results → tool messages
    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        result.push({
          role: "tool",
          tool_call_id: tr.callId,
          content: tr.content,
        });
      }
      continue;
    }

    // Regular user/assistant text (with optional inline images)
    if (msg.role === "assistant") {
      result.push({ role: "assistant", content: msg.content || "" });
    } else {
      // User message — may include inline images for vision
      if (msg.inlineImages && msg.inlineImages.length > 0) {
        const parts: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [];
        if (msg.content) {
          parts.push({ type: "text", text: msg.content });
        }
        for (const img of msg.inlineImages) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
          });
        }
        result.push({ role: "user", content: parts as any });
      } else {
        result.push({ role: "user", content: msg.content || "" });
      }
    }
  }

  return result;
}

function toolSchemasToOpenAI(schemas: LLMToolSchema[]): ChatCompletionTool[] {
  return schemas.map((s) => ({
    type: "function" as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters as Record<string, unknown>,
    },
  }));
}

function parseOpenAIResponse(
  completion: OpenAI.ChatCompletion,
): LLMResponse {
  const choice = completion.choices[0];
  if (!choice) {
    return { text: "Error: Empty response from OpenRouter." };
  }

  const result: LLMResponse = {};
  const msg = choice.message;

  // Text content
  if (msg.content) {
    result.text = msg.content;
  }

  // Tool calls
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    result.toolCalls = msg.tool_calls
      .filter((tc) => tc.type === "function")
      .map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }
        return {
          id: tc.id,
          name: tc.function.name,
          args,
        };
      });
  }

  // Usage metadata
  if (completion.usage) {
    result.usage = {
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens,
      totalTokens: completion.usage.total_tokens,
    };
  }

  return result;
}

// ─── Provider Implementation ──────────────────────────────────────

class OpenRouterProvider implements LLMProvider {
  async chat(params: LLMCallParams): Promise<LLMResponse> {
    if (!ENV.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    // Build messages — prepend system instruction if provided
    const llmMessages: LLMMessage[] = [];
    if (params.systemInstruction) {
      llmMessages.push({ role: "system", content: params.systemInstruction });
    }
    llmMessages.push(...params.messages);

    const messages = messagesToOpenAI(llmMessages);
    const tools =
      params.tools && params.tools.length > 0
        ? toolSchemasToOpenAI(params.tools)
        : undefined;

    const model = params.model || ENV.OPENROUTER_MODEL;
    console.log(`[OpenRouter] Calling ${model}...`);

    const completion = await getClient().chat.completions.create({
      model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      temperature: params.temperature ?? 0.7,
    });

    console.log(`[OpenRouter] Response received.`);
    return parseOpenAIResponse(completion);
  }
}

/** Singleton OpenRouter provider instance. */
export const openRouterProvider: LLMProvider = new OpenRouterProvider();
