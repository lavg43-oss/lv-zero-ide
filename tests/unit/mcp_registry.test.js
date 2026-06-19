/**
 * Unit tests for MCP Registry
 *
 * Tests the preconfigured MCP server registry: getEnabledMCPServers,
 * getMCPServerById, getAllMCPServerIds, and data integrity validation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MCP_REGISTRY,
  getEnabledMCPServers,
  getMCPServerById,
  getAllMCPServerIds,
} from "../../src/mcp_registry.js";

describe("MCP Registry", () => {
  // ─── Data integrity ────────────────────────────────────────────────────

  it("should have a non-empty registry", () => {
    expect(Array.isArray(MCP_REGISTRY)).toBe(true);
    expect(MCP_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every server should have all required fields", () => {
    const requiredFields = ["id", "name", "description", "type", "command", "url"];
    for (const server of MCP_REGISTRY) {
      expect(server.id).toBeDefined();
      expect(typeof server.id).toBe("string");
      expect(server.id.length).toBeGreaterThan(0);

      expect(server.name).toBeDefined();
      expect(typeof server.name).toBe("string");

      expect(server.description).toBeDefined();
      expect(typeof server.description).toBe("string");

      expect(server.type).toBeDefined();
      expect(["stdio", "http-sse"]).toContain(server.type);

      // Must have either command (for stdio) or url (for http-sse)
      if (server.type === "stdio") {
        expect(server.command).toBeDefined();
        expect(typeof server.command).toBe("string");
      }
    }
  });

  it("every server should have a unique id", () => {
    const ids = MCP_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every server should have a category", () => {
    for (const server of MCP_REGISTRY) {
      expect(server.category).toBeDefined();
      expect(typeof server.category).toBe("string");
    }
  });

  it("every server should have an enabled boolean", () => {
    for (const server of MCP_REGISTRY) {
      expect(typeof server.enabled).toBe("boolean");
    }
  });

  // ─── getEnabledMCPServers ──────────────────────────────────────────────

  it("should return only servers with enabled: true by default", () => {
    const enabled = getEnabledMCPServers();
    expect(Array.isArray(enabled)).toBe(true);

    // All returned servers should have enabled: true
    for (const server of enabled) {
      expect(server.enabled).toBe(true);
    }
  });

  it("should return the git server as enabled by default", () => {
    const enabled = getEnabledMCPServers();
    const gitServer = enabled.find((s) => s.id === "git");
    expect(gitServer).toBeDefined();
    expect(gitServer.name).toBe("Git");
  });

  it("should not return disabled servers by default", () => {
    const enabled = getEnabledMCPServers();
    const supabaseServer = enabled.find((s) => s.id === "supabase");
    expect(supabaseServer).toBeUndefined();
  });

  it("should respect MCP_ENABLED_SERVERS env var when set", () => {
    const originalEnv = process.env.MCP_ENABLED_SERVERS;
    try {
      process.env.MCP_ENABLED_SERVERS = "supabase,postgres,redis";
      const enabled = getEnabledMCPServers();
      expect(enabled.length).toBe(3);
      expect(enabled.map((s) => s.id)).toEqual(
        expect.arrayContaining(["supabase", "postgres", "redis"])
      );
    } finally {
      process.env.MCP_ENABLED_SERVERS = originalEnv;
    }
  });

  it("should handle MCP_ENABLED_SERVERS with extra whitespace", () => {
    const originalEnv = process.env.MCP_ENABLED_SERVERS;
    try {
      process.env.MCP_ENABLED_SERVERS = "  git ,  github , docker  ";
      const enabled = getEnabledMCPServers();
      expect(enabled.length).toBe(3);
    } finally {
      process.env.MCP_ENABLED_SERVERS = originalEnv;
    }
  });

  it("should return empty array for non-existent server IDs in env", () => {
    const originalEnv = process.env.MCP_ENABLED_SERVERS;
    try {
      process.env.MCP_ENABLED_SERVERS = "nonexistent-server";
      const enabled = getEnabledMCPServers();
      expect(enabled).toEqual([]);
    } finally {
      process.env.MCP_ENABLED_SERVERS = originalEnv;
    }
  });

  // ─── getMCPServerById ──────────────────────────────────────────────────

  it("should return the correct server by id", () => {
    const server = getMCPServerById("git");
    expect(server).not.toBeNull();
    expect(server.id).toBe("git");
    expect(server.name).toBe("Git");
  });

  it("should return null for a non-existent id", () => {
    const server = getMCPServerById("nonexistent");
    expect(server).toBeNull();
  });

  it("should be case-sensitive for ids", () => {
    const server = getMCPServerById("GIT");
    expect(server).toBeNull();
  });

  it("should return the correct server for various known ids", () => {
    const testCases = [
      { id: "supabase", expectedName: "Supabase" },
      { id: "postgres", expectedName: "PostgreSQL" },
      { id: "docker", expectedName: "Docker" },
      { id: "github", expectedName: "GitHub" },
      { id: "openai", expectedName: "OpenAI" },
      { id: "slack", expectedName: "Slack" },
    ];

    for (const { id, expectedName } of testCases) {
      const server = getMCPServerById(id);
      expect(server).not.toBeNull();
      expect(server.name).toBe(expectedName);
    }
  });

  // ─── getAllMCPServerIds ────────────────────────────────────────────────

  it("should return all server IDs", () => {
    const ids = getAllMCPServerIds();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBe(MCP_REGISTRY.length);
  });

  it("should match the IDs from the registry", () => {
    const ids = getAllMCPServerIds();
    const registryIds = MCP_REGISTRY.map((s) => s.id);
    expect(ids).toEqual(registryIds);
  });

  it("should contain expected server IDs", () => {
    const ids = getAllMCPServerIds();
    expect(ids).toContain("git");
    expect(ids).toContain("github");
    expect(ids).toContain("docker");
    expect(ids).toContain("supabase");
    expect(ids).toContain("postgres");
    expect(ids).toContain("openai");
  });
});
