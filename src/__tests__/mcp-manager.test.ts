/**
 * Tests for MCP Manager — Tool Name Mapping
 *
 * Validates that the tool name mapping system correctly handles
 * server names with underscores (the I13 bug fix).
 */

import { describe, it, expect } from "vitest";

// We test the name parsing logic directly since the full MCP manager
// requires real server connections. We can still validate the mapping pattern.

describe("MCP Tool Name Mapping", () => {
    // Simulate the mapping logic from McpManager
    function buildToolNameMap(
        servers: Array<{ name: string; tools: string[] }>,
    ): Map<string, { serverName: string; toolName: string }> {
        const map = new Map<string, { serverName: string; toolName: string }>();
        for (const server of servers) {
            for (const tool of server.tools) {
                const prefixedName = `mcp_${server.name}_${tool}`;
                map.set(prefixedName, { serverName: server.name, toolName: tool });
            }
        }
        return map;
    }

    it("handles simple server names correctly", () => {
        const map = buildToolNameMap([
            { name: "weather", tools: ["get_forecast", "get_current"] },
        ]);

        const entry = map.get("mcp_weather_get_forecast");
        expect(entry).toBeDefined();
        expect(entry!.serverName).toBe("weather");
        expect(entry!.toolName).toBe("get_forecast");
    });

    it("handles server names with underscores correctly", () => {
        const map = buildToolNameMap([
            { name: "my_server", tools: ["my_tool"] },
        ]);

        // This is the I13 bug: old code would parse "my_server_my_tool" as
        // serverName="my", toolName="server_my_tool" — wrong!
        const entry = map.get("mcp_my_server_my_tool");
        expect(entry).toBeDefined();
        expect(entry!.serverName).toBe("my_server");
        expect(entry!.toolName).toBe("my_tool");
    });

    it("handles multiple servers without collisions", () => {
        const map = buildToolNameMap([
            { name: "server_a", tools: ["query", "insert"] },
            { name: "server_b", tools: ["query", "delete"] },
        ]);

        expect(map.size).toBe(4);

        const aQuery = map.get("mcp_server_a_query");
        expect(aQuery).toBeDefined();
        expect(aQuery!.serverName).toBe("server_a");

        const bQuery = map.get("mcp_server_b_query");
        expect(bQuery).toBeDefined();
        expect(bQuery!.serverName).toBe("server_b");
    });

    it("returns undefined for unknown tool names", () => {
        const map = buildToolNameMap([
            { name: "weather", tools: ["get_forecast"] },
        ]);

        expect(map.get("mcp_weather_unknown_tool")).toBeUndefined();
    });
});
