/**
 * MCP Manager — Manages lifecycle of all MCP (Model Context Protocol) servers
 *
 * Reads mcp.json config, connects to all configured servers,
 * aggregates their tools, and routes tool executions.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { McpClient } from "./mcp-client.js";
import type { McpServerConfig } from "./mcp-client.js";
import type { Tool as GeminiTool } from "@google/genai";

interface McpConfig {
  servers: McpServerConfig[];
}

class McpManager {
  private clients: Map<string, McpClient> = new Map();
  /** Maps prefixed tool name → { serverName, toolName } for reliable routing */
  private toolNameMap: Map<string, { serverName: string; toolName: string }> = new Map();
  private initialized = false;

  /**
   * Initialize all MCP servers from the config file.
   * Silently skips if no config file exists.
   */
  async init(configPath?: string): Promise<void> {
    const path = configPath || resolve(process.cwd(), "mcp.json");

    let config: McpConfig;
    try {
      const raw = readFileSync(path, "utf-8");
      config = JSON.parse(raw) as McpConfig;
    } catch {
      console.log("[MCP] No mcp.json found — MCP support disabled.");
      this.initialized = true;
      return;
    }

    if (!config.servers || config.servers.length === 0) {
      console.log("[MCP] mcp.json has no servers configured.");
      this.initialized = true;
      return;
    }

    console.log(
      `[MCP] Connecting to ${config.servers.length} server(s)...`,
    );

    // Connect to all servers concurrently
    const connectPromises = config.servers.map(async (serverConfig) => {
      const client = new McpClient(serverConfig);
      try {
        await client.connect();
        this.clients.set(serverConfig.name, client);
      } catch (error) {
        console.error(
          `[MCP] Failed to connect to "${serverConfig.name}":`,
          error,
        );
      }
    });

    await Promise.allSettled(connectPromises);

    console.log(
      `[MCP] ${this.clients.size}/${config.servers.length} server(s) connected.`,
    );
    this.initialized = true;
  }

  /**
   * Get all MCP tools as Gemini Tool[] for injection into the agent loop.
   * Also builds the toolNameMap for reliable name → (server, tool) resolution.
   */
  getAllMcpTools(): GeminiTool[] {
    const tools: GeminiTool[] = [];
    this.toolNameMap.clear();

    for (const [serverName, client] of this.clients.entries()) {
      if (!client.isConnected()) continue;

      const geminiTools = client.toGeminiTools();
      tools.push(...geminiTools);

      // Build the reverse lookup map from prefixed names
      for (const tool of geminiTools) {
        if (!tool.functionDeclarations) continue;
        for (const decl of tool.functionDeclarations) {
          const prefixedName = decl.name!;
          // The original tool name is the prefixed name minus "mcp_{serverName}_"
          const prefix = `mcp_${serverName}_`;
          const originalName = prefixedName.startsWith(prefix)
            ? prefixedName.substring(prefix.length)
            : prefixedName;
          this.toolNameMap.set(prefixedName, { serverName, toolName: originalName });
        }
      }
    }
    return tools;
  }

  /**
   * Execute an MCP tool call.
   * Uses the toolNameMap for reliable routing (handles underscores in names).
   */
  async executeMcpTool(
    prefixedName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    // Look up from the name map (populated by getAllMcpTools)
    const mapping = this.toolNameMap.get(prefixedName);

    if (!mapping) {
      return `Error: Unknown MCP tool "${prefixedName}". Was it discovered by getAllMcpTools()?`;
    }

    const client = this.clients.get(mapping.serverName);
    if (!client) {
      return `Error: MCP server "${mapping.serverName}" not found or not connected.`;
    }

    return client.executeTool(mapping.toolName, args);
  }

  /**
   * Check if a tool name is an MCP tool (starts with "mcp_").
   */
  isMcpTool(name: string): boolean {
    return name.startsWith("mcp_");
  }

  /**
   * Disconnect all MCP servers.
   */
  async shutdown(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.values()).map(
      (client) => client.disconnect(),
    );
    await Promise.allSettled(disconnectPromises);
    this.clients.clear();
    console.log("[MCP] All servers disconnected.");
  }
}

// Singleton instance
export const mcpManager = new McpManager();
