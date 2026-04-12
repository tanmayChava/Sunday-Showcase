/**
 * MCP Client — Connects to a single MCP (Model Context Protocol) server
 *
 * Supports both transport types:
 *   - stdio: launches a child process and communicates via stdin/stdout
 *   - sse/http: connects to a remote HTTP server
 *
 * Discovers tools from the server and provides execution capability.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool as GeminiTool } from "@google/genai";
import { Type } from "@google/genai";

export interface McpServerConfig {
  /** Human-readable name for this server */
  name: string;
  /** For stdio transport: the command to run */
  command?: string;
  /** For stdio transport: command arguments */
  args?: string[];
  /** For stdio transport: environment variables */
  env?: Record<string, string>;
  /** For HTTP/SSE transport: the server URL */
  url?: string;
}

interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  readonly serverName: string;
  private client: Client;
  private transport: StdioClientTransport | SSEClientTransport | null = null;
  private tools: McpToolInfo[] = [];
  private connected = false;

  constructor(private config: McpServerConfig) {
    this.serverName = config.name;
    this.client = new Client(
      { name: "sunday", version: "1.0.0" },
      { capabilities: {} },
    );
  }

  /**
   * Connect to the MCP server and discover available tools.
   */
  async connect(): Promise<void> {
    try {
      if (this.config.command) {
        // Stdio transport — launch a child process
        this.transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args || [],
          env: {
            ...process.env,
            ...(this.config.env || {}),
          } as Record<string, string>,
        });
      } else if (this.config.url) {
        // SSE/HTTP transport — connect to remote server
        this.transport = new SSEClientTransport(new URL(this.config.url));
      } else {
        throw new Error(
          `MCP server "${this.serverName}" has neither command nor url configured.`,
        );
      }

      await this.client.connect(this.transport);
      this.connected = true;

      // Discover tools
      const result = await this.client.listTools();
      this.tools = (result.tools || []).map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: (t.inputSchema as Record<string, unknown>) || {},
      }));

      console.log(
        `[MCP/${this.serverName}] Connected — ${this.tools.length} tool(s) discovered: ${this.tools.map((t) => t.name).join(", ")}`,
      );
    } catch (error) {
      console.error(`[MCP/${this.serverName}] Connection failed:`, error);
      this.connected = false;
    }
  }

  /**
   * Disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors
      }
      this.connected = false;
      console.log(`[MCP/${this.serverName}] Disconnected.`);
    }
  }

  /**
   * Check if the server is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the list of discovered tools in this server.
   */
  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  /**
   * Convert discovered MCP tools to Gemini Tool format for injection into the agent loop.
   */
  toGeminiTools(): GeminiTool[] {
    if (this.tools.length === 0) return [];

    return [
      {
        functionDeclarations: this.tools.map((tool) => ({
          name: `mcp_${this.serverName}_${tool.name}`,
          description: `[MCP/${this.serverName}] ${tool.description}`,
          parameters: this.convertSchemaToGemini(tool.inputSchema),
        })),
      },
    ];
  }

  /**
   * Execute a tool on this server.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.connected) {
      return `Error: MCP server "${this.serverName}" is not connected.`;
    }

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Extract text content from the result
      if (result.content && Array.isArray(result.content)) {
        return result.content
          .map((c: { type: string; text?: string }) =>
            c.type === "text" ? c.text || "" : JSON.stringify(c),
          )
          .join("\n");
      }

      return JSON.stringify(result);
    } catch (error) {
      return `MCP tool error: ${String(error)}`;
    }
  }

  /**
   * Convert a JSON Schema to Gemini's parameter format.
   * Handles the most common schema patterns gracefully.
   */
  private convertSchemaToGemini(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const type = schema.type as string;

    if (type === "object") {
      const properties = schema.properties as
        | Record<string, Record<string, unknown>>
        | undefined;

      if (!properties) {
        return { type: Type.OBJECT, properties: {} };
      }

      const geminiProps: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(properties)) {
        geminiProps[key] = this.convertPropertyToGemini(prop);
      }

      return {
        type: Type.OBJECT,
        properties: geminiProps,
        required: (schema.required as string[]) || [],
      };
    }

    return { type: Type.OBJECT, properties: {} };
  }

  /**
   * Convert a single JSON Schema property to Gemini format.
   */
  private convertPropertyToGemini(
    prop: Record<string, unknown>,
  ): Record<string, unknown> {
    const typeMap: Record<string, string> = {
      string: Type.STRING,
      number: Type.NUMBER,
      integer: Type.INTEGER,
      boolean: Type.BOOLEAN,
      array: Type.ARRAY,
      object: Type.OBJECT,
    };

    const geminiType = typeMap[prop.type as string] || Type.STRING;
    const result: Record<string, unknown> = {
      type: geminiType,
    };

    if (prop.description) {
      result.description = prop.description;
    }

    if (prop.enum) {
      result.enum = prop.enum;
    }

    return result;
  }
}
