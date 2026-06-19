/**
 * ─── MCP Server for lv-zero (May 2026 Protocol) ───────────────────────────
 *
 * Exposes all registered lv-zero skills as MCP tools, plus resources and
 * prompts, so external AI tools (Claude Code, Cursor, Windsurf, custom MCP
 * clients) can consume them via the Model Context Protocol.
 *
 * Two transport modes:
 *   HTTP  →  Node.js built-in http module (no express dependency)
 *             Single JSON-RPC endpoint at /jsonrpc
 *   stdio →  Readline from stdin, write to stdout (for editor integrations)
 *
 * Integration:
 *   const { MCPServer } = await import('./mcp_server.js');
 *   const server = new MCPServer({ getSkills, executeToolCall, getStatus, getSystemPrompt });
 *   await server.start({ httpPort: 3001 });  // or { stdio: true }
 *   // later:
 *   await server.stop();
 *
 * @module mcp_server
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ── Constants ────────────────────────────────────────────────────────────────

/** Supported MCP protocol versions (newest first, negotiated during initialize) */
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2026-05-15",
  "2025-11-05",
  "2025-07-01",
  "2025-03-26",
];

/** Default HTTP port for the MCP server */
const DEFAULT_HTTP_PORT = 3001;

/** Default host to bind */
const DEFAULT_HOST = "127.0.0.1";

// ── MCP Server ──────────────────────────────────────────────────────────────

