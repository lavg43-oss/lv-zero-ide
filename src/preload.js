/**
 * lv-zero — Preload Script (IPC Bridge)
 *
 * v2.1 — Reactive IPC Broadcast
 *   + Nuevos canales: terminal:execCommand, file:watchStart/Stop, panel:toggle
 *   + Nuevos eventos push: fs:update, editor:openFile, panel:visibility
 *   + Shell output events for terminal reactiva
 *
 * v2.0 — IDE Edition
 *   Puente de comunicación entre el renderer (IDE) y el main process (Orchestrator + Bridges).
 *   Expone una API segura al contexto de la ventana via contextBridge.
 *
 * v2.2 — CJS Migration
 *   Converted from ESM `import` to CommonJS `require()` because Electron's sandbox
 *   loader evaluates preload scripts as CommonJS. ESM `import` threw:
 *   SyntaxError: Cannot use import statement outside a module
 */

const { contextBridge, ipcRenderer } = require("electron");

// ─── IPC Channel Definitions ────────────────────────────────────────────────
const IPC_CHANNELS = {
  // ── Agent Control ──────────────────────────────────────────────────────
  "agent:send": (userInput) => ipcRenderer.invoke("agent:send", userInput),
  "agent:status": () => ipcRenderer.invoke("agent:status"),
  "agent:clear": () => ipcRenderer.invoke("agent:clear"),
  "agent:stop": () => ipcRenderer.invoke("agent:stop"),

  // ── 🧹 Amnesia — Clear short-term memory ───────────────────────────────
  "chat:clear_context": () => ipcRenderer.invoke("chat:clear_context"),

  // ── Skills ─────────────────────────────────────────────────────────────
  "skills:list": () => ipcRenderer.invoke("skills:list"),
  "skills:reload": () => ipcRenderer.invoke("skills:reload"),

  // ── Session ────────────────────────────────────────────────────────────
  "session:status": () => ipcRenderer.invoke("session:status"),
  "session:plan": (content) => ipcRenderer.invoke("session:plan", content),

  // ── Settings Store (Phase 6) ──────────────────────────────────────────
  "settings:get": (key) => ipcRenderer.invoke("settings:get", key),
  "settings:set": (key, value) => ipcRenderer.invoke("settings:set", key, value),
  "settings:getAll": () => ipcRenderer.invoke("settings:getAll"),
  "settings:delete": (key) => ipcRenderer.invoke("settings:delete", key),

  // ── Config ─────────────────────────────────────────────────────────────
  "config:get": () => ipcRenderer.invoke("config:get"),

  // ── Dialog ─────────────────────────────────────────────────────────────
  "dialog:openFile": () => ipcRenderer.invoke("dialog:openFile"),
  "dialog:openDirectory": () => ipcRenderer.invoke("dialog:openDirectory"),

  // ── Workflows ──────────────────────────────────────────────────────────
  "workflows:list": () => ipcRenderer.invoke("workflows:list"),
  "workflows:help": () => ipcRenderer.invoke("workflows:help"),
  "workflows:active": () => ipcRenderer.invoke("workflows:active"),

  // ── Terminal (node-pty) ────────────────────────────────────────────────
  "terminal:create": () => ipcRenderer.invoke("terminal:create"),
  "terminal:write": (data) => ipcRenderer.invoke("terminal:write", data),
  "terminal:resize": (cols, rows) => ipcRenderer.invoke("terminal:resize", cols, rows),
  "terminal:kill": () => ipcRenderer.invoke("terminal:kill"),
  "terminal:execCommand": (command, options) => ipcRenderer.invoke("terminal:execCommand", command, options),
  "terminal:switchShell": (shellType) => ipcRenderer.invoke("terminal:switchShell", shellType),
  "terminal:shellInfo": () => ipcRenderer.invoke("terminal:shellInfo"),

  // ── File System ────────────────────────────────────────────────────────
  "file:read": (filePath) => ipcRenderer.invoke("file:read", filePath),
  "file:write": (filePath, content) => ipcRenderer.invoke("file:write", filePath, content),
  "file:list": (dirPath) => ipcRenderer.invoke("file:list", dirPath),
  "file:tree": (dirPath, maxDepth) => ipcRenderer.invoke("file:tree", dirPath, maxDepth),
  "file:create": (filePath, content) => ipcRenderer.invoke("file:create", filePath, content),
  "file:mkdir": (dirPath) => ipcRenderer.invoke("file:mkdir", dirPath),
  "file:delete": (targetPath) => ipcRenderer.invoke("file:delete", targetPath),
  "file:rename": (oldPath, newPath) => ipcRenderer.invoke("file:rename", oldPath, newPath),
  "file:info": (targetPath) => ipcRenderer.invoke("file:info", targetPath),
  "file:watchStart": () => ipcRenderer.invoke("file:watchStart"),
  "file:watchStop": () => ipcRenderer.invoke("file:watchStop"),

  // ── Diff Review (Misión 2) ─────────────────────────────────────────────
  "file:acceptDiff": (filePath, content) => ipcRenderer.invoke("file:acceptDiff", filePath, content),
  "file:rejectDiff": (filePath) => ipcRenderer.invoke("file:rejectDiff", filePath),

  // ── Config (Auto-Approve) ──────────────────────────────────────────────
  "config:setAutoApprove": (settings) => ipcRenderer.invoke("config:setAutoApprove", settings),

  // ── Git Integration ────────────────────────────────────────────────────
  "git:status": () => ipcRenderer.invoke("git:status"),
  "git:diff": (filePath) => ipcRenderer.invoke("git:diff", filePath),
  "git:autoCommit": () => ipcRenderer.invoke("git:autoCommit"),

  // ── Skills (Direct Invocation) ─────────────────────────────────────────
  "skill:runRepoMapper": (directory) => ipcRenderer.invoke("skill:runRepoMapper", directory),
  "skill:runCodeMapper": (params) => ipcRenderer.invoke("skill:runCodeMapper", params),
  "skill:runApplyDiff": (params) => ipcRenderer.invoke("skill:runApplyDiff", params),

  // ── Panel Toggle (View Menu) ───────────────────────────────────────────
  "panel:toggle": (panelId) => ipcRenderer.invoke("panel:toggle", panelId),

  // ── Follow-Up Question ────────────────────────────────────────────────
  "agent:answer_followup": (answer) => ipcRenderer.invoke("agent:answer_followup", answer),

  // ── Mode Suggestion Approval ──────────────────────────────────────────
  "agent:accept_mode_suggestion": () => ipcRenderer.invoke("agent:accept_mode_suggestion"),
  "agent:deny_mode_suggestion": () => ipcRenderer.invoke("agent:deny_mode_suggestion"),

  // ── Mode Switching ─────────────────────────────────────────────────────
  "mode:switch": (modeSlug) => ipcRenderer.invoke("mode:switch", modeSlug),

  // ── Model Override ─────────────────────────────────────────────────────
  "model:setModel": (tier) => ipcRenderer.invoke("model:setModel", tier),
  "model:getAvailable": () => ipcRenderer.invoke("model:getAvailable"),

  // ── Auth Guard (Fase 5) ────────────────────────────────────────────────
  "auth:saveKey": (apiKey) => ipcRenderer.invoke("auth:saveKey", apiKey),

  // ── Secret Storage (Phase 0.1) ─────────────────────────────────────────
  "secrets:saveKey": (service, key) => ipcRenderer.invoke("secrets:saveKey", service, key),
  "secrets:getKey": (service) => ipcRenderer.invoke("secrets:getKey", service),
  "secrets:list": () => ipcRenderer.invoke("secrets:list"),
  "secrets:deleteKey": (service) => ipcRenderer.invoke("secrets:deleteKey", service),
  "secrets:hasKey": (service) => ipcRenderer.invoke("secrets:hasKey", service),

  // ── Project Management ─────────────────────────────────────────────────
  "project:new": (options) => ipcRenderer.invoke("project:new", options),
  "project:open": (options) => ipcRenderer.invoke("project:open", options),
  "project:close": () => ipcRenderer.invoke("project:close"),
  "project:duplicate": () => ipcRenderer.invoke("project:duplicate"),
  "project:export": () => ipcRenderer.invoke("project:export"),
  "project:listRecent": () => ipcRenderer.invoke("project:listRecent"),
  "project:current": () => ipcRenderer.invoke("project:current"),
  "project:info": () => ipcRenderer.invoke("project:info"),

  // ── Project Identity (Phase 1) ────────────────────────────────────────
  "project:identity": (projectPath) => ipcRenderer.invoke("project:identity", projectPath),
  "project:identity-update": (projectPath, updates) => ipcRenderer.invoke("project:identity-update", projectPath, updates),
  "project:identity-create": (projectPath, config) => ipcRenderer.invoke("project:identity-create", projectPath, config),

  // ── Permissions (Phase 2) ─────────────────────────────────────────────
  "permissions:check": (projectPath, permissionType, target) => ipcRenderer.invoke("permissions:check", projectPath, permissionType, target),
  "permissions:list": (projectPath) => ipcRenderer.invoke("permissions:list", projectPath),

  // ── Workspace State (per-project persistence) ───────────────────────
  "workspace:getState": (opts) => ipcRenderer.invoke("workspace:getState", opts),
  "workspace:saveState": (opts) => ipcRenderer.invoke("workspace:saveState", opts),
  "workspace:id": (opts) => ipcRenderer.invoke("workspace:id", opts),

  // ── MCP Config Manager ──────────────────────────────────────────────
  "mcp:status": () => ipcRenderer.invoke("mcp:status"),
  "mcp:connect": (serverName) => ipcRenderer.invoke("mcp:connect", serverName),
  "mcp:disconnect": (serverName) => ipcRenderer.invoke("mcp:disconnect", serverName),
  "mcp:reconnect": (serverName) => ipcRenderer.invoke("mcp:reconnect", serverName),
  "mcp:config": () => ipcRenderer.invoke("mcp:config"),
  "mcp:configSave": (config) => ipcRenderer.invoke("mcp:configSave", config),
  "mcp:saveEnabled": (serverIds) => ipcRenderer.invoke("mcp:saveEnabled", serverIds),
  "mcp:getEnabled": () => ipcRenderer.invoke("mcp:getEnabled"),
  "mcp:listRegistry": () => ipcRenderer.invoke("mcp:listRegistry"),

  // ── MCP Health & Tool Management (Phase 3) ─────────────────────────
  "mcp:healthStatus": () => ipcRenderer.invoke("mcp:healthStatus"),
  "mcp:getTools": (serverId) => ipcRenderer.invoke("mcp:getTools", serverId),
  "mcp:disableTool": (serverId, toolName) => ipcRenderer.invoke("mcp:disableTool", serverId, toolName),
  "mcp:enableTool": (serverId, toolName) => ipcRenderer.invoke("mcp:enableTool", serverId, toolName),
  "mcp:getDisabledTools": (serverId) => ipcRenderer.invoke("mcp:getDisabledTools", serverId),

  // ── 🚨 Crash Recovery ────────────────────────────────────────────────
  "crash:getState": () => ipcRenderer.invoke("crash:getState"),
  "crash:recover": () => ipcRenderer.invoke("crash:recover"),
  "crash:dismiss": () => ipcRenderer.invoke("crash:dismiss"),

  // ── 🧠 Memory (Symphony + NeuralMemory) ─────────────────────────────
  "memory:store": (payload) => ipcRenderer.invoke("memory:store", payload),
  "memory:get": (payload) => ipcRenderer.invoke("memory:get", payload),
  "memory:search": (payload) => ipcRenderer.invoke("memory:search", payload),
  "memory:delete": (payload) => ipcRenderer.invoke("memory:delete", payload),
  "memory:list-by-type": (payload) => ipcRenderer.invoke("memory:list-by-type", payload),
  "memory:stats": (payload) => ipcRenderer.invoke("memory:stats", payload),
  "memory:share": (payload) => ipcRenderer.invoke("memory:share", payload),
  "memory:associative-search": (payload) => ipcRenderer.invoke("memory:associative-search", payload),
  "memory:find-related": (payload) => ipcRenderer.invoke("memory:find-related", payload),
  "memory:build-context": (payload) => ipcRenderer.invoke("memory:build-context", payload),
  "memory:preflight": (payload) => ipcRenderer.invoke("memory:preflight", payload),
  "memory:ping": () => ipcRenderer.invoke("memory:ping"),
  "memory:audit": (payload) => ipcRenderer.invoke("memory:audit", payload),
  "memory:audit-history": (payload) => ipcRenderer.invoke("memory:audit-history", payload),
  "memory:evolve": (payload) => ipcRenderer.invoke("memory:evolve", payload),

  // ── 📋 Session (4-Phase Restore) ────────────────────────────────────
  "session:restore-full": (payload) => ipcRenderer.invoke("session:restore-full", payload),
  "session:save": (payload) => ipcRenderer.invoke("session:save", payload),
  "session:load": (payload) => ipcRenderer.invoke("session:load", payload),
  "session:list": (payload) => ipcRenderer.invoke("session:list", payload),
  "session:delete": (payload) => ipcRenderer.invoke("session:delete", payload),
  "session:save-workspace": (payload) => ipcRenderer.invoke("session:save-workspace", payload),
  "session:save-task": (payload) => ipcRenderer.invoke("session:save-task", payload),
  "session:list-tasks": (payload) => ipcRenderer.invoke("session:list-tasks", payload),

  // ── 🔧 Workflow Triggers ────────────────────────────────────────────
  "workflow:register-trigger": (payload) => ipcRenderer.invoke("workflow:register-trigger", payload),
  "workflow:unregister-trigger": (payload) => ipcRenderer.invoke("workflow:unregister-trigger", payload),
  "workflow:list-triggers": (payload) => ipcRenderer.invoke("workflow:list-triggers", payload),
  "workflow:evaluate-event": (payload) => ipcRenderer.invoke("workflow:evaluate-event", payload),

  // ── ⚖️ Iron Laws (Phase 3) ──────────────────────────────────────────
  "iron-laws:check": (projectPath, context) => ipcRenderer.invoke("iron-laws:check", projectPath, context),
  "iron-laws:evidence-save": (projectPath, taskId, evidence) => ipcRenderer.invoke("iron-laws:evidence-save", projectPath, taskId, evidence),
  "iron-laws:evidence-get": (projectPath, taskId) => ipcRenderer.invoke("iron-laws:evidence-get", projectPath, taskId),
  "iron-laws:evidence-summary": (projectPath) => ipcRenderer.invoke("iron-laws:evidence-summary", projectPath),

  // ── 🧪 Diagnose Wizard (Phase 10) ────────────────────────────────────
  "diagnose:create-session": (projectPath) => ipcRenderer.invoke("diagnose:create-session", projectPath),
  "diagnose:get-session": (projectPath, sessionId) => ipcRenderer.invoke("diagnose:get-session", projectPath, sessionId),
  "diagnose:list-sessions": (projectPath) => ipcRenderer.invoke("diagnose:list-sessions", projectPath),
  "diagnose:update-session": (projectPath, sessionId, updates) => ipcRenderer.invoke("diagnose:update-session", projectPath, sessionId, updates),
  "diagnose:advance-step": (projectPath, sessionId, stepData) => ipcRenderer.invoke("diagnose:advance-step", projectPath, sessionId, stepData),
  "diagnose:get-current-step": (projectPath, sessionId) => ipcRenderer.invoke("diagnose:get-current-step", projectPath, sessionId),
  "diagnose:delete-session": (projectPath, sessionId) => ipcRenderer.invoke("diagnose:delete-session", projectPath, sessionId),
  "diagnose:complete-session": (projectPath, sessionId, evidenceOpts) => ipcRenderer.invoke("diagnose:complete-session", projectPath, sessionId, evidenceOpts),

  // ── 🔥 Grill Me Wizard (Phase 4 – Scope Interview) ──────────────────
  "grill-me:create-session": (projectPath) => ipcRenderer.invoke("grill-me:create-session", projectPath),
  "grill-me:submit-answer": (sessionId, questionId, answer) => ipcRenderer.invoke("grill-me:submit-answer", sessionId, questionId, answer),
  "grill-me:skip-question": (sessionId, questionId) => ipcRenderer.invoke("grill-me:skip-question", sessionId, questionId),
  "grill-me:get-session-state": (sessionId) => ipcRenderer.invoke("grill-me:get-session-state", sessionId),
  "grill-me:generate-specs": (sessionId, projectPath, identity) => ipcRenderer.invoke("grill-me:generate-specs", sessionId, projectPath, identity),

  // ── 📋 Init Pipeline (Phase 4) ──────────────────────────────────────
  "init-pipeline:run": (projectPath) => ipcRenderer.invoke("init-pipeline:run", projectPath),
  "spec:read": (projectPath, specType) => ipcRenderer.invoke("spec:read", projectPath, specType),

  // ── 📋 Code Review (Phase 5) ────────────────────────────────────────
  "code-review:review": (projectPath, filePath) => ipcRenderer.invoke("code-review:review", projectPath, filePath),
  "code-review:review-all": (projectPath) => ipcRenderer.invoke("code-review:review-all", projectPath),
  "code-review:reports": (projectPath) => ipcRenderer.invoke("code-review:reports", projectPath),

  // ── 📦 Deploy Pipeline (Phase 6) ────────────────────────────────────
  "deploy:run": (projectPath, options) => ipcRenderer.invoke("deploy:run", projectPath, options),
  "deploy:audit": (projectPath) => ipcRenderer.invoke("deploy:audit", projectPath),
  "deploy:releases": (projectPath) => ipcRenderer.invoke("deploy:releases", projectPath),

  // ── 🚀 Smart Launcher (Phase 7) ─────────────────────────────────────
  "launcher:detect": (projectPath) => ipcRenderer.invoke("launcher:detect", projectPath),
  "launcher:precheck": (projectPath, target) => ipcRenderer.invoke("launcher:precheck", projectPath, target),
  "launcher:config": (projectPath, config) => ipcRenderer.invoke("launcher:config", projectPath, config),

  // ── 🔌 Supabase Integration (Phase 8) ──────────────────────────────
  "supabase:query": (projectPath, table, options) => ipcRenderer.invoke("supabase:query", projectPath, table, options),
  "supabase:insert": (projectPath, table, rows) => ipcRenderer.invoke("supabase:insert", projectPath, table, rows),
  "supabase:sql": (projectPath, sqlQuery) => ipcRenderer.invoke("supabase:sql", projectPath, sqlQuery),
  "supabase:schema": (projectPath) => ipcRenderer.invoke("supabase:schema", projectPath),

  // ── ☁️ Cloudflare Integration (Phase 8) ────────────────────────────
  "cloudflare:generate-worker": (projectPath, options) => ipcRenderer.invoke("cloudflare:generate-worker", projectPath, options),
  "cloudflare:generate-wrangler": (projectPath, options) => ipcRenderer.invoke("cloudflare:generate-wrangler", projectPath, options),

  // ── 🔧 Node-RED Integration (Phase 8) ──────────────────────────────
  "nodered:flows": (flowsFilePath) => ipcRenderer.invoke("nodered:flows", flowsFilePath),
  "nodered:flow": (flowId, flowsFilePath) => ipcRenderer.invoke("nodered:flow", flowId, flowsFilePath),

  // ── 📋 Trello Integration (Phase 8) ────────────────────────────────
  "trello:config": (projectPath) => ipcRenderer.invoke("trello:config", projectPath),
  "trello:create-card": (projectPath, name, desc) => ipcRenderer.invoke("trello:create-card", projectPath, name, desc),
  "trello:add-comment": (projectPath, comment) => ipcRenderer.invoke("trello:add-comment", projectPath, comment),

  // ── ⏱ Timer System (Unified Timer & Timeout) ────────────────────
  "timer:config": () => ipcRenderer.invoke("timer:config"),
  "timer:get-timeout": (commandOrPreset) => ipcRenderer.invoke("timer:get-timeout", commandOrPreset),

  // ── 🎨 Frontend-Design Auditor ─────────────────────────────────
  "frontend:audit-file": (projectPath, filePath) => ipcRenderer.invoke("frontend:audit-file", projectPath, filePath),
  "frontend:audit-directory": (projectPath) => ipcRenderer.invoke("frontend:audit-directory", projectPath),
  "frontend:audit-all": (projectPath) => ipcRenderer.invoke("frontend:audit-all", projectPath),

  // ── 🌐 Agent Browser ────────────────────────────────────────────
  "browser:open": (url, options) => ipcRenderer.invoke("browser:open", url, options),
  "browser:navigate": (sessionId, url) => ipcRenderer.invoke("browser:navigate", sessionId, url),
  "browser:execute-script": (sessionId, code) => ipcRenderer.invoke("browser:execute-script", sessionId, code),
  "browser:get-content": (sessionId) => ipcRenderer.invoke("browser:get-content", sessionId),
  "browser:screenshot": (sessionId) => ipcRenderer.invoke("browser:screenshot", sessionId),
  "browser:click": (sessionId, selector) => ipcRenderer.invoke("browser:click", sessionId, selector),
  "browser:fill": (sessionId, selector, value) => ipcRenderer.invoke("browser:fill", sessionId, selector, value),
  "browser:get-text": (sessionId, selector) => ipcRenderer.invoke("browser:get-text", sessionId, selector),
  "browser:wait-for": (sessionId, selector, timeout) => ipcRenderer.invoke("browser:wait-for", sessionId, selector, timeout),
  "browser:logs": (sessionId) => ipcRenderer.invoke("browser:logs", sessionId),
  "browser:close": (sessionId) => ipcRenderer.invoke("browser:close", sessionId),
  "browser:test-command": (name) => ipcRenderer.invoke("browser:test-command", name),
  "browser:run-test": (sessionId, commandName) => ipcRenderer.invoke("browser:run-test", sessionId, commandName),
  "browser:list-sessions": () => ipcRenderer.invoke("browser:list-sessions"),

  // ── 📂 Workspace Management (multi-folder projects) ────────────────────
  "workspace:status": () => ipcRenderer.invoke("workspace:status"),
  "workspace:addFolder": (folderPath, label) => ipcRenderer.invoke("workspace:addFolder", folderPath, label),
  "workspace:removeFolder": (folderPath) => ipcRenderer.invoke("workspace:removeFolder", folderPath),
  "workspace:create": (options) => ipcRenderer.invoke("workspace:create", options),
  "workspace:close": () => ipcRenderer.invoke("workspace:close"),

  // ── 🌐 Live Preview ────────────────────────────────────────────────────
  "preview:start": (projectPath) => ipcRenderer.invoke("preview:start", projectPath),
  "preview:stop": () => ipcRenderer.invoke("preview:stop"),
  "preview:status": () => ipcRenderer.invoke("preview:status"),
  "preview:restart": (projectPath) => ipcRenderer.invoke("preview:restart", projectPath),

  // ── 🚀 Cloudflare Pages Publish ────────────────────────────────────────
  "publish:deploy": (projectPath) => ipcRenderer.invoke("publish:deploy", projectPath),
  "publish:status": (projectPath) => ipcRenderer.invoke("publish:status", projectPath),
  "publish:setup": () => ipcRenderer.invoke("publish:setup"),

  // ── 🎙️ Discovery Phase (Nivel Cero Interview) ─────────────────────────
  "discovery:start": () => ipcRenderer.invoke("discovery:start"),
  "discovery:answer": (questionId, value) => ipcRenderer.invoke("discovery:answer", questionId, value),
  "discovery:needsDiscovery": (userInput) => ipcRenderer.invoke("discovery:needsDiscovery", userInput),

  // ── 🗺️ Graph Renderer ─────────────────────────────────────────────────
  "graph:build": (projectPath) => ipcRenderer.invoke("graph:build", projectPath),
  "graph:addFile": (filePath) => ipcRenderer.invoke("graph:addFile", filePath),
  "graph:removeFile": (filePath) => ipcRenderer.invoke("graph:removeFile", filePath),
  "graph:getData": () => ipcRenderer.invoke("graph:getData"),

  // ── 🐝 Swarm / Worker Pool ────────────────────────────────────────────
  "swarm:status": () => ipcRenderer.invoke("swarm:status"),
  "swarm:cancelTask": (taskId) => ipcRenderer.invoke("swarm:cancelTask", taskId),
  "swarm:shutdown": () => ipcRenderer.invoke("swarm:shutdown"),
};

