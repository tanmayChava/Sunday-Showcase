/**
 * Provider-Agnostic LLM Interface
 *
 * All LLM providers (Gemini, OpenRouter, future providers) implement
 * LLMProvider so the agent loop never needs to know which SDK it is using.
 *
 * Tool schemas are expressed as plain JSON-Schema objects (Record<string, unknown>)
 * because both Gemini and OpenAI-compatible APIs consume the same schema format.
 */

// ─── Shared Message Types ─────────────────────────────────────────

export type LLMRole = "user" | "assistant" | "system";

/** An inline image attached to a message (for multimodal / vision queries). */
export interface LLMInlineImage {
    /** Base64-encoded image data. */
    data: string;
    /** MIME type, e.g. "image/jpeg", "image/png". */
    mimeType: string;
}

/** A single turn in a conversation. */
export interface LLMMessage {
    role: LLMRole;
    /** Plain text content (undefined for pure tool-call messages). */
    content?: string;
    /** Inline images attached to this message (vision / multimodal). */
    inlineImages?: LLMInlineImage[];
    /** Tool calls the assistant wants to make (outgoing from model). */
    toolCalls?: LLMToolCall[];
    /** Tool results to return to the model (incoming from executor). */
    toolResults?: LLMToolResult[];
}

/** A tool invocation requested by the model. */
export interface LLMToolCall {
    /** Opaque call ID — used to match results back to calls. */
    id: string;
    /** Tool name as declared in the schema. */
    name: string;
    /** Parsed arguments keyed by parameter name. */
    args: Record<string, unknown>;
    /**
     * Internal: raw Gemini SDK parts for this call (functionCall + thoughtSignature).
     * Gemini 3 requires these to be echoed back verbatim on the next turn.
     * Only populated by gemini.ts — ignored by all other providers.
     */
    _rawParts?: unknown[];
}

/** The result of executing a single tool call. */
export interface LLMToolResult {
    /** Must match the id of the corresponding LLMToolCall. */
    callId: string;
    /** The tool's name (required by some providers). */
    name: string;
    /** Serialised result returned to the model. */
    content: string;
}

// ─── Tool Schema ──────────────────────────────────────────────────

/** A single tool the model can invoke. */
export interface LLMToolSchema {
    name: string;
    description: string;
    /** JSON Schema object describing the tool's parameters. */
    parameters: Record<string, unknown>;
}

// ─── Response ─────────────────────────────────────────────────────

/** The model's response to a single `chat()` call. */
export interface LLMResponse {
    /** Text content from the model (if it produced a final answer). */
    text?: string;
    /** Tool calls the model wants to make (if any). */
    toolCalls?: LLMToolCall[];
    /** Token usage (may be undefined if the provider doesn't expose it). */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// ─── Call Params ──────────────────────────────────────────────────

/** Everything needed to make a single LLM call. */
export interface LLMCallParams {
    /** The model identifier (provider-specific string). */
    model: string;
    /** System instruction / personality prompt. */
    systemInstruction?: string;
    /** Conversation history + current turn. */
    messages: LLMMessage[];
    /** Tools the model may call. */
    tools?: LLMToolSchema[];
    temperature?: number;
}

// ─── Provider Interface ───────────────────────────────────────────

/**
 * Every LLM backend implements this interface.
 * The agent loop routes calls through it, knowing nothing about the SDK.
 */
export interface LLMProvider {
    /**
     * Send a chat request and get one turn of response back.
     * Throws on unrecoverable errors.
     */
    chat(params: LLMCallParams): Promise<LLMResponse>;
}
