/**
 * mcp_client — Model Context Protocol Client v2
 *
 * Cliente MCP universal con soporte para:
 *   - Transporte HTTP+SSE (remoto)
 *   - Transporte stdio (local, via child_process)
 *   - Transporte Streamable HTTP (simplificado)
 *   - Resources, Prompts, Notificaciones, Progress
 *   - Paginación automática (nextCursor)
 *   - Negociación de versión de protocolo
 *   - Reconexión automática con backoff exponencial
 *
 * Protocolo: 2026-05-15 (con fallback a versiones anteriores)
 *
 * v2.0 — Mayo 2026
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { sanitizeToolOutput } from "./prompt_security.js";
import { RateLimiter } from "./rate_limiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2026-05-15",  // Latest
  "2025-11-05",  // Resources + Prompts + Sampling
  "2025-07-01",  // Streamable HTTP + Notifications
  "2025-03-26",  // Initial (fallback)
];

const DEFAULT_PROTOCOL_VERSION = "2026-05-15";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_RETRIES = 10;

const JSON_RPC_VERSION = "2.0";

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Base — defines the interface all transports must implement
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base transport class.
 * Subclasses must implement: connect(), send(request), close()
 */
class BaseTransport extends EventEmitter {
  constructor() {
    super();
    this._requestId = 0;
    this._pending = new Map(); // id → { resolve, reject, timeout }
    this._notificationHandlers = [];
  }

  nextId() {
    return ++this._requestId;
  }

  /**
   * Sends a JSON-RPC request and waits for the response.
   * @param {string} method - The JSON-RPC method name
   * @param {object} params - Parameters for the method
   * @param {object} [options] - Additional options
   * @param {number} [options.timeout] - Timeout in ms (default: 30000)
   * @returns {Promise<object>} - The JSON-RPC response result
   */
  async request(method, params = {}, options = {}) {
    const id = this.nextId();
    const request = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 30000;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });

      this._sendRaw(request).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Low-level send — must be overridden by subclasses.
   * @param {object} request - The JSON-RPC request object
   */
  async _sendRaw(request) {
    throw new Error("_sendRaw() must be implemented by subclass");
  }

  /**
   * Called by subclasses when a JSON-RPC response arrives.
   * @param {object} response - The JSON-RPC response object
   */
  _handleResponse(response) {
    const { id, result, error } = response;

    if (id === undefined || id === null) {
      // This is a notification (no id)
      this._handleNotification(response);
      return;
    }

    const pending = this._pending.get(id);
    if (!pending) {
      // Response for an unknown/unexpected id — could be a late response
      return;
    }

    clearTimeout(pending.timer);
    this._pending.delete(id);

    if (error) {
      pending.reject(new Error(`MCP error [${error.code}]: ${error.message}`));
    } else {
      pending.resolve(result);
    }
  }

  /**
   * Handles incoming notifications/events from the server.
   * @param {object} notification - JSON-RPC notification object
   */
  _handleNotification(notification) {
    const { method, params } = notification;
    this.emit("notification", { method, params });
    for (const handler of this._notificationHandlers) {
      try {
        handler(method, params);
      } catch {
        // Silently ignore handler errors
      }
    }
  }

  /**
   * Registers a handler for incoming notifications.
   * @param {function} handler - (method, params) => void
   * @returns {function} - Unsubscribe function
   */
  onNotification(handler) {
    this._notificationHandlers.push(handler);
    return () => {
      const idx = this._notificationHandlers.indexOf(handler);
      if (idx >= 0) this._notificationHandlers.splice(idx, 1);
    };
  }

  /**
   * Connects to the MCP server.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error("connect() must be implemented by subclass");
  }

  /**
   * Closes the transport connection.
   * @returns {Promise<void>}
   */
  async close() {
    // Reject all pending requests
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Transport closed"));
    }
    this._pending.clear();
    this.removeAllListeners();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP + SSE Transport — client → server via HTTP POST, server → client via SSE
// ═══════════════════════════════════════════════════════════════════════════════

