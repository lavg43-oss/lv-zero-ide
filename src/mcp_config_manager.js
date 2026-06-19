/**
 * ─── MCP Config Manager for lv-zero ─────────────────────────────────────────
 *
 * Sistema de gestión centralizada de servidores MCP.
 * Maneja configuración, ciclo de vida, health checks y eventos.
 *
 * v1.0 — Mayo 2026
 *
 * Integration:
 *   const { MCPConfigManager } = await import('./mcp_config_manager.js');
 *   const manager = new MCPConfigManager({ logger: console });
 *   await manager.initialize();
 *   const skill = manager.createSkill();
 *   // ... use skill ...
 *   await manager.shutdown();
 *
 * @module mcp_config_manager
 */

import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────────────

/** Default health check interval in ms */
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30000;

/** Default health check timeout in ms */
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Default max health check failures before marking unhealthy */
const DEFAULT_MAX_HEALTH_FAILURES = 3;

/** Default reconnect base delay in ms */
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;

/** Default reconnect max delay in ms */
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30000;

/** Default reconnect max retries */
const DEFAULT_RECONNECT_MAX_RETRIES = 10;

/** Default health check ping method */
const DEFAULT_HEALTH_METHOD = "ping"; // "ping" | "tools/list"

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ServerConfig
 * @property {string} name - Unique server name
 * @property {"http-sse"|"streamable-http"|"stdio"} [type] - Transport type
 * @property {string} [url] - URL for HTTP transports
 * @property {string} [command] - Command for stdio transport
 * @property {string[]} [args] - Arguments for stdio transport
 * @property {object} [env] - Environment variables for stdio
 * @property {string} [cwd] - Working directory for stdio
 * @property {object} [headers] - HTTP headers
 * @property {object} [auth] - Auth configuration
 * @property {string} [auth.type] - "bearer" | "basic" | "api-key"
 * @property {string} [auth.credentials] - Credentials value
 * @property {object} [healthCheck] - Health check configuration
 * @property {boolean} [healthCheck.enabled=true]
 * @property {number} [healthCheck.intervalMs=30000]
 * @property {number} [healthCheck.timeoutMs=5000]
 * @property {string} [healthCheck.method="ping"]
 * @property {number} [healthCheck.maxFailures=3]
 * @property {number} [healthCheck.backoffMs=1000]
 * @property {object} [reconnect] - Reconnect configuration
 * @property {boolean} [reconnect.enabled=true]
 * @property {number} [reconnect.baseDelayMs=1000]
 * @property {number} [reconnect.maxDelayMs=30000]
 * @property {number} [reconnect.maxRetries=10]
 * @property {boolean} [autoConnect=true] - Connect on initialize
 */

/**
 * @typedef {object} ServerStatus
 * @property {string} name
 * @property {"disconnected"|"connecting"|"connected"|"unhealthy"} state
 * @property {string} [type]
 * @property {string} [url]
 * @property {string} [command]
 * @property {string} [protocolVersion]
 * @property {object} [serverInfo]
 * @property {object} [capabilities]
 * @property {number} [failureCount]
 * @property {number} [reconnectAttempts]
 * @property {string} [lastError]
 * @property {number} [lastConnected]
 * @property {number} [lastHealthCheck]
 */

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Config Manager
// ═══════════════════════════════════════════════════════════════════════════════

