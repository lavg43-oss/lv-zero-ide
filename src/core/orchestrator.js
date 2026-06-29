/**
 * lv-zero — Orchestrator (Motor de Agente Desacoplado)
 *
 * v2.0 — CON AUTO-MEMORIA PERSISTENTE EN SUPABASE
 *   Motor de agente event-driven, sin dependencia de readline.
 *   Listo para ser consumido por CLI (index.js) o GUI (Electron).
 *
 *   🧠 AUTO-MEMORIA: cada ~30 mensajes o ~18K chars, guarda automáticamente
 *      un resumen en Supabase (tabla lvzero_memory). Al iniciar, carga los
 *      últimos recuerdos para restaurar contexto entre sesiones.
 *
 * Eventos emitidos:
 *   'thought'       - Cuando el agente expresa su monólogo interno
 *   'tool_call'     - Cuando se invoca una skill
 *   'tool_result'   - Resultado de una skill
 *   'response'      - Respuesta final del agente
 *   'error'         - Error controlado
 *   'step'          - Progreso de iteración
 *   'summary'       - Cuando se compacta la memoria
 *   'skills_loaded' - Skills cargadas
 *   'ready'         - Sistema listo
 *   'memory_checkpoint' - Checkpoint guardado en Supabase
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import EventEmitter from "events";
import chalk from "chalk";

import { LLMClient } from "./llm_client.js";
import { RateLimiter } from "../rate_limiter.js";

import {
  analyzeHistory,
  needsSummary,
  needsSummaryWithCheckpoint,
  compactHistory,
  loadPreviousContext,
  garbageCollectHistory,
} from "./context_manager.js";
import { CacheFirstLoop } from "./cache_first_loop.js";
import { ToolCallRepair, nestArguments } from "./tool_call_repair.js";
import {
  resolveCommand,
  getWorkflowInstructions,
  detectIntent,
  listWorkflows,
  getHelpText,
  parseWorkflowSteps,
} from "../workflows/loader.js";
import {
  initSession,
  saveSession,
  updateState,
  updateStateBatch,
  updatePlanProgress,
  trackMessage,
  trackToolCall,
  setSkillsCount,
  getSessionState,
  getSessionId,
  startAutoSave,
  stopAutoSave,
  clearSession,
  setSessionMetadata,
  saveSessionCheckpoint,
  checkLastSession,
  restoreSession,
  clearLastSession,
  saveAutoCheckpoint,
  listSessions,
  exportSession,
  saveRooState,
  loadRooState,
  clearRooState,
} from "./state_manager.js";
import { ModeController } from "../modes/mode_controller.js";
import { detectModeFromInput, getMode, getModeSwitchToolSpec, getAskFollowupQuestionToolSpec, getModelForMode } from "../modes/mode_registry.js";
import {
  LvError,
  ConfigurationError,
  APIError,
  ToolExecutionError,
  FileSystemError,
  StateError,
  ValidationError,
  ErrorCodes,
  toLvError,
} from "./errors.js";

import { indexFile, indexFiles } from "../../skills/file_indexer.js";
import { createMcpServer } from "../mcp_server.js";
import { WorkspaceManager, getWorkspaceManager } from "../workspace_manager.js";
import { WorkerPool, getWorkerPool } from "../workers/worker_pool.js";
import { TaskAnalyzer } from "../workers/task_analyzer.js";
import {
  sanitizeUserInput,
  sanitizeToolOutput,
  detectInjection,
  createSecurityMiddleware,
} from "../prompt_security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  apiKey: null,
  baseURL: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  planFile: null,
  maxToolIterations: 50,
  security: {
    enabled: true,
    maxOutputLength: 100 * 1024, // 100 KB
  },
};

// ─── Orchestrator Class ─────────────────────────────────────────────────────
class Orchestrator extends EventEmitter {
  constructor() {
    super();

    // ── Timeout Configuration (crash prevention) ──────────────────────
    /** Cached reference to auto_memoria module (loaded once in init()) */
    this._autoMemoria = null;

    // ── Core State ────────────────────────────────────────────────────
    /** @type {LLMClient|null} Multi-provider LLM client abstraction */
    this.llm = null;
    this.skills = [];
    this.messages = [];
    this.systemPrompt = null;
    this.isRunning = false;
    this._abortRequested = false;

    /** @type {AbortController|null} Tool-level abort controller — signaled by abortAgent() to cancel running tools */
    this._toolAbortController = null;

    // ── Mode Controller ──────────────────────────────────────────────
    /** @type {ModeController} Controla cambios de modo y filtrado de tools */
    this.modeController = new ModeController(this);
    this.iterationCount = 0;
    this.workflowActive = null; // Tracks active workflow command
    this.projectPath = null;    // Tracks the active project path (null = lv-zero root)
    this._projectContextMsgIndex = -1; // Index of project context system message in this.messages

    // ── Workspace Manager (multi-folder project support) ────────────────
    /** @type {WorkspaceManager} Manages multi-folder workspace configurations */
    this.workspaceManager = getWorkspaceManager({ logger: this });

    // ── Graphify Auto-Update ─────────────────────────────────
    /** @type {number} Cada N iteraciones se actualiza el grafo del proyecto */
    this._graphifyUpdateInterval = 10;
    /** @type {number} Última iteración en la que se actualizó el grafo */
    this._lastGraphifyIteration = 0;

    // ── Reasonix-inspired modules ─────────────────────────────────────
    /** @type {CacheFirstLoop} Cache-first loop for prefix-stable API calls */
    this.cacheLoop = new CacheFirstLoop();
    /** @type {ToolCallRepair} Tool-call repair pipeline (flatten/scavenge/truncation/storm) */
    this.toolRepair = new ToolCallRepair();

    // ── Auto-healing state ────────────────────────────────────────────
    /** @type {number} Consecutive health check failures */
    this._healthCheckFailures = 0;
    /** @type {number} Timestamp of last health check */
    this._lastHealthCheck = Date.now();
    /** @type {number|null} Timer ID for periodic health check */
    this._healthCheckTimer = null;
    /** @type {number} Snapshot of iterationCount at last health check (stuck detection) */
    this._lastIterationCount = 0;
    /** @type {number} Timestamp when the orchestrator was initialized (for uptime) */
    this._startTime = Date.now();

    // ── Rate Limiter ──────────────────────────────────────────────
    /** @type {RateLimiter} Token bucket rate limiter for API calls */
    this.rateLimiter = new RateLimiter({
      maxTokens: 60,
      refillRate: 1,
      refillInterval: 1000,
      tokensPerRequest: 1,
    });

    // Create named buckets for different API categories
    this.rateLimiter.createBucket('api', {
      maxTokens: 60,
      refillRate: 1,
      refillInterval: 1000,
      tokensPerRequest: 1,
    });
    this.rateLimiter.createBucket('mcp', {
      maxTokens: 30,
      refillRate: 1,
      refillInterval: 1000,
      tokensPerRequest: 1,
    });
    this.rateLimiter.createBucket('search', {
      maxTokens: 20,
      refillRate: 1,
      refillInterval: 2000,
      tokensPerRequest: 1,
    });

    // Wire rate_limited events to orchestrator log
    this.rateLimiter.on('rate_limited', (info) => {
      this.emit('log', `   ⏳ Rate limited [${info.bucket}]: ${info.current}/${info.max} tokens (denied: ${info.denied})`);
    });
    /** @type {Array} Log of recent health check events (last 10) */
    this._healthCheckHistory = [];

    /** @type {boolean} Concurrency guard for checkpoint saves — prevents pile-up when Supabase is slow */
    this._checkpointBusy = false;

    /** @type {Array} List of recently accessed files (for crash recovery context) */
    this._recentFiles = [];

    // ── Mode Suggestion (Approval Flow) ───────────────────────────────
    /** @type {string|null} Stored user input pending mode switch approval */
    this._pendingModeInput = null;
    /** @type {string|null} Target mode slug pending user approval */
    this._pendingModeSlug = null;
    /** @type {boolean} Whether the pending switch was initiated by the agent (LLM) */
    this._pendingFromAgent = false;
    /** @type {boolean} Flag set during tool execution to pause agentLoop after tool results */
    this._pendingModeSwitch = false;

    /** @type {Array} Queue of messages received while agent is busy — drained after task finishes */
    this._pendingMessages = [];
    /** @type {number|null} Timer ID for live heartbeat (elapsed time counter) */
    this._heartbeatInterval = null;
    /** @type {number} Interval in ms between heartbeat emissions */
    this._heartbeatIntervalMs = 1000;

    // ── Task Tracking (activity cascade + recap) ────────────────────────────
    /** @type {Array} Chronological log of all activities during current task */
    this._activityLog = [];
    /** @type {number|null} Timestamp when the current task started */
    this._taskStartTime = null;
    /** @type {number} Number of tool calls in the current task */
    this._toolCallCount = 0;
    /** @type {Set} Set of file paths modified during the current task */
    this._modifiedFiles = new Set();
    /** @type {number|null} Timer ID for mode switch timeout (auto-resume) */
    this._modeSwitchTimer = null;

    // ── Multi-Provider Fallback State ─────────────────────────────────
    /** @type {boolean} Prevents infinite fallback loops */
    this._fallbackAttempted = false;
    /** @type {string|null} Current active tier: "free"|"cheap"|"reasoner" */
    this._currentTier = null;
    /** @type {string|null} Current active provider name */
    this._currentProvider = null;

    // ── Emergency Escalation State ──────────────────────────────────────
    /** @type {number} Consecutive diff rejections for current task */
    this._consecutiveDiffRejections = 0;
    /** @type {string|null} Last file path where a diff was rejected */
    this._lastDiffRejectedForFile = null;
    /** @type {boolean} Flag set when user rejects 2+ diffs → trigger emergency */
    this._emergencyEscalationNeeded = false;
    /** @type {number} Consecutive iterations WITHOUT progress (loop detection) */
    this._noProgressCount = 0;
    /** @type {Set<string>} Set of tool call fingerprints from recent iterations */
    this._recentToolPrints = new Set();
    /** @type {number} Last iteration where visible progress was detected */
    this._lastProgressIteration = 0;

    /** @type {import("../mcp_server.js").MCPServer|null} MCP Server instance */
    this._mcpServer = null;

    /** @type {import("../mcp_config_manager.js").MCPConfigManager|null} MCP Config Manager */
    this._mcpConfigManager = null;

    // ── Discovery Phase (Nivel Cero Interview) ──────────────────────────
    /** @type {boolean} Whether Discovery Phase has been triggered this session */
    this._discoveryDone = false;
    /** @type {boolean} Whether Discovery Phase is pending user answers */
    this._pendingDiscovery = false;

    // ── Swarm Architecture (Background Agents) ──────────────────────────
    /** @type {WorkerPool} Pool of background worker processes */
    this.workerPool = getWorkerPool({ logger: this });
    /** @type {boolean} Whether swarm mode is active */
    this._swarmActive = false;

    // ── Prompt Security Module ──────────────────────────────────────────
    /** @type {object} Security middleware with preProcess/postProcess methods */
    this._security = createSecurityMiddleware({
      enabled: CONFIG.security.enabled,
      maxOutputLength: CONFIG.security.maxOutputLength,
    });
  }

  // ─── Emergency Escalation Public API ──────────────────────────────────

  /**
   * Called from IPC when the user rejects a diff in the editor.
   * After 2 consecutive rejections on the same task, triggers
   * the emergency escalation protocol (Gemini distillation → Pro).
   *
   * @param {string} filePath - The file path where diff was rejected
   */
  reportDiffRejection(filePath) {
    this._consecutiveDiffRejections++;
    this._lastDiffRejectedForFile = filePath;

    this.emit("log", `   ⚠️ Diff rechazado (${this._consecutiveDiffRejections}/2): ${filePath}`);

    if (this._consecutiveDiffRejections >= 2) {
      this.emit("log", "   🚨 2 diffs rechazados consecutivos — activando protocolo de emergencia");
      this._emergencyEscalationNeeded = true;
    }
  }

  /**
   * Reset the diff rejection counter (called when a diff is accepted
   * or when a new task starts).
   */
  _resetDiffCounter() {
    this._consecutiveDiffRejections = 0;
    this._lastDiffRejectedForFile = null;
    this._emergencyEscalationNeeded = false;
  }

  /**
   * Reset progress tracking (called at the start of each new agentLoop).
   */
  _resetProgressTracking() {
    this._noProgressCount = 0;
    this._recentToolPrints = new Set();
    this._lastProgressIteration = 0;
  }

  // ─── Logical Loop Detection ───────────────────────────────────────────

  /**
   * Detect if the agent is stuck in a logical loop — repeating the same
   * tool calls with the same arguments without making visible progress.
   *
   * Looks at the last 8 tool calls. If 4+ are identical in name AND args,
   * the agent is looping.
   *
   * @param {Array} messages - Full conversation history
   * @returns {boolean} True if a logical loop is detected
   */
  _detectLogicalLoop(messages) {
    const recentToolCalls = [];

    // Scan messages backwards to collect last 8 tool calls
    for (let i = messages.length - 1; i >= 0 && recentToolCalls.length < 8; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name || "unknown";
          // Truncate args to first 120 chars for fingerprint comparison
          const args = (tc.function?.arguments || "{}").substring(0, 120);
          recentToolCalls.push(`${name}:${args}`);
        }
      }
      // Also check tool result messages for repeated patterns
      if (msg.role === "tool" && msg.content) {
        const contentPreview = String(msg.content || "").substring(0, 80);
        // If tool results contain repeated error messages, that's also a loop
        if (contentPreview.includes("Path traversal denied") ||
            contentPreview.includes("ENOENT") ||
            contentPreview.includes("already exists")) {
          recentToolCalls.push(`tool_error:${contentPreview}`);
        }
      }
    }

    if (recentToolCalls.length < 4) return false;

    // Count unique fingerprints
    const unique = new Set(recentToolCalls);
    const duplicateRatio = recentToolCalls.length - unique.size;

    // Loop detection: 3+ duplicates AND only 2 or fewer unique patterns
    if (duplicateRatio >= 3 && unique.size <= 2) {
      this.emit("log",
        `   ⚠️ Bucle lógico detectado: ${recentToolCalls.length} tool calls, ` +
        `solo ${unique.size} únicas (${Array.from(unique).join(" | ").substring(0, 120)})`
      );
      return true;
    }

    return false;
  }

  /**
   * Track whether the current iteration made visible progress.
   * Progress is defined as: a successful tool call, a new file modification,
   * or new content in the assistant response.
   *
   * @param {object} assistantMessage - The current assistant message
   * @param {boolean} hasToolCalls      - Whether tool calls were executed
   * @param {boolean} anyToolSucceeded  - Whether any tool call succeeded
   */
  _trackProgress(assistantMessage, hasToolCalls, anyToolSucceeded) {
    if (!hasToolCalls) {
      // Pure text response — always count as progress
      this._noProgressCount = 0;
      this._lastProgressIteration = this.iterationCount;
      return;
    }

    if (anyToolSucceeded) {
      // At least one tool succeeded — reset progress counter
      this._noProgressCount = 0;
      this._lastProgressIteration = this.iterationCount;
    } else {
      // All tools failed this iteration
      this._noProgressCount++;
    }
  }

  // ─── Emergency Distillation via Gemini ────────────────────────────────

  /**
   * Emergency distillation protocol.
   *
   * When Flash fails (diff rejections, loops, or repeated API errors),
   * this method:
   *   1. Takes the full task history
   *   2. Sends it to gemini-2.5-flash (FREE) for a 1-paragraph summary
   *   3. Builds a new ultra-light context with only:
   *      - Original system prompt
   *      - Gemini's summary paragraph
   *      - Last 2 user/tool messages
   *   4. Sends this to deepseek-reasoner (Pro) for the definitive solution
   *
   * @param {Array}  cacheMessages - Messages from the cache loop
   * @param {Array}  tools         - Tool definitions
   * @param {string} reason        - Human-readable reason for escalation
   * @returns {Promise<{ success: boolean, fullContent?: string, fullReasoning?: string, streamedToolCalls?: object }>}
   */
  async _emergencyDistill(cacheMessages, tools, reason = "Protocolo de emergencia") {
    this.emit("log", `   🚨 PROTOCOLO DE EMERGENCIA: ${reason}`);
    this.emit("log", "   🧪 Destilando contexto con Gemini Flash...");

    // 1. Get Gemini Flash provider
    const geminiProvider = this.llm?.getRawProvider?.("gemini-flash") ??
                           this.llm?._providers?.["gemini-flash"];

    if (!geminiProvider) {
      this.emit("warn", "   ⚠️ Gemini Flash no disponible — usando fallback local");
      // Fallback: use _buildMinimalContext without Gemini
      this._currentTier = "reasoner";
      const model = process.env.DEEPSEEK_MODEL_REASONER || "deepseek-reasoner";
      this.llm.setModel(model);

      const minimalMessages = this._buildMinimalContext(cacheMessages);
      return this._executeWithProvider("deepseek", model, minimalMessages, tools, "destilación local (sin Gemini)");
    }

    // 2. Build distillation prompt for Gemini
    const distillationMessages = this._buildDistillationPrompt(cacheMessages);

    try {
      // 3. Call Gemini Flash for 1-paragraph summary
      this.emit("log", "   📡 Enviando historial a Gemini Flash para resumen...");
      const geminiResponse = await geminiProvider.complete(distillationMessages, {
        max_tokens: 300,
        temperature: 0.3,
      });

      const summary = geminiResponse.choices?.[0]?.message?.content || "";

      if (summary) {
        this.emit("log", `   ✅ Gemini resumió ${cacheMessages.length} mensajes → 1 párrafo (${summary.length} chars)`);
      } else {
        this.emit("warn", "   ⚠️ Gemini no devolvió resumen — usando fallback local");
      }

      // 4. Build ultra-light context
      const systemMsg = cacheMessages.find(m => m.role === "system");
      const lastMessages = cacheMessages.slice(-4); // Last 4 messages (user + tool + assistant)

      const proMessages = [];
      if (systemMsg) proMessages.push(systemMsg);

      // Gemini summary as system context
      if (summary) {
        proMessages.push({
          role: "system",
          content: `[RESUMEN DE EMERGENCIA — Generado por Gemini Flash]: ${summary}\n\n---\nProblema detectado: ${reason}`
        });
      } else {
        proMessages.push({
          role: "system",
          content: `[CONTEXTO COMPRIMIDO — Escalación de emergencia]\n` +
                   `Razón: ${reason}\n` +
                   `Total de mensajes originales: ${cacheMessages.length}`
        });
      }

      // Last user/tool messages
      for (const msg of lastMessages) {
        if (msg.role !== "system") {
          proMessages.push(msg);
        }
      }

      this.emit("log", `   📦 Contexto destilado: ${cacheMessages.length} → ${proMessages.length} mensajes para Pro`);

      // 5. Switch to Pro and send
      this._currentTier = "reasoner";
      const proModel = process.env.DEEPSEEK_MODEL_REASONER || "deepseek-reasoner";
      this.llm.setModel(proModel);

      return this._executeWithProvider("deepseek", proModel, proMessages, tools, "destilación Gemini → Pro");

    } catch (geminiErr) {
      this.emit("warn", `   ⚠️ Gemini falló: ${geminiErr.message} — usando fallback local`);
      // Fallback: minimal context without Gemini
      this._currentTier = "reasoner";
      const proModel = process.env.DEEPSEEK_MODEL_REASONER || "deepseek-reasoner";
      this.llm.setModel(proModel);

      const minimalMessages = this._buildMinimalContext(cacheMessages);
      return this._executeWithProvider("deepseek", proModel, minimalMessages, tools, "destilación local (Gemini falló)");
    }
  }

  /**
   * Build a distillation prompt for Gemini Flash.
   * Includes the original task and the failed approaches so Gemini
   * can identify what went wrong.
   *
   * @param {Array} messages - Full message array from cache loop
   * @returns {Array} Messages formatted for Gemini distillation
   */
  _buildDistillationPrompt(messages) {
    // Extract key information from the conversation
    const userMessages = messages.filter(m => m.role === "user");
    const assistantMessages = messages.filter(m => m.role === "assistant");
    const toolMessages = messages.filter(m => m.role === "tool");

    const firstUserMsg = userMessages[0]?.content?.substring(0, 500) || "(no hay input)";
    const lastUserMsg = userMessages[userMessages.length - 1]?.content?.substring(0, 500) || firstUserMsg;

    // Collect tool names used
    const toolNames = new Set();
    for (const msg of assistantMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolNames.add(tc.function?.name || "unknown");
        }
      }
    }

    // Find explicit errors
    const errors = [];
    for (const msg of toolMessages) {
      const content = String(msg.content || "");
      if (content.includes("Error") || content.includes("error") ||
          content.includes("fail") || content.includes("Path traversal") ||
          content.includes("ENOENT") || content.includes("timeout")) {
        errors.push(content.substring(0, 200));
        if (errors.length >= 5) break;
      }
    }

    const systemPrompt = `You are an emergency context distiller. Your ONLY job is to summarise a failed AI coding task into 1 concise paragraph.

Include in your summary:
1. What the user was trying to accomplish (the original task)
2. What approaches were tried (tools used: ${Array.from(toolNames).join(", ") || "none"})
3. Why the approaches failed (specific errors, if any)
4. What should be tried next (your recommendation)

Rules:
- Write ONLY the summary paragraph — no greetings, no markdown, no code blocks
- Maximum 5 sentences
- Be specific about the technical problem
- Do NOT suggest tools or commands — just the strategic approach`;

    const userContent = [
      `ORIGINAL TASK: ${firstUserMsg}`,
      ``,
      `LAST USER MESSAGE: ${lastUserMsg}`,
      ``,
      `TOOLS USED: ${Array.from(toolNames).join(", ") || "none"}`,
      ``,
      `ERRORS ENCOUNTERED:`,
      ...errors.map((e, i) => `  ${i + 1}. ${e}`),
      ``,
      `CONVERSATION STATS: ${messages.length} total messages, ${userMessages.length} user, ${assistantMessages.length} assistant, ${toolMessages.length} tool results`,
    ].join("\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];
  }

  /**
   * Execute a stream with a specific provider, handling AbortController
   * and returning the stream result.
   *
   * @param {string} provider   - Provider key (e.g., "deepseek")
   * @param {string} model      - Model name
   * @param {Array}  messages   - Messages to send
   * @param {Array}  tools      - Tool definitions
   * @param {string} context    - Log context label
   * @returns {Promise<{ success: boolean, fullContent?: string, fullReasoning?: string, streamedToolCalls?: object }>}
   */
  async _executeWithProvider(provider, model, messages, tools, context) {
    this._abortController = new AbortController();

    try {
      const stream = this.llm.stream(messages, {
        tools: tools.length > 0 ? tools : undefined,
        signal: this._abortController.signal,
        ...this._streamOptions,
      });

      const result = await this._processLLMStream(stream, {
        fullContent: "",
        fullReasoning: "",
        streamedToolCalls: {},
        lastReasoningEmit: "",
        lastContentEmit: "",
        abortLabel: `aborted during ${context}`,
      });

      this._abortController = null;
      return { success: true, ...result };
    } catch (err) {
      this._abortController = null;
      this.emit("warn", `   ❌ ${context} falló: ${err.message}`);
      return { success: false };
    }
  }

  // ─── Environment Loading ───────────────────────────────────────────────

  /**
   * Carga variables de entorno desde un archivo .env manualmente.
   * Primero carga el .env de lv-zero (el de siempre), y opcionalmente
   * también carga el .env del proyecto activo (sobrescribe variables).
   *
   * En modo portable (app.asar), busca el .env en el directorio del
   * ejecutable como fallback, ya que dentro del asar es de solo lectura.
   *
   * @param {string} [projectEnvPath] - Ruta opcional al .env del proyecto activo
   */
  loadEnv(projectEnvPath) {
    // ── 1. Cargar .env de lv-zero (siempre) ─────────────────────────────
    const envPath = path.resolve(__dirname, "..", "..", ".env");
    if (fs.existsSync(envPath)) {
      this._parseEnvFile(envPath, true);
    } else {
      // Fallback para modo portable: buscar .env junto al ejecutable
      try {
        const exeDir = path.dirname(process.execPath);
        const portableEnv = path.resolve(exeDir, ".env");
        if (fs.existsSync(portableEnv)) {
          this._parseEnvFile(portableEnv, true);
          this.emit("log", `   📁 .env cargado desde directorio portable: ${portableEnv}`);
        }
      } catch (_) {
        // Ignorar errores de process.execPath (entornos headless/CI)
      }
    }

    // ── 1b. Preservar credenciales de base de datos de lv-zero ─────────
    // Guardamos los valores ORIGINALES de SUPABASE antes de que el .env
    // del proyecto los sobrescriba. Así las skills de memoria (auto_memoria,
    // buscar_recuerdo, guardar_recuerdo) pueden seguir conectándose a la
    // base de datos de lv-zero incluso cuando hay un proyecto activo con
    // su propio .env de Supabase.
    if (process.env.SUPABASE_URL) {
      process.env.LV_SUPABASE_URL = process.env.SUPABASE_URL;
    }
    if (process.env.SUPABASE_KEY) {
      process.env.LV_SUPABASE_KEY = process.env.SUPABASE_KEY;
    }
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      process.env.LV_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    }

    // ── 1c. Cargar .env_siae de lv-zero (credenciales SIAE, si existe) ──
    // Este archivo contiene credenciales de la base de datos SIAE
    // (SIAE_SUPABASE_* y también sobrescribe SUPABASE_* con valores SIAE).
    // Se carga SIEMPRE, independientemente del proyecto activo, para que
    // las skills SIAE (sia_supabase, pg_query project=siae) puedan
    // conectarse a la base de datos SIAE desde cualquier contexto.
    const envSiaePath = path.resolve(__dirname, "..", "..", ".env_siae");
    if (fs.existsSync(envSiaePath)) {
      this._parseEnvFile(envSiaePath, true);
      this.emit("log", "   📁 .env_siae cargado (credenciales SIAE)");
    }

    // ── 2. Cargar .env del proyecto activo (si existe y es diferente) ───
    // NOTA: Con overwrite=true, esto sobrescribe SUPABASE_URL, SUPABASE_KEY,
    // SUPABASE_SERVICE_ROLE_KEY con los valores del proyecto. Pero los valores
    // originales de lv-zero ya fueron preservados como LV_SUPABASE_* arriba.
    if (projectEnvPath && projectEnvPath !== envPath && fs.existsSync(projectEnvPath)) {
      this._parseEnvFile(projectEnvPath, true);

      // ── 2b. Remapear SUPABASE_* → SIAE_SUPABASE_* para el proyecto activo ──
      // Después de cargar el .env del proyecto, cualquier SUPABASE_* que haya
      // sido sobrescrito se duplica como SIAE_SUPABASE_* para que las skills
      // del proyecto (siae_consolidator, pg_query con project='siae') puedan
      // resolver sus credenciales via getCredentials('siae') / getPoolerConfig('siae').
      const remapKeys = ['URL', 'KEY', 'SERVICE_ROLE_KEY', 'ANON_KEY', 'REF', 'REGION', 'DB_PASSWORD', 'DB_URL'];
      for (const suffix of remapKeys) {
        const supabaseKey = `SUPABASE_${suffix}`;
        const siaeKey = `SIAE_SUPABASE_${suffix}`;
        if (process.env[supabaseKey] && !process.env[siaeKey]) {
          process.env[siaeKey] = process.env[supabaseKey];
        }
      }
    }

    // Load into CONFIG (priority: LLM_* vars > DEEPSEEK_* vars)
    CONFIG.apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || CONFIG.apiKey;
    CONFIG.baseURL =
      process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
    CONFIG.model = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";

    // planFile por defecto = lv-zero root; setProjectPath() lo actualiza si hay proyecto
    if (!this.projectPath) {
      CONFIG.planFile = path.resolve(__dirname, "..", "..", "PLAN.md");
    }

    if (process.env.MAX_TOOL_ITERATIONS) {
      const parsed = parseInt(process.env.MAX_TOOL_ITERATIONS, 10);
      if (parsed > 0 && parsed <= 500) {
        CONFIG.maxToolIterations = parsed;
      }
    }
  }

  /**
   * Parsea un archivo .env y carga sus variables en process.env.
   * @param {string} filePath - Ruta al archivo .env
   * @param {boolean} [overwrite=false] - Si true, sobrescribe variables existentes
   */
  _parseEnvFile(filePath, overwrite = false) {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Solo establecer si no existe ya (a menos que overwrite=true)
      if (overwrite || !process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // ─── Client Initialization ─────────────────────────────────────────────

  /**
   * Inicializa el cliente LLM multi-provider.
   * Lee la configuración de CONFIG (cargado desde .env).
   * Soporta: deepseek (default), openai-compatible.
   *
   * Variables de entorno:
   *   LLM_PROVIDER   = "deepseek" | "openai-compatible"
   *   LLM_API_KEY    = API key (fallback: DEEPSEEK_API_KEY)
   *   LLM_BASE_URL   = Base URL (fallback: DEEPSEEK_BASE_URL)
   *   LLM_MODEL      = Model name (fallback: DEEPSEEK_MODEL)
   */
  initClient() {
    const provider = process.env.LLM_PROVIDER || "deepseek";

    // Mock provider doesn't need an API key — it's used for testing/CI.
    if (!CONFIG.apiKey && provider !== "mock") {
      const err = new ConfigurationError("LLM_API_KEY / DEEPSEEK_API_KEY no encontrada en .env");
      this.emit("error", err.toJSON());
      return null;
    }

    this.llm = new LLMClient({
      emitter: this,
      provider,
      apiKey: CONFIG.apiKey || "mock-key", // mock provider ignores the key
      baseURL: CONFIG.baseURL,
      model: CONFIG.model,
    });

    try {
      this.llm.init();

      // ── Wire circuit breaker events to orchestrator's EventEmitter ──
      this.llm.connectCircuitBreakerEvents((event, data) => {
        switch (event) {
          case "circuit_open":
            this.emit("warn", `   ⚡ Circuito ABIERTO: ${data.error} (${data.failureCount} fallos)`);
            break;
          case "circuit_half_open":
            this.emit("log", `   ⚡ Circuito SEMI-ABIERTO: probando recuperación...`);
            break;
          case "circuit_closed":
            this.emit("log", `   ⚡ Circuito CERRADO: recuperado exitosamente`);
            break;
          default:
            this.emit("log", `   ⚡ CircuitBreaker: ${event}`, data);
        }
      });

      return this.llm;
    } catch (initErr) {
      const lvErr = toLvError(initErr, {
        code: ErrorCodes.CONFIG_ERROR,
        context: { provider },
        recoverable: true,
      });
      this.emit("error", lvErr.toJSON());
      this.llm = null;
      return null;
    }
  }

  // ─── Skill Loading ─────────────────────────────────────────────────────

  /**
   * Convierte skills al formato tools de OpenAI.
   */
  skillsToTools() {
    const allTools = this.skills.map((skill) => ({
      type: "function",
      function: {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters,
      },
    }));

    // Filter tools based on current mode permissions
    let filtered;
    if (this.modeController) {
      filtered = this.modeController.filterTools(allTools);
    } else {
      filtered = allTools;
    }

    // ── Inject the mode switch tool (always available when allowed) ──
    // request_mode_switch is a built-in tool, not a skill. It's added to
    // each mode's allowedTools in mode_registry.js. We inject it here
    // after filtering so the agent can always request a mode switch.
    const modeSwitchTool = getModeSwitchToolSpec();
    const switchToolName = modeSwitchTool.function.name;
    const alreadyInjected = filtered.some(
      (t) => (t.function?.name || t.name) === switchToolName
    );
    if (!alreadyInjected) {
      const currentSlug = this.modeController?.currentMode || "orchestrator";
      const modeConfig = getMode(currentSlug);
      if (modeConfig) {
        const allowed = modeConfig.allowedTools;
        // "*" means all tools are allowed; otherwise check the list
        if (allowed === "*" || (Array.isArray(allowed) && allowed.includes(switchToolName))) {
          filtered.push(modeSwitchTool);
        }
      }
    }

    // ── Inject the ask_followup_question tool (always available) ─────
    // This built-in tool lets the LLM ask the user for clarification
    // when information is missing. It's not a skill — it's handled by
    // the orchestrator directly.
    const questionTool = getAskFollowupQuestionToolSpec();
    const questionToolName = questionTool.function.name;
    const alreadyHasQuestion = filtered.some(
      (t) => (t.function?.name || t.name) === questionToolName
    );
    if (!alreadyHasQuestion) {
      const currentSlug = this.modeController?.currentMode || "orchestrator";
      const modeConfig = getMode(currentSlug);
      if (modeConfig) {
        const allowed = modeConfig.allowedTools;
        if (allowed === "*" || (Array.isArray(allowed) && allowed.includes(questionToolName))) {
          filtered.push(questionTool);
        }
      }
    }

    return filtered;
  }

  /**
   * Carga todas las skills (nativas + bridge + MCP).
   */
  async loadAllSkills() {
    const allSkills = [];

    // ── Resolve skills directory (supports both dev and packaged/asar) ──
    let skillsDir = path.resolve(__dirname, "..", "..", "skills");
    if (!fs.existsSync(skillsDir) && process.resourcesPath) {
      const packedDir = path.resolve(process.resourcesPath, "skills");
      if (fs.existsSync(packedDir)) {
        skillsDir = packedDir;
        console.log(`   ↳ Using extraResources skills path: ${skillsDir}`);
      }
    }

    // ── Phase 1: Native lv-zero skills from /skills/ ────────────────────
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".js")) {
          try {
            const skillPath = path.resolve(skillsDir, entry.name);
            const bustedPath = `${skillPath}?t=${Date.now()}`;
            const skillUrl = new URL(`file://${bustedPath.replace(/\\/g, "/")}`);
            const { default: skill } = await import(skillUrl);
            if (skill && skill.name && skill.handler) {
              if (skill.name === "skill_bridge") {
                allSkills.push(skill);
              } else if (skill.name === "skill_factory") {
                const { setSkillRegistry } = await import(skillUrl);
                if (setSkillRegistry) {
                  setSkillRegistry(allSkills, () => this.reloadAllSkills());
                }
                allSkills.push(skill);
              } else {
                allSkills.push(skill);
              }
              this.emit("log", `   🛠  ${skill.name}`);
            }
          } catch (err) {
            const lvErr = toLvError(err, { code: ErrorCodes.TOOL_ERROR, context: { skill: entry.name }, recoverable: true });
            this.emit("log", `   ⚠️  Error cargando ${entry.name}: ${lvErr.message}`);
          }
        }
      }
    }

    // ── Phase 1b: Markdown-defined skills (SKILL.md) ────────────────────
    // Supports gstack-style SKILL.md files with YAML frontmatter.
    // Skills are defined as Markdown in skills/<name>/SKILL.md.
    // Template compilation from SKILL.md.tmpl is handled by template_engine.js.
    try {
      const { loadMarkdownSkills } = await import(
        `file://${path.resolve(skillsDir, "loader", "skill_md_loader.js").replace(/\\/g, "/")}?t=${Date.now()}`
      );
      const mdSkills = await loadMarkdownSkills({ baseDir: skillsDir, includeAntigravity: false });
      let mdLoaded = 0;
      let mdSkipped = 0;
      for (const mdSkill of mdSkills) {
        // 🛡️ Defensive: skip if name conflicts with an already-loaded skill
        if (allSkills.some((existing) => existing.name === mdSkill.name)) {
          mdSkipped++;
          continue;
        }
        allSkills.push(mdSkill);
        mdLoaded++;
      }
      if (mdLoaded > 0) {
        this.emit("log", `   📝 ${mdLoaded} skill(s) Markdown cargadas (${mdSkipped} omitidas por duplicado)`);
      }
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.TOOL_ERROR, context: { phase: "markdown_skills" }, recoverable: true });
      this.emit("log", `   ⚠️  Skills Markdown: ${lvErr.message}`);
    }

    // ── Phase 2: Skills de Proceso (desde skills/antigravity/) ──────────
    this.emit("log", "   🔗 Cargando skills de proceso...");
    try {
      const { loadAntigravitySkills } = await import(
        `file://${path.resolve(skillsDir, "skill_bridge.js").replace(/\\/g, "/")}?t=${Date.now()}`
      );
      const bridgeSkills = await loadAntigravitySkills();
      let loadedCount = 0;
      let skippedCount = 0;
      for (const bs of bridgeSkills) {
        // 🛡️ Defensive: skip if name conflicts with an already-loaded skill
        if (allSkills.some((existing) => existing.name === bs.name)) {
          skippedCount++;
          continue;
        }
        allSkills.push(bs);
        loadedCount++;
      }
      this.emit("log", `   → ${loadedCount} skill(s) de proceso cargadas (${skippedCount + 3} omitidas por duplicado: auto-save, skill-creator, code-review${skippedCount > 0 ? ", +" + skippedCount + " más" : ""})`);
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.TOOL_ERROR, context: { phase: "process_skills" }, recoverable: true });
      this.emit("log", `   ⚠️  Skills de proceso: ${lvErr.message}`);
    }

    // ── Phase 3: MCP Config Manager + Client Skill ─────────────────────
    try {
      const { MCPConfigManager } = await import(
        `file://${path.resolve(__dirname, "..", "mcp_config_manager.js").replace(/\\/g, "/")}?t=${Date.now()}`
      );

      // Create manager instance and store as global for mcp_client.js backward compat
      this._mcpConfigManager = new MCPConfigManager({
        logger: this,
        configPaths: {
          projectRoot: path.resolve(__dirname, "..", ".."),
        },
      });
      global.__mcpConfigManager = this._mcpConfigManager;

      // Auto-connect configured servers and create skill
      await this._mcpConfigManager.initialize();
      const mcpSkill = this._mcpConfigManager.createSkill();
      if (mcpSkill) {
        allSkills.push(mcpSkill);
        const connectedCount = this._mcpConfigManager.getConnectedCount();
        this.emit("log", `   🛠  mcp_client (${this._mcpConfigManager.readConfig().length} configurados, ${connectedCount} conectados)`);
      }

      // Forward MCP events to orchestrator logs
      this._mcpConfigManager.on("mcp:server_healthy", ({ name }) => {
        this.emit("log", `   ✅ MCP ${name}: saludable`);
      });
      this._mcpConfigManager.on("mcp:server_unhealthy", ({ name, failures }) => {
        this.emit("log", `   ⚠️ MCP ${name}: no saludable (${failures} fallos)`);
      });
      this._mcpConfigManager.on("mcp:server_recovered", ({ name }) => {
        this.emit("log", `   🔄 MCP ${name}: recuperado`);
      });
      this._mcpConfigManager.on("mcp:status_changed", (status) => {
        this.emit("mcp_status_changed", status);
      });
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.TOOL_ERROR, context: { phase: "mcp_config_manager" }, recoverable: true });
      this.emit("log", `   ⚠️ MCP Config Manager: ${lvErr.message}`);
    }

    this.skills = allSkills;
    setSkillsCount(allSkills.length);
    return allSkills;
  }

  /**
   * Hot-reload de skills.
   */
  async reloadAllSkills() {
    this.emit("log", "   🔄 Recarga en caliente...");
    const count = await this.loadAllSkills();
    this.emit("log", `   → ${count} skill(s) cargadas después del hot-reload`);
    return count;
  }

  // ─── Tool Execution ───────────────────────────────────────────────────

  /**
   * Ejecuta un tool_call y devuelve el resultado.
   */
  async executeToolCall(toolCall, toolIndex, totalTools) {
    // ── SPECIAL: Agent-initiated mode switch request ─────────────
    // If the LLM calls request_mode_switch, intercept it before the
    // skill lookup. This is a built-in tool (not a loaded skill) that
    // lets the agent autonomously request a mode change.
    if (toolCall.function.name === "request_mode_switch") {
      return this._handleModeSwitchRequest(toolCall, toolIndex, totalTools);
    }

    // ── SPECIAL: Agent-initiated follow-up question ──────────────
    // If the LLM calls ask_followup_question, intercept it before the
    // skill lookup. This is a built-in tool that lets the agent ask
    // the user for clarification without making a tool call.
    if (toolCall.function.name === "ask_followup_question") {
      return await this._handleAskFollowupQuestion(toolCall);
    }

    const skill = this.skills.find((s) => s.name === toolCall.function.name);
    if (!skill) {
      this.emit("tool_call", {
        name: toolCall.function.name,
        status: "not_found",
        toolIndex,
        totalTools,
      });
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Error: Skill "${toolCall.function.name}" no encontrada.`,
      };
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      this.emit("tool_call", {
        name: skill.name,
        args,
        status: "running",
        toolIndex,
        totalTools,
      });

      // Emit progress at start
      this.emit("tool_progress", {
        name: skill.name,
        index: toolIndex + 1,
        total: totalTools,
        status: "running",
      });

      // ── 🔒 CRASH-SAFE: Tool call with timeout + cancellation ──────────
      // Prevents a single hanging tool (Supabase, shell, file I/O) from
      // freezing the entire extension host. Uses Promise.race with a
      // timeout that resolves with a sentinel if the tool takes too long.
      // After the race resolves, the AbortController signals the still-
      // running handler to cancel, preventing orphaned background operations.
      const TOOL_TIMEOUT_MS = 120_000; // 2 minutes per tool call
      const abortCtrl = new AbortController();

      // ── Wire orchestrator-wide tool abort to this tool's controller ──
      // When abortAgent() signals _toolAbortController, forward to this
      // tool so shell_executor, build_slidev_deck, etc. get cancelled.
      this._toolAbortController = abortCtrl;

      const TOOL_TIMED_OUT = { __lv_timed_out: true };
      const result = await Promise.race([
        skill.handler(args, { signal: abortCtrl.signal }),
        new Promise((resolve) =>
          setTimeout(
            () => resolve(TOOL_TIMED_OUT),
            TOOL_TIMEOUT_MS
          )
        ),
      ]);

      // Cancel if timed out — signals the handler to abort
      abortCtrl.abort();
      // Clear tool abort controller so subsequent tools get a fresh one
      if (this._toolAbortController === abortCtrl) {
        this._toolAbortController = null;
      }

      // If timeout won, throw instead of continuing with stale data
      if (result === TOOL_TIMED_OUT) {
        throw new Error(`Tool "${skill.name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`);
      }

      // 🔧 Determine true operational status: some skills return { success: false }
      // even though the handler didn't throw. Check for this pattern to emit
      // an accurate status for UI/logging purposes.
      const opSuccess =
        typeof result === "object" &&
        result !== null &&
        "success" in result
          ? result.success === true
          : true;

      const opStatus = opSuccess ? "success" : "error";
      const opError = !opSuccess && result.error ? result.error : undefined;

      this.emit("tool_result", {
        name: skill.name,
        status: opStatus,
        result:
          typeof result === "string"
            ? result.substring(0, 500)
            : JSON.stringify(result).substring(0, 500),
        error: opError,
        toolIndex,
        totalTools,
      });

      // Emit progress on completion
      this.emit("tool_progress", {
        name: skill.name,
        index: toolIndex + 1,
        total: totalTools,
        status: opSuccess ? "completed" : "failed",
      });

      trackToolCall();

      // ── ACTIVITY CASCADE: Track tool call for recap ──────────────────
      this._toolCallCount++;
      const activityEntry = {
        type: "tool",
        name: skill.name,
        args,
        status: opStatus,
        error: opError,
        timestamp: Date.now(),
        iteration: this.iterationCount,
      };
      this._activityLog.push(activityEntry);
      this.emit("activity", activityEntry);

      // Detect file modifications (write_to_file, apply_diff, etc.)
      if (["write_to_file", "apply_diff", "delete_file", "create_file"].includes(skill.name)) {
        if (args.path) {
          this._modifiedFiles.add(args.path);
        }
      }

      // ── HEARTBEAT: After each tool call ──────────────────────────────
      try {
        saveRooState({
          status: "in_progress",
          currentMode: this.modeController ? this.modeController.currentMode : "orchestrator",
          lastAssistantAction: `Tool: ${skill.name} (${toolIndex}/${totalTools})`,
        });
      } catch (_) {
        // Non-critical
      }

      // ── PROMPT SECURITY: Sanitize tool result content ──────────
      const rawContent =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      const safeContent = this._security.postProcess(rawContent);

      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: safeContent,
      };
    } catch (err) {
      // Clean up tool abort controller on error path too
      if (this._toolAbortController) {
        try { this._toolAbortController.abort(); } catch {}
        this._toolAbortController = null;
      }

      const lvErr = toLvError(err, { code: ErrorCodes.TOOL_ERROR, context: { skill: skill.name, toolIndex, totalTools }, recoverable: true });
      this.emit("tool_result", {
        name: skill.name,
        status: "error",
        error: lvErr.message,
        toolIndex,
        totalTools,
      });

      // Emit progress on failure
      this.emit("tool_progress", {
        name: skill.name,
        index: toolIndex + 1,
        total: totalTools,
        status: "failed",
      });

      // ── ACTIVITY CASCADE: Track failed tool call ─────────────────────
      this._toolCallCount++;
      const failEntry = {
        type: "tool",
        name: skill.name,
        args: {},
        status: "error",
        error: lvErr.message,
        timestamp: Date.now(),
        iteration: this.iterationCount,
      };
      this._activityLog.push(failEntry);
      this.emit("activity", failEntry);

      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Error ejecutando ${toolCall.function.name}: ${lvErr.message}`,
      };
    }
  }

  /**
   * Processes an LLM stream, extracting reasoning_content, content, and
   * tool_calls chunk by chunk.  Emits "reasoning" and "content_chunk" events
   * for real-time UI streaming.
   *
   * This is the shared loop body extracted from the initial call and the
   * retry path to eliminate ~50 lines of duplicated code.
   *
   * @param {AsyncIterable} stream  - The LLM stream (from this.llm.stream())
   * @param {object}         state  - Mutable accumulator object with:
   *   { fullContent, fullReasoning, streamedToolCalls, lastReasoningEmit,
   *     lastContentEmit, abortLabel }
   * @returns {Promise<object>} Updated accumulator with the same shape.
   */
  async _processLLMStream(stream, state) {
    const REASONING_EMIT_THRESHOLD = 1;
    const CONTENT_EMIT_THRESHOLD = 1;
    const abortLabel = state.abortLabel || "aborted by user";

    let fullContent = state.fullContent || "";
    let fullReasoning = state.fullReasoning || "";
    let streamedToolCalls = state.streamedToolCalls || {};
    let lastReasoningEmit = state.lastReasoningEmit || "";
    let lastContentEmit = state.lastContentEmit || "";

    for await (const chunk of stream) {
      // ── Abort check during streaming ──────────────────────────
      if (this._abortRequested) {
        this.emit("log", `   🛑 Streaming ${abortLabel}.`);
        break;
      }

      // ── 1. Extract reasoning_content (provider-specific) ────────
      if (chunk.reasoning_content) {
        fullReasoning += chunk.reasoning_content;
        if (fullReasoning.length - lastReasoningEmit.length >= REASONING_EMIT_THRESHOLD) {
          // ── GLASS-BOX: Transform reasoning for Nivel Cero users ──
          // Translate technical terms to human-readable language
          // while preserving the original for the technical detail view.
          const humanReadable = fullReasoning
            .replace(/\btool_call\b/gi, '🌐 herramienta')
            .replace(/\bAPI\b/gi, 'conexión')
            .replace(/\bdatabase query\b/gi, 'consulta a la base de datos')
            .replace(/\bendpoint\b/gi, 'ruta o puente')
            .replace(/\bmiddleware\b/gi, 'filtro')
            .replace(/\basync\b/gi, 'tarea que toma tiempo')
            .replace(/\bawait\b/gi, 'esperar')
            .replace(/\bfunction\b/gi, 'función')
            .replace(/\bvariable\b/gi, 'cajita')
            .replace(/\bparameter\b/gi, 'dato de entrada')
            .replace(/\breturn\b/gi, 'devolver')
            .replace(/\bimport\b/gi, 'traer')
            .replace(/\bexport\b/gi, 'exportar')
            .replace(/\bclass\b/gi, 'plantilla')
            .replace(/\barray\b/gi, 'lista')
            .replace(/\bobject\b/gi, 'objeto');

          this.emit("reasoning", {
            text: humanReadable,
            raw: fullReasoning, // Original technical version
            delta: chunk.reasoning_content,
            complete: false,
          });
          lastReasoningEmit = fullReasoning;
        }
      }

      // ── 2. Collect content & stream to UI ──────────────────────
      if (chunk.content) {
        fullContent += chunk.content;
        if (fullContent.length - lastContentEmit.length >= CONTENT_EMIT_THRESHOLD) {
          this.emit("content_chunk", {
            text: fullContent,
            delta: chunk.content,
            complete: false,
          });
          lastContentEmit = fullContent;
        }
      }

      // ── 3. Collect tool calls (aggregated by index) ─────────────
      if (chunk.tool_calls) {
        for (const tc of chunk.tool_calls) {
          if (!streamedToolCalls[tc.index]) {
            streamedToolCalls[tc.index] = {
              id: null,
              type: "function",
              function: { name: "", arguments: "" },
            };
          }
          if (tc.id) streamedToolCalls[tc.index].id = tc.id;
          if (tc.function?.name) streamedToolCalls[tc.index].function.name += tc.function.name;
          if (tc.function?.arguments) streamedToolCalls[tc.index].function.arguments += tc.function.arguments;
        }
      }

      // ── 4. Track finish_reason (for token-limit detection) ──────────
      if (chunk.finish_reason) {
        this._lastFinishReason = chunk.finish_reason;
      }
    }

    // Warn if response was truncated by token limit
    if (this._lastFinishReason === "length") {
      this.emit("log", "   ⚠️ La respuesta se truncó por límite de tokens. Si necesitas más contenido, pídemelo.");
    }

    // Return accumulated state
    return {
      fullContent,
      fullReasoning,
      streamedToolCalls,
      lastReasoningEmit,
      lastContentEmit,
    };
  }

  /**
   * Handles a `request_mode_switch` tool call from the agent (LLM).
   *
   * Parses the agent's requested mode and reason, emits a mode_suggestion
   * event (same flow as user keyword detection), and sets flags to pause
   * agentLoop after all tool results are processed.
   *
   * @param {object} toolCall - The tool call object from the LLM
   * @param {number} toolIndex - Index of this tool call in the batch
   * @param {number} totalTools - Total tool calls in this batch
   * @returns {object} Tool result message (to be pushed to conversation)
   */
  async _handleModeSwitchRequest(toolCall, toolIndex, totalTools) {
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      this.emit("tool_call", {
        name: "request_mode_switch",
        status: "error",
        error: "Invalid JSON arguments",
        toolIndex,
        totalTools,
      });
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Error: Invalid arguments. Usage: { "mode": "architect|code|ask|debug|orchestrator", "reason": "why you need to switch" }`,
      };
    }

    const { mode, reason } = args;
    const VALID_MODES = ["architect", "code", "ask", "debug", "orchestrator"];

    if (!mode || !VALID_MODES.includes(mode)) {
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Error: Invalid mode "${mode}". Available modes: ${VALID_MODES.join(", ")}`,
      };
    }

    const currentMode = this.modeController?.currentMode || "orchestrator";
    if (mode === currentMode) {
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Already in **${mode}** mode. No switch needed.`,
      };
    }

    // Validate target mode exists
    const modeConfig = getMode(mode);
    if (!modeConfig) {
      return {
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Error: Mode "${mode}" not found in registry.`,
      };
    }

    this.emit("tool_call", {
      name: "request_mode_switch",
      args,
      status: "running",
      toolIndex,
      totalTools,
    });

    // ── Store pending state — agentLoop will pause for user approval ──
    this._pendingModeInput = `[Agent requested mode switch to ${modeConfig.icon} ${modeConfig.name}]\nReason: ${reason || "Not specified"}\n\nContinue with the previous task in this mode.`;
    this._pendingModeSlug = mode;
    this._pendingFromAgent = true;
    // Set _pendingModeSwitch so agentLoop pauses and waits for user approval.
    // The renderer's mode_suggestion handler will check autoApprove.subtasks
    // and auto-accept if the toggle is ON, or show a banner if OFF.
    this._pendingModeSwitch = true;

    this.emit("log", `   🤖 El agente solicita cambiar a modo ${modeConfig.icon} ${modeConfig.name}: ${reason || "No especificado"}`);

    // Emit mode_suggestion so the renderer can auto-approve or prompt the user
    this.emit("mode_suggestion", {
      from: this.modeController?.currentMode || "orchestrator",
      to: mode,
      confidence: 1.0,
      icon: modeConfig.icon,
      name: modeConfig.name,
      reason: reason || "Agent-initiated delegation",
      source: "delegation",  // ← distinguishes from mode detection
    });

    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: `🔄 **Agent requested mode switch.**\nTarget: **${modeConfig.icon} ${modeConfig.name}** (${mode})\nReason: ${reason || "Not specified"}\n\n⏸  Waiting for your approval...`,
    };
  }

  /**
   * Handles the `ask_followup_question` built-in tool call.
   * Pauses the agent loop and emits an `ask_question` event for the UI
   * to display to the user. The loop resumes when the user answers via
   * answerFollowupQuestion().
   *
   * @param {object} toolCall - The tool call object from the LLM
   * @returns {object} Tool result with pending status
   */
  async _handleAskFollowupQuestion(toolCall) {
    const args = JSON.parse(toolCall.function?.arguments || "{}");

    // Validate
    if (!args.question || !args.follow_up?.length) {
      return { error: "ask_followup_question requires 'question' and 'follow_up' parameters" };
    }

    // Emit tool_call event
    this.emit("tool_call", {
      name: "ask_followup_question",
      args: { question: args.question },
      status: "running"
    });

    // Store pending state — agent loop pauses awaiting user response
    this._pendingAskQuestion = true;
    this._pendingAskData = {
      question: args.question,
      follow_up: args.follow_up,
      toolCallIndex: this._currentToolIndex,
    };

    // Emit event for UI to show question
    this.emit("ask_question", {
      question: args.question,
      follow_up: args.follow_up
    });

    // Emit tool_result as "pending" — will be replaced when user answers
    this.emit("tool_result", {
      name: "ask_followup_question",
      result: "⏳ Esperando respuesta del usuario...",
      status: "pending"
    });

    // Pause agent loop — the loop checks _pendingAskQuestion flag
    return { pending: true, message: "⏳ Esperando respuesta del usuario..." };
  }

  // ─── System Prompt Loading ────────────────────────────────────────────

  async loadSystemPrompt(modeSlug) {
    // Load the tool manifest (skills + MCP servers) for injection into prompts
    let manifestSection = "";
    try {
      const { generateManifest } = await import(
        `file://${path.resolve(__dirname, "..", "..", "_lib", "tool_manifest.js").replace(/\\/g, "/")}?t=${Date.now()}`
      );
      manifestSection = generateManifest();
    } catch (err) {
      this.emit("log", `   ⚠️ No se pudo generar tool_manifest: ${err.message}`);
      manifestSection = "";
    }

    // If mode is specified, load from mode prompts directory
    if (modeSlug && this.modeController) {
      const { getMode } = await import("../modes/mode_registry.js");
      const mode = getMode(modeSlug);
      if (mode) {
        const promptPath = path.resolve(__dirname, "..", "modes", "prompts", `${mode.systemPromptFile}.md`);
        try {
          let content = fs.readFileSync(promptPath, "utf-8");
          // Inject manifest before the mode-specific content
          if (manifestSection) {
            content = manifestSection + "\n\n---\n\n" + content;
          }
          this.systemPrompt = content;
          this.emit("log", `   📜 System prompt cargado: ${mode.icon} ${mode.name} Mode (${content.length} caracteres, con tool manifest)`);
          return content;
        } catch (err) {
          const lvErr = toLvError(err, { code: ErrorCodes.FS_ERROR, context: { modeSlug }, recoverable: true });
          this.emit("log", `   ⚠️ Error cargando prompt de ${modeSlug}: ${lvErr.message}`);
        }
      }
    }

    // Fallback: load default system_prompt.js
    const { default: systemPrompt } = await import(
      `file://${path.resolve(__dirname, "..", "system_prompt.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    // Inject manifest into fallback prompt too
    this.systemPrompt = manifestSection ? manifestSection + "\n\n---\n\n" + systemPrompt : systemPrompt;
    this.emit("log", `   📜 System prompt cargado (fallback, ${this.systemPrompt.length} caracteres)`);
    return this.systemPrompt;
  }

  // ─── Mode Switching ──────────────────────────────────────────────────

  /**
   * Cambia al modo especificado.
   * Delega en ModeController y emite evento mode_changed.
   *
   * @param {string} modeSlug - Modo destino (architect, code, ask, debug)
   * @param {string} [reason] - Razón del cambio
   * @returns {Promise<object>} Resultado del cambio
   */
  async switchMode(modeSlug, reason = "manual") {
    if (!this.modeController) {
      return { success: false, error: "ModeController no inicializado" };
    }

    const result = await this.modeController.switchMode(modeSlug, reason);

    // After mode switch, re-filter skills/tools
    if (result.success) {
      this.emit("log", `   🔧 Skills re-filtradas para modo ${modeSlug}`);
    }

    return result;
  }

  // ─── Heartbeat Cleanup ─────────────────────────────────────────────────

  /**
   * Clears the live heartbeat interval timer.
   */
  _clearHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  // ─── Pending Message Queue ────────────────────────────────────────────

  /**
   * Drains the pending messages queue — processes each queued message
   * sequentially after the current task finishes.
   * Each queued message goes through a full agentLoop cycle.
   */
  async _drainPendingMessages() {
    while (this._pendingMessages.length > 0) {
      const msg = this._pendingMessages.shift();
      const remaining = this._pendingMessages.length;
      this.emit("log", `📤 Procesando mensaje encolado (${remaining + 1} pendientes)...`);
      await this.agentLoop(msg);
    }
  }

  // ─── Message Validation ───────────────────────────────────────────────

  /**
   * Valida que los mensajes estén bien formados antes de enviarlos a la API.
   * Previene errores 400 por:
   *   a) tool_calls sin tool response (asistente pide herramienta pero no hay respuesta)
   *   b) tool response sin assistant tool_calls precedente (respuesta huérfana)
   *
   * @param {Array} [msgs] - El array de mensajes a validar. Por defecto this.messages.
   *                         DEBE ser el mismo array que se envía a la API.
   */
  validateMessages(msgs) {
    const messages = msgs || this.messages;
    if (!messages || messages.length === 0) return;

    let corrected = false;

    // ── Forward pass: remove orphaned tool_calls from assistant messages ──
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant" || !msg.tool_calls || !Array.isArray(msg.tool_calls)) {
        continue;
      }

      const orphanedIds = [];
      for (const tc of msg.tool_calls) {
        const nextMsg = messages[i + 1];
        const hasResponse =
          nextMsg &&
          nextMsg.role === "tool" &&
          nextMsg.tool_call_id === tc.id;

        if (!hasResponse) {
          orphanedIds.push(tc.id);
        }
      }

      if (orphanedIds.length === 0) continue;

      msg.tool_calls = msg.tool_calls.filter(
        (tc) => !orphanedIds.includes(tc.id)
      );

      if (msg.tool_calls.length === 0) {
        // If the assistant message had ONLY tool_calls (no text content),
        // and all of them were orphaned, remove the empty message entirely.
        // Otherwise DeepSeek rejects it with "400: content or tool_calls must be set".
        if (!msg.content) {
          messages.splice(i, 1);
          i--;
        } else {
          delete msg.tool_calls;
        }
      }

      corrected = true;
      this.emit("log", `   ⚠️ Sanitized ${orphanedIds.length} orphaned tool_call_id(s) from message[${i}]`);
    }

    // ── Reverse pass: remove orphaned tool results ──
    const toolCallIdsExpected = new Set();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCallIdsExpected.add(tc.id);
        }
      } else if (msg.role === "tool" && msg.tool_call_id) {
        if (!toolCallIdsExpected.has(msg.tool_call_id)) {
          messages.splice(i, 1);
          i--;
          corrected = true;
          this.emit("log", `   ⚠️ Removed orphaned tool result (${msg.tool_call_id}) — no preceding assistant with tool_calls`);
        } else {
          toolCallIdsExpected.delete(msg.tool_call_id);
        }
      }
    }

    if (corrected) {
      this.emit("log", "   ✅ Messages validated and corrected before API call");
    }
  }

  // ─── Swarm Events ───────────────────────────────────────────────────────

  /**
   * Wires WorkerPool events to orchestrator events so the UI can display
   * background agent progress in real-time.
   */
  _wireSwarmEvents() {
    const pool = this.workerPool;

    // Remove old listeners to avoid duplicates
    pool.removeAllListeners("task:started");
    pool.removeAllListeners("task:progress");
    pool.removeAllListeners("task:complete");
    pool.removeAllListeners("task:error");
    pool.removeAllListeners("task:cancelled");

    pool.on("task:started", ({ taskId, name }) => {
      this.emit("swarm:task_started", { taskId, name });
      this.emit("log", `   🐝 [${name}] iniciado`);
    });

    pool.on("task:progress", ({ taskId, name, progress, status, detail }) => {
      this.emit("swarm:task_progress", { taskId, name, progress, status, detail });
    });

    pool.on("task:complete", ({ taskId, name, result, duration }) => {
      this.emit("swarm:task_complete", { taskId, name, result, duration });
      this.emit("log", `   ✅ [${name}] completado (${(duration / 1000).toFixed(1)}s)`);

      // If all tasks are done, emit swarm complete
      if (pool.queuedCount === 0 && pool.activeCount === 0) {
        this._swarmActive = false;
        this.emit("swarm:complete", {
          totalTasks: pool.totalCreated,
          completedTasks: pool.completedCount,
          failedTasks: pool.totalCreated - pool.completedCount,
        });
        this.emit("log", `   🐝 Swarm completado: ${pool.completedCount}/${pool.totalCreated} tareas`);
      }
    });

    pool.on("task:error", ({ taskId, name, error }) => {
      this.emit("swarm:task_error", { taskId, name, error });
      this.emit("warn", `   ⚠️ [${name}] error: ${error}`);
    });

    pool.on("task:cancelled", ({ taskId }) => {
      this.emit("swarm:task_cancelled", { taskId });
    });
  }

  // ─── Agent Loop ───────────────────────────────────────────────────────

  /**
   * El núcleo del agente: llama a DeepSeek, maneja tool_calls en ciclo.
   * Retorna una promesa que se resuelve con la respuesta final.
   *
   * @param {string} userInput - Mensaje del usuario
   * @returns {Promise<string>} - Respuesta final del agente
   */
  async agentLoop(userInput) {
    if (!this.llm || !this.llm.isReady()) {
      const errorMsg = "❌ LLM no está configurado. Revisa tu .env";
      this.emit("error", { type: "client", message: errorMsg });
      return errorMsg;
    }

    if (this.isRunning) {
      // Queue the message instead of rejecting — the queue is drained when the current task finishes.
      this._pendingMessages.push(userInput);
      const pendingCount = this._pendingMessages.length;
      this.emit("log", `📥 Mensaje encolado (#${pendingCount}) — se procesará cuando el agente termine.`);
      return `📥 Tu mensaje ha sido encolado (#${pendingCount}). Se procesará cuando termine la tarea actual.`;
    }

    this.isRunning = true;
    this.iterationCount = 0;

    // ── Task Tracking Initialization ──────────────────────────────────────
    this._taskStartTime = Date.now();
    this._toolCallCount = 0;
    this._modifiedFiles = new Set();
    this._activityLog = [];

    // ── Emergency Escalation Reset ───────────────────────────────────────
    this._resetDiffCounter();
    this._resetProgressTracking();

    // ── Start Live Heartbeat Timer (Fix 1) ───────────────────────────────
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = setInterval(() => {
      const elapsed = ((Date.now() - this._taskStartTime) / 1000).toFixed(1);
      this.emit("heartbeat", {
        elapsed: parseFloat(elapsed),
        toolCallCount: this._toolCallCount,
        iterationCount: this.iterationCount,
      });
    }, this._heartbeatIntervalMs);

    // ── CHECKPOINT: Start of agent iteration ─────────────────────────────
    try {
      saveRooState({
        status: "processing",
        currentTask: this.workflowActive || "general",
        currentMode: this.modeController ? this.modeController.currentMode : "orchestrator",
        lastUserMessage: userInput.substring(0, 500),
        lastAssistantAction: "Starting agent loop",
        planFilePath: CONFIG.planFile,
        recentMessages: this.messages.slice(-5).map(m => ({
          role: m.role,
          content: (m.content || "").substring(0, 200),
          timestamp: new Date().toISOString(),
        })),
      });
    } catch (_) {
      // Non-critical; ignore checkpoint errors
    }

    // ── Forced Model Support (/model cheap | /model pro) ────────────────────
    // If the user includes "/model " in their input, override the active model.
    if (userInput.includes("/model ")) {
      const modelMatch = userInput.match(/\/model\s+(cheap|reasoner|flash|pro)/i);
      if (modelMatch) {
        const requested = modelMatch[1].toLowerCase();
        this._forcedModel = requested === "cheap" || requested === "flash"
          ? (process.env.DEEPSEEK_MODEL_CHEAP || "deepseek-v4-flash")
          : (process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro");
        this.llm.setModel(this._forcedModel);
        this._currentProvider = "deepseek";
        this._currentTier = requested === "cheap" || requested === "flash" ? "cheap" : "reasoner";
        this.emit("log", `   🧠 Modelo forzado: ${this._forcedModel}`);
        userInput = userInput.replace(/\/model\s+\S+/i, "").trim();
      }
    }

    this.emit("log", "   🔍 Analizando comando...");

    // ── Workflow Command Detection ──────────────────────────────────────────
    let processedInput = userInput;
    const workflowIntent = detectIntent(userInput);

    // Track current step for workflow progress UI
    let workflowCurrentStep = 0;
    let workflowTotalSteps = 0;
    let workflowStepNames = [];

    if (workflowIntent.type === "command") {
      const instructions = await getWorkflowInstructions(workflowIntent.command);
      if (instructions) {
        // Strip slash command prefix if present (for explicit /cmd usage)
        const cmdPattern = new RegExp(`^${workflowIntent.command}\\s*`);
        processedInput = userInput.replace(cmdPattern, "").trim();
        if (!processedInput) {
          processedInput = `Ejecuta el workflow ${workflowIntent.command}: ${workflowIntent.workflow.description}`;
        }

        const wfMsg = { role: "system", content: instructions };
        this.messages.push(wfMsg);
        this.cacheLoop.log.append(wfMsg);

        this.workflowActive = workflowIntent.command;

        // Parse workflow steps for progress UI
        const steps = await parseWorkflowSteps(workflowIntent.command);
        if (steps && steps.length > 0) {
          workflowTotalSteps = steps.length;
          workflowStepNames = steps.map((s) => s.name);
          workflowCurrentStep = 0;
        }

        // Log activation (silent for auto-detected, visible for slash commands)
        const isAutoDetected = workflowIntent.confidence !== undefined && workflowIntent.confidence < 1.0;
        const logMsg = isAutoDetected
          ? `   🤖 Intención detectada: ${workflowIntent.workflow.description}`
          : `   📋 Workflow activado: ${workflowIntent.command} (${workflowIntent.workflow.description})`;
        this.emit("log", logMsg);

        // Emit workflow_start with step info for UI progress bar
        this.emit("workflow_start", {
          command: workflowIntent.command,
          description: workflowIntent.workflow.description,
          input: processedInput,
          totalSteps: workflowTotalSteps,
          steps: workflowStepNames,
          autoDetected: isAutoDetected,
        });

        // Emit first step immediately so UI shows [Paso 1/N: Title]
        if (workflowTotalSteps > 0) {
          this.emit("workflow_step", {
            command: workflowIntent.command,
            currentStep: 1,
            totalSteps: workflowTotalSteps,
            stepName: workflowStepNames[0] || workflowIntent.workflow.description,
          });
        }
      }
    } else if (workflowIntent.type === "suggestion") {
      this.emit("workflow_suggest", {
        command: workflowIntent.command,
        description: workflowIntent.workflow.description,
        confidence: workflowIntent.confidence,
      });
    }

    // ── DISCOVERY PHASE: Detectar prompts vagos (Nivel Cero) ──────────
    // Si el usuario da un prompt vago, activar la entrevista del Discovery Agent
    // para acotar el alcance antes de codificar.
    try {
      const { DiscoveryAgent } = await import(
        `file://${path.resolve(__dirname, "..", "workflows", "discovery", "discovery_agent.js").replace(/\\/g, "/")}?t=${Date.now()}`
      );
      if (DiscoveryAgent.needsDiscovery(processedInput) && !this._discoveryDone && !this._pendingDiscovery) {
        this._discoveryDone = true;
        this._pendingDiscovery = true;
        const da = new DiscoveryAgent({ logger: this });
        const firstQuestion = da.start();
        global.__discoveryAgent = da;

        this.emit("log", "   🎓 Prompt vago detectado — iniciando Discovery Phase...");
        this.emit("discovery:start", firstQuestion);

        const optionsText = firstQuestion.options
          .map((o, i) => `${i + 1}. ${o.text}`)
          .join("\n");

        this.emit("response",
          `🎓 **¡Excelente idea!** Voy a hacerte algunas preguntas para entender mejor tu proyecto.\n\n` +
          `**${firstQuestion.question}**\n\n` +
          `${optionsText}\n\n` +
          `*Responde con el número de tu opción o escríbeme tu respuesta.*`
        );

        this.isRunning = false;
        this._clearHeartbeat();
        return `⏸ Discovery phase started — waiting for your answers.`;
      }
    } catch (err) {
      this.emit("log", `   ⚠️ Discovery Agent: ${err.message}`);
    }

    // Reset scratch for a new turn
    this.cacheLoop.newTurn();

    // ── PROMPT SECURITY: Sanitize user input and detect injection ──────
    const { sanitized, detection } = this._security.preProcess(processedInput);

    if (detection.isInjection) {
      this.emit("log", `   ⚠️ Posible inyección de prompt detectada (confianza: ${(detection.confidence * 100).toFixed(0)}%)`);
      this.emit("log", `   🔍 Patrones: ${detection.matchedPatterns.join(", ")}`);
      // Log the warning but continue with sanitized input
    }

    // Use sanitized input for the conversation
    const safeInput = sanitized;

    // ── SWARM ARCHITECTURE: Detectar tareas paralelizables ─────────────
    // Automatically detect if the user's request can be split into
    // multiple background agents that work in parallel.
    try {
      const analysis = TaskAnalyzer.analyze(processedInput);
      if (analysis.canParallelize && analysis.tasks.length >= 2) {
        this._swarmActive = true;
        this.emit("log", `   🐝 Swarm: ${analysis.reason}`);

        // Emit swarm start event for UI
        this.emit("swarm:start", {
          reason: analysis.reason,
          taskCount: analysis.tasks.length,
          tasks: analysis.tasks.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            dependsOn: t.dependsOn,
          })),
        });

        // Add each task to the worker pool
        for (const task of analysis.tasks) {
          this.workerPool.addTask(task);
        }

        // Wire worker pool events to orchestrator events (for UI)
        this._wireSwarmEvents();

        // Respond to user
        const taskList = analysis.tasks
          .map((t, i) => `  ${i + 1}. ${t.name}: ${t.description}`)
          .join("\n");

        const response = `🐝 **¡Claro!** Dividí tu solicitud en ${analysis.tasks.length} tareas que trabajaré en paralelo:\n\n${taskList}\n\nPuedes seguir escribiendo mientras los agentes trabajan en segundo plano. Te avisaré cuando terminen.`;

        this.emit("response", response);
        this.messages.push({ role: "user", content: safeInput });
        this.cacheLoop.addUserMessage(safeInput);
        trackMessage({ role: "user", content: safeInput });
        this.messages.push({ role: "assistant", content: response });

        // Don't enter the normal agent loop — the swarm handles it
        this.isRunning = false;
        return response;
      }
    } catch (err) {
      this.emit("log", `   ⚠️ Swarm analysis: ${err.message}`);
    }

    // Add user message to history (via cache loop for prefix stability)
    this.messages.push({ role: "user", content: safeInput });
    this.cacheLoop.addUserMessage(safeInput);
    trackMessage({ role: "user", content: safeInput });

    const currentModeSlug = this.modeController ? this.modeController.currentMode : "orchestrator";
    this._fallbackAttempted = false;

    // ── Resolve DeepSeek-specific stream options (thinking mode, effort, etc.) ──
    this._streamOptions = this._resolveStreamOptions(currentModeSlug);

    this.emit("log", "   🔍 Detectando modo óptimo...");

    // ── MODE AUTO-DETECTION: Detectar modo sugerido del input ──────────
    try {
      if (this.modeController) {
        const detection = this.modeController.detectFromInput(processedInput);
        if (detection.shouldSuggest && detection.mode) {
          const modeConfig = (await import("../modes/mode_registry.js")).getMode(detection.mode);
          this.emit("mode_suggestion", {
            from: currentModeSlug,
            to: detection.mode,
            confidence: detection.confidence,
            icon: modeConfig ? modeConfig.icon : "🔧",
            name: modeConfig ? modeConfig.name : detection.mode,
            matchedKeywords: detection.matchedKeywords,
          });
          this.emit("log", `   🤖 Modo sugerido: ${modeConfig ? modeConfig.icon + " " : ""}${detection.mode} (confianza: ${Math.round(detection.confidence * 100)}%)`);

          // ── Always PAUSE and ask for approval when a different mode is suggested ──
          // Store the input for replay after user approves the switch
          // NOTE: isRunning is NOT set to false here — stays locked to prevent race conditions.
          // acceptModeSuggestion() will temporarily release it before calling agentLoop().
          this._pendingModeInput = processedInput;
          this._pendingModeSlug = detection.mode;
          // Clear the heartbeat that was started — it will be restarted when agentLoop runs again after approval
          this._clearHeartbeat();
          this.emit("log", `   ⏸  Esperando aprobación del usuario para cambiar a ${detection.mode}...`);
          this.emit("response", `⏸  Esta tarea requiere el modo **${modeConfig ? modeConfig.icon + " " : ""}${detection.mode}**. Se ha mostrado una sugerencia en la interfaz. Aprueba el cambio para continuar.`);
          return `⏸  Pending mode switch to ${detection.mode} — waiting for user approval.`;
        }
      }
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.VALIDATION_ERROR, context: { phase: "mode_detection" }, recoverable: true });
      this.emit("log", `   ⚠️ Mode detection: ${lvErr.message}`);
    }

    const tools = this.skillsToTools();

    try {
      while (this.iterationCount < CONFIG.maxToolIterations) {
        // ── Check if abort was requested (stop button) ──────────────
        if (this._abortRequested) {
          this.emit("log", "   🛑 Agent aborted by user.");
          this.emit("response", "🛑 Agent aborted by user.");
          this.isRunning = false;
          this._clearHeartbeat();
          this._abortRequested = false;
          this._drainPendingMessages();
          return "🛑 Agent aborted by user.";
        }

        this.iterationCount++;

        this.emit("step", {
          iteration: this.iterationCount,
          total: CONFIG.maxToolIterations,
        });

        this.emit("log", "   🧠 Verificando memoria y contexto...");

        // ── AUTO-MEMORIA: Checkpoint en Supabase (si aplica) ─────────────
        // needsSummaryWithCheckpoint verifica umbrales tempranos
        // y guarda en Supabase antes de que ocurra la compactación local.
        // Los umbrales de Supabase (30 msgs, 18K chars) son más tempranos
        // que los de compactación local (50 msgs, 32K chars).
        const summaryCheck = await needsSummaryWithCheckpoint(this.messages);
        if (summaryCheck.checkpointSaved) {
          this.emit("memory_checkpoint", {
            reason: summaryCheck.reason || "umbral de contexto",
            messagesCount: this.messages.length,
          });
        }
        
        if (summaryCheck.needsSummary) {
          // Compact via cache loop (preserves prefix, trims from front)
          const before = this.messages.length;
          const { removed } = this.cacheLoop.trimLog(4000000, 50);
          // Also compact legacy messages array for backward compat
          this.messages = compactHistory(this.messages);
          const after = this.messages.length;
          this.emit("summary", {
            summary: `Contexto compactado: ${before} → ${after} mensajes. Razón: ${summaryCheck.reason}.`,
            before,
            after,
            reason: summaryCheck.reason,
            cacheTrimmed: removed,
          });
          await saveSession();
        }

        // ── GARBAGE COLLECTOR (4K token threshold) ─────────────────────
        // For light conversations without heavy tool calls, trim history
        // to stay under ~4K tokens using Gemini summarization or local fallback.
        // Tool-call intensive loops use compactHistory() triggered by
        // needsSummaryWithCheckpoint above (higher thresholds).
        if (this.iterationCount > 0 && this.iterationCount % 5 === 0) {
          try {
            const before = this.messages.length;
            this.messages = await garbageCollectHistory(this.messages, this.llm);
            if (this.messages.length < before) {
              this.emit("log", `   🧹 GC: ${before} → ${this.messages.length} mensajes (umbral 4K tokens)`);
            }
          } catch (_) {
            // GC is non-critical — continue with current messages
          }
        }

        // ── CHECKPOINT POR ITERACIONES (independiente de mensajes de chat) ──
        // Fire-and-forget: schedule checkpoint asynchronously so it does NOT
        // block the agent's hot loop. If a checkpoint is already in progress
        // (this._checkpointBusy), skip to avoid pile-up.
        if (this.iterationCount > 0 && this.iterationCount % 3 === 0 && !this._checkpointBusy) {
          this._checkpointBusy = true;
          setImmediate(async () => {
            try {
              if (this._autoMemoria && this._autoMemoria.guardarCheckpoint) {
                const lastMsgs = this.messages.slice(-5).map(m =>
                  `${m.role}: ${String(m.content || '').substring(0, 200)}`
                ).join('\n');
                await this._autoMemoria.guardarCheckpoint({
                  topic: `checkpoint:iteracion_${this.iterationCount}`,
                  content: `[Checkpoint por iteración #${this.iterationCount}]\nMensajes totales: ${this.messages.length}\nIteraciones del agente: ${this.iterationCount}\n\nÚltimos mensajes:\n${lastMsgs.substring(0, 2000)}`,
                  source: 'iteration_checkpoint',
                });
                this.emit("log", `   [checkpoint] iteracion #${this.iterationCount}`);
              }
            } catch (err) {
              this.emit("log", `   [checkpoint] error en iteracion #${this.iterationCount}: ${err.message}`);
            } finally {
              this._checkpointBusy = false;
            }
          });
        }

        // ── GRAPHIFY PERIODIC UPDATE (cada N iteraciones) ──────────────
        // After every _graphifyUpdateInterval iterations, trigger a graphify
        // rebuild so the project map stays current with code changes.
        if (
          this.projectPath &&
          this.iterationCount > 0 &&
          this.iterationCount % this._graphifyUpdateInterval === 0 &&
          this.iterationCount > this._lastGraphifyIteration
        ) {
          // Fire-and-forget: don't block the agent loop
          setImmediate(async () => {
            try {
              await this.triggerGraphifyBuild(this.projectPath);
            } catch (err) {
              this.emit("log", `   ⚠️ Graphify periódico: ${err.message}`);
            }
          });
        }

        // ── Build messages from cache loop ──────────────────────────────
        const cacheMessages = this.cacheLoop.buildMessages();

        // ── CRITICAL: Validate the ACTUAL messages being sent to the API ──
        this.validateMessages(cacheMessages);

        // ── LOGICAL LOOP DETECTION ─────────────────────────────────────
        // Check if the agent is repeating the same tool calls without
        // progress — if so, flag for emergency escalation.
        if (this.iterationCount > 3 && this._detectLogicalLoop(this.messages)) {
          this.emit("log", "   🔄 Bucle lógico detectado — se forzará escalada de emergencia");
          this._emergencyEscalationNeeded = true;
        }

        // ── Declare accumulator variables at the OUTER scope ────────────
        // These are used both by emergency escalation (below) and the normal
        // streaming block. Without hoisting them here, the emergency path
        // triggers "fullReasoning is not defined" (ReferenceError) because
        // the let declarations inside the normal block below are in a
        // different lexical scope.
        let fullContent = "";
        let fullReasoning = "";
        let streamedToolCalls = {};
        let lastReasoningEmit = "";
        let lastContentEmit = "";
        const REASONING_EMIT_THRESHOLD = 1;  // chars between reasoning emits (1 = letter-by-letter)
        const CONTENT_EMIT_THRESHOLD = 1;    // chars between content emits for true real-time feel

        // ── EMERGENCY ESCALATION TRIGGER ───────────────────────────────
        // If the user rejected 2+ diffs OR a logical loop was detected,
        // skip the normal Flash stream and go directly to emergency protocol.
        if (this._emergencyEscalationNeeded && this.iterationCount > 1) {
          this.emit("log", "   🚨 Activando destilación de emergencia antes de la llamada API...");
          const emergencyResult = await this._emergencyDistill(
            cacheMessages, tools,
            this._consecutiveDiffRejections >= 2
              ? `${this._consecutiveDiffRejections} diffs rechazados consecutivos`
              : "Bucle lógico detectado"
          );
          if (emergencyResult.success) {
            fullContent = emergencyResult.fullContent || "";
            fullReasoning = emergencyResult.fullReasoning || "";
            streamedToolCalls = emergencyResult.streamedToolCalls || {};
            // Reset emergency flags after successful escalation
            this._emergencyEscalationNeeded = false;
            this._resetDiffCounter();
            this._resetProgressTracking();
            // Skip the normal try/catch streaming block below
            // Fall through to post-stream processing after this if-block
          } else {
            this.isRunning = false;
            this.emit("error", { type: "escalation", message: "La destilación de emergencia falló. Todos los modelos agotados." });
            return "❌ Destilación de emergencia fallida. Revisa las credenciales de Gemini y DeepSeek Pro.";
          }
        }

        // Only enter the normal API streaming block if emergency didn't run
        if (!this._emergencyEscalationNeeded || this.iterationCount <= 1) {
        // ── Select optimal model for this task (3-tier: free/cheap/reasoner) ──
        const selectedModel = this.selectOptimalModel(userInput, currentModeSlug || "orchestrator");
        if (this.llm._currentModel !== selectedModel) {
          this.llm.setModel(selectedModel);
        }

        // ── Call LLM API (STREAMING) ─────────────────────────────────────
        // Stream the response to extract reasoning_content in real-time
        // and emit it to the UI as a collapsible <details> block.
        // Also emit content_chunk events for token-by-token text streaming.

        // ── Rate Limiting Check ───────────────────────────────────
        // Before making the API call, check the rate limiter.
        // If rate limited, wait with exponential backoff and retry.
        let rateLimitRetries = 0;
        const MAX_RATE_LIMIT_RETRIES = 5;
        while (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          const allowed = await this.rateLimiter.consume('api', 1);
          if (allowed) {
            break;
          }
          rateLimitRetries++;
          const backoffMs = Math.min(1000 * Math.pow(2, rateLimitRetries - 1), 16000);
          this.emit('log', `   ⏳ Rate limited, waiting ${backoffMs}ms (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})...`);
          await new Promise(r => setTimeout(r, backoffMs));
        }
        if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
          this.emit('log', '   ⏳ Max rate limit retries reached, proceeding anyway...');
        }

        // ── Create AbortController for this stream ────────────────
        // Stored on `this._abortController` so abortAgent() can cancel
        // the in-flight HTTP request immediately via controller.abort().
        this._abortController = new AbortController();

        try {
          const stream = this.llm.stream(cacheMessages, {
            tools: tools.length > 0 ? tools : undefined,
            signal: this._abortController.signal,
            ...this._streamOptions,
          });

            const streamState = await this._processLLMStream(stream, {
              fullContent, fullReasoning, streamedToolCalls,
              lastReasoningEmit, lastContentEmit,
              abortLabel: "aborted by user (partial response captured)",
            });
            fullContent = streamState.fullContent;
            fullReasoning = streamState.fullReasoning;
            streamedToolCalls = streamState.streamedToolCalls;
            lastReasoningEmit = streamState.lastReasoningEmit;
            lastContentEmit = streamState.lastContentEmit;
            // Keep _abortController alive so abortAgent() can signal it
            // during post-stream processing (tool repair, execution, etc.).
            // It will be replaced when the next stream creates a new controller
            // or cleaned up by abortAgent().
          } catch (apiErr) {
            // Keep _abortController alive for the same reason — don't null it
            // until the next stream replaces it or abortAgent() cleans it up.

            const lvErr = toLvError(apiErr, { code: ErrorCodes.API_ERROR, context: { iteration: this.iterationCount }, recoverable: true });
            this.emit("error", lvErr.toJSON());

            // ── 🔄 RETRY WITH EXPONENTIAL BACKOFF ─────────────────────
            // Transient network errors, rate limits, or timeouts should not
            // kill a multi-step task. Retry up to MAX_RETRIES times with
            // 1s → 2s → 4s backoff before escalating via fallback chain.
            // CircuitBreaker fast-fail errors (OPEN state) are non-retriable.
            const apiErrMsg = (apiErr?.message || "").toLowerCase();
            const isCircuitOpen = apiErrMsg.includes("circuito abierto") || apiErrMsg.includes("circuit is open");
            const MAX_RETRIES = 4;
            let retryCount = 0;

            // ── Abort check: skip retries if user requested stop ────
            if (this._abortRequested) {
              this.emit("log", "   🛑 Streaming aborted by user (skipping retries).");
            } else if (!isCircuitOpen) {
              for (retryCount = 1; retryCount <= MAX_RETRIES; retryCount++) {
                // Check abort before each retry attempt
                if (this._abortRequested) {
                  this.emit("log", "   🛑 Agent aborted during retry delay.");
                  break;
                }

                const delayMs = Math.min(1000 * Math.pow(2, retryCount - 1), 4000); // 1s → 2s → 4s
                this.emit("log", `   🔄 Error de API, reintentando en ${delayMs / 1000}s (intento ${retryCount}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, delayMs));

                // Check abort again after delay
                if (this._abortRequested) {
                  this.emit("log", "   🛑 Agent aborted before retry stream.");
                  break;
                }

                // Create new AbortController for retry stream
                this._abortController = new AbortController();
                try {
                  const retryStream = this.llm.stream(cacheMessages, {
                    tools: tools.length > 0 ? tools : undefined,
                    signal: this._abortController.signal,
                    ...this._streamOptions,
                  });

                  // Re-initialize stream state for retry
                  fullContent = "";
                  fullReasoning = "";
                  streamedToolCalls = {};
                  lastReasoningEmit = "";
                  lastContentEmit = "";

                  const retryResult = await this._processLLMStream(retryStream, {
                    fullContent, fullReasoning, streamedToolCalls,
                    lastReasoningEmit, lastContentEmit,
                    abortLabel: "aborted by user during retry",
                  });
                  fullContent = retryResult.fullContent;
                  fullReasoning = retryResult.fullReasoning;
                  streamedToolCalls = retryResult.streamedToolCalls;
                  lastReasoningEmit = retryResult.lastReasoningEmit;
                  lastContentEmit = retryResult.lastContentEmit;

                  // Retry succeeded — break out of retry loop
                  this.emit("log", `   ✅ Reintento ${retryCount} exitoso`);
                  // Reset circuit breaker so the next request isn't
                  // blocked by stale failure count from before the retry.
                  if (typeof this.llm.resetCircuitBreaker === "function") {
                    this.llm.resetCircuitBreaker();
                  }
                  this._abortController = null;
                  break;
                } catch (retryErr) {
                  const isLastRetry = retryCount === MAX_RETRIES;
                  if (isLastRetry) {
                    // ── 🔄 FALLBACK CHAIN: Try next provider tier ────────────
                    // After all retries fail, attempt fallback before giving up.
                    if (!this._fallbackAttempted && this.llm) {
                      const fallbackResult = await this._executeFallbackChain(cacheMessages, tools);
                      if (fallbackResult.success) {
                        fullContent = fallbackResult.fullContent;
                        fullReasoning = fallbackResult.fullReasoning;
                        streamedToolCalls = fallbackResult.streamedToolCalls;
                        // Reset fallback flag for next API calls
                        this._fallbackAttempted = false;
                        this.emit("log", "   ✅ Fallback exitoso, continuando procesamiento...");
                        // Break out of retry loop — fall through to post-stream processing
                        this._abortController = null;
                        break;
                      }
                    }
                    this._abortController = null;
                    this.emit("error", toLvError(retryErr, { code: ErrorCodes.API_ERROR, context: { iteration: this.iterationCount, retries: retryCount }, recoverable: true }).toJSON());
                    this.isRunning = false;
                    return `Error en llamada a la API tras ${MAX_RETRIES} reintentos: ${retryErr.message}`;
                  }
                  // Otherwise, loop continues to next retry
                }
              }
              // If retry succeeded, the `break` above exited; fall through to post-stream processing
            } else {
              // Circuit is OPEN — try fallback before giving up
              if (!this._fallbackAttempted && this.llm) {
                const fallbackResult = await this._executeFallbackChain(cacheMessages, tools);
                if (fallbackResult.success) {
                  fullContent = fallbackResult.fullContent;
                  fullReasoning = fallbackResult.fullReasoning;
                  streamedToolCalls = fallbackResult.streamedToolCalls;
                  this._fallbackAttempted = false;
                  this.emit("log", "   ✅ Fallback exitoso (circuito abierto), continuando...");
                  // Fall through to post-stream processing
                } else {
                  this.isRunning = false;
                  return `Error: ${apiErr.message}`;
                }
              } else {
                this.isRunning = false;
                return `Error: ${apiErr.message}`;
              }
            }
          }
        } // Close the emergency if-block opened before selectOptimalModel

        // ── Emergency escalation jump: if emergency produced a result,
        //     skip the abort checks and go straight to post-stream processing.
        if (this._emergencyEscalationNeeded === false && this.iterationCount > 1 &&
            (fullContent || fullReasoning || Object.keys(streamedToolCalls).length > 0)) {
          // Emergency just ran and produced output — skip abort checks
          this.emit("log", "   ⏭  Saltando chequeos post-stream (resultado de emergencia)");
        } else {
        // ── Abort check after streaming (normal flow only) ──────────
        // If the user clicked stop during streaming, abort immediately
        // and skip all post-stream processing (tool repair, execution).
        if (this._abortRequested) {
          this.emit("log", "   🛑 Agent aborted by user.");
          this.emit("response", "🛑 Agent aborted by user.");
          this.isRunning = false;
          this._clearHeartbeat();
          this._abortRequested = false;
          this._drainPendingMessages();
          return "🛑 Agent aborted by user.";
        }

        // ── Abort check: post-stream processing entry ─────────────────
        // If user clicked stop right after streaming ended (during the brief
        // window between the check above and here), abort via break to let
        // the while-loop cleanup handle it gracefully.
        if (this._abortRequested) {
          this.emit("log", "   🛑 Agent aborted after stream end");
          const abortActivityEntry = {
            timestamp: new Date().toISOString(),
            type: "abort",
            detail: "User requested stop — aborting after stream"
          };
          saveRooState({ recentActivity: [abortActivityEntry] });
          this.emit("workflow_end", { reason: "aborted", message: "🛑 Stopped by user" });
          break;
        }
        } // Close else block wrapping abort checks (normal flow only)

        // ── Fallback: extract <think> blocks from content ───────────────
        // Some models (e.g., deepseek-chat) embed reasoning inside
        // <think>...</think> tags in the content rather than using the
        // dedicated reasoning_content field. Extract it here as a fallback
        // and strip the tags from the final content.
        if (!fullReasoning && fullContent) {
          const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
          const thinkMatch = thinkRegex.exec(fullContent);
          if (thinkMatch) {
            fullReasoning = thinkMatch[1].trim();
            // Remove the <think> block from content
            fullContent = fullContent.replace(thinkRegex, "").trim();
            // Emit the extracted reasoning
            this.emit("reasoning", {
              text: fullReasoning,
              delta: fullReasoning,
              complete: true,
            });
            this.emit("log", `   💭 Razonamiento extraído de bloque <think> (${fullReasoning.length} caracteres)`);
          }
        }

        // ── Signal content streaming complete ────────────────────────────
        // Emit one final content_chunk with complete=true so the renderer
        // can do the final markdown render.
        if (fullContent) {
          this.emit("content_chunk", {
            text: fullContent,
            delta: fullContent.slice(lastContentEmit.length),
            complete: true,
          });
          lastContentEmit = fullContent;
        }

        // ── Signal reasoning phase complete ──────────────────────────────
        if (fullReasoning && fullReasoning !== lastReasoningEmit) {
          this.emit("reasoning", {
            text: fullReasoning,
            delta: fullReasoning.slice(lastReasoningEmit.length),
            complete: true,
          });
          lastReasoningEmit = fullReasoning;
        } else if (fullReasoning && !lastReasoningEmit) {
          this.emit("reasoning", {
            text: fullReasoning,
            delta: "",
            complete: true,
          });
          lastReasoningEmit = fullReasoning;
        }

        // ── Reconstruct assistant message from stream data ───────────────
        const toolCallsArray = Object.values(streamedToolCalls);
        const assistantMessage = {
          role: "assistant",
          content: fullContent || null,
          reasoning_content: fullReasoning || null,
        };
        if (toolCallsArray.length > 0) {
          assistantMessage.tool_calls = toolCallsArray;
        }

        // ── Tool-Call Repair (4-pass Reasonix pipeline) ──────────────────
        const reasoning = fullReasoning ||
                          (assistantMessage.content?.includes("<think>") ? assistantMessage.content : null);
        if (reasoning) {
          this.emit("log", "   🔧 Ejecutando pipeline de reparación de tool calls...");
        }

        // ── Abort check before tool-call repair ────────────────────
        // The 4-pass Reasonix pipeline is expensive; don't run it if
        // the user stopped during streaming or early post-stream processing.
        if (this._abortRequested) {
          this.emit("log", "   🛑 Agent aborted before tool call repair");
          break;
        }

        const repairedMsg = this.toolRepair.repair(assistantMessage, tools);

        const repairStats = this.toolRepair.getStats();
        if (repairStats.scavenged > 0) {
          this.emit("log", `   🔍 Recuperadas ${repairStats.scavenged} tool call(s) del razonamiento`);
        }
        if (repairStats.truncated > 0) {
          this.emit("log", `   🔧 Reparadas ${repairStats.truncated} tool call(s) truncadas`);
        }
        if (repairStats.suppressed > 0) {
          this.emit("log", `   ⛈️  Suprimidas ${repairStats.suppressed} tool call(s) duplicadas (storm)`);
        }

        this.messages.push(repairedMsg);

        // ── ACTIVITY CASCADE: Track LLM response ─────────────────────────
        const llmActivityEntry = {
          type: "llm_response",
          toolCalls: repairedMsg.tool_calls?.length || 0,
          contentLength: (repairedMsg.content || "").length,
          reasoningLength: (repairedMsg.reasoning_content || "").length,
          timestamp: Date.now(),
          iteration: this.iterationCount,
        };
        this._activityLog.push(llmActivityEntry);
        this.emit("activity", llmActivityEntry);

        // ── Re-nest flattened args before execution ─────────────────────
        if (repairedMsg.tool_calls) {
          for (const tc of repairedMsg.tool_calls) {
            if (tc.function?.arguments && typeof tc.function.arguments === "string") {
              try {
                const parsed = JSON.parse(tc.function.arguments);
                const hasDotKeys = Object.keys(parsed).some((k) => k.includes("."));
                if (hasDotKeys) {
                  tc.function.arguments = JSON.stringify(nestArguments(parsed));
                }
              } catch {
                // Use as-is
              }
            }
          }
        }

        trackMessage(repairedMsg);

        // ── 7.3 — Auto-save checkpoint every N messages ─────────────────
        // Save conversation state to _roo/sessions/auto/ every 5 messages
        if (this.messages.length > 0 && this.messages.length % 5 === 0) {
          try {
            const savedPath = saveAutoCheckpoint();
            if (savedPath) {
              this.emit("log", `   💾 Auto-checkpoint guardado (${this.messages.length} mensajes)`);
            }
          } catch (_) {
            // Non-critical; ignore checkpoint errors
          }
        }

        // Extract and emit thought if present
        if (repairedMsg.content) {
          const thoughtMatch = repairedMsg.content.match(/\[THOUGHT\]([^]*?)(?:\n\n|$)/);
          if (thoughtMatch) {
            this.emit("thought", thoughtMatch[1].trim());
          }
        }

        // ── Workflow Step Progress Tracking ──────────────────────────────
        // Detect "## Paso N:" or "## Step N:" markers in agent response
        // to update the UI progress bar in real-time.
        if (this.workflowActive && workflowTotalSteps > 0 && repairedMsg.content) {
          // Match structured step markers like:
          //   ## Paso 1: Title    (standard markdown heading)
          //   ### Paso 1: Title   (any heading level)
          //   **Paso 1:** Title   (bold)
          //   Paso 1: Title       (plain text, at line start)
          //   Step 1: Title       (English)
          //   [Paso 1] Title      (brackets)
          const stepMatch = repairedMsg.content.match(/^#{1,4}\s*(?:Paso|Step)\s*(\d+)\s*[.:]?\s*(.*)/mi)
            || repairedMsg.content.match(/^\*\*(?:Paso|Step)\s*(\d+)\s*[.:]?\s*\*\*(.*)/i)
            || repairedMsg.content.match(/^\[(?:Paso|Step)\s*(\d+)\s*[.\]:]+\s*(.*)/i)
            || repairedMsg.content.match(/^(?:Paso|Step)\s*(\d+)\s*[.:]\s*(.*)/mi);
          if (stepMatch) {
            const detectedStep = parseInt(stepMatch[1], 10);
            if (detectedStep > 0 && detectedStep <= workflowTotalSteps && detectedStep !== workflowCurrentStep) {
              workflowCurrentStep = detectedStep;
              this.emit("workflow_step", {
                command: this.workflowActive,
                currentStep: workflowCurrentStep,
                totalSteps: workflowTotalSteps,
                stepName: workflowStepNames[workflowCurrentStep - 1] || stepMatch[2].trim(),
              });
              this.emit("log", `   📊 Paso ${workflowCurrentStep}/${workflowTotalSteps}: ${workflowStepNames[workflowCurrentStep - 1] || stepMatch[2].trim()}`);
            }
          }
        }

        // ── Abort check before tool execution ──────────────────────
        // If the user clicked stop during post-stream processing
        // (tool repair, message reconstruction), abort before
        // executing any tools.
        if (this._abortRequested) {
          this.emit("log", "   🛑 Agent aborted by user.");
          this.emit("response", "🛑 Agent aborted by user.");
          this.isRunning = false;
          this._abortRequested = false;
          return "🛑 Agent aborted by user.";
        }

        // Handle tool calls
        if (repairedMsg.tool_calls && repairedMsg.tool_calls.length > 0) {
          const totalTools = repairedMsg.tool_calls.length;

          this.emit("log", `   🔧 ${totalTools} tool call(s) solicitadas`);

          this.cacheLoop.addAssistantMessage(
            repairedMsg.content ?? null,
            repairedMsg.tool_calls,
            repairedMsg.reasoning_content
          );

          // ── Abort check before tool execution ────────────────────
          // If the user stopped during post-stream processing, don't
          // execute tools at all — emit synthetic result and break.
          if (this._abortRequested) {
            this.emit("log", "   🛑 Agent aborted before tool execution");
            const syntheticResult = {
              name: repairedMsg.tool_calls[0]?.function?.name || "unknown",
              result: "🛑 Agent was stopped by user before this tool could execute.",
              isError: true
            };
            this.emit("workflow_end", { reason: "aborted", message: "🛑 Stopped by user" });
            break;
          }

          // ── 🔒 CRASH-SAFE: allSettled prevents cascading failures ─────
          // If one tool times out (via Promise.race in executeToolCall), it
          // rejects individually without cancelling the other in-flight tools.
          // Promise.allSettled ensures all tools complete (or fail) independently.
          const settledResults = await Promise.allSettled(
            repairedMsg.tool_calls.map((tc, i) =>
              this.executeToolCall(tc, i + 1, totalTools)
            )
          );

          for (const settled of settledResults) {
            if (settled.status === "fulfilled") {
              const result = settled.value;

              // ── PROMPT SECURITY: Sanitize tool result content ──────────
              if (result && result.content && typeof result.content === "string") {
                result.content = this._security.postProcess(result.content);
              }

              this.messages.push(result);
              if (result.tool_call_id) {
                this.cacheLoop.addToolResult(result.tool_call_id, result.content);
              }
            } else {
              // Tool call timed out or threw — generate a synthetic error result
              const errMsg = settled.reason?.message || "Unknown tool error";
              const syntheticResult = {
                role: "tool",
                tool_call_id: `timeout_${Date.now()}`,
                content: `Error: ${errMsg}`,
              };
              this.messages.push(syntheticResult);
              this.emit("log", `   ⚠️ Tool call failed (non-fatal): ${errMsg}`);
            }
          }

          // ── MODE SWITCH CHECK: Did the agent request a mode switch? ────
          if (this._pendingModeSwitch) {
            this._pendingModeSwitch = false;
            this.isRunning = false;
            this.emit("log", `   ⏸  Esperando aprobación del usuario para cambiar a ${this._pendingModeSlug}...`);
            this.emit("response", `⏸  El agente solicita cambiar al modo **${this._pendingModeSlug}**. Revisa la sugerencia en la interfaz para aprobar o rechazar.`);

            // ── MODE SWITCH TIMEOUT: Auto-resume after 60 seconds ─────────
            // Prevents the agent from getting stuck in "sleep mode" when the
            // user doesn't notice the approval request. After the timeout,
            // the pending switch is cleared and the agent can be restarted.
            this._modeSwitchTimer = setTimeout(() => {
              if (this._pendingModeSlug || this._pendingModeInput) {
                this.emit("log", `⏰ Tiempo de espera agotado para cambio de modo a ${this._pendingModeSlug}. Reanudando en modo actual.`);
                this._pendingModeSlug = null;
                this._pendingModeInput = null;
                this._pendingFromAgent = false;
                this._modeSwitchTimer = null;
              }
            }, 60000);

            return `⏸  Pending agent-initiated mode switch to ${this._pendingModeSlug} — waiting for user approval.`;
          }

          // ── FOLLOW-UP QUESTION CHECK: Pause if agent asked a question ──
          if (this._pendingAskQuestion) {
            this.emit("log", "   ⏳ Esperando respuesta del usuario...");
            this.isRunning = false;
            return "⏳ Esperando respuesta del usuario...";
          }

          await saveSession();

          // ── HEARTBEAT: After tool call batch ──────────────────────────
          try {
            saveRooState({
              status: "in_progress",
              currentMode: this.modeController ? this.modeController.currentMode : "orchestrator",
              lastAssistantAction: `Processed ${totalTools} tool result(s), iteration #${this.iterationCount}`,
            });
          } catch (_) {
            // Non-critical
          }

          // ── Early checkpoint (primeros mensajes significativos) ──────────
          if (!this._earlyCheckpointDone && this.messages.length >= 6) {
            this._earlyCheckpointDone = true;
            try {
              if (this._autoMemoria && this._autoMemoria.guardarCheckpoint) {
                const summary = this.messages.slice(-8).map(m =>
                  `${m.role}: ${String(m.content || '').substring(0, 300)}`
                ).join('\n');
                await this._autoMemoria.guardarCheckpoint({
                  topic: 'checkpoint:temprano',
                  content: `[Checkpoint temprano - Primeros mensajes significativos]\nMensajes totales: ${this.messages.length}\n\nResumen:\n${summary.substring(0, 2000)}`,
                  source: 'early_checkpoint',
                });
              }
            } catch (err) {
              const lvErr = toLvError(err, { code: ErrorCodes.STATE_ERROR, context: { phase: "early_checkpoint" }, recoverable: true });
              this.emit("log", `   ⚠️ Early checkpoint: ${lvErr.message}`);
            }
          }

          // ── Abort check before loop continue ──────────────────────
          // If user stopped during tool execution results processing,
          // break out of the while loop instead of continuing.
          if (this._abortRequested) {
            this.emit("workflow_end", { reason: "aborted", message: "🛑 Stopped by user" });
            break;
          }

          continue;
        }

        this.cacheLoop.addAssistantMessage(repairedMsg.content ?? null, null, repairedMsg.reasoning_content);

        const content = assistantMessage.content || "[sin respuesta de texto]";
  
        // ── AUTO-MEMORIA: Checkpoint al finalizar workflow ────────────────
        if (this.workflowActive) {
          // Emit final step as complete for UI progress bar
          if (workflowTotalSteps > 0) {
            this.emit("workflow_step", {
              command: this.workflowActive,
              currentStep: workflowTotalSteps,
              totalSteps: workflowTotalSteps,
              stepName: workflowStepNames[workflowTotalSteps - 1] || "Completado",
              completed: true,
            });
          }

          this.emit("workflow_end", {
            command: this.workflowActive,
            totalSteps: workflowTotalSteps,
            completedSteps: workflowCurrentStep || workflowTotalSteps,
          });
          this.workflowActive = null;
          
          // Guardar checkpoint del workflow completado
          try {
            if (this._autoMemoria && this._autoMemoria.guardarCheckpoint) {
              await this._autoMemoria.guardarCheckpoint({
                topic: `workflow:completado`,
                content: `Workflow completado. Última respuesta:\n${content.substring(0, 500)}`,
                source: 'fin_workflow',
              });
            }
          } catch (err) {
            const lvErr = toLvError(err, { code: ErrorCodes.STATE_ERROR, context: { phase: "workflow_checkpoint" }, recoverable: true });
            this.emit("log", `   ⚠️ Workflow checkpoint: ${lvErr.message}`);
          }
        }
  
        // ── TASK COMPLETE RECAP ───────────────────────────────────────────
        const duration = this._taskStartTime ? ((Date.now() - this._taskStartTime) / 1000).toFixed(1) : "?";
        const recap = {
          completed: true,
          reason: "done",
          durationSec: parseFloat(duration),
          toolCallCount: this._toolCallCount,
          iterationCount: this.iterationCount,
          modifiedFiles: [...this._modifiedFiles],
          activityLog: this._activityLog.slice(),
        };
        this.emit("task_complete", recap);
        this.emit("log", `✅ Tarea completada en ${duration}s · ${this._toolCallCount} tool calls · ${this.iterationCount} iteraciones · ${this._modifiedFiles.size} archivo(s) modificado(s)`);

        // ── CHECKPOINT: Response complete — clear RooState ──────────────
        try {
          clearRooState();
        } catch (_) {
          // Non-critical
        }

        this.emit("response", content);
        this.isRunning = false;
        this._clearHeartbeat();
        this._abortRequested = false;
        this._drainPendingMessages();
        return content;
      }

      // ── Safety net: ensure clean state after loop exit ───────────────
      if (!this._abortRequested && this.isRunning) {
        this.emit("log", "   ✅ Tarea completada.");
        // Emit empty response to signal renderer that agent is done
        // (stops the heartbeat timer, resets _isProcessing, shows send button)
        this.emit("response", "");
      }
      this.isRunning = false;
      this._clearHeartbeat();
      this._abortRequested = false;
      this._drainPendingMessages();

      // ── CHECKPOINT: Iteration limit reached ──────────────────────────
      try {
        clearRooState();
      } catch (_) {
        // Non-critical
      }

      const limitMsg = "⚠️ Límite de iteraciones de herramientas alcanzado.";
      
      // ── TASK COMPLETE RECAP (limit) ──────────────────────────────────────
      const limitDuration = this._taskStartTime ? ((Date.now() - this._taskStartTime) / 1000).toFixed(1) : "?";
      const limitRecap = {
        completed: false,
        reason: "iteration_limit",
        durationSec: parseFloat(limitDuration),
        toolCallCount: this._toolCallCount,
        iterationCount: this.iterationCount,
        modifiedFiles: [...this._modifiedFiles],
        activityLog: this._activityLog.slice(),
      };
      this.emit("task_complete", limitRecap);
      this.emit("log", `⚠️ Tarea interrumpida por límite de iteraciones · ${limitDuration}s · ${this._toolCallCount} tool calls`);

      this.emit("response", limitMsg);
      this.isRunning = false;
      this._clearHeartbeat();
      this._abortRequested = false;
      this._drainPendingMessages();
      return limitMsg;
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.UNEXPECTED, context: { iteration: this.iterationCount }, fatal: false, recoverable: true });
      this.emit("error", lvErr.toJSON());
      
      // ── TASK COMPLETE RECAP (error) ──────────────────────────────────────
      const errDuration = this._taskStartTime ? ((Date.now() - this._taskStartTime) / 1000).toFixed(1) : "?";
      const errRecap = {
        completed: false,
        reason: "unexpected_error",
        error: lvErr.message,
        durationSec: parseFloat(errDuration),
        toolCallCount: this._toolCallCount,
        iterationCount: this.iterationCount,
        modifiedFiles: [...this._modifiedFiles],
        activityLog: this._activityLog.slice(),
      };
      this.emit("task_complete", errRecap);
      this.emit("log", `❌ Error inesperado · ${errDuration}s · ${this._toolCallCount} tool calls · ${lvErr.message}`);

      this.isRunning = false;
      this._clearHeartbeat();
      this._abortRequested = false;
      this._drainPendingMessages();
      return `Error inesperado: ${lvErr.message}`;
    }
  }

  // ─── System Initialization ────────────────────────────────────────────

  /**
   * Inicializa el sistema completo:
   *   1. Carga .env
   *   2. Inicia sesión con state_manager
   *   3. Crea cliente DeepSeek
   *   4. Carga skills
   *   5. Carga system prompt + CONTEXTO PREVIO DESDE SUPABASE
   *   6. Inicia autoguardado
   *
   * @param {object} options - Opciones de inicialización
   * @param {boolean} options.autoSave - Activar autoguardado (default: true)
   * @returns {Promise<object>} - Estado inicial
   */
  async init(options = {}) {
    const { autoSave = true, projectPath } = options;

    this.emit("log", "🔌 Inicializando lv-zero Orchestrator...");

    // ── 🛡️ UNHANDLED REJECTION GUARD ──────────────────────────────
    // Prevents Node.js from crashing the process on unhandled promise
    // rejections (Node >=15 treats these as fatal). This is a last-resort
    // safety net — all promises should have explicit catch handlers.
    if (!this._unhandledRejectionInstalled) {
      this._unhandledRejectionInstalled = true;
      process.on('unhandledRejection', (reason, promise) => {
        const msg = reason?.message || reason || 'Unknown rejection';
        this.emit('warn', `   🛡️ Guard: Unhandled promise rejection caught: ${msg}`);
        // Log to console as well for debugging
        console.warn(`[lv-zero] 🛡️ Unhandled rejection: ${msg}`, reason?.stack || '');
      });
    }

    // 1. Load environment
    this.loadEnv();
    this.emit("log", "📁 Entorno cargado");

    // 1b. Try to load workspace config first (multi-folder support)
    if (projectPath) {
      // Check if there's a workspace config file
      const wsResult = this.workspaceManager.loadFromProject(projectPath);
      if (wsResult.success) {
        // Multi-folder workspace detected — use the primary folder as project path
        const primaryFolder = this.workspaceManager.primaryFolder;
        this.setProjectPath(primaryFolder ? primaryFolder.path : projectPath);
        this.emit("log", `📂 Workspace activo: ${this.workspaceManager.name} (${this.workspaceManager.folders.length} carpetas)`);
        this.emit("workspace_loaded", {
          name: this.workspaceManager.name,
          folders: this.workspaceManager.folderPaths,
          config: this.workspaceManager.config,
        });
      } else {
        // Single-folder project (legacy mode)
        this.setProjectPath(projectPath);
        this.emit("log", `📂 Proyecto activo: ${path.basename(projectPath)}`);
      }
    }

    // ── 🚨 CRASH DETECTION: Check for stale RooState checkpoint ──────────
    const CRASH_THRESHOLD_MS = 30000;
    const savedRooState = loadRooState();
    if (savedRooState) {
      if (savedRooState.status === 'processing' || savedRooState.status === 'in_progress') {
        const heartbeatAge = Date.now() - new Date(savedRooState.lastHeartbeat).getTime();
        if (heartbeatAge > CRASH_THRESHOLD_MS) {
          this._pendingRecovery = savedRooState;
          this.emit('crash_detected', {
            task: savedRooState.currentTask,
            mode: savedRooState.currentMode,
            lastAction: savedRooState.lastAssistantAction,
            lastMessage: savedRooState.lastUserMessage,
            heartbeatAge,
            ...savedRooState,
          });
          this.emit('log', `   🚨 CRASH detectado (heartbeat ${Math.round(heartbeatAge/1000)}s estancado). Esperando recuperación...`);
        }
      } else if (savedRooState.status === 'complete') {
        clearRooState(); // Clean session — no crash
      }
    }

    // Determine mode slug early for session metadata
    const modeSlug = this.modeController ? this.modeController.currentMode : "orchestrator";

    // 2. Initialize session (with metadata)
    const session = initSession({ mode: modeSlug, projectPath });
    setSessionMetadata({ mode: modeSlug, projectPath });
    this.emit("log", `📂 Sesión: ${session.sessionId}${session.restored ? " (recuperada)" : " (nueva)"}`);

    // 2b. Check for saved session checkpoint (_roo/sessions/last.json) for restore prompt
    const savedSession = checkLastSession();
    if (savedSession.exists) {
      this.emit("session:restore_prompt", {
        sessionId: savedSession.session.sessionId,
        savedAt: savedSession.session.savedAt,
        mode: savedSession.session.mode,
        messageCount: savedSession.session.messageCount,
        projectPath: savedSession.session.projectPath,
        filePath: savedSession.filePath,
      });
    }

    // 3. Initialize LLM client (multi-provider)
    this.initClient();
    if (this.llm && this.llm.isReady()) {
      this.emit("log", `🔌 ${this.llm.getLabel()}`);
    } else {
      this.emit("warn", "⚠️ API key no encontrada. Modo offline.");
    }

    // 3b. Ensure _currentTier is always set (for UI model label)
    if (!this._currentTier) {
      const modeSlug2 = this.modeController?.currentMode || "orchestrator";
      const modeDefault = getModelForMode(modeSlug2);
      this._currentTier = modeDefault || "cheap";
    }

    // 4. Load skills
    this.emit("log", "📦 Armando arsenal de skills...");
    await this.loadAllSkills();
    this.emit("log", `   → ${this.skills.length} skill(s) registrada(s)`);
    this.emit("skills_loaded", { count: this.skills.length, skills: this.skills.map((s) => s.name) });

    // ── 🖥️  MCP SERVER (start if enabled) ────────────────────────────────
    // Starts the lv-zero MCP Server so external AI tools (Claude Code, Cursor)
    // can consume registered skills as MCP tools.
    try {
      const mcpPort = parseInt(process.env.MCP_SERVER_PORT || "0", 10);
      const mcpStdio = process.env.MCP_SERVER_STDIO === "true" || process.env.MCP_SERVER_STDIO === "1";
      if (mcpPort > 0 || mcpStdio) {
        const opts = {};
        if (mcpPort > 0) opts.httpPort = mcpPort;
        if (mcpStdio) opts.stdio = true;
        this._mcpServer = await createMcpServer(this, opts);
        this.emit("log", `   🖥️  MCP Server: HTTP:${mcpPort > 0 ? mcpPort : "off"} stdio:${mcpStdio ? "on" : "off"}`);
      } else {
        // Auto-enable on default port for local development (can be disabled via MCP_SERVER_PORT=0)
        const autoPort = 3001;
        this._mcpServer = await createMcpServer(this, { httpPort: autoPort });
        this.emit("log", `   🖥️  MCP Server: HTTP:${autoPort} (auto)`);
      }
    } catch (err) {
      this.emit("log", `   ⚠️  MCP Server: ${err.message}`);
    }

    // ── 🧠 CACHE AUTO-MEMORIA (cargar una vez, reusar siempre) ─────────
    // Previously, auto_memoria was dynamically imported with ?t=${Date.now()}
    // cache-busting on EVERY checkpoint call (iteration, early, workflow,
    // shutdown). This caused a memory leak: Node.js ESM loader caches each
    // unique URL, and every cache-bust creates a stale module instance with
    // its own closures, Supabase client, and interval timers.
    //
    // Fix: Import once here, store the reference, reuse everywhere.
    try {
      const { default: autoMemoriaLoaded } = await import(
        `file://${path.resolve(__dirname, "..", "..", "skills", "auto_memoria.js").replace(/\\/g, "/")}`
      );
      this._autoMemoria = autoMemoriaLoaded;
    } catch (err) {
      this.emit("warn", `   ⚠️ No se pudo cargar auto_memoria: ${err.message}`);
      this._autoMemoria = null;
    }

    // 5. Initialize PLAN.md
    try {
      fs.writeFileSync(
        CONFIG.planFile,
        "# lv-zero — Manager View\n\n*Sesión iniciada. Sistema Autónomo activo.*\n",
        "utf-8"
      );
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.FS_ERROR, context: { phase: "plan_md_init", planFile: CONFIG.planFile }, recoverable: true });
      this.emit("log", `   ⚠️ No se pudo escribir PLAN.md: ${lvErr.message}`);
    }

    // 6. Load system prompt (mode-specific)
    const systemPrompt = await this.loadSystemPrompt(modeSlug);

    // 7. Add system prompt to conversation
    this.messages.push({ role: "system", content: systemPrompt });

    // ── 🧠 AUTO-MEMORIA: Cargar contexto previo desde Supabase ──────────
    try {
      this.emit("log", "   🧠 Cargando memoria de sesiones anteriores...");
      const prevContext = await loadPreviousContext();
      if (prevContext) {
        this.messages.push({
          role: "system",
          content: prevContext,
        });
        this.emit("log", "   ✅ Contexto de sesiones anteriores inyectado");
      } else {
        this.emit("log", "   ℹ️  No hay memoria previa disponible");
      }
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.STATE_ERROR, context: { phase: "load_previous_context" }, recoverable: true });
      this.emit("log", `   ⚠️ Error cargando contexto previo: ${lvErr.message}`);
    }

    // 7b. Build CacheFirstLoop prefix (Reasonix-inspired cache stability)
    const tools = this.modeController ? this.modeController.filterTools(this.skillsToTools()) : this.skillsToTools();
    this.cacheLoop.init(systemPrompt, tools);
    this.emit("log", `   🏷️  Prefix hash: ${this.cacheLoop.prefix.hash} (~${this.cacheLoop.prefix.estimatedTokens} tok)`);

    // Register tool schemas with ToolCallRepair (flattens complex schemas)
    for (const tool of tools) {
      this.toolRepair.registerTool(tool);
    }

    // 8. Start auto-save
    if (autoSave) {
      startAutoSave();
    }

    // 8b. Periodic checkpoint timer — guarda en Supabase cada 60s durante actividad
    // Uses cached this._autoMemoria (imported once during init) instead of cache-busting
    // dynamic import that caused memory leak (see comment at line ~1801).
    // Concurrency guard via this._checkpointBusy prevents pile-up when Supabase is slow.
    this._checkpointTimer = setInterval(async () => {
      if (!this.isRunning || this.messages.length < 3 || this._checkpointBusy) return;
      this._checkpointBusy = true;
      try {
        if (this._autoMemoria && this._autoMemoria.guardarCheckpoint) {
          const lastMsgs = this.messages.slice(-5).map(m =>
            `${m.role}: ${String(m.content || '').substring(0, 200)}`
          ).join('\n');
          await this._autoMemoria.guardarCheckpoint({
            topic: `checkpoint:periodico`,
            content: `[Checkpoint periódico - Sesión activa]\nMensajes totales: ${this.messages.length}\n\nÚltimos mensajes:\n${lastMsgs.substring(0, 2000)}`,
            source: 'timer_periodico',
          });
        }
      } catch (err) {
        this.emit("log", `   [checkpoint] timer: ${err.message}`);
      } finally {
        this._checkpointBusy = false;
      }
    }, 60000);

    // 8c. 🧠 GBrain Fusion: Dream Cycle — enriquecimiento nocturno automático
    try {
      const { startDreamCycle } = await import(
        `file://${path.resolve(__dirname, "..", "workflows", "lifecycle", "dream_cycle.js").replace(/\\/g, "/")}`
      );
      startDreamCycle(this);
      this.emit("log", "   💤 Dream cycle iniciado (background)");
    } catch (err) {
      this.emit("log", `   ⚠️ Dream cycle no disponible: ${err.message}`);
    }

    // 8d. Guardar checkpoint temprano tras los primeros mensajes significativos
    this._earlyCheckpointDone = false;

    // 8d. Iniciar auto-healing (health check periódico cada 60s)
    this._startHealthCheck();

    this.initialized = true;

    this.emit("ready", {
      skills: this.skills,
      sessionId: getSessionId(),
      skillsCount: this.skills.length,
      model: CONFIG.model,
      cachePrefixHash: this.cacheLoop.prefix.hash,
    });

    return {
      sessionId: getSessionId(),
      skillsCount: this.skills.length,
      model: this.llm?.getModel?.() || CONFIG.model,
      clientReady: !!this.llm?.isReady(),
      provider: this.llm?.getProviderName?.() || null,
      cacheStats: this.cacheLoop.getStats(),
    };
  }

  /**
   * Handles the user's response to a session restore prompt.
   * Called after emitting 'session:restore_prompt' during init().
   * @param {boolean} accepted - Whether the user wants to restore the session
   * @returns {{ restored: boolean, sessionId: string|null, messageCount: number }}
   */
  handleSessionRestore(accepted) {
    const savedSession = checkLastSession();
    if (!savedSession.exists) {
      this.emit("log", "ℹ️  No hay sesión guardada para restaurar");
      return { restored: false, sessionId: null, messageCount: 0 };
    }

    if (accepted) {
      // Restore the saved session state into current session
      const result = restoreSession(savedSession.filePath);
      if (result.restored) {
        this.emit("log", `📂 Sesión restaurada: ${result.sessionId} (${result.messageCount} mensajes)`);
        this.emit("session:restored", {
          sessionId: result.sessionId,
          messageCount: result.messageCount,
        });
      }
      return result;
    } else {
      // User declined — clear the checkpoint and start fresh
      clearLastSession();
      this.emit("log", "🗑️  Checkpoint de sesión anterior eliminado, empezando fresco");
      this.emit("session:restore_declined", {});
      return { restored: false, sessionId: null, messageCount: 0 };
    }
  }

  // ─── Shutdown ─────────────────────────────────────────────────────────

  /**
   * Detiene el sistema y guarda el estado final.
   * Además guarda un checkpoint de despedida en Supabase.
   */
  async shutdown() {
    stopAutoSave();
    await saveSession();

    // ── Graphify: actualizar grafo antes de cerrar ─────────────────────
    // Fire-and-forget to avoid blocking shutdown; errors are non-critical.
    if (this.projectPath) {
      try {
        await this.triggerGraphifyBuild(this.projectPath);
      } catch (err) {
        this.emit("log", `   ⚠️ Graphify shutdown: ${err.message}`);
      }
    }
    
    // Guardar checkpoint de cierre
    try {
      if (this._autoMemoria && this._autoMemoria.guardarCheckpoint) {
        await this._autoMemoria.guardarCheckpoint({
          topic: `sesion:cierre`,
          content: `Sesión cerrada. Últimos ${this.messages.length} mensajes en contexto.`,
          source: 'shutdown',
        });
      }
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.STATE_ERROR, context: { phase: "shutdown_checkpoint" }, recoverable: true });
      this.emit("log", `   ⚠️ Shutdown checkpoint: ${lvErr.message}`);
    }

    // Cleanup health check timer
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }

    // Cleanup heartbeat timer
    this._clearHeartbeat();

    // Cleanup periodic checkpoint timer (prevents Supabase writes after shutdown)
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = null;
    }

    // Shutdown MCP Config Manager (disconnect all clients)
    if (this._mcpConfigManager) {
      try {
        await this._mcpConfigManager.shutdown();
        global.__mcpConfigManager = null;
        this._mcpConfigManager = null;
        this.emit("log", "   🔌 MCP Clients desconectados");
      } catch (err) {
        this.emit("log", `   ⚠️ MCP Clients shutdown: ${err.message}`);
      }
    }

    // Shutdown MCP Server if running
    if (this._mcpServer) {
      try {
        await this._mcpServer.stop();
        this._mcpServer = null;
        this.emit("log", "   🖥️  MCP Server detenido");
      } catch (err) {
        this.emit("log", `   ⚠️ MCP Server shutdown: ${err.message}`);
      }
    }

    this.isRunning = false;
    this.emit("log", "👋 Sistema detenido. Estado guardado + checkpoint en Supabase.");
  }

  // ─── Auto-Healing ────────────────────────────────────────────────────

  /**
   * Inicia el timer de health check periódico (cada 60s).
   * Se llama desde init().
   */
  _startHealthCheck() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
    }
    this._healthCheckTimer = setInterval(async () => {
      await this._performHealthCheck();
    }, 60000); // cada 60 segundos
  }

  /**
   * Realiza un health check completo del orquestador:
   *   1. Verifica que el LLMClient siga vivo
   *   2. Verifica consistencia entre this.messages y this.cacheLoop
   *   3. Detecta si el sistema está "estancado" (isRunning=true sin progreso)
   *   4. Intenta recuperación automática en caso de fallo
   *   5. Emite evento 'health_check' con el resultado
   */
  async _performHealthCheck() {
    const issues = [];
    const recovered = [];
    const MAX_CONSECUTIVE_FAILURES = 3;

    // ── 1. Verificar LLMClient ─────────────────────────────────────────
    if (!this.llm || !this.llm.isReady()) {
      issues.push('llm_not_ready');
      this.emit('warn', '🔧 Auto-heal: LLMClient no disponible, reintentando initClient()...');
      this.initClient();
      if (this.llm && this.llm.isReady()) {
        recovered.push('llm_client');
        this._healthCheckFailures = 0;
      } else {
        this._healthCheckFailures++;
      }
    } else {
      // Verificar que el proveedor esté realmente disponible
      if (!this.llm.isReady()) {
        issues.push('llm_provider_not_ready');
        this.emit('warn', '🔧 Auto-heal: Proveedor LLM no listo, reintentando initClient()...');
        this.initClient();
        if (this.llm && this.llm.isReady()) {
          recovered.push('llm_provider');
          this._healthCheckFailures = 0;
        } else {
          this._healthCheckFailures++;
        }
      }
    }

    // ── 1b. Verificar salud por proveedor ──────────────────────────────
    if (this.llm && this.llm.isReady() && typeof this.llm.getProviderHealth === "function") {
      const providerHealth = this.llm.getProviderHealth();
      if (providerHealth) {
        for (const [name, health] of Object.entries(providerHealth)) {
          if (health.degraded) {
            issues.push(`provider_${name}_degraded`);
            this.emit('warn', `   ⚠️ Proveedor ${name} degradado (${health.consecutiveFailures} fallos consecutivos)`);
          }
        }
      }
    }

    // ── 2. Verificar consistencia del cache loop ────────────────────────
    if (this.cacheLoop && this.cacheLoop.log && this.messages.length > 0) {
      const logEntries = this.cacheLoop.log.getAll();
      const prefixMsgs = this.cacheLoop.prefix?.getMessages?.() || [];
      const systemInMessages = this.messages.filter(m => m.role === 'system').length;
      // Check BOTH prefix AND log for system messages — the rebuild stores
      // the main system prompt in the prefix (via rebuildPrefix), not the log.
      // Checking only log.getAll() causes infinite rebuild loops.
      const systemInCache = [...prefixMsgs, ...logEntries].filter(e => e.role === 'system').length;

      if (systemInMessages > 0 && systemInCache === 0) {
        // Cache loop parece vacío pero hay mensajes — reconstruir
        issues.push('cache_loop_empty');
        this.emit('warn', '🔧 Auto-heal: Cache loop vacío, reconstruyendo desde this.messages...');

        // Reconstruir el prefix
        const systemPrompt = this.messages.find(m => m.role === 'system' && !m.content?.startsWith('[CONTEXTO DEL PROYECTO]'));
        const tools = this.skillsToTools();
        if (systemPrompt) {
          this.cacheLoop.rebuildPrefix(systemPrompt.content, tools);
        }

        // Agregar contexto del proyecto si existe
        const projectCtx = this.messages.find(
          m => m.role === 'system' && m.content?.startsWith('[CONTEXTO DEL PROYECTO]')
        );
        if (projectCtx) {
          this.cacheLoop.log.append(projectCtx);
        }

        // Agregar mensajes no-system (user/assistant/tool) desde this.messages
        const nonSystem = this.messages.filter(m => m.role !== 'system');
        for (const msg of nonSystem) {
          this.cacheLoop.log.append(msg);
        }

        recovered.push('cache_loop');
        this._healthCheckFailures = 0;
      }
    }

    // ── 3. Verificar skills no estén vacías ─────────────────────────────
    if (this.skills.length === 0 && this.initialized) {
      issues.push('skills_empty');
      this.emit('warn', '🔧 Auto-heal: Skills vacías, recargando...');
      try {
        await this.loadAllSkills();
        if (this.skills.length > 0) {
          recovered.push('skills');
          this._healthCheckFailures = 0;
        } else {
          this._healthCheckFailures++;
        }
      } catch (err) {
        const lvErr = toLvError(err, { code: ErrorCodes.TOOL_ERROR, context: { phase: "auto_heal_skills" }, recoverable: true });
        this.emit('error', lvErr.toJSON());
        this._healthCheckFailures++;
      }
    }

    // ── 4. Detectar sistema estancado (isRunning sin progreso) ──────────
    // ❌ OLD BEHAVIOR: Forced isRunning=false → created zombie state where
    //    agentLoop continued running but UI thought system was idle.
    //    Subsequent user messages got "busy" error (sleep mode).
    // ✅ NEW BEHAVIOR: Sets _abortRequested so agentLoop terminates
    //    gracefully at its next check point, with proper cleanup.
    if (this.isRunning) {
      if (this.iterationCount === this._lastIterationCount) {
        this._healthCheckFailures++;
        if (this._healthCheckFailures >= MAX_CONSECUTIVE_FAILURES) {
          issues.push('stuck_running');
          this.emit('warn',
            `🔧 Auto-heal: Sistema parece estancado tras ${this._healthCheckFailures} chequeos sin progreso. Señalando aborto...`
          );
          // Do NOT force isRunning=false — let agentLoop terminate gracefully
          this._abortRequested = true;
          recovered.push('reset_stuck');
          this._healthCheckFailures = 0;
        }
      } else {
        // Hubo progreso, reiniciar contador
        this._healthCheckFailures = 0;
      }
    } else {
      this._healthCheckFailures = 0;
    }
    this._lastIterationCount = this.iterationCount;
    this._lastHealthCheck = Date.now();

    // ── 5. Registrar en historial (mantener últimos 10) ─────────────────
    const entry = {
      timestamp: new Date().toISOString(),
      healthy: issues.length === 0,
      issues: [...issues],
      recovered: [...recovered],
      failures: this._healthCheckFailures,
      messagesCount: this.messages.length,
      skillsCount: this.skills.length,
      isRunning: this.isRunning,
      iterationCount: this.iterationCount,
    };
    this._healthCheckHistory.push(entry);
    if (this._healthCheckHistory.length > 10) {
      this._healthCheckHistory.shift();
    }

    // ── 6. Emitir evento ────────────────────────────────────────────────
    this.emit('health_check', {
      healthy: issues.length === 0,
      issues,
      recovered,
      failures: this._healthCheckFailures,
      uptime: Math.floor((Date.now() - this._startTime) / 1000),
      messagesCount: this.messages.length,
      skillsCount: this.skills.length,
      isRunning: this.isRunning,
    });

    if (issues.length === 0) {
      this.emit('log', `✅ Health check OK (${Math.floor((Date.now() - this._startTime) / 1000)}s uptime)`);
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────

  /**
   * Actualiza el Manager View (PLAN.md).
   */
  updatePlan(content) {
    try {
      fs.writeFileSync(CONFIG.planFile, content, "utf-8");
      this.emit("log", `📋 Manager View actualizado → ${CONFIG.planFile}`);
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.FS_ERROR, context: { phase: "plan_update", planFile: CONFIG.planFile }, recoverable: true });
      this.emit("error", lvErr.toJSON());
    }
  }

  /**
   * Obtiene el estado actual del orquestador.
   */
  getStatus() {
    // Estimate tokens from total message characters (rough: ~4 chars/token)
    let estimatedTokens = 0;
    let totalChars = 0;
    if (this.messages && this.messages.length > 0) {
      for (const msg of this.messages) {
        const content = typeof msg.content === 'string' ? msg.content : '';
        totalChars += content.length;
      }
      estimatedTokens = Math.ceil(totalChars / 4);
    }

    // Default context window: 64000 tokens (DeepSeek standard)
    const tokenBudget = 64000;

    return {
      running: this.isRunning,
      iteration: this.iterationCount,
      maxIterations: CONFIG.maxToolIterations,
      skillsCount: this.skills.length,
      messagesCount: this.messages.length,
      estimatedTokens,
      tokenBudget,
      contextUsedPct: tokenBudget > 0 ? Math.min(100, Math.round((estimatedTokens / tokenBudget) * 100)) : 0,
      ready: !!this.initialized,
      session: getSessionState(),
      model: this.llm?.getModel?.() || CONFIG.model,
      clientReady: !!this.llm?.isReady(),
      provider: this.llm?.getProviderName?.() || null,
      providerHealth: this.llm?.getProviderHealth?.() || null,
      currentTier: this._currentTier,
      currentProvider: this._currentProvider,
      cache: this.cacheLoop.getStats(),
      toolRepair: this.toolRepair.getStats(),
      project: this.getProjectInfo(),
      mode: this.modeController ? this.modeController.getStatus() : { slug: "orchestrator", icon: "🔄", name: "Orchestrator", color: "#FF6B35" },
      rateLimiter: this.rateLimiter ? this.rateLimiter.getStats() : [],
      health: {
        failures: this._healthCheckFailures,
        lastCheck: this._lastHealthCheck,
        uptime: Math.floor((Date.now() - this._startTime) / 1000),
        history: this._healthCheckHistory.slice(-5),
      },
    };
  }

  /**
   * Returns the pending crash recovery state, if any.
   * Called by the renderer after receiving a 'crash_detected' event.
   * @returns {object|null} The saved RooState checkpoint, or null if none.
   */
  getCrashRecoveryState() {
    return this._pendingRecovery || null;
  }

  /**
   * Recovers context from a detected crash.
   * Restores the mode that was active at crash time and injects a system
   * message explaining the crash, so the agent can continue where it left off.
   * Clears the stale RooState checkpoint.
   * @returns {{ restored: boolean, mode: string|null, lastMessage: string|null }}
   */
  recoverFromCrash() {
    const crashState = this._pendingRecovery;
    if (!crashState) {
      return { restored: false, mode: null, lastMessage: null };
    }

    try {
      // 1. Restore the mode that was active at crash time
      if (crashState.currentMode && this.modeController) {
        const modeSlug = crashState.currentMode;
        if (getMode(modeSlug)) {
          this.modeController.switchMode(modeSlug, 'crash_recovery');
        }
      }

      // 2. Inject a system message explaining the crash
      const crashMsg = {
        role: "system",
        content: `[🚨 CRASH RECOVERY] The system was interrupted during a previous session.\n`
          + `Last action: ${crashState.lastAssistantAction || 'Unknown'}\n`
          + `Last user message: "${crashState.lastUserMessage || 'N/A'}"\n`
          + `Active mode: ${crashState.currentMode || 'code'}\n`
          + `The user may want to continue from where it left off. `
          + `If the user asks to continue, examine the recovery context above and resume.`,
        timestamp: new Date().toISOString(),
        source: 'crash_recovery',
      };
      this.messages.push(crashMsg);

      // 3. Clear the stale RooState checkpoint
      clearRooState();
      this._pendingRecovery = null;

      this.emit('log', `   ✅ Crash recovery complete — mode: ${crashState.currentMode || 'code'}, last action: ${crashState.lastAssistantAction || 'N/A'}`);

      return {
        restored: true,
        mode: crashState.currentMode || null,
        lastMessage: crashState.lastUserMessage || null,
      };
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.STATE_ERROR, context: { phase: 'crash_recovery' }, recoverable: true });
      this.emit('error', { phase: 'crash_recovery', error: lvErr.message });
      return { restored: false, mode: null, lastMessage: null, error: lvErr.message };
    }
  }

  /**
   * Clears the pending crash recovery state without restoring.
   * Simply removes the stale RooState checkpoint and resets the flag.
   */
  clearCrashState() {
    if (this._pendingRecovery) {
      clearRooState();
      this._pendingRecovery = null;
      this.emit('log', '   🧹 Crash recovery state cleared');
    }
  }

  /**
   * Obtiene la lista de skills registradas.
   */
  getSkills() {
    return this.skills.map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  /**
   * Limpia el historial de conversación (mantiene system prompt).
   */
  clearConversation() {
    const systemMessages = this.messages.filter((m) => m.role === "system");
    this.messages = systemMessages;
    this.cacheLoop.clear();
    this.toolRepair.reset();
    this.workflowActive = null;
    // Reset project context index — it will be re-inserted next setProjectPath call
    this._projectContextMsgIndex = -1;

    // Stop the periodic checkpoint timer to prevent stale Supabase writes
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = null;
    }

    this.emit("log", "🧹 Historial de conversación limpiado (cache + repair reseteados)");
  }

  /**
   * 🧹 Amnesia — Clear short-term memory (more aggressive than clearConversation).
   * Preserves ONLY the current mode's primary system prompt.
   * All other messages (auto-memoria context, project context, user messages,
   * assistant messages, tool results) are removed.
   * This prevents context collapse when large Base64 or massive files overload the window.
   */
  /**
   * Aborts the currently running agent loop. Sets a flag checked during
   * the main while loop and streaming loop. The agent returns gracefully
   * with whatever partial state has been accumulated.
   */
  abortAgent() {
    process.stderr.write("[abortAgent] called — _abortRequested = true\n");
    this._abortRequested = true;

    // Immediately cancel any in-flight HTTP stream request
    if (this._abortController) {
      process.stderr.write("[abortAgent] Aborting HTTP controller...\n");
      this._abortController.abort(new Error("🛑 User requested stop"));
      // DON'T nullify — let stream lifecycle handle cleanup
    }

    // Cancel any running tool (shell_executor, build_slidev_deck, etc.)
    if (this._toolAbortController) {
      process.stderr.write("[abortAgent] Aborting tool controller...\n");
      this._toolAbortController.abort(new Error("🛑 User requested stop"));
    }

    // NOTE: Do NOT set isRunning = false or emit "response" here.
    // Let the agent loop's natural abort checks handle both:
    //   - Line ~992: while-loop abort check (start of iteration)
    //   - Line ~1090: streaming abort check (inside for-await)
    //   - Line ~1255: post-streaming abort check
    //   - Line ~1423: pre-tool-execution abort check
    // Setting isRunning = false here creates a race condition where
    // a new agent loop can start while the old one is still running tools.

    this.emit("log", "   🛑 Stop signal received — aborting agent...");
  }

  clearMemory() {
    // Keep ONLY the first system message (the mode's primary system prompt)
    const systemPromptMsg = this.messages.find((m) => m.role === "system");
    this.messages = systemPromptMsg ? [{ role: "system", content: systemPromptMsg.content }] : [];

    // Reset cache loop and tool repair
    this.cacheLoop.clear();
    this.toolRepair.reset();
    this.workflowActive = null;
    this._projectContextMsgIndex = -1;

    // Stop the periodic checkpoint timer to prevent stale Supabase writes after memory clear
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = null;
    }

    this.emit("log", "🧠💥 Amnesia: Memoria a corto plazo vaciada. Solo se conservó el System Prompt del modo activo.");
  }

  // ─── Mode Suggestion Approval Flow ────────────────────────────────────────

  /**
   * Accepts a pending mode suggestion: switches to the suggested mode and
   * re-processes the stored user input in the new mode's context.
   * @returns {Promise<Object>} Result from the mode switch + agentLoop execution
   */
  async acceptModeSuggestion() {
    // ── Clear mode switch timeout timer (if any) ─────────────────────────
    if (this._modeSwitchTimer) {
      clearTimeout(this._modeSwitchTimer);
      this._modeSwitchTimer = null;
    }

    const input = this._pendingModeInput;
    const slug = this._pendingModeSlug;
    const fromAgent = this._pendingFromAgent;
    this._pendingModeInput = null;
    this._pendingModeSlug = null;
    this._pendingFromAgent = false;

    // Reset fallback state on mode switch — new mode gets fresh provider selection
    this._fallbackAttempted = false;
    this._currentTier = null;
    this._currentProvider = null;

    if (!input || !slug) {
      return { success: false, error: "No pending mode suggestion to accept" };
    }

    // Capture the previous mode BEFORE switching (for context boundary marker — Fix 3)
    const previousMode = this.modeController ? this.modeController.currentMode : "orchestrator";

    if (fromAgent) {
      // ── Agent-initiated mode switch ──────────────────────────────────
      this.emit("log", `   ✅ Usuario aprobó cambio solicitado por el agente a modo ${slug}.`);

      // Pop tool result (last message) — sync cacheLoop log
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "tool") {
        this.messages.pop();
        this.cacheLoop.popLogEntry();
      }
      // Pop assistant message with the request_mode_switch tool_call — sync cacheLoop log
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "assistant") {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg.tool_calls?.some(tc => tc.function?.name === "request_mode_switch")) {
          this.messages.pop();
          this.cacheLoop.popLogEntry();
        }
      }

      // Switch to the target mode
      const switchResult = await this.switchMode(slug, "user_approved_agent");
      if (!switchResult.success) {
        this.emit("error", `   ❌ Error al cambiar a modo ${slug}: ${switchResult.error}`);
        this.isRunning = false;
        this._clearHeartbeat();
        return switchResult;
      }

      // ── Context Boundary Marker (Fix 3) ──────────────────────────────
      // Prevents the "you" confusion: insert a system message that tells the
      // new mode which messages were generated by the AI itself (not the user).
      this.messages.push({
        role: "system",
        content: `[Mode Switch] The assistant has switched from "${previousMode}" mode to "${slug}" mode.\nMessages with role "assistant" or "tool" above this point were generated by the AI while in "${previousMode}" mode. They are the AI's own previous reasoning and tool calls — NOT user messages. The actual user's input has role "user". Do NOT interpret the AI's own previous messages as instructions from the user.`,
      });
      this.cacheLoop.addSystemMessage(this.messages[this.messages.length - 1]);

      // ── Release isRunning lock (Fix 4) — was kept true during mode detection ──
      this.isRunning = false;

      // Run agentLoop with the continuation prompt
      return await this.agentLoop(input);
    } else {
      // ── User-initiated mode switch (keyword detection) ─────────────
      this.emit("log", `   ✅ Usuario aprobó cambio a modo ${slug}. Cambiando y reprocesando input...`);

      // Remove the last user message that was already pushed to this.messages
      // by agentLoop() before it detected the mode mismatch
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "user") {
        this.messages.pop();
        this.cacheLoop.popLastUserMessage();
      }

      // Switch to the target mode
      const switchResult = await this.switchMode(slug, "user_approved");
      if (!switchResult.success) {
        this.emit("error", `   ❌ Error al cambiar a modo ${slug}: ${switchResult.error}`);
        this.isRunning = false;
        this._clearHeartbeat();
        return switchResult;
      }

      // ── Context Boundary Marker (Fix 3) ──────────────────────────────
      this.messages.push({
        role: "system",
        content: `[Mode Switch] The assistant has switched from "${previousMode}" mode to "${slug}" mode.\nMessages with role "assistant" or "tool" above this point were generated by the AI while in "${previousMode}" mode. They are the AI's own previous reasoning and tool calls — NOT user messages. The actual user's input has role "user". Do NOT interpret the AI's own previous messages as instructions from the user.`,
      });
      this.cacheLoop.addSystemMessage(this.messages[this.messages.length - 1]);

      // ── Release isRunning lock (Fix 4) — was kept true during mode detection ──
      this.isRunning = false;

      // Re-process the original input in the new mode
      return await this.agentLoop(input);
    }
  }

  /**
   * Denies a pending mode suggestion: clears the stored state and removes
   * the user message that was pushed before detection, so no trace remains.
   * @returns {Object} Confirmation result
   */
  async denyModeSuggestion() {
    // ── Clear mode switch timeout timer (if any) ─────────────────────────
    if (this._modeSwitchTimer) {
      clearTimeout(this._modeSwitchTimer);
      this._modeSwitchTimer = null;
    }

    const fromAgent = this._pendingFromAgent;
    const hadPending = !!(this._pendingModeInput && this._pendingModeSlug);
    this._pendingModeInput = null;
    this._pendingModeSlug = null;
    this._pendingFromAgent = false;

    if (fromAgent) {
      // Agent-initiated: Pop tool result + assistant message with tool_call — sync cacheLoop log
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "tool") {
        this.messages.pop();
        this.cacheLoop.popLogEntry();
      }
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "assistant") {
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg.tool_calls?.some(tc => tc.function?.name === "request_mode_switch")) {
          this.messages.pop();
          this.cacheLoop.popLogEntry();
        }
      }
    } else {
      // User-initiated: Remove the last user message that was pushed by agentLoop()
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === "user") {
        this.messages.pop();
        this.cacheLoop.popLastUserMessage();
      }
    }

    if (hadPending) {
      this.emit("log", "   ❌ Usuario rechazó sugerencia de modo. Continuando en modo actual.");
    }

    // ── Release isRunning lock (Fix 4) — was kept true during mode detection ──
    this.isRunning = false;
    this._clearHeartbeat();
    // Drain any messages that were queued while waiting for mode decision
    this._drainPendingMessages();

    return { success: true };
  }

  // ─── Workflow Methods ──────────────────────────────────────────────────

  /**
   * Lista los workflows disponibles.
   * @returns {Array} Lista de workflows
   */
  getWorkflows() {
    return listWorkflows();
  }

  /**
   * Obtiene el texto de ayuda de los comandos slash.
   * @returns {string} Texto de ayuda
   */
  getWorkflowHelp() {
    return getHelpText();
  }

  /**
   * Obtiene el workflow activo actual.
   * @returns {string|null} Comando del workflow activo o null
   */
  getActiveWorkflow() {
    return this.workflowActive;
  }

  /**
   * Obtiene la configuración actual.
   */
  getConfig() {
    return { ...CONFIG };
  }

  // ─── Project Path Management ────────────────────────────────────────────

  /**
   * Establece la ruta del proyecto activo.
   *
   * Cuando el usuario abre/crea un proyecto en el explorador, este método:
   *   1. Actualiza this.projectPath
   *   2. Establece process.env.LV_PROJECT_PATH (para file_manager.js)
   *   3. Actualiza CONFIG.planFile para escribir PLAN.md en el proyecto
   *   4. Recarga el .env del proyecto (si existe)
   *   5. Inyecta/actualiza un mensaje system con el contexto del proyecto
   *   6. Emite evento 'project_changed' para que main.cjs lo escuche
   *
   * @param {string|null} projectPath - Ruta absoluta del proyecto, o null para cerrar
   */
  async setProjectPath(projectPath) {
    // ── Guardar ruta anterior para referencia ──
    const previousPath = this.projectPath;

    if (!projectPath) {
      // ── Cerrar proyecto: volver a lv-zero root ──
      this.projectPath = null;
      delete process.env.LV_PROJECT_PATH;
      CONFIG.planFile = path.resolve(__dirname, "..", "..", "PLAN.md");
    } else {
      // ── Abrir/crear proyecto ──
      this.projectPath = path.resolve(projectPath);
      process.env.LV_PROJECT_PATH = this.projectPath;

      // Actualizar planFile al proyecto
      CONFIG.planFile = path.resolve(this.projectPath, "PLAN.md");

      // Cargar .env del proyecto (si existe, sobrescribe variables de lv-zero)
      const projectEnvPath = path.resolve(this.projectPath, ".env");
      if (fs.existsSync(projectEnvPath)) {
        this._parseEnvFile(projectEnvPath, true);
        this.emit("log", `   📁 .env del proyecto cargado desde ${projectEnvPath}`);

        // ── Remapear SUPABASE_* → SIAE_SUPABASE_* para el proyecto ──
        // Si el .env del proyecto sobrescribe SUPABASE_*, duplicamos los
        // valores como SIAE_SUPABASE_* para que las skills del proyecto
        // (sia_supabase, pg_query) puedan resolver credenciales vía
        // getCredentials('siae') / getPoolerConfig('siae').
        const remapKeys = ['URL', 'KEY', 'SERVICE_ROLE_KEY', 'ANON_KEY', 'REF', 'REGION', 'DB_PASSWORD', 'DB_URL'];
        for (const suffix of remapKeys) {
          const supabaseKey = `SUPABASE_${suffix}`;
          const siaeKey = `SIAE_SUPABASE_${suffix}`;
          if (process.env[supabaseKey] && !process.env[siaeKey]) {
            process.env[siaeKey] = process.env[supabaseKey];
          }
        }
      }
    }

    // ── 4b. Sincronizar file_manager skill con la nueva ruta del proyecto ──
    // This ensures the file_manager skill's PROJECT_ROOT variable is updated
    // dynamically after it was already loaded during init().
    try {
      const fmPath = path.resolve(__dirname, "..", "..", "skills", "file_manager.js");
      const fmUrl = new URL(`file://${fmPath.replace(/\\/g, "/")}?t=${Date.now()}`);
      const { setProjectRoot } = await import(fmUrl);
      if (typeof setProjectRoot === "function") {
        setProjectRoot(this.projectPath);
      }
    } catch (err) {
      const lvErr = toLvError(err, { code: ErrorCodes.IPC_ERROR, context: { phase: "file_manager_sync" }, recoverable: true });
      this.emit("log", `   ⚠️ File manager sync: ${lvErr.message}`);
    }

    // ── 5. Inyectar/actualizar mensaje system con contexto del proyecto ──
    const projectName = this.projectPath ? path.basename(this.projectPath) : null;

    // ── Analizar estructura del proyecto para enriquecer contexto ──────
    let projectStructure = "";
    if (this.projectPath) {
      try {
        projectStructure = await this._analyzeProjectStructure(this.projectPath);
      } catch (err) {
        this.emit("log", `   ⚠️ Error analizando estructura: ${err.message}`);
      }
    }

    // ── Build workspace-aware project context ──────────────────────────
    // If a multi-folder workspace is active, include all folder paths
    let workspaceContext = "";
    if (this.workspaceManager && this.workspaceManager.isOpen) {
      workspaceContext = this.workspaceManager.generateContextSummary();
    }

    // Build project context message with emoji markers so AI can clearly see it
    // Includes project structure analysis for better AI awareness
    const projectMsg = {
      role: "system",
      content: projectName
        ? `📁 PROYECTO ACTUAL: ${projectName}\n📂 RUTA: ${this.projectPath}\n⚠️ TODOS los archivos deben crearse/leerse en esta ruta. NO uses la raíz de lv-zero.\n📄 PLAN.md: ${CONFIG.planFile}\n${workspaceContext}\n${projectStructure}`
        : `📁 PROYECTO ACTUAL: ninguno\n📂 RUTA: (raíz de lv-zero)\n⚠️ No hay un proyecto abierto. Estás operando en el directorio raíz de lv-zero.`,
    };

    // Inject into this.messages — insert after first system prompt
    // Avoid duplicates by checking for existing marker
    const existingMsgIdx = this.messages.findIndex(
      (m) => m.role === "system" && m.content && m.content.startsWith("📁 PROYECTO ACTUAL:")
    );
    if (existingMsgIdx >= 0) {
      this.messages[existingMsgIdx] = projectMsg;
      this._projectContextMsgIndex = existingMsgIdx;
    } else {
      const sysIdx = this.messages.findIndex((m) => m.role === "system");
      this.messages.splice(sysIdx + 1, 0, projectMsg);
      this._projectContextMsgIndex = sysIdx + 1;
    }

    // ── Sync project context to cache loop ──────────────────────────────
    // The cache loop is what actually gets sent to the API (buildMessages()).
    // The project context must be in the cache loop's log so the AI sees it.
    if (this.cacheLoop && this.cacheLoop.log) {
      const logEntries = this.cacheLoop.log.getAll();
      const cacheCtxIdx = logEntries.findIndex(
        (e) => e.role === "system" && e.content && e.content.startsWith("📁 PROYECTO ACTUAL:")
      );
      if (cacheCtxIdx >= 0) {
        // Mutate in-place (AppendOnlyLog stores plain objects)
        logEntries[cacheCtxIdx].content = projectMsg.content;
      } else {
        // Append to log so buildMessages() includes it
        this.cacheLoop.log.append(projectMsg);
      }
    }

    // ── 6. Emitir evento ──
    this.emit("project_changed", {
      path: this.projectPath,
      name: projectName,
      previousPath,
      planFile: CONFIG.planFile,
    });

    this.emit("log", `📂 Proyecto activo: ${projectName || "ninguno (raíz lv-zero)"}`);

    // ── 7. Auto-index key project files (fire-and-forget) ─────────────────
    if (this.projectPath) {
      this._autoIndexProjectFiles(this.projectPath).catch(() => {});
    }

    // ── 8. Auto-build graphify map (fire-and-forget) ─────────────────────
    // Each time a project is opened or created, trigger a background
    // graphify build so the project map stays up-to-date.
    if (this.projectPath) {
      this.triggerGraphifyBuild(this.projectPath).catch(() => {});
    }
  }

  /**
   * Auto-index key project files in the background (fire-and-forget).
   * Reads common config/doc files and stores their metadata in Supabase
   * via file_indexer for change detection.
   *
   * @param {string} projectPath
   */
  async _autoIndexProjectFiles(projectPath) {
    const keyFiles = [
      "package.json",
      "README.md",
      "PLAN.md",
      "LOGICA.md",
      ".env",
      "tsconfig.json",
      "vite.config.ts",
      "next.config.js",
      "docker-compose.yml",
    ];

    const entries = [];
    for (const fileName of keyFiles) {
      const filePath = path.resolve(projectPath, fileName);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          const stat = fs.statSync(filePath);
          entries.push({
            path: fileName,
            content,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    if (entries.length > 0) {
      const results = await indexFiles(entries);
      const indexed = results.filter((r) => r.success).length;
      if (indexed > 0) {
        this.emit("log", `   📇 Indexados ${indexed} archivos del proyecto en Supabase`);
      }
    }
  }

  /**
   * Obtiene información del proyecto activo.
   * @returns {{ isOpen: boolean, name: string|null, path: string|null, planFile: string }}
   */
  getProjectInfo() {
    if (this.projectPath) {
      return {
        isOpen: true,
        name: path.basename(this.projectPath),
        path: this.projectPath,
        planFile: CONFIG.planFile,
      };
    }
    return {
      isOpen: false,
      name: null,
      path: null,
      planFile: CONFIG.planFile,
    };
  }

  // ─── Graphify Auto-Build ──────────────────────────────────────────────────

  /**
   * Dispara la construcción del grafo del proyecto usando graphify_knowledge.
   * Busca la skill graphify_knowledge entre las skills cargadas y ejecuta
   * su handler con action="build" apuntando al directorio del proyecto.
   *
   * Si el proyecto no está abierto o no hay skill, no hace nada.
   * Es fire-and-forget — no bloquea el flujo principal.
   *
   * @param {string} [projectPath] - Ruta del proyecto. Usa this.projectPath si no se pasa.
   */
  async triggerGraphifyBuild(projectPath) {
    const targetPath = projectPath || this.projectPath;
    if (!targetPath) {
      this.emit("log", "   ⏭️  Graphify: no hay proyecto activo, saltando");
      return;
    }

    // Buscar la skill graphify_knowledge entre las skills cargadas
    const graphifySkill = this.skills.find(s => s.name === "graphify_knowledge");
    if (!graphifySkill || typeof graphifySkill.handler !== "function") {
      this.emit("log", "   ⏭️  Graphify: skill no disponible");
      return;
    }

    try {
      this.emit("log", `   🗺️  Graphify: construyendo grafo para ${path.basename(targetPath)}...`);
      const result = await graphifySkill.handler({ action: "build", directory: targetPath });
      if (result?.success) {
        const stats = result.stats ? ` (${result.stats.nodes} nodos, ${result.stats.edges} aristas)` : "";
        this.emit("log", `   ✅ Graphify: grafo construido${stats}`);
        this._lastGraphifyIteration = this.iterationCount;

        // ── Copiar salida a mapa-del-proyecto/ ──────────────────────────
        try {
          const mapDir = path.join(targetPath, "mapa-del-proyecto");
          if (!fs.existsSync(mapDir)) {
            fs.mkdirSync(mapDir, { recursive: true });
          }
          // Write a symlink/metadata file pointing to latest graph
          const graphOutDir = path.join(
            targetPath,
            "graphify-out",
            path.basename(targetPath) + "-graph.json"
          );
          // Try common graphify output paths
          const possibleGraphPaths = [
            path.join(targetPath, "graphify-out", "graph.json"),
            path.join(targetPath, "graphify-out", path.basename(targetPath) + "-graph.json"),
          ];
          let graphSrc = null;
          for (const gp of possibleGraphPaths) {
            if (fs.existsSync(gp)) {
              graphSrc = gp;
              break;
            }
          }
          if (graphSrc) {
            // Copy graph.json snapshot to mapa-del-proyecto/
            const destGraph = path.join(mapDir, "graph.json");
            const destMeta = path.join(mapDir, "ultima-actualizacion.json");
            fs.copyFileSync(graphSrc, destGraph);
            fs.writeFileSync(destMeta, JSON.stringify({
              updatedAt: new Date().toISOString(),
              iteration: this.iterationCount,
              stats: result.stats || {},
              source: graphSrc,
            }, null, 2));
          }
        } catch (copyErr) {
          // Non-critical: don't bubble up
          this.emit("log", `   ⚠️ Graphify: error copiando a mapa-del-proyecto: ${copyErr.message}`);
        }
      } else {
        this.emit("log", `   ⚠️ Graphify: construcción falló: ${result?.message || "sin detalles"}`);
      }
    } catch (err) {
      this.emit("log", `   ⚠️ Graphify: error: ${err.message}`);
    }
  }

  // ─── Project Structure Analysis ────────────────────────────────────────────

  /**
   * Analiza la estructura del proyecto y devuelve un resumen textual.
   * Escanea el directorio raíz del proyecto y recopila:
   *   - Archivos clave (package.json, README.md, etc.)
   *   - Directorios principales (src/, skills/, ui/, etc.)
   *   - Conteo de archivos por extensión
   *
   * @param {string} projectPath - Ruta del proyecto
   * @returns {Promise<string>} Resumen markdown de la estructura
   */
  async _analyzeProjectStructure(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) {
      return "*(Proyecto no disponible para análisis estructural)*";
    }

    const projectName = path.basename(projectPath);
    const lines = [`## 📂 Estructura del Proyecto: ${projectName}\n`];

    try {
      // 1. Directorios principales (primer nivel)
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
      if (dirs.length > 0) {
        lines.push(`**Directorios:** ${dirs.map(d => `\`${d.name}/\``).join(', ')}`);
      }

      // 2. Archivos clave y su estado
      const keyFiles = ["package.json", "README.md", "PLAN.md", "LOGICA.md", ".env", "compose.yml", "Dockerfile"];
      const existingFiles = [];
      for (const f of keyFiles) {
        const fPath = path.join(projectPath, f);
        if (fs.existsSync(fPath)) {
          const stat = fs.statSync(fPath);
          existingFiles.push(`\`${f}\` (${(stat.size / 1024).toFixed(1)} KB)`);
        }
      }
      if (existingFiles.length > 0) {
        lines.push(`**Archivos clave:** ${existingFiles.join(', ')}`);
      }

      // 3. Conteo de archivos por extensión (muestra top 10)
      const extCount = {};
      let totalFiles = 0;
      const walkDir = (dir, depth = 0) => {
        if (depth > 3) return; // limit depth
        let items;
        try {
          items = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === 'node_modules') continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else if (item.isFile()) {
            totalFiles++;
            const ext = path.extname(item.name).toLowerCase() || '(sin ext)';
            extCount[ext] = (extCount[ext] || 0) + 1;
          }
        }
      };
      walkDir(projectPath);

      const sortedExts = Object.entries(extCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      if (sortedExts.length > 0) {
        lines.push(`**Archivos:** ${totalFiles} total, ` +
          sortedExts.map(([ext, count]) => `\`${ext}\`: ${count}`).join(', '));
      }

      // 4. Estado de graphify
      const graphOutDir = path.join(projectPath, "graphify-out");
      if (fs.existsSync(graphOutDir)) {
        const graphFiles = fs.readdirSync(graphOutDir).filter(f => f !== 'cache');
        lines.push(`**Graphify:** ${graphFiles.length} archivos en \`graphify-out/\``);
      } else {
        lines.push(`**Graphify:** ⚠️ No se ha generado grafo todavía`);
      }

      // 5. Estado de mapa-del-proyecto
      const mapDir = path.join(projectPath, "mapa-del-proyecto");
      if (fs.existsSync(mapDir)) {
        const metaPath = path.join(mapDir, "ultima-actualizacion.json");
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            lines.push(`**Mapa actualizado:** ${new Date(meta.updatedAt).toLocaleString()}`);
          } catch {}
        }
      }

    } catch (err) {
      lines.push(`*(Error analizando estructura: ${err.message})*`);
    }

    return lines.join('\n');
  }

  /**
   * Receives the user's answer to a pending follow-up question
   * and resumes the agent loop with the answer injected as a user message.
   *
   * @param {string} answer - The user's answer text
   * @returns {Promise<object|string>} Result of the resumed agent loop
   */
  async answerFollowupQuestion(answer) {
    if (!this._pendingAskQuestion) return { error: "No hay pregunta pendiente" };

    this._pendingAskQuestion = false;
    const questionData = this._pendingAskData;
    this._pendingAskData = null;

    this.emit("log", `   ✅ Respuesta recibida: "${answer}"`);

    // Inject answer as a user message and continue agent loop
    this.messages.push({
      role: "user",
      content: `[Respuesta a: "${questionData.question}"] ${answer}`
    });

    // Resume agent loop from where it paused
    return await this.agentLoop(`[Continuación — usuario respondió: ${answer}]`);
  }

  // ─── 3-Tier Model Selection (free/cheap/reasoner) ─────────────────────────

  /**
   * Backward-compatible alias — delegates to selectOptimalModel.
   * @param {string} userInput
   * @param {string} currentMode
   * @returns {string} Selected model name
   */
  selectModel(userInput = "", currentMode = "orchestrator") {
    return this.selectOptimalModel(userInput, currentMode);
  }

  /**
   * Manually override the model tier at runtime.
   * Called from the UI model selector or /model command.
   *
   * @param {"cheap"|"reasoner"|"auto"} tier - "cheap" for Flash, "reasoner" for Pro, "auto" to clear override
   * @returns {{ success: boolean, tier: string, model: string }}
   */
  overrideModel(tier) {
    if (tier === "auto") {
      this._forcedModel = null;
      this.emit("log", "   🔄 Modelo: Auto (override eliminado)");
      // Re-select optimal model based on current context
      const currentModeSlug = this.modeController?.getStatus()?.slug || "orchestrator";
      const autoModel = this.selectOptimalModel("", currentModeSlug);
      CONFIG.model = autoModel;
      updateState("forcedModel", null);
      updateState("currentProvider", null);
      updateState("currentTier", null);
      saveSession();
      return { success: true, tier: "auto", model: autoModel };
    }

    if (tier === "free") {
      // OpenRouter Free — Primary: Google Gemma 4 31B, Secondary: OpenAI GPT-OSS 120B (cost = $0)
      const primaryModel = process.env.OPENROUTER_MODEL_FREE || "google/gemma-4-31b-it:free";
      const secondaryModel = process.env.OPENROUTER_MODEL_FREE_SECONDARY || "openai/gpt-oss-120b:free";
      const providerName = "free";
      
      // Try primary model first
      let modelName = primaryModel;
      this._forcedModel = modelName;
      let switchedOk = false;
      if (this.llm) {
        try {
          switchedOk = this.llm.switchProvider(providerName);
        } catch (switchErr) {
          this.emit("warn", `   ⚠️ Proveedor "${providerName}" no disponible: ${switchErr.message}. ¿Falta OPENROUTER_API_KEY?`);
        }
        if (switchedOk) {
          this.llm.setModel(modelName);
          CONFIG.model = modelName;
          updateState("forcedModel", modelName);
          updateState("currentProvider", providerName);
          updateState("currentTier", "free");
          saveSession();
          this.emit("log", `   🧠 Modelo forzado: 🆓 OpenRouter Free — ${modelName}`);
        } else {
          // Primary failed, try secondary
          this.emit("warn", `   ⚠️ Modelo primario "${primaryModel}" no disponible. Intentando secundario...`);
          modelName = secondaryModel;
          this._forcedModel = modelName;
          try {
            switchedOk = this.llm.switchProvider(providerName);
          } catch (switchErr2) {
            this.emit("warn", `   ⚠️ Proveedor "${providerName}" no disponible: ${switchErr2.message}`);
          }
          if (switchedOk) {
            this.llm.setModel(modelName);
            CONFIG.model = modelName;
            updateState("forcedModel", modelName);
            updateState("currentProvider", providerName);
            updateState("currentTier", "free");
            saveSession();
            this.emit("log", `   🧠 Modelo forzado: 🆓 OpenRouter Free — ${modelName} (secundario)`);
          }
        }
      }
      this._currentProvider = switchedOk ? providerName : (this.llm ? this.llm.getProviderName() : null);
      this._currentTier = switchedOk ? "free" : (this._currentTier || "cheap");
      if (!switchedOk) {
        return { success: false, tier: "free", model: "", error: `Proveedor "free" no disponible. ¿Falta OPENROUTER_API_KEY?` };
      }
      return { success: true, tier: "free", model: modelName };
    }

    if (tier === "gemini" || tier === "gemini-flash") {
      // Gemini 2.0 Flash — fast, free tier, streaming support
      const modelName = process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp";
      const providerName = "gemini-flash";
      this._forcedModel = modelName;
      if (this.llm) {
        const switched = this.llm.switchProvider(providerName);
        if (switched) {
          this.llm.setModel(modelName);
          CONFIG.model = modelName;
          updateState("forcedModel", modelName);
          updateState("currentProvider", providerName);
          updateState("currentTier", "gemini");
          saveSession();
        } else {
          this.emit("warn", `   ⚠️ Proveedor ${providerName} no disponible (¿falta GEMINI_API_KEY?)`);
        }
      }
      this._currentProvider = switched ? providerName : (this.llm ? this.llm.getProviderName() : null);
      this._currentTier = switched ? "gemini" : (this._currentTier || "cheap");
      if (switched) {
        this.emit("log", `   🧠 Modelo forzado: 🪄 Gemini 2.0 Flash (${modelName})`);
        return { success: true, tier: "gemini", model: modelName };
      }
      return { success: false, tier: "gemini", model: "", error: `Proveedor ${providerName} no disponible. ¿Falta GEMINI_API_KEY?` };
    }

    if (tier === "gemini-pro") {
      // Gemini 2.0 Pro — powerful, reasoning, larger context
      const modelName = process.env.GEMINI_PRO_MODEL || "gemini-2.0-pro-exp-02-05";
      const providerName = "gemini-pro";
      this._forcedModel = modelName;
      if (this.llm) {
        const switched = this.llm.switchProvider(providerName);
        if (switched) {
          this.llm.setModel(modelName);
          CONFIG.model = modelName;
          updateState("forcedModel", modelName);
          updateState("currentProvider", providerName);
          updateState("currentTier", "gemini-pro");
          saveSession();
        } else {
          this.emit("warn", `   ⚠️ Proveedor ${providerName} no disponible (¿falta GEMINI_API_KEY?)`);
        }
      }
      this._currentProvider = switched ? providerName : (this.llm ? this.llm.getProviderName() : null);
      this._currentTier = switched ? "gemini-pro" : (this._currentTier || "cheap");
      if (switched) {
        this.emit("log", `   🧠 Modelo forzado: 🧪 Gemini 2.0 Pro (${modelName})`);
        return { success: true, tier: "gemini-pro", model: modelName };
      }
      return { success: false, tier: "gemini-pro", model: "", error: `Proveedor ${providerName} no disponible. ¿Falta GEMINI_API_KEY?` };
    }

    const modelName = tier === "cheap"
      ? (process.env.DEEPSEEK_MODEL_CHEAP || "deepseek-v4-flash")
      : (process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro");

    this._forcedModel = modelName;
    if (this.llm) {
      // Switch back to DeepSeek if coming from Gemini or OpenRouter
      if (this.llm.getProviderName() !== "deepseek") {
        this.llm.switchProvider("deepseek");
      }
      this.llm.setModel(modelName);
    }
    this._currentProvider = "deepseek";
    this._currentTier = tier;
    CONFIG.model = modelName;
    updateState("forcedModel", modelName);
    updateState("currentProvider", "deepseek");
    updateState("currentTier", tier);
    saveSession();

    const label = tier === "cheap" ? "⚡ Flash" : "🧠 Pro";
    this.emit("log", `   🧠 Modelo forzado: ${label} (${modelName})`);

    return { success: true, tier, model: modelName };
  }

  /**
   * Select the optimal model tier for the current task.
   * All modes start with cheap (Flash). Escalation to reasoner (Pro)
   * happens automatically after 2 failed retries (via _executeFallbackChain).
   *
   * Priority chain:
   *   1. Forced model override (/model command)
   *   2. Mode default from mode_registry (always "cheap" — Flash)
   *   3. Resolve tier to concrete provider + model
   *
   * @param {string} userInput   - The user's natural language input
   * @param {string} currentMode - The active mode slug
   * @returns {string} The selected model name (e.g. "deepseek-chat")
   */
  selectOptimalModel(userInput = "", currentMode = "orchestrator") {
    // 0. Mock provider bypass — skip tier resolution entirely
    //    When LLM_PROVIDER=mock is active (test/CI mode), the tier-to-provider
    //    resolution always returns { provider: "deepseek", model: "deepseek-chat" },
    //    which causes switchProvider("deepseek") to override the mock provider.
    //    This check ensures mock provider stays active during tests.
    if (this.llm && this.llm.getProviderName() === "mock") {
      return this.llm.getCurrentModel() || "mock-model";
    }

    // 1. Forced model override (/model command)
    if (this._forcedModel) {
      // CRITICAL: Verify the active provider matches the forced model.
      // When _forcedModel is set (e.g., "deepseek-reasoner") but the LLM
      // client's active provider is still on a different provider (e.g.,
      // "gemini-flash"), the stream() call below would use the WRONG
      // provider. This can happen if overrideModel() was called earlier
      // but the provider state got out of sync.
      // Fix: resolve the forced model back to its provider and switch
      // if the active provider doesn't match.
      if (this.llm) {
        const forcedProvider = this._forcedModel.includes("gemini")
          ? (this._forcedModel.includes("pro") ? "gemini-pro" : "gemini-flash")
          : "deepseek";
        const activeProvider = this.llm.getProviderName();
        if (activeProvider !== forcedProvider) {
          this.llm.switchProvider(forcedProvider);
          this.llm.setModel(this._forcedModel);
          this._currentProvider = forcedProvider;
        }
      }
      return this._forcedModel;
    }

    // 2. Get mode default tier (orchestrator/ask → "free", code/debug → "cheap")
    const modeDefault = getModelForMode(currentMode); // "free"|"cheap"|"reasoner"
    let tier = modeDefault;

    // 3. Check for provider degradation and escalate if needed
    if (this.llm) {
      const health = this.llm.getProviderHealth();
      if (tier === "free") {
        const freeHealth = health?.free;
        if (freeHealth?.degraded) {
          this.emit("log", "   ⚠️ OpenRouter Free está degradado — usando DeepSeek Flash");
          tier = "cheap";
        }
      }
      if (tier === "cheap") {
        const deepseekHealth = health?.deepseek;
        if (deepseekHealth?.degraded) {
          this.emit("log", "   ⚠️ DeepSeek Flash está degradado — usando Pro directamente");
          tier = "reasoner";
        }
      }
    }

    // 4. Resolve tier to concrete provider + model
    const resolved = this._resolveTierToProvider(tier);
    this._currentTier = tier;
    this._currentProvider = resolved.provider;

    // Switch provider if different from current active
    if (this.llm && this.llm.getProviderName() !== resolved.provider) {
      this.llm.switchProvider(resolved.provider);
    }

    return resolved.model;
  }

  // ─── Smart Flash→Pro Escalation ─────────────────────────────────────────

  /**
   * Map a tier name to a concrete provider + model configuration.
   *
   * @param {"free"|"cheap"|"reasoner"} tier
   * @returns {{ provider: string, model: string }}
   */

  /**
   * Resolve DeepSeek-specific stream options from environment and context.
   *
   * Reads DEEPSEEK_REASONING_EFFORT env var ("high"|"max") to control thinking effort.
   * Returns extra_body for thinking mode toggle and reasoning_effort for effort control.
   *
   * @param {string} [currentMode] - Active mode slug (for mode-specific tuning)
   * @returns {{ extra_body?: object, reasoning_effort?: string }}
   */
  _resolveStreamOptions(currentMode = "orchestrator") {
    const options = {};
    const effort = process.env.DEEPSEEK_REASONING_EFFORT || "high";

    // Thinking mode: enabled by default on Pro, controllable via env
    if (effort && effort !== "off") {
      options.reasoning_effort = effort === "max" ? "max" : "high";
      // Only pass extra_body if explicitly toggled via env
      if (process.env.DEEPSEEK_THINKING_MODE === "enabled") {
        options.extra_body = { thinking: { type: "enabled" } };
      } else if (process.env.DEEPSEEK_THINKING_MODE === "disabled") {
        options.extra_body = { thinking: { type: "disabled" } };
      }
    }

    // Future: mode-specific options (e.g., JSON mode for code generation)
    // if (currentMode === "code") {
    //   options.response_format = { type: "json_object" };
    // }

    return options;
  }

  _resolveTierToProvider(tier) {
    switch (tier) {
      case "free":
        return { provider: "free", model: process.env.OPENROUTER_MODEL_FREE || "google/gemma-4-31b-it:free" };
      case "cheap":
        return { provider: "deepseek", model: process.env.DEEPSEEK_MODEL_CHEAP || "deepseek-v4-flash" };
      case "reasoner":
        return { provider: "deepseek", model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro" };
      case "gemini":
      case "gemini-flash":
        return { provider: "gemini-flash", model: process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp" };
      case "gemini-pro":
        return { provider: "gemini-pro", model: process.env.GEMINI_PRO_MODEL || "gemini-2.0-pro-exp-02-05" };
      default:
        return { provider: "deepseek", model: CONFIG.model };
    }
  }

  /**
   * Returns the ordered fallback chain for a given tier.
   *
   * Free (OpenRouter: Gemma 4 31B / GPT-OSS 120B) → Cheap (DeepSeek Flash) → Reasoner (DeepSeek Pro) → Gemini
   * Cheap (DeepSeek Flash) → Reasoner (DeepSeek Pro) → Gemini
   * Reasoner (DeepSeek Pro) → Gemini
   *
   * @param {"free"|"cheap"|"reasoner"|"gemini"} currentTier
   * @returns {Array<{ tier: string, provider: string, model: string }>}
   */
  _getFallbackChain(currentTier) {
    switch (currentTier) {
      case "free":
        return [
          { tier: "cheap", provider: "deepseek", model: process.env.DEEPSEEK_MODEL_CHEAP || "deepseek-v4-flash" },
          { tier: "reasoner", provider: "deepseek", model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro" },
          { tier: "gemini", provider: "gemini-flash", model: process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp" },
        ];
      case "cheap":
        return [
          { tier: "reasoner", provider: "deepseek", model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro" },
          { tier: "gemini", provider: "gemini-flash", model: process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp" },
        ];
      case "reasoner":
        return [
          { tier: "gemini", provider: "gemini-flash", model: process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp" },
          { tier: "gemini-pro", provider: "gemini-pro", model: process.env.GEMINI_PRO_MODEL || "gemini-2.0-pro-exp-02-05" },
        ];
      case "gemini":
      case "gemini-flash":
        return [
          { tier: "gemini-pro", provider: "gemini-pro", model: process.env.GEMINI_PRO_MODEL || "gemini-2.0-pro-exp-02-05" },
          { tier: "reasoner", provider: "deepseek", model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro" },
        ];
      case "gemini-pro":
        return [
          { tier: "reasoner", provider: "deepseek", model: process.env.DEEPSEEK_MODEL_REASONER || "deepseek-v4-pro" },
        ];
      default:
        return [];
    }
  }

  /**
   * Execute the fallback chain for the current tier.
   * When escalating from cheap (Flash) to reasoner (Pro), only
   * minimal context is sent — not the full conversation history.
   *
   * @param {Array} cacheMessages - Messages to send to fallback provider
   * @param {Array} tools         - Tool definitions
   * @returns {Promise<{ success: boolean, fullContent?: string, fullReasoning?: string, streamedToolCalls?: object }>}
   */
  async _executeFallbackChain(cacheMessages, tools) {
    this._fallbackAttempted = true;
    const currentTier = this._currentTier || "cheap";
    const fallbackChain = this._getFallbackChain(currentTier);

    if (fallbackChain.length === 0) {
      this.emit("log", "   ℹ️ No hay respaldo disponible para el tier actual");
      return { success: false };
    }

    for (const fallback of fallbackChain) {
      const { tier, provider, model } = fallback;

      // Skip if already on this provider/tier
      if (provider === this._currentProvider && tier === this._currentTier) {
        continue;
      }

      // Build and emit Spanish warning
      const warning = this._buildFallbackWarning(
        this._currentProvider || "deepseek",
        provider,
        `Error de API — probando respaldo`
      );
      this.emit("warn", warning);

      try {
        // Switch to fallback provider
        this.llm.switchProvider(provider);
        if (model) {
          this.llm.setModel(model);
        }

        // ── Minimal Context for Flash→Pro escalation ───────────────
        // When escalating from cheap (Flash) to reasoner (Pro), avoid
        // sending the full conversation history. Instead, build a
        // compressed context with only the essential information.
        const isEscalation = currentTier === "cheap" && tier === "reasoner";
        const messages = isEscalation
          ? this._buildMinimalContext(cacheMessages)
          : cacheMessages;

        // Create new AbortController for the fallback stream
        this._abortController = new AbortController();

        // Attempt the fallback stream with (possibly minimal) messages
        const fallbackStream = this.llm.stream(messages, {
          tools: tools.length > 0 ? tools : undefined,
          signal: this._abortController.signal,
          ...this._streamOptions,
        });

        const fallbackResult = await this._processLLMStream(fallbackStream, {
          fullContent: "",
          fullReasoning: "",
          streamedToolCalls: {},
          lastReasoningEmit: "",
          lastContentEmit: "",
          abortLabel: "aborted by user during fallback",
        });

        // Fallback succeeded — update state
        this._currentTier = tier;
        this._currentProvider = provider;
        this.emit("log", `   ✅ Fallback exitoso → ${provider} (${model})`);

        return { success: true, ...fallbackResult };
      } catch (fallbackErr) {
        this.emit("warn", `   ❌ Fallback a ${provider} falló: ${fallbackErr.message}`);
        // Continue to next fallback option
      }
    }

    // All fallbacks failed
    this.emit("log", "   ❌ Todos los respaldos agotados");
    return { success: false };
  }

  /**
   * Build a minimal context message array for model escalation.
   * Instead of sending the full conversation history to Pro,
   * only essential information is included:
   *   1. System prompt (first message)
   *   2. A compressed summary of what was attempted and failed
   *   3. The original/last user request
   *
   * @param {Array} fullMessages - The complete message array from cache loop
   * @returns {Array} Minimal messages for Pro model
   */
  _buildMinimalContext(fullMessages) {
    const minimal = [];

    // 1. System prompt (always first)
    const systemMsg = fullMessages.find(m => m.role === 'system');
    if (systemMsg) minimal.push(systemMsg);

    // 2. Compressed summary of what failed
    const userMsgCount = fullMessages.filter(m => m.role === 'user').length;
    const lastUserMsg = [...fullMessages].reverse().find(m => m.role === 'user');
    const lastAssistantMsg = [...fullMessages].reverse().find(m => m.role === 'assistant');

    const failureContext = [
      `[CONTEXTO COMPRIMIDO — Escalación a modelo Pro]`,
      `El modelo Flash (rápido) falló tras ${this.iterationCount || 1} iteraciones.`,
      `Total de mensajes en conversación original: ${fullMessages.length}.`,
      userMsgCount > 1 ? `Se enviaron ${userMsgCount} mensajes de usuario antes del fallo.` : '',
      lastAssistantMsg
        ? `Última respuesta del asistente: ${(lastAssistantMsg.content || '').substring(0, 500)}...`
        : '',
    ].filter(Boolean).join('\n');

    minimal.push({ role: 'system', content: failureContext });

    // 3. The last/original user request
    if (lastUserMsg) {
      minimal.push(lastUserMsg);
    }

    this.emit("log", `   📦 Contexto comprimido: ${fullMessages.length} → ${minimal.length} mensajes para modelo Pro`);
    return minimal;
  }

  /**
   * Build a user-facing warning message in Spanish when falling back
   * from one provider to another.
   *
   * @param {string} fromProvider - Name of the failing provider
   * @param {string} toProvider   - Name of the fallback provider
   * @param {string} reason       - Reason for the fallback
   * @returns {string} Formatted warning message
   */
  _buildFallbackWarning(fromProvider, toProvider, reason) {
    const providerLabels = {
      deepseek: "DeepSeek",
    };
    const fromLabel = providerLabels[fromProvider] || fromProvider;
    const toLabel   = providerLabels[toProvider]   || toProvider;

    return (
      `   ⚠️ ${fromLabel} no disponible (${reason}). ` +
      `Cambiando a ${toLabel} como respaldo...`
    );
  }

  /**
   * Determine if an error should trigger the fallback chain.
   * Triggers on: 402 (billing), 401/403 (auth), 429 (rate limit),
   * quota exceeded, timeout, or circuit breaker events.
   *
   * @param {Error} error - The error to evaluate
   * @returns {boolean} True if fallback should be attempted
   */
  _isFallbackTrigger(error) {
    if (!error) return false;

    const msg = (error.message || "").toLowerCase();
    const status = error.status || error.statusCode || 0;

    // HTTP status-based triggers
    if (status === 402 || status === 401 || status === 403) return true;  // Billing / Auth
    if (status === 429) return true;                                       // Rate limit
    if (status === 503 || status === 502) return true;                    // Service unavailable

    // Message-based triggers
    if (msg.includes("quota") || msg.includes("rate limit")) return true;
    if (msg.includes("insufficient_balance") || msg.includes("billing")) return true;
    if (msg.includes("timeout") || msg.includes("timed out")) return true;
    if (msg.includes("circuito abierto") || msg.includes("circuit is open")) return true;
    if (msg.includes("internal server error")) return true;
    if (msg.includes("too many requests")) return true;
    if (msg.includes("authentication") || msg.includes("unauthorized")) return true;
    if (msg.includes("unavailable") || msg.includes("service")) return true;

    return false;
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────
export default Orchestrator;