class HttpSseTransport extends BaseTransport {
  /**
   * @param {string} serverUrl - Base URL of the MCP HTTP endpoint
   * @param {object} [options]
   * @param {object} [options.headers] - Additional HTTP headers
   */
  constructor(serverUrl, options = {}) {
    super();
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    };
    this._sseUrl = null;
    this._sseReader = null;
    this._sseAbortController = null;
    this._closed = false;
  }

  async connect() {
    this._closed = false;

    // Discover SSE endpoint from the base URL
    // In standard MCP, the SSE stream endpoint is at {serverUrl}/events
    // or can be discovered via the initialize endpoint response
    this._sseUrl = `${this.serverUrl}/events`;
    this._startSSEStream();

    return this;
  }

  async _startSSEStream() {
    if (this._closed) return;

    try {
      this._sseAbortController = new AbortController();

      const response = await fetch(this._sseUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...this.headers,
        },
        signal: this._sseAbortController.signal,
      });

      if (!response.ok) {
        // SSE stream not available — this is acceptable for simpler servers
        // We'll rely on polling or just HTTP request/response
        console.warn(`   ⚠️  MCP SSE stream not available at ${this._sseUrl} (${response.status})`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!this._closed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        let eventType = "message";
        let data = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            data = line.slice(6).trim();
          } else if (line === "" && data) {
            // Empty line = end of event
            this._processSSEEvent(eventType, data);
            eventType = "message";
            data = "";
          }
        }
      }
    } catch (err) {
      if (!this._closed) {
        console.warn(`   ⚠️  MCP SSE stream error: ${err.message}`);
        this.emit("notification", {
          method: "notifications/stream/error",
          params: { error: err.message },
        });
      }
    }
  }

  _processSSEEvent(eventType, data) {
    try {
      const parsed = JSON.parse(data);
      this._handleResponse(parsed);
    } catch {
      // Not JSON — might be a keepalive or custom event
      if (eventType !== "message" || data !== "") {
        console.warn(`   ⚠️  MCP SSE non-JSON event: ${eventType}: ${data}`);
      }
    }
  }

  async _sendRaw(request) {
    if (this._closed) {
      throw new Error("Transport closed");
    }

    const response = await fetch(`${this.serverUrl}/jsonrpc`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // For HTTP+SSE, the response may be immediate (JSON) or streaming (SSE)
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      // Server is streaming the response via SSE
      // The actual response will come through the SSE stream
      return; // response handled by _handleResponse via SSE
    }

    // Immediate JSON response
    const result = await response.json();
    this._handleResponse(result);
  }

  async close() {
    this._closed = true;
    if (this._sseAbortController) {
      this._sseAbortController.abort();
      this._sseAbortController = null;
    }
    await super.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Streamable HTTP Transport — simplified transport (MCP spec July 2025+)
// ═══════════════════════════════════════════════════════════════════════════════

class StreamableHttpTransport extends BaseTransport {
  /**
   * @param {string} serverUrl - URL of the MCP server endpoint
   * @param {object} [options]
   * @param {object} [options.headers] - Additional HTTP headers
   * @param {boolean} [options.streamable] - Whether to request streaming responses
   */
  constructor(serverUrl, options = {}) {
    super();
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...options.headers,
    };
    this._streamable = options.streamable !== false;
    this._closed = false;
  }

  async connect() {
    this._closed = false;
    return this;
  }

  async _sendRaw(request) {
    if (this._closed) {
      throw new Error("Transport closed");
    }

    const response = await fetch(this.serverUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      // Streaming response — read SSE events
      await this._readStreamingResponse(response);
    } else {
      // Immediate JSON response
      const result = await response.json();
      this._handleResponse(result);
    }
  }

  async _readStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this._closed) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let data = "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          data += line.slice(6).trim();
        } else if (line === "" && data) {
          try {
            const parsed = JSON.parse(data);
            this._handleResponse(parsed);
          } catch {
            // Ignore non-JSON data
          }
          data = "";
        }
      }
    }
  }

  async close() {
    this._closed = true;
    await super.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// stdio Transport — local MCP servers via child process (stdin/stdout)
// ═══════════════════════════════════════════════════════════════════════════════

class StdioTransport extends BaseTransport {
  /**
   * @param {object} options
   * @param {string} options.command - The command to run (e.g., "npx", "uvx", "node")
   * @param {string[]} options.args - Arguments for the command
   * @param {object} [options.env] - Additional environment variables
   * @param {string} [options.cwd] - Working directory for the process
   * @param {number} [options.timeout] - Process startup timeout in ms
   */
  constructor(options) {
    super();
    this._command = options.command;
    this._args = options.args || [];
    this._env = { ...process.env, ...options.env };
    this._cwd = options.cwd || process.cwd();
    this._startupTimeout = options.timeout || 15000;
    this._process = null;
    this._closed = false;
    this._buffer = "";
  }

  async connect() {
    this._closed = false;

    return new Promise((resolve, reject) => {
      const startupTimer = setTimeout(() => {
        reject(new Error(`MCP stdio startup timeout: ${this._command} (${this._startupTimeout}ms)`));
      }, this._startupTimeout);

      try {
        this._process = spawn(this._command, this._args, {
          env: this._env,
          cwd: this._cwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        // Handle stdout — JSON-RPC responses come as lines
        this._process.stdout.on("data", (chunk) => {
          this._buffer += chunk.toString();

          // Process complete JSON-RPC messages (one per line)
          const lines = this._buffer.split("\n");
          this._buffer = lines.pop() || ""; // Keep incomplete line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const response = JSON.parse(trimmed);
              this._handleResponse(response);
            } catch {
              // Non-JSON output from the process (e.g., logs)
              console.warn(`   ⚠️  MCP stdio non-JSON: ${trimmed.slice(0, 200)}`);
            }
          }
        });

        // Handle stderr
        this._process.stderr.on("data", (chunk) => {
          const text = chunk.toString().trim();
          if (text) {
            console.warn(`   ⚠️  MCP stderr [${this._command}]: ${text}`);
          }
        });

        // Handle process exit
        this._process.on("exit", (code, signal) => {
          console.warn(`   ⚠️  MCP process exited: ${this._command} (code: ${code}, signal: ${signal})`);
          this._closed = true;
          this.emit("close", { code, signal });

          // Reject all pending
          for (const [id, pending] of this._pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`MCP process exited (code: ${code})`));
          }
          this._pending.clear();
        });

        // Handle process error
        this._process.on("error", (err) => {
          clearTimeout(startupTimer);
          reject(new Error(`MCP stdio spawn error: ${err.message}`));
        });

        // Assume startup is successful after a small delay
        // The first message (initialize response) will come through stdout
        setTimeout(() => {
          clearTimeout(startupTimer);
          resolve(this);
        }, 500);

      } catch (err) {
        clearTimeout(startupTimer);
        reject(new Error(`MCP stdio init error: ${err.message}`));
      }
    });
  }

  async _sendRaw(request) {
    if (!this._process || this._closed) {
      throw new Error("MCP stdio transport not connected");
    }

    const message = JSON.stringify(request) + "\n";
    return new Promise((resolve, reject) => {
      const flushed = this._process.stdin.write(message);
      if (!flushed) {
        // Backpressure — wait for drain event
        this._process.stdin.once("drain", resolve);
      } else {
        resolve();
      }
    });
  }

  async close() {
    if (this._closed) return;
    this._closed = true;

    // Try graceful shutdown first
    try {
      await this.request("shutdown", {}, { timeout: 3000 });
    } catch {
      // Ignore shutdown errors
    }

    if (this._process) {
      this._process.stdin.end();
      this._process.kill("SIGTERM");

      // Force kill after 3 seconds
      setTimeout(() => {
        if (this._process && !this._process.killed) {
          this._process.kill("SIGKILL");
        }
      }, 3000);
    }

    await super.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Client — high-level client that uses any transport
// ═══════════════════════════════════════════════════════════════════════════════

export class MCPClient {
  /**
   * @param {object|string} config - Server URL (string) or config object
   *
   * Config object formats:
   *
   *   HTTP+SSE:
   *     { url: "http://localhost:8080/mcp", transport: "http-sse" }
   *
   *   Streamable HTTP:
   *     { url: "https://api.example.com/mcp", transport: "streamable-http" }
   *
   *   stdio:
   *     { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
   *       transport: "stdio" }
   *
   *   Shorthand (string):
   *     "http://localhost:8080/mcp"  →  auto-detected as HTTP transport
   */
  constructor(config) {
    if (typeof config === "string") {
      // Shorthand URL → auto-detect transport
      this._config = { url: config };
    } else {
      this._config = { ...config };
    }

    this._transport = null;
    this._connected = false;
    this._serverInfo = null;
    this._protocolVersion = null;
    this._serverCapabilities = {};
    this._notificationUnsubscribers = [];
    this._reconnectAttempts = 0;
    this._autoReconnect = false;

    // ── Rate Limiter for MCP calls ────────────────────────────────
    /** @type {RateLimiter} Token bucket rate limiter for MCP tool calls */
    this._rateLimiter = new RateLimiter({
      maxTokens: 30,
      refillRate: 1,
      refillInterval: 1000,
      tokensPerRequest: 1,
    });
    this._rateLimiter.createBucket('tools', {
      maxTokens: 30,
      refillRate: 1,
      refillInterval: 1000,
      tokensPerRequest: 1,
    });
    this._rateLimiter.createBucket('resources', {
      maxTokens: 20,
      refillRate: 1,
      refillInterval: 2000,
      tokensPerRequest: 1,
    });

    /** @type {Array} Queue of rate-limited requests waiting to be retried */
    this._rateLimitQueue = [];
    /** @type {boolean} Whether the rate limit queue processor is running */
    this._rateLimitQueueRunning = false;
  }

  // ── Transport Factory ───────────────────────────────────────────────────

  _createTransport() {
    const cfg = this._config;

    // Explicit transport type
    if (cfg.transport === "stdio") {
      return new StdioTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        timeout: cfg.startupTimeout,
      });
    }

    if (cfg.transport === "streamable-http") {
      return new StreamableHttpTransport(cfg.url, {
        headers: cfg.headers,
        streamable: cfg.streamable !== false,
      });
    }

    if (cfg.transport === "http-sse") {
      return new HttpSseTransport(cfg.url, {
        headers: cfg.headers,
      });
    }

    // Auto-detect from URL
    if (cfg.url) {
      // Default to Streamable HTTP (preferred), fallback to HTTP+SSE
      return new StreamableHttpTransport(cfg.url, {
        headers: cfg.headers,
      });
    }

    // Default to stdio if command is provided
    if (cfg.command) {
      return new StdioTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        timeout: cfg.startupTimeout,
      });
    }

    throw new Error(
      "Cannot create MCP transport: provide a URL (string/url), " +
      "a command (stdio), or explicit transport type."
    );
  }

  // ── Connection ──────────────────────────────────────────────────────────

  /**
   * Connects to the MCP server and performs the initialization handshake.
   * Negotiates protocol version automatically.
   *
   * @param {object} [options]
   * @param {boolean} [options.autoReconnect] - Enable auto-reconnection
   * @param {string} [options.protocolVersion] - Request specific protocol version
   * @returns {Promise<object>} - Server info from initialize result
   */
  async connect(options = {}) {
    this._autoReconnect = options.autoReconnect !== false;
    const requestedVersion = options.protocolVersion || DEFAULT_PROTOCOL_VERSION;

    try {
      // Create and connect transport
      this._transport = this._createTransport();
      await this._transport.connect();

      // Perform initialization handshake with version negotiation
      const initResult = await this._initialize(requestedVersion);

      this._connected = true;
      this._reconnectAttempts = 0;
      this._serverInfo = initResult.serverInfo || {};
      this._protocolVersion = initResult.protocolVersion;
      this._serverCapabilities = initResult.capabilities || {};

      // Handle transport close for auto-reconnect
      this._transport.on("close", () => {
        this._connected = false;
        if (this._autoReconnect) {
          this._scheduleReconnect();
        }
        // Notify external callback (e.g., MCPConfigManager) about disconnection
        if (typeof options.onClose === "function") {
          options.onClose();
        }
      });

      // Forward notifications from transport
      this._transport.on("notification", ({ method, params }) => {
        this._handleNotification(method, params);
      });

      console.log(
        `   🔌 MCP v${this._protocolVersion} conectado: ${this._serverInfo.name || "desconocido"}` +
        ` (${this._getLabel()})` +
        ` [${this._getCapabilitiesSummary()}]`
      );

      return {
        serverInfo: this._serverInfo,
        protocolVersion: this._protocolVersion,
        capabilities: this._serverCapabilities,
      };

    } catch (err) {
      this._connected = false;
      console.warn(`   ⚠️  MCP no disponible (${this._getLabel()}): ${err.message}`);

      if (this._autoReconnect) {
        this._scheduleReconnect();
      }

      return null;
    }
  }

  /**
   * Performs the MCP initialization handshake with version negotiation.
   * Tries the requested version first, then falls back to older versions.
   */
  async _initialize(requestedVersion) {
    const versionsToTry = [
      requestedVersion,
      ...SUPPORTED_PROTOCOL_VERSIONS.filter((v) => v !== requestedVersion),
    ];

    let lastError = null;

    for (const version of versionsToTry) {
      try {
        const result = await this._transport.request("initialize", {
          protocolVersion: version,
          capabilities: this._getClientCapabilities(),
          clientInfo: {
            name: "lv-zero",
            version: "4.0.0",
          },
        });

        // Server responded — use this version
        return {
          ...result,
          protocolVersion: result.protocolVersion || version,
        };
      } catch (err) {
        lastError = err;
        // Try next version
      }
    }

    throw new Error(
      `Failed to negotiate MCP protocol version: ${lastError.message}`
    );
  }

  _getClientCapabilities() {
    return {
      tools: {},
      resources: {},
      prompts: {},
      sampling: {},
      roots: {
        listChanged: true,
      },
      experimental: {},
    };
  }

  _getLabel() {
    const cfg = this._config;
    if (cfg.transport === "stdio") {
      return `${cfg.command} ${(cfg.args || []).slice(0, 2).join(" ")}`;
    }
    return cfg.url || cfg.command || "unknown";
  }

  _getCapabilitiesSummary() {
    const caps = [];
    if (this._serverCapabilities.tools) caps.push("tools");
    if (this._serverCapabilities.resources) caps.push("resources");
    if (this._serverCapabilities.prompts) caps.push("prompts");
    if (this._serverCapabilities.sampling) caps.push("sampling");
    if (this._serverCapabilities.roots) caps.push("roots");
    return caps.join(", ") || "basic";
  }

  // ── Reconnection ────────────────────────────────────────────────────────

  _scheduleReconnect() {
    if (this._reconnectAttempts >= RECONNECT_MAX_RETRIES) {
      console.warn(`   ⚠️  MCP max reconnection attempts reached for ${this._getLabel()}`);
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this._reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    );

    this._reconnectAttempts++;
    console.log(
      `   🔄 MCP reconexión en ${delay}ms (intento ${this._reconnectAttempts}/${RECONNECT_MAX_RETRIES})`
    );

    setTimeout(() => {
      this.connect({ autoReconnect: this._autoReconnect }).catch(() => {
        // Error already logged in connect()
      });
    }, delay);
  }

  // ── Disconnection ───────────────────────────────────────────────────────

  async disconnect() {
    this._autoReconnect = false;

    for (const unsub of this._notificationUnsubscribers) {
      try { unsub(); } catch {}
    }
    this._notificationUnsubscribers = [];

    if (this._transport) {
      await this._transport.close();
      this._transport = null;
    }

    this._connected = false;
    this._serverInfo = null;
    this._protocolVersion = null;
    this._serverCapabilities = {};
    this._reconnectAttempts = 0;

    console.log("   🔌 MCP desconectado");
  }

  // ── Notifications ───────────────────────────────────────────────────────

  _handleNotification(method, params) {
    // Built-in notification handling
    switch (method) {
      case "notifications/tools/list_changed":
        this.emit("tools_changed");
        break;
      case "notifications/resources/list_changed":
        this.emit("resources_changed");
        break;
      case "notifications/prompts/list_changed":
        this.emit("prompts_changed");
        break;
      case "notifications/progress":
        this.emit("progress", params);
        break;
      case "notifications/message":
        this.emit("message", params);
        break;
      case "notifications/initialized":
        this.emit("initialized", params);
        break;
      default:
        // Forward unknown notifications
        this.emit("notification", { method, params });
    }
  }

  /**
   * Sends a notification to the server (no response expected).
   * @param {string} method - Notification method name
   * @param {object} [params] - Parameters
   */
  async sendNotification(method, params = {}) {
    if (!this._connected || !this._transport) return;

    try {
      await this._transport._sendRaw({
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
      });
    } catch {
      // Notifications are fire-and-forget
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────────

  /**
   * Lists all available tools from the server.
   * Handles pagination automatically.
   * @returns {Promise<object[]>} - Array of tool definitions
   */
  async listTools() {
    if (!this._connected) return [];

    try {
      const allTools = [];
      let cursor = undefined;

      do {
        const result = await this._transport.request("tools/list", {
          cursor,
        });

        if (result.tools) {
          allTools.push(...result.tools);
        }

        cursor = result.nextCursor;
      } while (cursor);

      return allTools;
    } catch (err) {
      console.warn(`   ⚠️  MCP tools/list error: ${err.message}`);
      return [];
    }
  }

  /**
   * Processes the rate limit queue, retrying requests when tokens become available.
   * Runs asynchronously and processes one queued item per refill interval.
   */
  async _processRateLimitQueue() {
    if (this._rateLimitQueueRunning) return;
    this._rateLimitQueueRunning = true;

    while (this._rateLimitQueue.length > 0) {
      const item = this._rateLimitQueue.shift();
      const { toolName, args, options, resolve, reject } = item;

      // Wait until tokens are available
      while (true) {
        const allowed = await this._rateLimiter.consume('tools', 1);
        if (allowed) break;
        // Wait for one refill interval before checking again
        await new Promise(r => setTimeout(r, 100));
      }

      try {
        const result = await this._transport.request("tools/call", {
          name: toolName,
          arguments: args,
        }, { timeout: options.timeout || 60000 });

        const rawContent = result.content || result;
        const sanitizedContent = typeof rawContent === "string"
          ? sanitizeToolOutput(rawContent)
          : rawContent;

        resolve({
          success: true,
          result: sanitizedContent,
          toolName,
          isError: result.isError || false,
          meta: result.meta,
        });
      } catch (err) {
        resolve({
          success: false,
          error: `Error llamando a tool MCP "${toolName}": ${err.message}`,
          toolName,
        });
      }
    }

    this._rateLimitQueueRunning = false;
  }

  /**
   * Calls a tool on the MCP server.
   * @param {string} toolName - Name of the tool to call
   * @param {object} [args] - Arguments for the tool
   * @param {object} [options]
   * @param {number} [options.timeout] - Request timeout in ms
   * @returns {Promise<object>} - Result with success/error
   */
  async callTool(toolName, args = {}, options = {}) {
    if (!this._connected) {
      return { success: false, error: "MCP no conectado", toolName };
    }

    // ── Rate Limiting Check ───────────────────────────────────────
    // If rate limited, queue the request and retry after refill interval
    const allowed = await this._rateLimiter.consume('tools', 1);
    if (!allowed) {
      // Queue the request and return a promise that resolves when processed
      return new Promise((resolve, reject) => {
        this._rateLimitQueue.push({ toolName, args, options, resolve, reject });
        this._processRateLimitQueue();
      });
    }

    try {
      const result = await this._transport.request("tools/call", {
        name: toolName,
        arguments: args,
      }, { timeout: options.timeout || 60000 });

      // ── PROMPT SECURITY: Sanitize MCP tool output ──────────────────
      // Strip control characters, limit length, remove embedded tags
      // that could confuse the LLM (system prompt overrides, [SYSTEM], etc.)
      const rawContent = result.content || result;
      const sanitizedContent = typeof rawContent === "string"
        ? sanitizeToolOutput(rawContent)
        : rawContent;

      return {
        success: true,
        result: sanitizedContent,
        toolName,
        isError: result.isError || false,
        meta: result.meta,
      };
    } catch (err) {
      return {
        success: false,
        error: `Error llamando a tool MCP "${toolName}": ${err.message}`,
        toolName,
      };
    }
  }

  // ── Resources ───────────────────────────────────────────────────────────

  /**
   * Lists available resources from the server.
   * @param {object} [options]
   * @param {string} [options.cursor] - Pagination cursor
   * @returns {Promise<object[]>} - Array of resource definitions
   */
  async listResources(options = {}) {
    if (!this._connected) return [];

    try {
      const allResources = [];
      let cursor = options.cursor;

      do {
        const result = await this._transport.request("resources/list", {
          cursor,
        });

        if (result.resources) {
          allResources.push(...result.resources);
        }

        cursor = result.nextCursor;
      } while (cursor);

      return allResources;
    } catch (err) {
      // Resources may not be supported — that's OK
      return [];
    }
  }

  /**
   * Reads a specific resource from the server.
   * @param {string} uri - Resource URI (e.g., "file:///path/to/file")
   * @returns {Promise<object|null>} - Resource contents
   */
  async readResource(uri) {
    if (!this._connected) return null;

    try {
      return await this._transport.request("resources/read", { uri });
    } catch (err) {
      console.warn(`   ⚠️  MCP resources/read error: ${err.message}`);
      return null;
    }
  }

  /**
   * Subscribes to change notifications for a resource.
   * @param {string} uri - Resource URI
   * @returns {Promise<boolean>}
   */
  async subscribeResource(uri) {
    if (!this._connected) return false;

    try {
      await this._transport.request("resources/subscribe", { uri });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unsubscribes from change notifications for a resource.
   * @param {string} uri - Resource URI
   * @returns {Promise<boolean>}
   */
  async unsubscribeResource(uri) {
    if (!this._connected) return false;

    try {
      await this._transport.request("resources/unsubscribe", { uri });
      return true;
    } catch {
      return false;
    }
  }

  // ── Prompts ─────────────────────────────────────────────────────────────

  /**
   * Lists available prompts from the server.
   * @returns {Promise<object[]>} - Array of prompt definitions
   */
  async listPrompts() {
    if (!this._connected) return [];

    try {
      const allPrompts = [];
      let cursor = undefined;

      do {
        const result = await this._transport.request("prompts/list", {
          cursor,
        });

        if (result.prompts) {
          allPrompts.push(...result.prompts);
        }

        cursor = result.nextCursor;
      } while (cursor);

      return allPrompts;
    } catch {
      // Prompts may not be supported
      return [];
    }
  }

  /**
   * Gets a specific prompt from the server.
   * @param {string} name - Prompt name
   * @param {object} [args] - Prompt arguments
   * @returns {Promise<object|null>} - Prompt content
   */
  async getPrompt(name, args = {}) {
    if (!this._connected) return null;

    try {
      return await this._transport.request("prompts/get", {
        name,
        arguments: args,
      });
    } catch (err) {
      console.warn(`   ⚠️  MCP prompts/get error: ${err.message}`);
      return null;
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  /**
   * Sends a ping to check if the server is still alive.
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (!this._connected) return false;

    try {
      await this._transport.request("ping", {}, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sets the logging level on the server.
   * @param {string} level - One of: debug, info, notice, warning, error, critical, alert, emergency
   * @returns {Promise<boolean>}
   */
  async setLoggingLevel(level) {
    if (!this._connected) return false;

    try {
      await this._transport.request("logging/setLevel", { level });
      return true;
    } catch {
      return false;
    }
  }

  // ── Properties ──────────────────────────────────────────────────────────

  get isConnected() {
    return this._connected;
  }

  get serverInfo() {
    return this._serverInfo;
  }

  get protocolVersion() {
    return this._protocolVersion;
  }

  get serverCapabilities() {
    return this._serverCapabilities;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Config Manager (Backward Compat)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads MCP server configuration from .env or mcp_servers.json.
 *
 * @deprecated Since v4.2.0 — Use MCPConfigManager from mcp_config_manager.js.
 *   This function is kept for backward compatibility and delegates to the
 *   new MCPConfigManager if available.
 *
 * Supports both legacy format (array of URLs) and modern format:
 *   {
 *     "mcpServers": {
 *       "server-name": {
 *         "command": "npx",
 *         "args": ["-y", "package"],
 *         "transport": "stdio"
 *       }
 *     }
 *   }
 */
export function readMCPConfig() {
  // If the global manager is available, delegate to it
  if (global.__mcpConfigManager) {
    return global.__mcpConfigManager.readConfig();
  }

  // Otherwise, fall back to legacy implementation
  const configs = [];

  // 1. Try reading MCP_SERVERS from env (comma-separated URLs, legacy)
  const envServers = process.env.MCP_SERVERS;
  if (envServers) {
    for (const entry of envServers.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) {
        configs.push({ url: trimmed });
      }
    }
  }

  // 2. Try reading mcp_servers.json from project root
  const configPath = path.resolve(__dirname, "..", "mcp_servers.json");
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      // Modern format: { mcpServers: { name: { command, args, ... } } }
      if (raw.mcpServers && typeof raw.mcpServers === "object") {
        for (const [name, cfg] of Object.entries(raw.mcpServers)) {
          configs.push({
            name,
            command: cfg.command,
            args: cfg.args,
            url: cfg.url,
            transport: cfg.transport || (cfg.command ? "stdio" : undefined),
            env: cfg.env,
            headers: cfg.headers,
          });
        }
      }
      // Legacy format: array of URLs or objects
      else if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (typeof entry === "string") {
            configs.push({ url: entry });
          } else if (typeof entry === "object" && entry !== null) {
            configs.push({
              url: entry.url,
              command: entry.command,
              args: entry.args,
              transport: entry.transport,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`   ⚠️  Error parsing mcp_servers.json: ${err.message}`);
    }
  }

  // 3. Also check for modern file at MCP_SERVERS_CONFIG_PATH env var
  const modernConfigPath = process.env.MCP_SERVERS_CONFIG_PATH;
  if (modernConfigPath && fs.existsSync(modernConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(modernConfigPath, "utf-8"));
      if (raw.mcpServers && typeof raw.mcpServers === "object") {
        for (const [name, cfg] of Object.entries(raw.mcpServers)) {
          // Avoid duplicates (check by name)
          if (!configs.some((c) => c.name === name)) {
            configs.push({
              name,
              command: cfg.command,
              args: cfg.args,
              url: cfg.url,
              transport: cfg.transport || (cfg.command ? "stdio" : undefined),
              env: cfg.env,
              headers: cfg.headers,
            });
          }
        }
      }
    } catch {}
  }

  return configs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Skill for lv-zero agent
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * MCP skill for lv-zero — allows the agent to interact with MCP servers,
 * discover tools, resources, and prompts.
 */
export const mcpSkill = {
  name: "mcp_client",
  description:
    "Cliente del Model Context Protocol (MCP) v2 — Mayo 2026. " +
    "Permite conectarse a servidores MCP externos (HTTP, stdio, Streamable HTTP) " +
    "para descubrir y usar herramientas, recursos y prompts adicionales. " +
    "Soporta servidores locales (npx/uvx commands) y remotos (URLs). " +
    "Configura los servidores en mcp_servers.json o .env (MCP_SERVERS).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "connect", "list_tools", "call_tool",
          "list_resources", "read_resource",
          "list_prompts", "get_prompt",
          "status", "disconnect",
        ],
        description:
          '"connect": Conecta a uno o todos los servidores MCP configurados. ' +
          '"list_tools": Lista las herramientas de todos los servidores conectados. ' +
          '"call_tool": Llama a una herramienta en un servidor específico. ' +
          '"list_resources": Lista los recursos disponibles. ' +
          '"read_resource": Lee un recurso específico (URI). ' +
          '"list_prompts": Lista las plantillas de prompts disponibles. ' +
          '"get_prompt": Obtiene una plantilla de prompt específica. ' +
          '"status": Muestra el estado de todas las conexiones MCP. ' +
          '"disconnect": Desconecta todos los servidores MCP.',
      },
      serverUrl: {
        type: "string",
        description:
          "(Opcional) URL del servidor MCP. Ej: http://localhost:8080/mcp. " +
          "Si no se especifica, usa la configuración de mcp_servers.json o MCP_SERVERS.",
      },
      serverName: {
        type: "string",
        description:
          "(Opcional) Nombre del servidor configurado en mcp_servers.json para identificar el servidor destino.",
      },
      toolName: {
        type: "string",
        description: "(Para call_tool) Nombre de la herramienta a invocar.",
      },
      toolArgs: {
        type: "object",
        description: "(Para call_tool) Argumentos para la herramienta.",
      },
      resourceUri: {
        type: "string",
        description:
          "(Para read_resource) URI del recurso a leer. Ej: file:///path/to/file",
      },
      promptName: {
        type: "string",
        description: "(Para get_prompt) Nombre del prompt a obtener.",
      },
      promptArgs: {
        type: "object",
        description: "(Para get_prompt) Argumentos para el prompt.",
      },
      command: {
        type: "string",
        description:
          "(Para connect con servidor stdio) Comando a ejecutar. Ej: npx, uvx, node",
      },
      commandArgs: {
        type: "array",
        items: { type: "string" },
        description:
          "(Para connect con servidor stdio) Argumentos del comando.",
      },
    },
  },

  handler: async (params) => {
    const { action } = params;

    // If the global MCPConfigManager is available, delegate to it
    if (global.__mcpConfigManager) {
      return await global.__mcpConfigManager._handleSkillCall(params);
    }

    // Legacy fallback: use the old global registry
    // Initialize global MCP clients registry if not present
    if (!global.__mcp_clients) {
      global.__mcp_clients = [];
    }

    switch (action) {
      case "connect":
        return await handleConnect(params);
      case "list_tools":
        return await handleListTools();
      case "call_tool":
        return await handleCallTool(params);
      case "list_resources":
        return await handleListResources(params);
      case "read_resource":
        return await handleReadResource(params);
      case "list_prompts":
        return await handleListPrompts(params);
      case "get_prompt":
        return await handleGetPrompt(params);
      case "status":
        return handleStatus();
      case "disconnect":
        return await handleDisconnect();
      default:
        return { success: false, error: `Acción desconocida: ${action}` };
    }
  },
};

// ── Skill Handlers ────────────────────────────────────────────────────────────

async function handleConnect(params) {
  const { serverUrl, serverName, command, commandArgs } = params;

  // If specific server details provided, connect to that server
  if (command) {
    const client = new MCPClient({
      command,
      args: commandArgs || [],
      transport: "stdio",
    });
    const info = await client.connect();
    if (info) {
      global.__mcp_clients.push(client);
      return formatConnectionResult(client, info);
    }
    return { success: false, error: `No se pudo conectar: ${command}` };
  }

  if (serverUrl) {
    const client = new MCPClient(serverUrl);
    const info = await client.connect();
    if (info) {
      global.__mcp_clients.push(client);
      return formatConnectionResult(client, info);
    }
    return { success: false, error: `No se pudo conectar a ${serverUrl}` };
  }

  if (serverName) {
    // Find server config by name
    const configs = readMCPConfig();
    const cfg = configs.find((c) => c.name === serverName);
    if (!cfg) {
      return { success: false, error: `Servidor "${serverName}" no encontrado en configuración.` };
    }
    const client = new MCPClient(cfg);
    const info = await client.connect();
    if (info) {
      global.__mcp_clients.push(client);
      return formatConnectionResult(client, info);
    }
    return { success: false, error: `No se pudo conectar a "${serverName}"` };
  }

  // Auto-connect all configured servers
  const configs = readMCPConfig();
  if (configs.length === 0) {
    return {
      success: false,
      error:
        "No hay servidores MCP configurados. " +
        "Define MCP_SERVERS en .env, crea mcp_servers.json, " +
        "o proporciona un serverUrl, command, o serverName.",
    };
  }

  const results = [];
  for (const cfg of configs) {
    const client = new MCPClient(cfg);
    const info = await client.connect();
    if (info) {
      global.__mcp_clients.push(client);
      results.push({
        name: cfg.name || cfg.url || cfg.command,
        connected: true,
        protocolVersion: info.protocolVersion,
        serverInfo: info.serverInfo,
        capabilities: info.capabilities,
      });
    } else {
      results.push({
        name: cfg.name || cfg.url || cfg.command,
        connected: false,
      });
    }
  }
  return { success: true, results };
}

function formatConnectionResult(client, info) {
  return {
    success: true,
    serverUrl: client._config.url || `${client._config.command} ${(client._config.args || []).slice(0, 2).join(" ")}`,
    protocolVersion: info.protocolVersion,
    serverInfo: info.serverInfo,
    capabilities: info.capabilities,
  };
}

async function handleListTools() {
  const allTools = [];
  for (const c of global.__mcp_clients) {
    if (c.isConnected) {
      const tools = await c.listTools();
      allTools.push({
        serverName: c.serverInfo?.name || c._config.url || c._config.command,
        tools,
        count: tools.length,
      });
    }
  }
  return {
    success: true,
    servers: allTools,
    totalClients: global.__mcp_clients.length,
  };
}

async function handleCallTool(params) {
  const { toolName, toolArgs = {}, serverName } = params;

  if (!toolName) {
    return { success: false, error: "toolName es requerido." };
  }

  // If serverName specified, find that client
  if (serverName) {
    for (const c of global.__mcp_clients) {
      const name = c.serverInfo?.name || c._config.name || "";
      if (name === serverName && c.isConnected) {
        return await c.callTool(toolName, toolArgs);
      }
    }
    return { success: false, error: `Servidor "${serverName}" no encontrado o desconectado.` };
  }

  // Try on first connected client
  for (const c of global.__mcp_clients) {
    if (c.isConnected) {
      return await c.callTool(toolName, toolArgs);
    }
  }

  return { success: false, error: "No hay servidores MCP conectados." };
}

async function handleListResources(params) {
  const { serverName } = params;
  const allResources = [];

  for (const c of global.__mcp_clients) {
    if (!c.isConnected) continue;
    if (serverName) {
      const name = c.serverInfo?.name || c._config.name || "";
      if (name !== serverName) continue;
    }
    const resources = await c.listResources();
    allResources.push({
      serverName: c.serverInfo?.name || c._config.url || c._config.command,
      resources,
      count: resources.length,
    });
  }

  return { success: true, servers: allResources };
}

async function handleReadResource(params) {
  const { resourceUri, serverName } = params;

  if (!resourceUri) {
    return { success: false, error: "resourceUri es requerido." };
  }

  for (const c of global.__mcp_clients) {
    if (!c.isConnected) continue;
    if (serverName) {
      const name = c.serverInfo?.name || c._config.name || "";
      if (name !== serverName) continue;
    }
    const result = await c.readResource(resourceUri);
    if (result) {
      return { success: true, resourceUri, data: result };
    }
  }

  return { success: false, error: "No se pudo leer el recurso." };
}

async function handleListPrompts(params) {
  const { serverName } = params;
  const allPrompts = [];

  for (const c of global.__mcp_clients) {
    if (!c.isConnected) continue;
    if (serverName) {
      const name = c.serverInfo?.name || c._config.name || "";
      if (name !== serverName) continue;
    }
    const prompts = await c.listPrompts();
    allPrompts.push({
      serverName: c.serverInfo?.name || c._config.url || c._config.command,
      prompts,
      count: prompts.length,
    });
  }

  return { success: true, servers: allPrompts };
}

async function handleGetPrompt(params) {
  const { promptName, promptArgs = {}, serverName } = params;

  if (!promptName) {
    return { success: false, error: "promptName es requerido." };
  }

  for (const c of global.__mcp_clients) {
    if (!c.isConnected) continue;
    if (serverName) {
      const name = c.serverInfo?.name || c._config.name || "";
      if (name !== serverName) continue;
    }
    const result = await c.getPrompt(promptName, promptArgs);
    if (result) {
      return { success: true, promptName, result };
    }
  }

  return { success: false, error: `Prompt "${promptName}" no encontrado.` };
}

function handleStatus() {
  return {
    success: true,
    clients: global.__mcp_clients.map((c) => ({
      connected: c.isConnected,
      serverInfo: c.serverInfo,
      protocolVersion: c.protocolVersion,
      capabilities: c.serverCapabilities,
      config: {
        url: c._config.url,
        command: c._config.command,
        args: c._config.args,
        transport: c._config.transport || (c._config.command ? "stdio" : "auto"),
      },
    })),
  };
}

async function handleDisconnect() {
  const results = [];
  for (const c of global.__mcp_clients) {
    const label = c.serverInfo?.name || c._config.url || c._config.command || "unknown";
    try {
      await c.disconnect();
      results.push({ name: label, disconnected: true });
    } catch (err) {
      results.push({ name: label, disconnected: false, error: err.message });
    }
  }
  global.__mcp_clients = [];
  return { success: true, results };
}