export class MCPConfigManager extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - { info, warn, error } or console
   * @param {object} [options.configPaths] - Custom paths for config discovery
   * @param {string} [options.configPaths.projectRoot] - Project root directory
   * @param {string} [options.configPaths.configFile] - Explicit mcp_servers.json path
   * @param {boolean} [options.autoInitialize] - Auto-initialize on construction (default: false)
   */
  constructor(options = {}) {
    super();

    this._logger = options.logger || console;
    this._configPaths = options.configPaths || {};

    /** @type {Map<string, { config: ServerConfig, client: object|null, state: ServerStatus, healthTimer: number|null, reconnectTimer: number|null }>} */
    this._servers = new Map();

    /** @type {number|null} Global health check timer ID */
    this._globalHealthTimer = null;

    /** @type {boolean} Whether the manager has been initialized */
    this._initialized = false;

    /** @type {Set<string>} Servers currently being reconnected (to avoid double-reconnect) */
    this._reconnecting = new Set();

    // Auto-initialize if requested
    if (options.autoInitialize) {
      // Defer to next tick to allow event listeners to be attached
      setImmediate(() => {
        this.initialize().catch((err) => {
          this._logger.warn(`   ⚠️ MCP auto-init: ${err.message}`);
        });
      });
    }
  }

  // ─── Config Reading ───────────────────────────────────────────────────────

  /**
   * Reads MCP server configuration from all available sources.
   * Priority: MCP_SERVERS_CONFIG_PATH > mcp_servers.json > MCP_SERVERS env var
   *
   * @returns {ServerConfig[]}
   */
  readConfig() {
    const configs = [];
    const seenNames = new Set();

    // 1. Try reading MCP_SERVERS from env (comma-separated URLs, legacy)
    const envServers = process.env.MCP_SERVERS;
    if (envServers) {
      for (const entry of envServers.split(",")) {
        const trimmed = entry.trim();
        if (trimmed) {
          const name = `env-${configs.length + 1}`;
          configs.push({
            name,
            url: trimmed,
            type: trimmed.startsWith("http") ? "streamable-http" : undefined,
            autoConnect: true,
            healthCheck: { enabled: true, intervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS },
            reconnect: { enabled: true, baseDelayMs: DEFAULT_RECONNECT_BASE_DELAY_MS, maxDelayMs: DEFAULT_RECONNECT_MAX_DELAY_MS, maxRetries: DEFAULT_RECONNECT_MAX_RETRIES },
          });
          seenNames.add(name);
        }
      }
    }

    // 2. Try reading mcp_servers.json from config paths
    const configPaths = this._discoverConfigPaths();
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          const parsed = this._parseConfigFile(raw, seenNames);
          for (const cfg of parsed) {
            if (!seenNames.has(cfg.name)) {
              configs.push(cfg);
              seenNames.add(cfg.name);
            }
          }
        } catch (err) {
          this._logger.warn(`   ⚠️ Error parsing ${configPath}: ${err.message}`);
        }
      }
    }

    // 3. Also check MCP_SERVERS_CONFIG_PATH env var (override)
    const modernConfigPath = process.env.MCP_SERVERS_CONFIG_PATH;
    if (modernConfigPath && !configPaths.includes(modernConfigPath) && fs.existsSync(modernConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(modernConfigPath, "utf-8"));
        const parsed = this._parseConfigFile(raw, seenNames);
        for (const cfg of parsed) {
          if (!seenNames.has(cfg.name)) {
            configs.push(cfg);
            seenNames.add(cfg.name);
          }
        }
      } catch {}
    }

    return configs;
  }

  /**
   * Discovers paths to look for mcp_servers.json.
   * @returns {string[]}
   */
  _discoverConfigPaths() {
    const paths = [];

    // Explicit config file path
    if (this._configPaths.configFile) {
      paths.push(this._configPaths.configFile);
    }

    // Project root (resolved from cwd or provided)
    const projectRoot = this._configPaths.projectRoot || process.cwd();
    paths.push(path.resolve(projectRoot, "mcp_servers.json"));

    // Fallback: lv-zero root (relative to this file)
    const lvZeroRoot = path.resolve(__dirname, "..");
    paths.push(path.resolve(lvZeroRoot, "mcp_servers.json"));

    return paths;
  }

  /**
   * Parses a raw JSON config file into ServerConfig[].
   * Supports both modern { mcpServers: { name: {...} } } and legacy array format.
   * @param {object} raw
   * @param {Set<string>} seenNames - Names already seen (for dedup)
   * @returns {ServerConfig[]}
   */
  _parseConfigFile(raw, seenNames) {
    const configs = [];

    // Modern format: { mcpServers: { name: { command, args, ... } } }
    if (raw.mcpServers && typeof raw.mcpServers === "object" && !Array.isArray(raw.mcpServers)) {
      for (const [name, cfg] of Object.entries(raw.mcpServers)) {
        if (seenNames.has(name)) continue;
        configs.push(this._normalizeServerConfig(name, cfg));
      }
    }
    // Legacy format: array of URLs or objects
    else if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const entry = raw[i];
        const name = `legacy-${i + 1}`;
        if (seenNames.has(name)) continue;
        if (typeof entry === "string") {
          configs.push({
            name,
            url: entry,
            type: entry.startsWith("http") ? "streamable-http" : undefined,
            autoConnect: true,
            healthCheck: { enabled: true, intervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS },
            reconnect: { enabled: true, baseDelayMs: DEFAULT_RECONNECT_BASE_DELAY_MS, maxDelayMs: DEFAULT_RECONNECT_MAX_DELAY_MS, maxRetries: DEFAULT_RECONNECT_MAX_RETRIES },
          });
        } else if (typeof entry === "object" && entry !== null) {
          configs.push(this._normalizeServerConfig(name, entry));
        }
      }
    }

    return configs;
  }

  /**
   * Normalizes a raw server config entry into a full ServerConfig.
   * @param {string} name
   * @param {object} raw
   * @returns {ServerConfig}
   */
  _normalizeServerConfig(name, raw) {
    // Determine type
    let type = raw.type || raw.transport;
    if (!type) {
      if (raw.url) {
        type = "streamable-http"; // Default HTTP transport
      } else if (raw.command) {
        type = "stdio";
      } else {
        type = "streamable-http";
      }
    }

    // Normalize transport names (accept both "http-sse" and "http+sse")
    if (type === "http+sse") type = "http-sse";
    if (type === "streamable" || type === "streamablehttp") type = "streamable-http";

    // Build health check config
    const hc = raw.healthCheck || {};
    const healthCheck = {
      enabled: hc.enabled !== false,
      intervalMs: hc.intervalMs || DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      timeoutMs: hc.timeoutMs || DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      method: hc.method || DEFAULT_HEALTH_METHOD,
      maxFailures: hc.maxFailures ?? DEFAULT_MAX_HEALTH_FAILURES,
      backoffMs: hc.backoffMs || DEFAULT_RECONNECT_BASE_DELAY_MS,
    };

    // Build reconnect config
    const rc = raw.reconnect || {};
    const reconnect = {
      enabled: rc.enabled !== false,
      baseDelayMs: rc.baseDelayMs || DEFAULT_RECONNECT_BASE_DELAY_MS,
      maxDelayMs: rc.maxDelayMs || DEFAULT_RECONNECT_MAX_DELAY_MS,
      maxRetries: rc.maxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES,
    };

    // Build auth config
    let auth = raw.auth;
    if (raw.headers?.Authorization && !auth) {
      const match = raw.headers.Authorization.match(/^Bearer\s+(.+)/);
      if (match) {
        auth = { type: "bearer", credentials: match[1] };
      }
    }

    return {
      name,
      type,
      url: raw.url,
      command: raw.command,
      args: raw.args || [],
      env: raw.env || undefined,
      cwd: raw.cwd || undefined,
      headers: raw.headers || undefined,
      auth,
      healthCheck,
      reconnect,
      autoConnect: raw.autoConnect !== false,
      description: raw.description || undefined,
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initializes the manager: reads config, creates clients, auto-connects.
   * @returns {Promise<{success: boolean, connections: object[]}>}
   */
  async initialize() {
    if (this._initialized) {
      this._logger.warn("   ⚠️ MCP Config Manager ya inicializado");
      return { success: true, connections: [] };
    }

    this._logger.info("   🔌 Inicializando MCP Config Manager...");
    const configs = this.readConfig();
    const connections = [];

    if (configs.length === 0) {
      this._logger.info("   ℹ️ No hay servidores MCP configurados");
      this._initialized = true;
      return { success: true, connections: [] };
    }

    this._logger.info(`   → ${configs.length} servidor(es) MCP configurado(s)`);

    // Create server entries and auto-connect
    for (const cfg of configs) {
      const state = this._createInitialState(cfg);
      this._servers.set(cfg.name, {
        config: cfg,
        client: null,
        state,
        healthTimer: null,
        reconnectTimer: null,
      });

      if (cfg.autoConnect) {
        try {
          const result = await this._connectServer(cfg.name);
          connections.push(result);
        } catch (err) {
          connections.push({
            name: cfg.name,
            success: false,
            error: err.message,
          });
        }
      }
    }

    // Start global health check timer
    this._startGlobalHealthChecks();

    this._initialized = true;
    this.emit("mcp:status_changed", this.getStatus());

    return { success: true, connections };
  }

  /**
   * Shuts down the manager: disconnects all clients, stops timers.
   * @returns {Promise<{success: boolean, results: object[]}>}
   */
  async shutdown() {
    this._logger.info("   🔌 Deteniendo MCP Config Manager...");

    // Stop global health checks
    this._stopGlobalHealthChecks();

    const results = [];

    for (const [name, entry] of this._servers) {
      // Clear timers
      if (entry.healthTimer) {
        clearInterval(entry.healthTimer);
        entry.healthTimer = null;
      }
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }

      // Disconnect client
      if (entry.client) {
        try {
          await entry.client.disconnect();
          entry.client = null;
          results.push({ name, disconnected: true });
          this._logger.info(`   ✅ ${name}: desconectado`);
        } catch (err) {
          results.push({ name, disconnected: false, error: err.message });
          this._logger.warn(`   ⚠️ ${name}: error al desconectar: ${err.message}`);
        }
      }

      entry.state.state = "disconnected";
    }

    this._servers.clear();
    this._reconnecting.clear();
    this._initialized = false;

    this.emit("mcp:status_changed", this.getStatus());
    this._logger.info("   ✅ MCP Config Manager detenido");

    return { success: true, results };
  }

  // ─── Client Management ────────────────────────────────────────────────────

  /**
   * Creates the MCPClient for a server and connects.
   * @param {string} serverName
   * @returns {Promise<object>}
   */
  async connectServer(serverName) {
    const entry = this._servers.get(serverName);
    if (!entry) {
      // Try reading config and creating on the fly
      const configs = this.readConfig();
      const cfg = configs.find((c) => c.name === serverName);
      if (!cfg) {
        return { success: false, error: `Servidor "${serverName}" no encontrado` };
      }
      const state = this._createInitialState(cfg);
      this._servers.set(serverName, {
        config: cfg,
        client: null,
        state,
        healthTimer: null,
        reconnectTimer: null,
      });
      return await this._connectServer(serverName);
    }

    return await this._connectServer(serverName);
  }

  /**
   * Disconnects a specific server.
   * @param {string} serverName
   * @returns {Promise<object>}
   */
  async disconnectServer(serverName) {
    const entry = this._servers.get(serverName);
    if (!entry) {
      return { success: false, error: `Servidor "${serverName}" no encontrado` };
    }

    // Clear reconnect timer
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    this._reconnecting.delete(serverName);

    // Stop health checks for this server
    this._stopServerHealthChecks(serverName);

    if (entry.client) {
      try {
        await entry.client.disconnect();
        entry.client = null;
      } catch (err) {
        // Ignore disconnect errors
      }
    }

    entry.state.state = "disconnected";
    entry.state.lastError = "Disconnected by user";
    this.emit("mcp:status_changed", this.getStatus());

    return { success: true, name: serverName, state: "disconnected" };
  }

  /**
   * Reconnects a specific server.
   * @param {string} serverName
   * @returns {Promise<object>}
   */
  async reconnectServer(serverName) {
    // First disconnect if connected
    const entry = this._servers.get(serverName);
    if (entry && entry.client) {
      await this.disconnectServer(serverName);
    }
    return await this.connectServer(serverName);
  }

  /**
   * Gets a connected MCPClient by server name.
   * @param {string} serverName
   * @returns {object|null} The MCPClient instance or null
   */
  getClient(serverName) {
    const entry = this._servers.get(serverName);
    return entry?.client || null;
  }

  /**
   * Gets all server entries.
   * @returns {Array<{ name: string, config: ServerConfig, client: object|null, state: ServerStatus }>}
   */
  getAllClients() {
    return Array.from(this._servers.entries()).map(([name, entry]) => ({
      name,
      config: entry.config,
      client: entry.client,
      state: entry.state,
    }));
  }

  /**
   * Returns the number of currently connected servers.
   * @returns {number}
   */
  getConnectedCount() {
    let count = 0;
    for (const entry of this._servers.values()) {
      if (entry.state.state === "connected") count++;
    }
    return count;
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /**
   * Returns the current status of all managed servers.
   * @returns {{ servers: ServerStatus[] }}
   */
  getStatus() {
    const servers = [];
    for (const [name, entry] of this._servers) {
      const state = { ...entry.state };
      // Refresh connected status from client
      if (entry.client) {
        state.connected = entry.client.isConnected;
        if (entry.client.isConnected) {
          state.state = "connected";
          state.protocolVersion = entry.client.protocolVersion || state.protocolVersion;
          state.serverInfo = entry.client.serverInfo || state.serverInfo;
          state.capabilities = entry.client.serverCapabilities || state.capabilities;
        }
      }
      servers.push(state);
    }
    return { servers };
  }

  // ─── Skill Factory ────────────────────────────────────────────────────────

  /**
   * Creates a skill object compatible with the lv-zero agent skill interface.
   * Delegates all actions to this manager.
   * @returns {object}
   */
  createSkill() {
    const manager = this;

    return {
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
            description: "(Para read_resource) URI del recurso a leer. Ej: file:///path/to/file",
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
            description: "(Para connect con servidor stdio) Comando a ejecutar. Ej: npx, uvx, node",
          },
          commandArgs: {
            type: "array",
            items: { type: "string" },
            description: "(Para connect con servidor stdio) Argumentos del comando.",
          },
        },
      },

      handler: async (params) => {
        return await manager._handleSkillCall(params);
      },
    };
  }

  // ─── Config Persistence ───────────────────────────────────────────────────

  /**
   * Saves the current config to mcp_servers.json and re-initializes.
   * @param {object} config - The full config object { mcpServers: { ... } }
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveConfig(config) {
    try {
      const projectRoot = this._configPaths.projectRoot || process.cwd();
      const configPath = path.resolve(projectRoot, "mcp_servers.json");

      // Validate config structure
      if (!config || !config.mcpServers || typeof config.mcpServers !== "object") {
        return { success: false, error: "Formato inválido: debe contener mcpServers { }" };
      }

      // Write file
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      this._logger.info(`   💾 Configuración guardada: ${configPath}`);

      // Shutdown and re-initialize with new config
      await this.shutdown();
      await this.initialize();

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ─── Health Checks ────────────────────────────────────────────────────────

  /**
   * Starts the global health check timer.
   * Uses the minimum interval across all servers.
   */
  _startGlobalHealthChecks() {
    this._stopGlobalHealthChecks();

    // Find the smallest health check interval
    let minInterval = DEFAULT_HEALTH_CHECK_INTERVAL_MS;
    for (const entry of this._servers.values()) {
      if (entry.config.healthCheck?.enabled) {
        const interval = entry.config.healthCheck.intervalMs || DEFAULT_HEALTH_CHECK_INTERVAL_MS;
        if (interval < minInterval) minInterval = interval;
      }
    }

    this._globalHealthTimer = setInterval(() => {
      this._performHealthChecks().catch(() => {});
    }, minInterval);

    // Also run immediately
    setImmediate(() => {
      this._performHealthChecks().catch(() => {});
    });
  }

  _stopGlobalHealthChecks() {
    if (this._globalHealthTimer) {
      clearInterval(this._globalHealthTimer);
      this._globalHealthTimer = null;
    }
  }

  /**
   * Performs health checks on all managed servers.
   */
  async _performHealthChecks() {
    for (const [name, entry] of this._servers) {
      if (!entry.config.healthCheck?.enabled) continue;
      if (entry.state.state === "disconnected" || entry.state.state === "connecting") continue;

      try {
        const healthy = await this._pingServer(entry);

        if (healthy) {
          // Reset failure count on success
          if (entry.state.failureCount > 0) {
            entry.state.failureCount = 0;
            this.emit("mcp:server_recovered", {
              name,
              serverInfo: entry.state.serverInfo,
              previousFailures: entry.state.failureCount,
            });
            this._logger.info(`   ✅ MCP ${name}: recuperado`);
          }
          this.emit("mcp:server_healthy", { name, serverInfo: entry.state.serverInfo });
        } else {
          this._handleHealthCheckFailure(name, entry);
        }

        entry.state.lastHealthCheck = Date.now();
      } catch (err) {
        this._handleHealthCheckFailure(name, entry, err.message);
      }

      this.emit("mcp:status_changed", this.getStatus());
    }
  }

  /**
   * Handles a health check failure for a server.
   * @param {string} name
   * @param {object} entry
   * @param {string} [error]
   */
  _handleHealthCheckFailure(name, entry, error) {
    entry.state.failureCount = (entry.state.failureCount || 0) + 1;
    entry.state.lastError = error || "Health check failed";

    if (entry.state.failureCount >= (entry.config.healthCheck?.maxFailures || DEFAULT_MAX_HEALTH_FAILURES)) {
      entry.state.state = "unhealthy";
      this.emit("mcp:server_unhealthy", {
        name,
        failures: entry.state.failureCount,
        lastError: entry.state.lastError,
      });
      this._logger.warn(`   ⚠️ MCP ${name}: no saludable (${entry.state.failureCount} fallos)`);

      // Try to reconnect
      if (entry.config.reconnect?.enabled !== false) {
        this._scheduleReconnect(name);
      }
    } else {
      this._logger.warn(`   ⚠️ MCP ${name}: health check fallido (${entry.state.failureCount}/${entry.config.healthCheck?.maxFailures || DEFAULT_MAX_HEALTH_FAILURES})`);
    }
  }

  /**
   * Pings a single server to check health.
   * @param {object} entry
   * @returns {Promise<boolean>}
   */
  async _pingServer(entry) {
    if (!entry.client || !entry.client.isConnected) return false;

    const method = entry.config.healthCheck?.method || DEFAULT_HEALTH_METHOD;

    try {
      if (method === "tools/list") {
        const tools = await entry.client.listTools();
        return Array.isArray(tools);
      } else {
        // "ping" — use a lightweight initialize ping or tools/list as fallback
        if (typeof entry.client.ping === "function") {
          await entry.client.ping();
          return true;
        }
        // Fallback: check if connected
        return entry.client.isConnected;
      }
    } catch {
      return false;
    }
  }

  // ─── Reconnection ────────────────────────────────────────────────────────

  /**
   * Schedules a reconnection attempt with exponential backoff.
   * @param {string} name
   */
  _scheduleReconnect(name) {
    const entry = this._servers.get(name);
    if (!entry) return;

    // Prevent duplicate reconnect schedules
    if (this._reconnecting.has(name)) return;
    this._reconnecting.add(name);

    const maxRetries = entry.config.reconnect?.maxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES;
    const baseDelay = entry.config.reconnect?.baseDelayMs || DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = entry.config.reconnect?.maxDelayMs || DEFAULT_RECONNECT_MAX_DELAY_MS;

    const attempt = entry.state.reconnectAttempts || 0;

    if (attempt >= maxRetries) {
      this._logger.warn(`   ⚠️ MCP ${name}: máximo de reconexiones alcanzado (${maxRetries})`);
      this._reconnecting.delete(name);
      return;
    }

    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    entry.state.reconnectAttempts = attempt + 1;
    entry.state.state = "connecting";

    this._logger.info(`   🔄 MCP ${name}: reconectando en ${delay}ms (intento ${attempt + 1}/${maxRetries})`);

    entry.reconnectTimer = setTimeout(async () => {
      this._reconnecting.delete(name);
      entry.reconnectTimer = null;

      try {
        await this._connectServer(name);
        this._logger.info(`   ✅ MCP ${name}: reconectado exitosamente`);
      } catch (err) {
        this._logger.warn(`   ⚠️ MCP ${name}: error de reconexión: ${err.message}`);
        // Try again with backoff
        this._scheduleReconnect(name);
      }
    }, delay);

    this.emit("mcp:status_changed", this.getStatus());
  }

  // ─── Internal Connection Logic ────────────────────────────────────────────

  /**
   * Internal: connects to a server by name.
   * @param {string} serverName
   * @returns {Promise<object>}
   */
  async _connectServer(serverName) {
    const entry = this._servers.get(serverName);
    if (!entry) {
      return { success: false, error: `Servidor "${serverName}" no encontrado` };
    }

    // Already connected
    if (entry.client?.isConnected) {
      return {
        success: true,
        name: serverName,
        state: "already_connected",
        serverInfo: entry.state.serverInfo,
      };
    }

    entry.state.state = "connecting";
    this.emit("mcp:status_changed", this.getStatus());

    try {
      // Dynamically import MCPClient to avoid circular dependency
      const { MCPClient } = await import("./mcp_client.js");
      const cfg = entry.config;

      // Build MCPClient config from our normalized config
      const clientConfig = {
        transport: cfg.type,
        url: cfg.url,
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
        cwd: cfg.cwd,
        headers: this._buildHeaders(cfg),
        name: cfg.name,
        startupTimeout: cfg.healthCheck?.timeoutMs || DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      };

      const client = new MCPClient(clientConfig);
      const info = await client.connect({
        autoReconnect: false, // MCPConfigManager handles reconnection
        onClose: () => {
          entry.state.state = "disconnected";
          this.emit("mcp:status_changed", this.getStatus());
          if (cfg.reconnect?.enabled !== false) {
            this._scheduleReconnect(serverName);
          }
        },
      });

      if (!info) {
        entry.state.state = "disconnected";
        entry.state.lastError = "Connection failed (no server info)";
        this.emit("mcp:status_changed", this.getStatus());

        // Schedule initial reconnect
        if (cfg.reconnect?.enabled !== false) {
          this._scheduleReconnect(serverName);
        }

        return { success: false, name: serverName, error: "Connection failed" };
      }

      // Connection successful
      entry.client = client;
      entry.state.state = "connected";
      entry.state.protocolVersion = info.protocolVersion;
      entry.state.serverInfo = info.serverInfo;
      entry.state.capabilities = info.capabilities;
      entry.state.failureCount = 0;
      entry.state.reconnectAttempts = 0;
      entry.state.lastError = undefined;
      entry.state.lastConnected = Date.now();

      // Transport close → auto-reconnect (via onClose callback in connect options)

      // Start per-server health checks if interval differs from global
      this._startServerHealthChecks(serverName);

      this.emit("mcp:server_added", {
        name: serverName,
        serverInfo: info.serverInfo,
        capabilities: info.capabilities,
      });

      this._logger.info(`   🔌 MCP ${serverName}: conectado (v${info.protocolVersion})`);

    } catch (err) {
      entry.state.state = "disconnected";
      entry.state.lastError = err.message;

      if (entry.config.reconnect?.enabled !== false) {
        this._scheduleReconnect(serverName);
      }
    }

    this.emit("mcp:status_changed", this.getStatus());

    const entryAfter = this._servers.get(serverName);
    return {
      success: entryAfter?.state.state === "connected",
      name: serverName,
      state: entryAfter?.state.state || "error",
      serverInfo: entryAfter?.state.serverInfo,
      error: entryAfter?.state.lastError,
    };
  }

  /**
   * Starts per-server health check if its interval differs from the global minimum.
   * @param {string} serverName
   */
  _startServerHealthChecks(serverName) {
    const entry = this._servers.get(serverName);
    if (!entry || !entry.config.healthCheck?.enabled) return;

    // Clear existing
    this._stopServerHealthChecks(serverName);

    // We don't need per-server timers as the global timer handles all
    // But we keep the method for extensibility
  }

  _stopServerHealthChecks(serverName) {
    const entry = this._servers.get(serverName);
    if (entry?.healthTimer) {
      clearInterval(entry.healthTimer);
      entry.healthTimer = null;
    }
  }

  // ─── Skill Call Handler ──────────────────────────────────────────────────

  /**
   * Handles a skill call from the agent, delegating to the appropriate method.
   * @param {object} params
   * @returns {Promise<object>}
   */
  async _handleSkillCall(params) {
    const { action } = params;

    switch (action) {
      case "connect":
        return await this._skillConnect(params);
      case "list_tools":
        return await this._skillListTools();
      case "call_tool":
        return await this._skillCallTool(params);
      case "list_resources":
        return await this._skillListResources(params);
      case "read_resource":
        return await this._skillReadResource(params);
      case "list_prompts":
        return await this._skillListPrompts(params);
      case "get_prompt":
        return await this._skillGetPrompt(params);
      case "status":
        return this._skillStatus();
      case "disconnect":
        return await this._skillDisconnect();
      default:
        return { success: false, error: `Acción desconocida: ${action}` };
    }
  }

  async _skillConnect(params) {
    const { serverUrl, serverName, command, commandArgs } = params;

    // Direct command connection (ad-hoc, not from config)
    if (command) {
      const adhocName = `adhoc-${Date.now()}`;
      const cfg = {
        name: adhocName,
        type: "stdio",
        command,
        args: commandArgs || [],
        autoConnect: true,
        healthCheck: { enabled: true, intervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS },
        reconnect: { enabled: true, baseDelayMs: DEFAULT_RECONNECT_BASE_DELAY_MS, maxDelayMs: DEFAULT_RECONNECT_MAX_DELAY_MS, maxRetries: DEFAULT_RECONNECT_MAX_RETRIES },
      };
      const state = this._createInitialState(cfg);
      this._servers.set(adhocName, {
        config: cfg,
        client: null,
        state,
        healthTimer: null,
        reconnectTimer: null,
      });
      return await this._connectServer(adhocName);
    }

    // Direct URL connection (ad-hoc)
    if (serverUrl) {
      const adhocName = `adhoc-${Date.now()}`;
      const cfg = {
        name: adhocName,
        type: serverUrl.startsWith("http") ? "streamable-http" : undefined,
        url: serverUrl,
        autoConnect: true,
        healthCheck: { enabled: true, intervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS },
        reconnect: { enabled: true, baseDelayMs: DEFAULT_RECONNECT_BASE_DELAY_MS, maxDelayMs: DEFAULT_RECONNECT_MAX_DELAY_MS, maxRetries: DEFAULT_RECONNECT_MAX_RETRIES },
      };
      const state = this._createInitialState(cfg);
      this._servers.set(adhocName, {
        config: cfg,
        client: null,
        state,
        healthTimer: null,
        reconnectTimer: null,
      });
      return await this._connectServer(adhocName);
    }

    // Connect by name from config
    if (serverName) {
      return await this.connectServer(serverName);
    }

    // Connect all configured
    const results = [];
    for (const [name] of this._servers) {
      const result = await this._connectServer(name);
      results.push(result);
    }

    if (results.length === 0) {
      return {
        success: false,
        error:
          "No hay servidores MCP configurados. " +
          "Define MCP_SERVERS en .env, crea mcp_servers.json, " +
          "o proporciona un serverUrl, command, o serverName.",
      };
    }

    return { success: true, results };
  }

  async _skillListTools() {
    const allTools = [];
    for (const [name, entry] of this._servers) {
      if (entry.client?.isConnected) {
        try {
          const tools = await entry.client.listTools();
          allTools.push({
            serverName: name,
            tools,
            count: tools.length,
          });
        } catch (err) {
          allTools.push({
            serverName: name,
            error: err.message,
            count: 0,
          });
        }
      }
    }
    return { success: true, servers: allTools, totalServers: this._servers.size };
  }

  async _skillCallTool(params) {
    const { toolName, toolArgs = {}, serverName } = params;

    if (!toolName) {
      return { success: false, error: "toolName es requerido." };
    }

    // Specific server
    if (serverName) {
      const entry = this._servers.get(serverName);
      if (!entry?.client?.isConnected) {
        return { success: false, error: `Servidor "${serverName}" no encontrado o desconectado.` };
      }
      return await entry.client.callTool(toolName, toolArgs);
    }

    // Try on first connected client
    for (const entry of this._servers.values()) {
      if (entry.client?.isConnected) {
        return await entry.client.callTool(toolName, toolArgs);
      }
    }

    return { success: false, error: "No hay servidores MCP conectados." };
  }

  async _skillListResources(params) {
    const { serverName } = params;
    const allResources = [];

    for (const [name, entry] of this._servers) {
      if (!entry.client?.isConnected) continue;
      if (serverName && name !== serverName) continue;
      try {
        const resources = await entry.client.listResources();
        allResources.push({ serverName: name, resources, count: resources.length });
      } catch (err) {
        allResources.push({ serverName: name, error: err.message });
      }
    }

    return { success: true, servers: allResources };
  }

  async _skillReadResource(params) {
    const { resourceUri, serverName } = params;
    if (!resourceUri) {
      return { success: false, error: "resourceUri es requerido." };
    }

    for (const [name, entry] of this._servers) {
      if (!entry.client?.isConnected) continue;
      if (serverName && name !== serverName) continue;
      try {
        const result = await entry.client.readResource(resourceUri);
        if (result) {
          return { success: true, resourceUri, data: result };
        }
      } catch {}
    }

    return { success: false, error: "No se pudo leer el recurso." };
  }

  async _skillListPrompts(params) {
    const { serverName } = params;
    const allPrompts = [];

    for (const [name, entry] of this._servers) {
      if (!entry.client?.isConnected) continue;
      if (serverName && name !== serverName) continue;
      try {
        const prompts = await entry.client.listPrompts();
        allPrompts.push({ serverName: name, prompts, count: prompts.length });
      } catch (err) {
        allPrompts.push({ serverName: name, error: err.message });
      }
    }

    return { success: true, servers: allPrompts };
  }

  async _skillGetPrompt(params) {
    const { promptName, promptArgs = {}, serverName } = params;
    if (!promptName) {
      return { success: false, error: "promptName es requerido." };
    }

    for (const [name, entry] of this._servers) {
      if (!entry.client?.isConnected) continue;
      if (serverName && name !== serverName) continue;
      try {
        const result = await entry.client.getPrompt(promptName, promptArgs);
        if (result) {
          return { success: true, promptName, result };
        }
      } catch {}
    }

    return { success: false, error: `Prompt "${promptName}" no encontrado.` };
  }

  _skillStatus() {
    return this.getStatus();
  }

  async _skillDisconnect() {
    const results = [];
    for (const [name, entry] of this._servers) {
      if (entry.client) {
        try {
          await entry.client.disconnect();
          entry.client = null;
          results.push({ name, disconnected: true });
        } catch (err) {
          results.push({ name, disconnected: false, error: err.message });
        }
      }
      entry.state.state = "disconnected";
    }
    this.emit("mcp:status_changed", this.getStatus());
    return { success: true, results };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Creates the initial state object for a server.
   * @param {ServerConfig} cfg
   * @returns {ServerStatus}
   */
  _createInitialState(cfg) {
    return {
      name: cfg.name,
      state: "disconnected",
      type: cfg.type,
      url: cfg.url,
      command: cfg.command,
      protocolVersion: undefined,
      serverInfo: undefined,
      capabilities: undefined,
      failureCount: 0,
      reconnectAttempts: 0,
      lastError: undefined,
      lastConnected: undefined,
      lastHealthCheck: undefined,
    };
  }

  /**
   * Builds HTTP headers from server config, including auth.
   * @param {ServerConfig} cfg
   * @returns {object|undefined}
   */
  _buildHeaders(cfg) {
    const headers = { ...(cfg.headers || {}) };

    if (cfg.auth) {
      switch (cfg.auth.type) {
        case "bearer":
          headers["Authorization"] = `Bearer ${cfg.auth.credentials}`;
          break;
        case "basic":
          headers["Authorization"] = `Basic ${cfg.auth.credentials}`;
          break;
        case "api-key":
          headers["X-API-Key"] = cfg.auth.credentials;
          break;
      }
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  // ─── Per-Server Tool Management ──────────────────────────────────────────

  /**
   * Lists all tools from a specific server.
   * Filters out disabled tools.
   * @param {string} serverId - Server name
   * @returns {Promise<{success: boolean, tools?: object[], disabled?: string[], error?: string}>}
   */
  async getTools(serverId) {
    const entry = this._servers.get(serverId);
    if (!entry) {
      return { success: false, error: `Servidor "${serverId}" no encontrado` };
    }
    if (!entry.client || !entry.client.isConnected) {
      return { success: false, error: `Servidor "${serverId}" no conectado` };
    }

    try {
      const tools = await entry.client.listTools();
      const disabled = this.getDisabledTools(serverId);
      const disabledSet = new Set(disabled);
      const filtered = tools.filter((t) => !disabledSet.has(t.name));
      return {
        success: true,
        tools: filtered,
        disabled,
        total: tools.length,
        filteredCount: filtered.length,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Disables a specific tool on a server.
   * Persists to the server config file (mcp_servers.json).
   * @param {string} serverId - Server name
   * @param {string} toolName - Tool name to disable
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async disableTool(serverId, toolName) {
    const entry = this._servers.get(serverId);
    if (!entry) {
      return { success: false, error: `Servidor "${serverId}" no encontrado` };
    }

    // Ensure disabledTools array exists on the config
    if (!entry.config.disabledTools) {
      entry.config.disabledTools = [];
    }

    if (!entry.config.disabledTools.includes(toolName)) {
      entry.config.disabledTools.push(toolName);
    }

    // Persist to disk
    try {
      await this._persistDisabledTools(serverId);
    } catch (err) {
      return { success: false, error: `Error al persistir: ${err.message}` };
    }

    this._logger.info(`   🔧 Herramienta "${toolName}" deshabilitada en servidor "${serverId}"`);
    return { success: true };
  }

  /**
   * Re-enables a previously disabled tool on a server.
   * @param {string} serverId - Server name
   * @param {string} toolName - Tool name to enable
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async enableTool(serverId, toolName) {
    const entry = this._servers.get(serverId);
    if (!entry) {
      return { success: false, error: `Servidor "${serverId}" no encontrado` };
    }

    if (!entry.config.disabledTools) {
      return { success: true }; // Nothing to enable
    }

    const idx = entry.config.disabledTools.indexOf(toolName);
    if (idx !== -1) {
      entry.config.disabledTools.splice(idx, 1);
    }

    // Persist to disk
    try {
      await this._persistDisabledTools(serverId);
    } catch (err) {
      return { success: false, error: `Error al persistir: ${err.message}` };
    }

    this._logger.info(`   🔧 Herramienta "${toolName}" habilitada en servidor "${serverId}"`);
    return { success: true };
  }

  /**
   * Returns the list of disabled tools for a server.
   * @param {string} serverId - Server name
   * @returns {string[]}
   */
  getDisabledTools(serverId) {
    const entry = this._servers.get(serverId);
    if (!entry) return [];
    return entry.config.disabledTools || [];
  }

  /**
   * Persists disabled tools list to the mcp_servers.json file.
   * @param {string} serverId
   */
  async _persistDisabledTools(serverId) {
    const entry = this._servers.get(serverId);
    if (!entry) return;

    const configPaths = this._discoverConfigPaths();
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (raw.mcpServers && raw.mcpServers[serverId]) {
            const disabled = entry.config.disabledTools || [];
            if (disabled.length > 0) {
              raw.mcpServers[serverId].disabledTools = disabled;
            } else {
              delete raw.mcpServers[serverId].disabledTools;
            }
            fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
          }
          return; // Successfully persisted
        } catch {
          // Try next path
        }
      }
    }

    // If no existing config file, create one
    const projectRoot = this._configPaths.projectRoot || process.cwd();
    const configPath = path.resolve(projectRoot, "mcp_servers.json");
    let config = { mcpServers: {} };
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {
      config = { mcpServers: {} };
    }

    if (!config.mcpServers[serverId]) {
      config.mcpServers[serverId] = {};
    }
    const disabled = entry.config.disabledTools || [];
    if (disabled.length > 0) {
      config.mcpServers[serverId].disabledTools = disabled;
    } else {
      delete config.mcpServers[serverId].disabledTools;
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HealthMonitor — Per-Server Health Monitoring with Exponential Backoff
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Monitors the health of a single MCP server connection.
 * Uses periodic lightweight pings with exponential backoff reconnection.
 * Emits events: 'healthy', 'unhealthy', 'reconnecting', 'reconnected', 'failed'
 */
export class HealthMonitor extends EventEmitter {
  /**
   * @param {object} serverConfig - Server configuration
   * @param {object} [options]
   * @param {number} [options.intervalMs=30000] - Health check interval
   * @param {number} [options.timeoutMs=5000] - Health check timeout
   * @param {number} [options.maxFailures=3] - Consecutive failures before unhealthy
   * @param {number} [options.baseBackoffMs=1000] - Initial backoff delay
   * @param {number} [options.maxBackoffMs=30000] - Maximum backoff delay
   * @param {object} [options.logger] - Logger instance
   */
  constructor(serverConfig, options = {}) {
    super();
    this._config = serverConfig;
    this._intervalMs = options.intervalMs || DEFAULT_HEALTH_CHECK_INTERVAL_MS;
    this._timeoutMs = options.timeoutMs || DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
    this._maxFailures = options.maxFailures ?? DEFAULT_MAX_HEALTH_FAILURES;
    this._baseBackoffMs = options.baseBackoffMs || DEFAULT_RECONNECT_BASE_DELAY_MS;
    this._maxBackoffMs = options.maxBackoffMs || DEFAULT_RECONNECT_MAX_DELAY_MS;
    this._logger = options.logger || console;

    /** @type {"healthy"|"unhealthy"|"reconnecting"|"stopped"} */
    this._state = "stopped";
    this._timer = null;
    this._reconnectTimer = null;
    this._consecutiveFailures = 0;
    this._lastCheck = null;
    this._lastSuccess = null;
    this._lastFailure = null;
    this._reconnectAttempt = 0;
    this._client = null;
    this._running = false;
  }

  /**
   * Sets the MCP client instance to ping.
   * @param {object} client
   */
  setClient(client) {
    this._client = client;
  }

  /**
   * Begins periodic health monitoring.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._running) return;
    this._running = true;
    this._state = "healthy";
    this._logger.info(`   ❤️ HealthMonitor: iniciando monitoreo para ${this._config.name}`);

    // Run an initial check immediately
    await this._check();

    // Start periodic checks
    this._timer = setInterval(() => {
      this._check().catch(() => {});
    }, this._intervalMs);
  }

  /**
   * Stops health monitoring and clears timers.
   * @returns {Promise<void>}
   */
  async stop() {
    this._running = false;
    this._state = "stopped";
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._consecutiveFailures = 0;
    this._reconnectAttempt = 0;
  }

  /**
   * Returns the current health state.
   * @returns {{ state: string, lastCheck: number|null, lastSuccess: number|null, lastFailure: number|null, consecutiveFailures: number, reconnectAttempt: number }}
   */
  getStatus() {
    return {
      state: this._state,
      lastCheck: this._lastCheck,
      lastSuccess: this._lastSuccess,
      lastFailure: this._lastFailure,
      consecutiveFailures: this._consecutiveFailures,
      reconnectAttempt: this._reconnectAttempt,
    };
  }

  /**
   * Subscribes to health status changes.
   * @param {Function} callback - Receives (newState, oldState, details)
   * @returns {Function} Unsubscribe function
   */
  onStatusChange(callback) {
    const handler = (newState, oldState, details) => callback(newState, oldState, details);
    this.on("state_change", handler);
    return () => this.removeListener("state_change", handler);
  }

  /**
   * Performs a single health check.
   * Lightweight: uses ping() if available, otherwise checks isConnected.
   */
  async _check() {
    if (!this._running) return;
    this._lastCheck = Date.now();

    try {
      const healthy = await this._ping();

      if (healthy) {
        this._onHealthy();
      } else {
        this._onFailure("Health check returned unhealthy");
      }
    } catch (err) {
      this._onFailure(err.message || "Health check error");
    }
  }

  /**
   * Lightweight ping to the server.
   * @returns {Promise<boolean>}
   */
  async _ping() {
    if (!this._client) return false;

    try {
      // Use ping method if available (lightweight)
      if (typeof this._client.ping === "function") {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Ping timeout")), this._timeoutMs)
        );
        await Promise.race([this._client.ping(), timeoutPromise]);
        return true;
      }
      // Fallback: check connection status
      return !!this._client.isConnected;
    } catch {
      return false;
    }
  }

  /**
   * Handles a successful health check.
   */
  _onHealthy() {
    const prevState = this._state;
    this._lastSuccess = Date.now();

    if (this._consecutiveFailures > 0) {
      this._logger.info(`   ✅ HealthMonitor: ${this._config.name} recuperado (tras ${this._consecutiveFailures} fallos)`);
      this._consecutiveFailures = 0;
      this._reconnectAttempt = 0;
      this._state = "healthy";
      this.emit("reconnected", { name: this._config.name, previousFailures: this._consecutiveFailures });
      this.emit("state_change", "healthy", prevState, { name: this._config.name });
    } else {
      this._state = "healthy";
      this.emit("healthy", { name: this._config.name });
    }
  }

  /**
   * Handles a health check failure.
   * @param {string} error
   */
  _onFailure(error) {
    const prevState = this._state;
    this._consecutiveFailures++;
    this._lastFailure = Date.now();

    this._logger.warn(`   ⚠️ HealthMonitor: ${this._config.name} fallo #${this._consecutiveFailures}: ${error}`);

    if (this._consecutiveFailures >= this._maxFailures) {
      this._state = "unhealthy";
      this.emit("unhealthy", {
        name: this._config.name,
        failures: this._consecutiveFailures,
        lastError: error,
      });
      this.emit("state_change", "unhealthy", prevState, {
        name: this._config.name,
        failures: this._consecutiveFailures,
        error,
      });

      // Start exponential backoff reconnection
      this._scheduleReconnect();
    }
  }

  /**
   * Schedules a reconnection attempt with exponential backoff + jitter.
   */
  _scheduleReconnect() {
    if (!this._running) return;

    const attempt = this._reconnectAttempt;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(
      this._baseBackoffMs * Math.pow(2, attempt),
      this._maxBackoffMs
    );
    // Add jitter: ±25% to prevent thundering herd
    const jitter = delay * (0.75 + Math.random() * 0.5);
    const finalDelay = Math.round(jitter);

    this._reconnectAttempt++;
    this._state = "reconnecting";
    this.emit("reconnecting", {
      name: this._config.name,
      attempt: this._reconnectAttempt,
      delay: finalDelay,
    });
    this.emit("state_change", "reconnecting", "unhealthy", {
      name: this._config.name,
      attempt: this._reconnectAttempt,
      delay: finalDelay,
    });

    this._logger.info(
      `   🔄 HealthMonitor: reconectando ${this._config.name} en ${finalDelay}ms (intento ${this._reconnectAttempt})`
    );

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._check();
        // If _check succeeds, _onHealthy will set state back to healthy
      } catch (err) {
        // If still failing, schedule next attempt
        if (this._running && this._consecutiveFailures >= this._maxFailures) {
          this._scheduleReconnect();
        }
      }
    }, finalDelay);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backward Compat: readMCPConfig (delegates to a temporary manager instance)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads MCP server configuration from .env or mcp_servers.json.
 * Maintained for backward compatibility.
 *
 * @deprecated Use MCPConfigManager.readConfig() instead
 * @returns {Array<{name?: string, url?: string, command?: string, args?: string[], transport?: string, env?: object, headers?: object}>}
 */
export function readMCPConfig() {
  const manager = new MCPConfigManager({ logger: console });
  return manager.readConfig();
}