// ─── Event Subscriptions ────────────────────────────────────────────────────
const EVENT_CHANNELS = {
  /**
   * Escucha eventos del orchestrator.
   * @param {string} event - Nombre del evento (log, thought, step, etc.)
   * @param {Function} callback - Función a ejecutar cuando ocurra el evento
   * @returns {Function} - Función para cancelar la suscripción
   */
  on: (event, callback) => {
    const channel = `orchestrator:${event}`;
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Escucha un evento una sola vez.
   */
  once: (event, callback) => {
    const channel = `orchestrator:${event}`;
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },

  /**
   * Elimina todos los listeners de un evento.
   */
  removeAllListeners: (event) => {
    const channel = `orchestrator:${event}`;
    ipcRenderer.removeAllListeners(channel);
  },

  /**
   * Escucha eventos del terminal (data desde node-pty).
   */
  onTerminal: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },

  /**
   * Escucha eventos de salida del terminal.
   */
  onTerminalExit: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },

  /**
   * Escucha cambios de shell activo en el terminal (terminal:shellChanged).
   * Se activa cuando el usuario cambia de CMD a PowerShell o viceversa.
   * @param {Function} callback - Recibe { shell, path }
   * @returns {Function} unsubscribe
   */
  onTerminalShellChanged: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("terminal:shellChanged", handler);
    return () => ipcRenderer.removeListener("terminal:shellChanged", handler);
  },

  // ── Reactive Events ────────────────────────────────────────────────────

  /**
   * Escucha cambios en el sistema de archivos (fs:update).
   * @param {Function} callback - Recibe { type, path, timestamp }
   * @returns {Function} unsubscribe
   */
  onFsUpdate: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("fs:update", handler);
    return () => ipcRenderer.removeListener("fs:update", handler);
  },

  /**
   * Escucha órdenes de abrir archivo en el editor (editor:openFile).
   * @param {Function} callback - Recibe { filePath, content? }
   * @returns {Function} unsubscribe
   */
  onEditorOpenFile: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("editor:openFile", handler);
    return () => ipcRenderer.removeListener("editor:openFile", handler);
  },

  /**
   * Escucha cambios de visibilidad de paneles (panel:visibility).
   * @param {Function} callback - Recibe { panelId, visible }
   * @returns {Function} unsubscribe
   */
  onPanelVisibility: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("panel:visibility", handler);
    return () => ipcRenderer.removeListener("panel:visibility", handler);
  },

  /**
   * Escucha eventos de diff review (editor:diffReview).
   * Se activa cuando el agente intenta modificar un archivo existente.
   * @param {Function} callback - Recibe { filePath, originalContent, newContent }
   * @returns {Function} unsubscribe
   */
  onDiffReview: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("editor:diffReview", handler);
    return () => ipcRenderer.removeListener("editor:diffReview", handler);
  },

  // ── Auto-Healing (Fase 4) ─────────────────────────────────────────────

  /**
   * Escucha errores de comandos en terminal (terminal:commandError).
   * Se activa cuando un comando shell_executor sale con código != 0.
   * @param {Function} callback - Recibe { command, exitCode, stderr, stdout }
   * @returns {Function} unsubscribe
   */
  onCommandError: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("terminal:commandError", handler);
    return () => ipcRenderer.removeListener("terminal:commandError", handler);
  },

  // ── Auth Guard (Fase 5) ─────────────────────────────────────────────

  /**
   * Escucha el evento de autenticación — se dispara cuando no hay API Key
   * almacenada y el frontend debe mostrar el modal de registro.
   * @param {Function} callback - Recibe { message }
   * @returns {Function} unsubscribe
   */
  onAuthRequireKey: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("auth:requireKey", handler);
    return () => ipcRenderer.removeListener("auth:requireKey", handler);
  },

  // ── Project Management ────────────────────────────────────────────

  /**
   * Escucha cambios de proyecto (abierto, cerrado, creado, duplicado).
   * @param {Function} callback - Recibe { name, path, action }
   * @returns {Function} unsubscribe
   */
  onProjectChanged: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("project:changed", handler);
    return () => ipcRenderer.removeListener("project:changed", handler);
  },

  /**
   * Escucha acciones del menu File (New/Open/Close/Duplicate/Export).
   * @param {Function} callback - Recibe { action }
   * @returns {Function} unsubscribe
   */
  onProjectMenuAction: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("project:menuAction", handler);
    return () => ipcRenderer.removeListener("project:menuAction", handler);
  },

  // ── Mode Switching ──────────────────────────────────────────────────

  /**
   * Escucha cambios de modo del agente.
   * Se dispara cuando el agente cambia de modo (architect, code, ask, debug).
   * @param {Function} callback - Recibe { from, to, icon, name, color, reason }
   * @returns {Function} unsubscribe
   */
  onModeChanged: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:mode_changed", handler);
    return () => ipcRenderer.removeListener("orchestrator:mode_changed", handler);
  },

  /**
   * Escucha sugerencias de cambio de modo por detección de lenguaje natural.
   * Se dispara cuando el detector de intentos encuentra alta confianza para otro modo.
   * @param {Function} callback - Recibe { from, to, confidence, icon, name, matchedKeywords }
   * @returns {Function} unsubscribe
   */
  onModeSuggestion: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:mode_suggestion", handler);
    return () => ipcRenderer.removeListener("orchestrator:mode_suggestion", handler);
  },

  // ── 🚨 Crash Recovery ────────────────────────────────────────────────

  /**
   * Escucha detección de crash del agente.
   * Se dispara cuando el orchestrator detecta un RooState estancado (>30s).
   * @param {Function} callback - Recibe { task, mode, lastAction, heartbeatAge, ... }
   * @returns {Function} unsubscribe
   */
  // ── MCP Config Manager Events ──────────────────────────────────────

  /**
   * Escucha cambios de estado de servidores MCP.
   * Se dispara cuando un servidor MCP se conecta, desconecta, o falla health check.
   * @param {Function} callback - Recibe { servers: [...] }
   * @returns {Function} unsubscribe
   */
  onMCPStatusChanged: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("mcp:status_changed", handler);
    return () => ipcRenderer.removeListener("mcp:status_changed", handler);
  },

  // ── 🚨 Crash Recovery ────────────────────────────────────────────────

  onCrashDetected: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:crash_detected", handler);
    return () => ipcRenderer.removeListener("orchestrator:crash_detected", handler);
  },

  // ── Tool Confirmation (Shell Execute Warning) ──────────────────────

  /**
   * Escucha solicitudes de confirmación para herramientas que requieren aprobación
   * (ej. ejecución de comandos shell cuando autoApprove.execute está OFF).
   * Se dispara desde main.cjs cuando el agente ejecuta un comando shell
   * y el toggle de auto-aprobación de Execute está desactivado.
   * @param {Function} callback - Recibe { type, command, cwd, shell, toolIndex }
   * @returns {Function} unsubscribe
   */
  onToolRequiresConfirmation: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("tool:requires_confirmation", handler);
    return () => ipcRenderer.removeListener("tool:requires_confirmation", handler);
  },

  // ── ⚖️ Iron Laws Violation (Phase 3) ─────────────────────────────────

  /**
   * Escucha violaciones de Iron Laws emitidas desde main.cjs.
   * Se dispara cuando una tarea se completa sin verificación, etc.
   * @param {Function} callback - Recibe { law, passed, reason, evidence }
   * @returns {Function} unsubscribe
   */
  onIronLawViolation: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("iron-laws:violation", handler);
    return () => ipcRenderer.removeListener("iron-laws:violation", handler);
  },

  // ── 📂 Workspace Events ───────────────────────────────────────────────

  /**
   * Escucha cuando se carga un workspace multi-carpeta.
   * @param {Function} callback - Recibe { name, folders, config }
   * @returns {Function} unsubscribe
   */
  onWorkspaceLoaded: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:workspace_loaded", handler);
    return () => ipcRenderer.removeListener("orchestrator:workspace_loaded", handler);
  },

  // ── 🐝 Swarm Events ───────────────────────────────────────────────────

  /**
   * Escucha cuando el swarm de agentes inicia.
   * @param {Function} callback - Recibe { reason, taskCount, tasks }
   * @returns {Function} unsubscribe
   */
  onSwarmStart: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:swarm:start", handler);
    return () => ipcRenderer.removeListener("orchestrator:swarm:start", handler);
  },

  /**
   * Escucha progreso de un agente en segundo plano.
   * @param {Function} callback - Recibe { taskId, name, progress, status, detail }
   * @returns {Function} unsubscribe
   */
  onSwarmTaskProgress: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:swarm:task_progress", handler);
    return () => ipcRenderer.removeListener("orchestrator:swarm:task_progress", handler);
  },

  /**
   * Escucha cuando un agente se completa.
   * @param {Function} callback - Recibe { taskId, name, result, duration }
   * @returns {Function} unsubscribe
   */
  onSwarmTaskComplete: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:swarm:task_complete", handler);
    return () => ipcRenderer.removeListener("orchestrator:swarm:task_complete", handler);
  },

  /**
   * Escucha cuando un agente falla.
   * @param {Function} callback - Recibe { taskId, name, error }
   * @returns {Function} unsubscribe
   */
  onSwarmTaskError: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:swarm:task_error", handler);
    return () => ipcRenderer.removeListener("orchestrator:swarm:task_error", handler);
  },

  /**
   * Escucha cuando todo el swarm se completa.
   * @param {Function} callback - Recibe { totalTasks, completedTasks, failedTasks }
   * @returns {Function} unsubscribe
   */
  onSwarmComplete: (callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on("orchestrator:swarm:complete", handler);
    return () => ipcRenderer.removeListener("orchestrator:swarm:complete", handler);
  },
};

// ─── Expose to Renderer ─────────────────────────────────────────────────────
contextBridge.exposeInMainWorld("lvzero", {
  // IPC invoke methods (request/response)
  ...IPC_CHANNELS,

  // Event subscriptions (push from main)
  events: EVENT_CHANNELS,

  // Version info
  version: "4.1.0",
  platform: process.platform,
});