export class MCPServer {
  /**
   * @param {object} options
   * @param {Function} options.getSkills        - () => [{ name, description, parameters?, handler? }]
   * @param {Function} options.executeToolCall  - (toolCall, toolIndex, totalTools) => Promise<result>
   * @param {Function} [options.getStatus]      - () => object (orchestrator status)
   * @param {Function} [options.getSystemPrompt]- () => string (current system prompt)
   * @param {Function} [options.getProjectInfo] - () => { name, path } (current project)
   * @param {object}   [options.logger]         - { info, warn, error } or console
   */
  constructor(options = {}) {
    this._getSkills = options.getSkills || (() => []);
    this._executeToolCall = options.executeToolCall || (() => ({ role: "tool", content: "No orchestrator bound" }));
    this._getStatus = options.getStatus || (() => ({}));
    this._getSystemPrompt = options.getSystemPrompt || (() => "");
    this._getProjectInfo = options.getProjectInfo || (() => ({}));
    this._logger = options.logger || console;

    /** Set after initialize succeeds */
    this._initialized = false;
    this._clientCapabilities = null;
    this._clientInfo = null;
    this._negotiatedVersion = null;

    /** HTTP server instance */
    this._httpServer = null;

    /** Whether stdio mode is active */
    this._stdioMode = false;

    /** Pending JSON-RPC requests for stdio mode (id → resolve) */
    this._pendingStdio = new Map();

    /** Shutdown controller */
    this._abortController = new AbortController();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Start the MCP server in one or both modes.
   *
   * @param {object} [opts]
   * @param {number} [opts.httpPort=3001]  - HTTP port (omit to disable HTTP)
   * @param {string} [opts.host="127.0.0.1"]
   * @param {boolean}[opts.stdio=false]    - Enable stdio transport
   */
  async start(opts = {}) {
    const { httpPort, host = DEFAULT_HOST, stdio = false } = opts;

    if (httpPort !== undefined) {
      await this._startHttp(httpPort, host);
    }

    if (stdio) {
      this._startStdio();
    }

    if (httpPort === undefined && !stdio) {
      this._logger.warn("[MCP-Server] No transport enabled. Use httpPort or stdio.");
    }

    this._logger.info(
      `[MCP-Server] Started` +
        (httpPort ? ` (HTTP :${httpPort})` : "") +
        (stdio ? " (stdio)" : "")
    );
  }

  /**
   * Gracefully stop the server.
   */
  async stop() {
    this._abortController.abort();

    if (this._httpServer) {
      await new Promise((resolve) => this._httpServer.close(resolve));
      this._httpServer = null;
      this._logger.info("[MCP-Server] HTTP server stopped");
    }

    if (this._stdioMode) {
      this._stdioMode = false;
      this._logger.info("[MCP-Server] stdio mode stopped");
    }

    this._initialized = false;
    this._negotiatedVersion = null;
  }

  // ── HTTP Transport ────────────────────────────────────────────────────

  /**
   * Start the HTTP server using Node.js built-in http module.
   * @param {number} port
   * @param {string} host
   */
  _startHttp(port, host) {
    return new Promise((resolve, reject) => {
      this._httpServer = http.createServer((req, res) => this._handleHttpRequest(req, res));

      this._httpServer.on("error", (err) => {
        this._logger.error(`[MCP-Server] HTTP error: ${err.message}`);
        if (!this._httpServer.listening) reject(err);
      });

      this._httpServer.listen(port, host, () => {
        resolve();
      });
    });
  }

  /**
   * Route incoming HTTP requests.
   *   POST /jsonrpc  →  JSON-RPC handler
   *   GET  /health   →  Health check
   *   GET  /         →  Info
   */
  _handleHttpRequest(req, res) {
    // CORS headers (allow any origin for MCP clients)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      this._handleHealthCheck(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      this._handleInfo(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/jsonrpc") {
      this._handleJsonRpcHttp(req, res);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  /** GET /health → simple health check */
  _handleHealthCheck(res) {
    const health = {
      status: this._initialized ? "ok" : "initializing",
      uptime: process.uptime(),
      version: this._negotiatedVersion || "pending",
      skillsCount: this._getSkills().length,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
  }

  /** GET / → server info */
  _handleInfo(res) {
    const info = {
      server: "lv-zero MCP Server",
      protocol: "Model Context Protocol",
      version: this._negotiatedVersion || "pending",
      transports: ["http+sse", "stdio"],
      skills: this._getSkills().length,
      initialized: this._initialized,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info, null, 2));
  }

  /**
   * Handle a JSON-RPC request over HTTP.
   * Supports both JSON response and SSE streaming for notifications.
   */
  async _handleJsonRpcHttp(req, res) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this._jsonRpcError(null, -32700, "Parse error: invalid JSON")));
        return;
      }

      try {
        const response = await this._processJsonRpc(request);

        // Check if client wants SSE streaming (for notifications)
        const acceptHeader = req.headers.accept || "";
        if (acceptHeader.includes("text/event-stream") && response && response.result?.streamable) {
          // SSE streaming response
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const streamData = response.result;
          delete streamData.streamable;
          res.write(`event: result\ndata: ${JSON.stringify({ ...response, result: streamData })}\n\n`);
          res.end();
        } else {
          // Standard JSON response
          res.writeHead(response ? 200 : 202, {
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify(response));
        }
      } catch (err) {
        this._logger.error(`[MCP-Server] Request error: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(this._jsonRpcError(request.id, -32603, `Internal error: ${err.message}`))
        );
      }
    });
  }

  // ── Stdio Transport ───────────────────────────────────────────────────

  /**
   * Start stdio transport: read JSON-RPC messages from stdin,
   * write responses to stdout.
   */
  _startStdio() {
    this._stdioMode = true;

    // Use readline interface for line-delimited JSON
    import("node:readline").then(({ createInterface }) => {
      const rl = createInterface({
        input: process.stdin,
        terminal: false,
      });

      rl.on("line", async (line) => {
        line = line.trim();
        if (!line) return;

        let request;
        try {
          request = JSON.parse(line);
        } catch {
          const errResp = this._jsonRpcError(null, -32700, "Parse error");
          console.log(JSON.stringify(errResp));
          return;
        }

        // Ignore notifications (no id)
        if (request.id === undefined || request.id === null) {
          try {
            await this._processJsonRpc(request);
          } catch {
            // Notifications are fire-and-forget
          }
          return;
        }

        try {
          const response = await this._processJsonRpc(request);
          // Check if response is a notification (no result/error for long-running)
          if (response) {
            console.log(JSON.stringify(response));
          }
        } catch (err) {
          const errResp = this._jsonRpcError(request.id, -32603, err.message);
          console.log(JSON.stringify(errResp));
        }
      });

      rl.on("close", () => {
        this._logger.info("[MCP-Server] stdio input ended");
        if (this._stdioMode) {
          this.stop().catch(() => {});
        }
      });

      // Signal readiness
      const readyMsg = JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: { server: "lv-zero MCP Server", status: "listening" },
      });
      console.log(readyMsg);
    }).catch((err) => {
      this._logger.error(`[MCP-Server] stdio init failed: ${err.message}`);
    });
  }

  // ── JSON-RPC Processing ──────────────────────────────────────────────

  /**
   * Process a single JSON-RPC request.
   * @param {object} request - The JSON-RPC request { jsonrpc, id, method, params }
   * @returns {object|null} JSON-RPC response, or null for notifications
   */
  async _processJsonRpc(request) {
    const { id, method, params = {} } = request;

    // Notifications have no id
    if (id === undefined || id === null) {
      await this._handleNotification(method, params);
      return null;
    }

    try {
      switch (method) {
        // ── Lifecycle ──
        case "initialize":
          return this._jsonRpcSuccess(id, await this._handleInitialize(params));

        case "notifications/initialized":
          return null; // No response needed

        // ── Tools ──
        case "tools/list":
          return this._jsonRpcSuccess(id, await this._handleToolsList(params));

        case "tools/call":
          return this._jsonRpcSuccess(id, await this._handleToolsCall(params));

        // ── Resources ──
        case "resources/list":
          return this._jsonRpcSuccess(id, this._handleResourcesList(params));

        case "resources/read":
          return this._jsonRpcSuccess(id, await this._handleResourcesRead(params));

        case "resources/subscribe":
          return this._jsonRpcSuccess(id, { subscribed: true });

        case "resources/unsubscribe":
          return this._jsonRpcSuccess(id, { unsubscribed: true });

        // ── Prompts ──
        case "prompts/list":
          return this._jsonRpcSuccess(id, this._handlePromptsList(params));

        case "prompts/get":
          return this._jsonRpcSuccess(id, await this._handlePromptsGet(params));

        // ── Utility ──
        case "ping":
          return this._jsonRpcSuccess(id, {});

        case "logging/setLevel":
          return this._jsonRpcSuccess(id, {});

        default:
          return this._jsonRpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      this._logger.error(`[MCP-Server] ${method} error: ${err.message}`);
      return this._jsonRpcError(id, -32603, err.message);
    }
  }

  /**
   * Handle a notification (no response expected).
   */
  async _handleNotification(method, params) {
    switch (method) {
      case "notifications/initialized":
        this._initialized = true;
        this._logger.info("[MCP-Server] Client initialized");
        break;
      case "notifications/cancelled":
        this._logger.info("[MCP-Server] Request cancelled by client");
        break;
      case "notifications/progress":
        // Client sent progress notification (ignore on server side)
        break;
      default:
        this._logger.debug(`[MCP-Server] Unknown notification: ${method}`);
    }
  }

  // ── Initialize Handler ───────────────────────────────────────────────

  /**
   * Handle the MCP initialize handshake.
   * Negotiates protocol version and reports server capabilities.
   */
  _handleInitialize(params) {
    const clientVersion = params.protocolVersion;
    const clientInfo = params.clientInfo || {};
    const clientCapabilities = params.capabilities || {};

    this._clientInfo = clientInfo;
    this._clientCapabilities = clientCapabilities;

    // Negotiate protocol version: choose the newest mutually supported
    const negotiatedVersion = this._negotiateVersion(clientVersion);
    this._negotiatedVersion = negotiatedVersion;

    this._logger.info(
      `[MCP-Server] Client "${clientInfo.name || "unknown"}" ` +
        `v${clientInfo.version || "?"} initialized ` +
        `(proto: ${negotiatedVersion})`
    );

    // Get skills for capabilities report
    const skills = this._getSkills();

    return {
      protocolVersion: negotiatedVersion,
      capabilities: {
        tools: {
          listChanged: true,
          total: skills.length,
        },
        resources: {
          listChanged: true,
          subscribe: true,
        },
        prompts: {
          listChanged: true,
        },
        logging: {},
      },
      serverInfo: {
        name: "lv-zero",
        version: "2.0.0",
        description: "lv-zero Autonomous Coding Agent - MCP Server",
      },
    };
  }

  /**
   * Negotiate protocol version: find the newest version supported by both.
   * Falls back through the chain if client version is unknown.
   * @param {string} clientVersion
   * @returns {string}
   */
  _negotiateVersion(clientVersion) {
    // If client sent a specific version, use it if supported
    if (SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion)) {
      return clientVersion;
    }

    // If client sent a version we don't know, find the newest we support
    // that is <= clientVersion (string comparison works for date-based versions)
    for (const ourVersion of SUPPORTED_PROTOCOL_VERSIONS) {
      if (clientVersion >= ourVersion) {
        return ourVersion;
      }
    }

    // Fallback to oldest supported
    return SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
  }

  // ── Tools Handlers ───────────────────────────────────────────────────

  /**
   * Handle tools/list - return all registered skills as MCP tools.
   * Supports pagination via cursor.
   */
  _handleToolsList(params) {
    const { cursor } = params || {};
    const skills = this._getSkills();

    // Convert skills to MCP tool format
    const allTools = skills.map((skill) => this._skillToMcpTool(skill));

    // Pagination (default page size: 50)
    const pageSize = 50;
    let tools = allTools;
    let nextCursor = undefined;

    if (cursor) {
      const startIndex = parseInt(cursor, 10);
      tools = allTools.slice(startIndex, startIndex + pageSize);
      if (startIndex + pageSize < allTools.length) {
        nextCursor = String(startIndex + pageSize);
      }
    } else if (allTools.length > pageSize) {
      tools = allTools.slice(0, pageSize);
      nextCursor = String(pageSize);
    }

    return { tools, nextCursor };
  }

  /**
   * Handle tools/call - delegate to orchestrator.
   * Returns MCP-formatted content (text, resource, etc.)
   */
  async _handleToolsCall(params) {
    const { name, arguments: args } = params;

    if (!name) {
      return {
        content: [{ type: "text", text: "Error: Tool name is required" }],
        isError: true,
      };
    }

    // Build toolCall object in orchestrator format
    const toolCall = {
      id: randomUUID(),
      function: {
        name,
        arguments: JSON.stringify(args || {}),
      },
    };

    try {
      const result = await this._executeToolCall(toolCall, 0, 1);

      // Format the result as MCP content
      const content = [];

      if (typeof result.content === "string") {
        content.push({ type: "text", text: result.content });
      } else if (typeof result.content === "object") {
        content.push({ type: "text", text: JSON.stringify(result.content, null, 2) });
      } else {
        content.push({ type: "text", text: String(result.content || "OK") });
      }

      return { content };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error executing ${name}: ${err.message}` }],
        isError: true,
      };
    }
  }

  // ── Resources Handlers ───────────────────────────────────────────────

  /**
   * Handle resources/list - expose project context and status.
   */
  _handleResourcesList() {
    const resources = [
      {
        uri: "mcp://lv-zero/project",
        name: "Current Project",
        description: "Information about the active project in lv-zero",
        mimeType: "application/json",
      },
      {
        uri: "mcp://lv-zero/skills",
        name: "Skills Registry",
        description: "List of all registered skills with their descriptions",
        mimeType: "application/json",
      },
      {
        uri: "mcp://lv-zero/status",
        name: "System Status",
        description: "Current orchestrator status, health, and metrics",
        mimeType: "application/json",
      },
      {
        uri: "mcp://lv-zero/prompt/system",
        name: "System Prompt",
        description: "The current system prompt used by the orchestrator",
        mimeType: "text/markdown",
      },
    ];

    // Add project file resources if project info is available
    const projectInfo = this._getProjectInfo();
    if (projectInfo && projectInfo.path) {
      resources.push({
        uri: `file://${projectInfo.path}/PLAN.md`,
        name: "PLAN.md",
        description: "Current project plan file",
        mimeType: "text/markdown",
      });
      resources.push({
        uri: `file://${projectInfo.path}/LOGICA.md`,
        name: "LOGICA.md",
        description: "Project logic documentation",
        mimeType: "text/markdown",
      });
    }

    return { resources };
  }

  /**
   * Handle resources/read - return the content of a specific resource.
   */
  async _handleResourcesRead(params) {
    const { uri } = params;

    if (!uri) {
      return {
        contents: [],
        isError: true,
        error: "URI is required",
      };
    }

    try {
      const parsed = new URL(uri);

      // Built-in mcp:// resources
      if (parsed.protocol === "mcp:") {
        return this._readMcpResource(parsed);
      }

      // file:// resources - read from filesystem
      if (parsed.protocol === "file:") {
        return this._readFileResource(parsed);
      }

      return {
        contents: [],
        isError: true,
        error: `Unsupported URI scheme: ${parsed.protocol}`,
      };
    } catch (err) {
      return {
        contents: [],
        isError: true,
        error: `Error reading resource: ${err.message}`,
      };
    }
  }

  /**
   * Read a built-in mcp:// resource.
   */
  _readMcpResource(parsed) {
    const host = parsed.hostname; // e.g. "lv-zero"
    const pathname = parsed.pathname.replace(/^\//, ""); // e.g. "project"

    let blob;
    switch (`${host}/${pathname}`) {
      case "lv-zero/project": {
        const projectInfo = this._getProjectInfo();
        blob = JSON.stringify(projectInfo || { name: "unknown", path: "." }, null, 2);
        break;
      }
      case "lv-zero/skills": {
        const skills = this._getSkills();
        blob = JSON.stringify(
          skills.map((s) => ({
            name: s.name,
            description: s.description,
            parameters: s.parameters || {},
          })),
          null,
          2
        );
        break;
      }
      case "lv-zero/status": {
        const status = this._getStatus();
        blob = JSON.stringify(
          {
            ...status,
            negotiatedVersion: this._negotiatedVersion,
            initialized: this._initialized,
          },
          null,
          2
        );
        break;
      }
      case "lv-zero/prompt/system": {
        blob = this._getSystemPrompt() || "No system prompt available";
        break;
      }
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }

    return {
      contents: [
        {
          uri: parsed.href,
          mimeType: "application/json",
          text: blob,
        },
      ],
    };
  }

  /**
   * Read a file:// resource from the filesystem.
   */
  _readFileResource(parsed) {
    const filePath = parsed.pathname;

    // Security: prevent path traversal
    const normalized = path.normalize(filePath);
    if (normalized.includes("..")) {
      throw new Error("Path traversal detected");
    }

    if (!existsSync(normalized)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = readFileSync(normalized, "utf-8");

    return {
      contents: [
        {
          uri: parsed.href,
          mimeType: this._guessMime(filePath),
          text: content,
        },
      ],
    };
  }

  // ── Prompts Handlers ─────────────────────────────────────────────────

  /**
   * Handle prompts/list - return available prompt templates.
   */
  _handlePromptsList() {
    const prompts = [
      {
        name: "system_prompt",
        description: "The current system prompt with all mode-specific instructions",
        arguments: [
          {
            name: "mode",
            description: "Optional: mode slug to get prompt for (orchestrator, code, debug, ask, architect)",
            required: false,
          },
        ],
      },
      {
        name: "tool_help",
        description: "Get help on how to use a specific tool/skill",
        arguments: [
          {
            name: "tool",
            description: "Tool/skill name to get help for",
            required: true,
          },
        ],
      },
    ];

    return { prompts };
  }

  /**
   * Handle prompts/get - return a specific prompt template.
   */
  async _handlePromptsGet(params) {
    const { name, arguments: args = {} } = params;

    switch (name) {
      case "system_prompt": {
        const prompt = this._getSystemPrompt();
        return {
          description: "lv-zero System Prompt",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: prompt || "No system prompt available",
              },
            },
          ],
        };
      }

      case "tool_help": {
        const toolName = args.tool;
        if (!toolName) {
          throw new Error("Tool name is required");
        }
        const skills = this._getSkills();
        const skill = skills.find((s) => s.name === toolName);
        if (!skill) {
          throw new Error(`Tool not found: ${toolName}`);
        }
        const desc = skill.description || "No description available";
        const paramsSchema = skill.parameters
          ? JSON.stringify(skill.parameters, null, 2)
          : "No parameters";

        return {
          description: `Help for tool: ${toolName}`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Tool: ${toolName}\n\nDescription:\n${desc}\n\nParameters:\n${paramsSchema}`,
              },
            },
          ],
        };
      }

      default:
        throw new Error(`Prompt not found: ${name}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Convert an lv-zero skill to an MCP tool definition.
   * @param {object} skill - { name, description, parameters, handler? }
   * @returns {object} MCP tool { name, description, inputSchema }
   */
  _skillToMcpTool(skill) {
    const tool = {
      name: skill.name,
      description: skill.description || "",
    };

    // Convert parameters to MCP inputSchema
    if (skill.parameters) {
      // skill.parameters is already in OpenAI tool format:
      // { type: "object", properties: { ... }, required: [...] }
      // MCP inputSchema uses JSON Schema format (same)
      tool.inputSchema = {
        type: skill.parameters.type || "object",
        properties: skill.parameters.properties || {},
        required: skill.parameters.required || [],
      };
    } else {
      tool.inputSchema = {
        type: "object",
        properties: {},
        required: [],
      };
    }

    return tool;
  }

  /**
   * Guess MIME type from file extension.
   */
  _guessMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".json": "application/json",
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".cjs": "application/javascript",
      ".html": "text/html",
      ".css": "text/css",
      ".yaml": "text/yaml",
      ".yml": "text/yaml",
      ".toml": "text/toml",
      ".env": "text/plain",
      ".gitignore": "text/plain",
      ".xml": "text/xml",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
    };
    return mimeMap[ext] || "application/octet-stream";
  }

  /**
   * Build a JSON-RPC success response.
   */
  _jsonRpcSuccess(id, result) {
    return {
      jsonrpc: "2.0",
      id,
      result,
    };
  }

  /**
   * Build a JSON-RPC error response.
   */
  _jsonRpcError(id, code, message, data) {
    const error = { code, message };
    if (data) error.data = data;
    return {
      jsonrpc: "2.0",
      id,
      error,
    };
  }
}

// ── Default export (factory function) ──────────────────────────────────────

/**
 * Create and start an MCPServer bound to an orchestrator.
 *
 * Convenience function for integration in orchestrator startup.
 *
 * @param {object} orchestrator - The lv-zero Orchestrator instance
 * @param {object} [opts] - { httpPort, stdio }
 * @returns {Promise<MCPServer>}
 */
export async function createMcpServer(orchestrator, opts = {}) {
  const server = new MCPServer({
    getSkills: () => orchestrator.getSkills(),
    executeToolCall: (toolCall, index, total) => orchestrator.executeToolCall(toolCall, index, total),
    getStatus: () => orchestrator.getStatus ? orchestrator.getStatus() : {},
    getSystemPrompt: () => {
      // Find system message in orchestrator messages
      const sysMsg = (orchestrator.messages || []).find((m) => m.role === "system");
      return sysMsg ? sysMsg.content : "";
    },
    getProjectInfo: () => orchestrator.getProjectInfo ? orchestrator.getProjectInfo() : {},
    logger: console,
  });

  await server.start(opts);
  return server;
}
