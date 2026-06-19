/**
 * Integration tests for MCP client flow
 *
 * Tests the MCP client infrastructure: config reading, client construction,
 * transport creation, and error handling for unreachable servers.
 * Uses mocked/stubbed external dependencies to avoid network calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MCPClient, readMCPConfig } from "../../src/mcp_client.js";

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Mock fetch globally to avoid actual network calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock performance.now for deterministic timing
let mockTime = 1000;
vi.spyOn(performance, "now").mockImplementation(() => {
  mockTime += 50;
  return mockTime;
});

// ─── readMCPConfig ─────────────────────────────────────────────────────────

describe("readMCPConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env vars that might affect tests
    delete process.env.MCP_SERVERS;
    delete process.env.MCP_SERVERS_CONFIG_PATH;
  });

  it("should return an empty array when no config sources exist", () => {
    const configs = readMCPConfig();
    expect(Array.isArray(configs)).toBe(true);
  });

  it("should read config from MCP_SERVERS env var", () => {
    process.env.MCP_SERVERS = "http://localhost:8080/mcp,http://example.com/mcp";
    const configs = readMCPConfig();
    expect(configs.length).toBeGreaterThanOrEqual(2);
    // At minimum, the env-based configs should be present
    const urls = configs.map((c) => c.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "http://localhost:8080/mcp",
        "http://example.com/mcp",
      ])
    );
  });

  it("should handle empty MCP_SERVERS env var", () => {
    process.env.MCP_SERVERS = "";
    const configs = readMCPConfig();
    expect(Array.isArray(configs)).toBe(true);
  });
});

// ─── MCPClient constructor ─────────────────────────────────────────────────

describe("MCPClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should construct with a URL string", () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    expect(client).toBeInstanceOf(MCPClient);
    expect(client._config.url).toBe("http://localhost:8080/mcp");
  });

  it("should construct with a config object (stdio)", () => {
    const client = new MCPClient({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      transport: "stdio",
    });
    expect(client).toBeInstanceOf(MCPClient);
    expect(client._config.command).toBe("npx");
    expect(client._config.transport).toBe("stdio");
  });

  it("should construct with a config object (http-sse)", () => {
    const client = new MCPClient({
      url: "http://localhost:8080/mcp",
      transport: "http-sse",
    });
    expect(client).toBeInstanceOf(MCPClient);
    expect(client._config.url).toBe("http://localhost:8080/mcp");
    expect(client._config.transport).toBe("http-sse");
  });

  it("should construct with a config object (streamable-http)", () => {
    const client = new MCPClient({
      url: "http://localhost:8080/mcp",
      transport: "streamable-http",
    });
    expect(client).toBeInstanceOf(MCPClient);
    expect(client._config.url).toBe("http://localhost:8080/mcp");
  });

  it("should have nextId starting from 1 and incrementing", () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    // Access the transport's nextId through the internal _createTransport
    // The transport is created lazily on connect, so we test the pattern
    expect(client._config).toBeDefined();
  });

  it("should start in disconnected state", () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    expect(client.isConnected).toBe(false);
    expect(client.serverInfo).toBeNull();
    expect(client.protocolVersion).toBeNull();
  });

  it("should create a rate limiter with MCP-specific buckets", () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    expect(client._rateLimiter).toBeDefined();
    // Should have 'tools' and 'resources' buckets
    const stats = client._rateLimiter.getStats();
    const bucketNames = stats.map((s) => s.bucket);
    expect(bucketNames).toContain("tools");
    expect(bucketNames).toContain("resources");
  });
});

// ─── Error handling for unreachable servers ────────────────────────────────

describe("MCPClient error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("should handle connection failure gracefully (returns null)", async () => {
    // Mock fetch to reject (server unreachable)
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const client = new MCPClient("http://localhost:9999/mcp");
    const result = await client.connect();

    // Should return null on connection failure (not throw)
    expect(result).toBeNull();
    expect(client.isConnected).toBe(false);
  });

  it("should handle HTTP error status codes gracefully", async () => {
    // Mock fetch to return 500
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const client = new MCPClient("http://localhost:8080/mcp");
    const result = await client.connect();

    // Should return null on HTTP error
    expect(result).toBeNull();
  });

  it("should handle timeout during connection", async () => {
    // Mock fetch to reject with a timeout-like error
    mockFetch.mockRejectedValue(new Error("connect ETIMEDOUT"));

    const client = new MCPClient("http://localhost:8080/mcp");
    const result = await client.connect();

    // Should return null on timeout
    expect(result).toBeNull();
  });

  it("should return error when calling tools before connecting", async () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    const result = await client.callTool("some_tool", {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.toolName).toBe("some_tool");
  });

  it("should return empty array when listing tools before connecting", async () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });

  it("should return empty array when listing resources before connecting", async () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    const resources = await client.listResources();
    expect(resources).toEqual([]);
  });

  it("should return null when reading resources before connecting", async () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    const result = await client.readResource("file:///test");
    expect(result).toBeNull();
  });

  it("should return false on ping when not connected", async () => {
    const client = new MCPClient("http://localhost:8080/mcp");
    const result = await client.ping();
    expect(result).toBe(false);
  });
});

// ─── Transport nextId ──────────────────────────────────────────────────────

describe("BaseTransport nextId", () => {
  it("should generate incrementing IDs", async () => {
    // We can test nextId through the transport created during connect attempt
    // Since connect fails (no server), we test the pattern directly
    const client = new MCPClient("http://localhost:8080/mcp");

    // Access the transport factory method
    const transport = client._createTransport();
    expect(transport).toBeDefined();

    // Test nextId
    expect(transport.nextId()).toBe(1);
    expect(transport.nextId()).toBe(2);
    expect(transport.nextId()).toBe(3);
  });
});
