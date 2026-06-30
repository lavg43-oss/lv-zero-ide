/**
 * lv-zero — IDE Renderer (Electron Renderer Process)
 *
 * v2.0 — IDE Edition
 *   Controlador principal del IDE de 4 paneles.
 *   Inicializa Split.js, Monaco Editor, XTerm Terminal, File Explorer y AI Chat.
 *
 * Dependencies (loaded via script tags in index.html):
 *   - Split.js  → global `Split`
 *   - XTerm.js  → global `Terminal` + `FitAddon` + `WebLinksAddon`
 *   - Monaco     → global `monaco` (loaded via AMD require())
 *   - lvzero API  → window.lvzero (via preload.js)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ─── IDE Controller ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

class IDEController {
  constructor() {
    // Expose _onProviderChange globally so the HTML onchange attribute can call it
    window._onProviderChange = () => this._onProviderChange();

    // ── State ──
    this.ready = false;
    this.busy = false;
    this.monaco = null;
    this.editor = null;
    this.terminal = null;
    this.fitAddon = null;
    this.splitHoriz = null;
    this.splitVert = null;
    this.terminalActive = false;
    this.switchingShell = false;   // flag to suppress exit message during shell switch
    this.currentFilePath = null;
    this.unsubscribers = [];
    this._pendingThought = null;
    this._pendingReasoningEl = null; // <details> element for real-time reasoning
    this._pendingReasoningText = ""; // accumulated reasoning text
    this._fsUpdateTimer = null; // debounce timer for fs:update events
    this._workspaceSaveTimer = null; // debounce timer for workspace state saves
    this._mcpHealthTimer = null; // periodic MCP health status refresh

    // ── Tab System (Misión 1) ──
    this.openTabs = {};       // { filePath: { model, lang, fileName, savedContent } }
    this.activeTabPath = null;
    this.tabIdCounter = 0;

    // ── Diff Editor (Misión 2) ──
    this.diffEditor = null;
    this._pendingDiff = null; // { filePath, originalContent, newContent }

    // ── Live Preview (Fase 4) ──
    this._previewVisible = false;

    // ── 🌐 Agent Browser Panel ──
    this._browserVisible = false;
    this._browserSessionId = null;

    // ── @ Mentions (Misión 3) ──
    this._fileList = [];      // cached file paths from explorer
    this._mentionFiles = [];  // files attached via @

    // ── Auto-Approve Settings ──
    this._settings = {
      autoApproveEdits: false,
      autoApproveTerminal: false,
    };

    // ── Chat Search State (Ctrl+F) ──
    this._searchQuery = '';
    this._searchMatches = [];
    this._searchCurrentIdx = -1;

    // ── File Explorer Search (Phase 9.4) ──
    this._fileTreeSearchQuery = '';

    // ── Theme State (Phase 9.3) ──
    this._theme = 'dark'; // 'dark' | 'light'

    // ── Multi-Session State ──
    this._sessions = {};          // { id: {id, name, html, createdAt} }
    this._currentSessionId = 'default';
    this._sessionCounter = 1;

    // ── 🐝 Swarm State ──
    this._swarmState = {
      active: false,
      tasks: [],
      completedCount: 0,
      totalCount: 0,
    };

    // ── Project Management State ──
    this._project = {
      name: null,
      path: null,
      isOpen: false,
    };

    // ── Permission State (Phase 2) ──
    this._permissions = {
      active: false,
      projectPerms: null,
      cache: {},
    };

    // ── Mode State ──
    this._mode = { slug: "orchestrator", icon: "🔄", name: "Orchestrator", color: "#FF6B35" };
    this._pendingSuggestion = null;

    // ── DOM refs (populated in init()) ──
    this.els = {};

    // ── Project Wizard State (Phase 9) ──
    this._wizardState = null;

    // ── Diagnose Wizard State (Phase 10) ──
    this._diagnoseState = null;      // { visible, sessionId, stepIndex, session, steps }
    this._diagnoseResolve = null;    // Promise resolve callback

    // ── Grill Me Wizard State (Phase 4 – Scope Interview) ──
    this._grillMeState = null;       // { visible, sessionId, currentIdx, questions, answers, completed }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  async init() {
    // ── Global error handlers to prevent silent crashes ──
    window.onerror = (msg, url, line, col, err) => {
      console.error(`[IDE] GLOBAL ERROR: ${msg} at ${url}:${line}:${col}`, err?.stack || "");
      this.addLogEntry("error", `💥 Global error: ${msg}`);
      return true; // Prevent default browser handling
    };
    window.onunhandledrejection = (event) => {
      console.error(`[IDE] UNHANDLED REJECTION:`, event.reason?.stack || event.reason);
      this.addLogEntry("error", `💥 Unhandled rejection: ${event.reason?.message || event.reason}`);
      event.preventDefault();
    };

    this._cacheDom();

    // ── Auth Guard: Check if any API key is configured FIRST ──
    // Must run BEFORE _bindUIEvents and _connectEvents to prevent
    // the auth modal from showing when keys already exist.
    this._checkApiKeys();

    this._bindUIEvents();

    // ── Message Queue (Feature 3) ──
    this._messageQueue = [];
    this._isProcessing = false;

    // 1. Load persisted settings from localStorage
    this._loadSettings();
    // Bind settings UI after loading (checkboxes get their listeners)
    this._bindSettingsUI();

    // Bind wizard UI (Phase 9)
    this._bindWizardUI();

    // 1b. Load theme preference
    this._loadTheme();

    // 2. Wait for Monaco
    await this._waitForMonaco();
    this._createEditor();

    // 3. Initialize Split.js (3-column layout)
    this._createSplitLayout();

    // 4. Set up terminal (XTerm UI)
    this._createTerminal();

    // 5. Connect orchestrator events FIRST (before startTerminal)
    //    This ensures onTerminal / onTerminalExit listeners are registered
    //    before the PTY is created, so fallback data is not lost.
    this._connectEvents();

    // 6. Start terminal asynchronously (PTY shell created via IPC)
    this.startTerminal().catch((err) => {
      console.error("[IDE] Terminal auto-start failed:", err);
    });

    // 7. Load file explorer (lazy — list root only)
    this._loadFileTree().catch((err) => {
      console.warn("[IDE] File tree load (deferred):", err.message);
    });

    // 8. Load Git status (Version Control panel)
    this._loadGitStatus().catch((err) => {
      console.warn("[IDE] Git status load:", err.message);
    });

    // 9. Load current project state (if any)
    await this._loadProject();

    // 10. Initialize sessions (load from localStorage, render tabs)
    // NOTE: Must run BEFORE _updateStatus() so that session-restored HTML
    // does not overwrite the live system message that _updateStatus() sets.
    // Previously _updateStatus() ran first, then _initSessions() would
    // overwrite the "✓ System ready" message with stale session HTML.
    await this._initSessions();

    // 11. Fetch initial status — detect if orchestrator is already ready
    // Must run AFTER _initSessions() so that the system message is updated
    // after any session restore (which may have replaced the chat HTML).
    await this._updateStatus();

    // 12. Start file watcher for reactive editor (Fase A)
    try {
      await window.lvzero["file:watchStart"]();
      console.log("[IDE] File watcher started");
    } catch (err) {
      console.warn("[IDE] File watcher unavailable:", err.message);
    }

    // 13. Load MCP server status
    try {
      await this._loadMCPStatus();
    } catch (err) {
      console.warn("[IDE] MCP status load:", err.message);
    }

    // 14. Load MCP health status (Phase 3)
    try {
      await this._loadMCPHealthStatus();
    } catch (err) {
      console.warn("[IDE] MCP health status load:", err.message);
    }

    // 15. Start periodic MCP health status refresh (every 15s)
    this._mcpHealthTimer = setInterval(() => {
      this._loadMCPHealthStatus().catch(() => {});
    }, 15000);

    this.ready = true;
    console.log("[IDE] Initialized successfully");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM CACHE
  // ═══════════════════════════════════════════════════════════════════════════

  _cacheDom() {
    this.els = {
      statusBadge: document.getElementById("status-badge"),
      contextGauge: document.getElementById("context-gauge"),
      gaugeFill: document.getElementById("gauge-fill"),
      gaugeLabel: document.getElementById("gauge-label"),
      fileTree: document.getElementById("file-tree"),
      editorContainer: document.getElementById("monaco-editor"),
      editorTabsBar: document.getElementById("editor-tabs-bar"),
      xtermContainer: document.getElementById("xterm-container"),
      chatSearchBar: document.getElementById("chat-search-bar"),
      chatSearchInput: document.getElementById("chat-search-input"),
      chatSearchCount: document.getElementById("chat-search-count"),
      chatSearchPrev: document.getElementById("chat-search-prev"),
      chatSearchNext: document.getElementById("chat-search-next"),
      chatSearchClose: document.getElementById("chat-search-close"),
      sessionTabs: document.getElementById("session-tabs"),
      btnNewSession: document.getElementById("btn-new-session"),
      chatMessages: document.getElementById("chat-messages"),
      chatInput: document.getElementById("chat-input"),
      chatInputArea: document.getElementById("chat-input-area"),
      dropOverlay: document.getElementById("drop-overlay"),
      sendBtn: document.getElementById("send-btn"),
      charCounter: document.getElementById("charCounter"),
      stopBtn: document.getElementById("stop-btn"),
      inspectorLog: document.getElementById("inspector-log"),
      autocompleteBox: document.getElementById("autocomplete-box"),
      refreshTreeBtn: document.getElementById("btn-refresh-tree"),
      initTerminalBtn: document.getElementById("btn-init-terminal"),
      newTerminalBtn: document.getElementById("btn-new-terminal"),
      terminalShellSelector: document.getElementById("terminal-shell-selector"),
      clearConvBtn: document.getElementById("btn-clear-conversation"),
      btnAmnesia: document.getElementById("btn-amnesia"),
      chatSettingsBtn: document.getElementById("btn-chat-settings"),
      // ── Diff Editor (Misión 2) ──
      diffOverlay: document.getElementById("diff-overlay"),
      diffEditorContainer: document.getElementById("diff-editor-container"),
      diffFilePath: document.getElementById("diff-filepath"),
      diffBtnAccept: document.getElementById("diff-btn-accept"),
      diffBtnReject: document.getElementById("diff-btn-reject"),
      // ── Settings Modal (Auto-Approve) ──
      settingsOverlay: document.getElementById("settings-overlay"),
      settingsClose: document.getElementById("btn-settings-close"),
      chkAutoApproveEdits: document.getElementById("chk-auto-approve-edits"),
      chkAutoApproveTerminal: document.getElementById("chk-auto-approve-terminal"),
      // ── API Key Management (Phase 0.1) ──
      apiKeyManager: document.getElementById("api-key-manager"),
      apiKeyList: document.getElementById("api-key-list"),
      apiKeyServiceSelect: document.getElementById("api-key-service-select"),
      // ── 🔌 Provider Configuration ──
      providerList: document.getElementById("provider-list"),
      apiKeyInput: document.getElementById("api-key-input"),
      apiKeyAddBtn: document.getElementById("api-key-add-btn"),
      apiKeyStatus: document.getElementById("api-key-status"),
      // ── Version Control (Fase 3) ──
      vcBranchName: document.getElementById("vc-branch-name"),
      vcFileList: document.getElementById("vc-file-list"),
      btnRefreshVc: document.getElementById("btn-refresh-vc"),
      btnAutoCommit: document.getElementById("btn-auto-commit"),
      // ── Live Preview (Fase 4) ──
      previewPanel: document.getElementById("preview-panel"),
      previewIframe: document.getElementById("preview-iframe"),
      previewUrl: document.getElementById("preview-url"),
      btnPreview: document.getElementById("btn-preview"),
      btnPreviewReload: document.getElementById("btn-preview-reload"),
      btnPreviewStartServer: document.getElementById("btn-preview-start-server"),
      btnPreviewStopServer: document.getElementById("btn-preview-stop-server"),
      previewFramework: document.getElementById("preview-framework"),
      btnPublish: document.getElementById("btn-publish"),
      editorMainArea: document.getElementById("editor-main-area"),
      // ── 🐝 Swarm Panel ──
      swarmPanel: document.getElementById("swarm-panel"),
      swarmTasks: document.getElementById("swarm-tasks"),
      swarmCount: document.getElementById("swarm-count"),
      btnSwarmToggle: document.getElementById("btn-swarm-toggle"),

      // ── 🌐 Agent Browser Panel ──
      browserPanel: document.getElementById("browser-panel"),
      browserWebview: document.getElementById("browser-webview"),
      browserUrl: document.getElementById("browser-url"),
      browserGo: document.getElementById("browser-go"),
      browserBack: document.getElementById("browser-back"),
      browserForward: document.getElementById("browser-forward"),
      browserReload: document.getElementById("browser-reload"),
      browserClose: document.getElementById("browser-close"),
      browserTestLinks: document.getElementById("browser-test-links"),
      browserTestImages: document.getElementById("browser-test-images"),
      browserTestConsole: document.getElementById("browser-test-console"),
      // ── Auth Guard (Fase 5) ──
      authOverlay: document.getElementById("auth-overlay"),
      authInputKey: document.getElementById("auth-input-key"),
      authBtnSave: document.getElementById("auth-btn-save"),
      authError: document.getElementById("auth-error"),
      authProviderSelect: document.getElementById("auth-provider-select"),
      authModelSelect: document.getElementById("auth-model-select"),
      authFooterLink: document.getElementById("auth-footer-link"),
      // ── Project Management ──
      projectHeader: document.querySelector("#panel-explorer .panel-header > span:first-child"),
      btnMapaProyecto: document.getElementById("btn-mapa-proyecto"),
      // ── Workflow Progress Bar (Fase 5) ──
      workflowProgress: document.getElementById("workflow-progress"),
      wpIcon: document.querySelector(".workflow-progress-icon"),
      wpCommand: document.querySelector(".workflow-progress-command"),
      wpCurrent: document.querySelector(".wp-current"),
      wpTotal: document.querySelector(".wp-total"),
      wpFill: document.querySelector(".workflow-progress-fill"),
      wpStepName: document.querySelector(".workflow-progress-stepname"),
      wpStatus: document.querySelector(".workflow-progress-status"),

      // ── Mode Selector ──
      modeSelector: document.getElementById("mode-selector"),
      modeBtns: document.querySelectorAll(".mode-btn"),
      currentModeLabel: document.getElementById("current-mode-label"),
      // ── Model Selector ──
      modelSelector: document.getElementById("model-selector"),
      modelOverrideBtn: document.getElementById("btn-model-override"),
      currentModelLabel: document.getElementById("current-model-label"),
      modelDropdown: document.getElementById("model-dropdown"),
      modelOptions: document.querySelectorAll(".model-option"),
      modeSuggestionBanner: document.getElementById("mode-suggestion-banner"),
      modeSuggestionText: document.getElementById("mode-suggestion-text"),
      modeSuggestionAccept: document.getElementById("mode-suggestion-accept"),
      modeSuggestionDismiss: document.getElementById("mode-suggestion-dismiss"),
      // ── Toast Container (Phase 9.1) ──
      toastContainer: document.getElementById("toast-container"),

      // ── Shortcuts Overlay (Phase 9.2) ──
      shortcutsOverlay: document.getElementById("shortcuts-overlay"),
      btnShortcutsClose: document.getElementById("btn-shortcuts-close"),

      // ── Theme Toggle (Phase 9.3) ──
      btnThemeToggle: document.getElementById("btn-theme-toggle"),
      themeToggleIcon: document.querySelector(".theme-toggle-icon"),
      themeToggleText: document.querySelector(".theme-toggle-text"),

      // ── Explorer Search (Phase 9.4) ──
      explorerSearchInput: document.getElementById("explorer-search-input"),

      // ── Parent Folder Button ──
      btnParentFolder: document.getElementById("btn-parent-folder"),

      // ── Auto-Approve Toolbar Checkboxes (Feature 1) ──
      autoRead: document.getElementById("auto-read"),
      autoWrite: document.getElementById("auto-write"),
      autoMode: document.getElementById("auto-mode"),
      autoExecute: document.getElementById("auto-execute"),
      autoQuestion: document.getElementById("auto-question"),
      autoSubtasks: document.getElementById("auto-subtasks"),

      // ── Task Status Bar / Heartbeat (Feature 2) ──
      taskStatusBar: document.getElementById("task-status-bar"),
      taskStatusIcon: document.getElementById("task-status-icon"),
      taskStatusText: document.getElementById("task-status-text"),
      taskStatusTimer: document.getElementById("task-status-timer"),

      // ── Queue Badge (Feature 3) ──
      queueBadge: document.getElementById("queue-badge"),

      // ── Crash Recovery (Batch 3 — Item #1) ──
      crashOverlay: document.getElementById("crash-overlay"),
      crashBtnRestore: document.getElementById("crash-btn-restore"),
      crashBtnNew: document.getElementById("crash-btn-new"),

      // ── Task Completion Banner (Batch 3 — Item #4) ──
      taskBanner: document.getElementById("task-banner"),
      taskBannerText: document.querySelector(".task-banner-text"),
      taskBannerClose: document.querySelector(".task-banner-close"),

      // ── File Attach Button (Batch 3 — Item #9) ──
      attachBtn: document.getElementById("attach-btn"),
      hiddenFileInput: document.getElementById("hidden-file-input"),

      // ── MCP Servers Panel ──
      mcpPanel: document.getElementById("mcp-panel"),
      mcpServerList: document.getElementById("mcp-server-list"),
      mcpCountBadge: document.getElementById("mcp-count-badge"),
      mcpRegistryBtn: document.getElementById("mcp-registry-btn"),
      mcpReloadAllBtn: document.getElementById("mcp-reload-all-btn"),
      mcpAddBtn: document.getElementById("mcp-add-btn"),
      mcpAddForm: document.getElementById("mcp-add-form"),
      mcpFormName: document.getElementById("mcp-form-name"),
      mcpFormType: document.getElementById("mcp-form-type"),
      mcpFormStdioFields: document.getElementById("mcp-form-stdio-fields"),
      mcpFormHttpFields: document.getElementById("mcp-form-http-fields"),
      mcpFormCommand: document.getElementById("mcp-form-command"),
      mcpFormArgs: document.getElementById("mcp-form-args"),
      mcpFormUrl: document.getElementById("mcp-form-url"),
      mcpFormEnv: document.getElementById("mcp-form-env"),
      mcpFormAutoconnect: document.getElementById("mcp-form-autoconnect"),
      mcpFormCancel: document.getElementById("mcp-form-cancel"),
      mcpFormSave: document.getElementById("mcp-form-save"),
      mcpFormStatus: document.getElementById("mcp-form-status"),
      // ── MCP Registry Modal ──
      mcpRegistryOverlay: document.getElementById("mcp-registry-overlay"),
      mcpRegistryClose: document.getElementById("mcp-registry-close"),
      mcpRegistrySearch: document.getElementById("mcp-registry-search-input"),
      mcpRegistryList: document.getElementById("mcp-registry-list"),
      // ── MCP Env Config Modal ──
      mcpEnvOverlay: document.getElementById("mcp-env-overlay"),
      mcpEnvClose: document.getElementById("mcp-env-close"),
      mcpEnvTitle: document.getElementById("mcp-env-title"),
      mcpEnvDescription: document.getElementById("mcp-env-description"),
      mcpEnvFields: document.getElementById("mcp-env-fields"),
      mcpEnvCancel: document.getElementById("mcp-env-cancel"),
      mcpEnvActivate: document.getElementById("mcp-env-activate"),
      mcpEnvStatus: document.getElementById("mcp-env-status"),

      // ── Project Wizard (Phase 9) ──
      wizardOverlay: document.getElementById("project-wizard-overlay"),
      wizardClose: document.getElementById("btn-wizard-close"),
      wizardStepIndicator: document.getElementById("project-wizard-step-indicator"),
      wizardBody: document.getElementById("project-wizard-body"),
      wizardFooter: document.getElementById("project-wizard-footer"),
      wizardBtnPrev: document.getElementById("btn-wizard-prev"),
      wizardBtnNext: document.getElementById("btn-wizard-next"),
      wizardProgress: document.getElementById("project-wizard-progress"),

      // ── Diagnose Wizard (Phase 10) ──
      diagnoseOverlay: document.getElementById("diagnose-wizard-overlay"),
      diagnoseClose: document.getElementById("btn-diagnose-close"),
      diagnoseStepIndicator: document.getElementById("diagnose-step-indicator"),
      diagnoseBody: document.getElementById("diagnose-body"),
      diagnoseFooter: document.getElementById("diagnose-footer"),
      diagnoseBtnPrev: document.getElementById("btn-diagnose-prev"),
      diagnoseBtnNext: document.getElementById("btn-diagnose-next"),
      diagnoseProgress: document.getElementById("diagnose-progress"),

      // ── Grill Me Wizard (Phase 4 – Scope Interview) ──
      grillMeOverlay: document.getElementById("grill-me-overlay"),
      grillMeClose: document.getElementById("btn-grill-me-close"),
      grillMeStepIndicator: document.getElementById("grill-me-step-indicator"),
      grillMeBody: document.getElementById("grill-me-body"),
      grillMeFooter: document.getElementById("grill-me-footer"),
      grillMeBtnPrev: document.getElementById("btn-grill-me-prev"),
      grillMeBtnNext: document.getElementById("btn-grill-me-next"),
      grillMeProgress: document.getElementById("grill-me-progress"),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MONACO EDITOR
  // ═══════════════════════════════════════════════════════════════════════════

  _waitForMonaco() {
    return new Promise((resolve) => {
      if (window.monaco) {
        this.monaco = window.monaco;
        return resolve();
      }
      document.addEventListener("monaco-ready", (e) => {
        this.monaco = e.detail.monaco;
        resolve();
      });
      // Timeout fallback: check again after 3s
      setTimeout(() => {
        if (window.monaco) {
          this.monaco = window.monaco;
          resolve();
        }
      }, 3000);
    });
  }

  _createEditor() {
    if (!this.monaco || !this.els.editorContainer) return;

    // ── lv-zero Dark Theme (VS Code Dark+ inspired) ────────────────────────
    this.monaco.editor.defineTheme("lvzero-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        // ── Comments ──
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "comment.line", foreground: "6a9955", fontStyle: "italic" },
        { token: "comment.block", foreground: "6a9955", fontStyle: "italic" },
        { token: "comment.block.documentation", foreground: "6a9955", fontStyle: "italic" },
        // ── Keywords ──
        { token: "keyword", foreground: "569cd6" },
        { token: "keyword.control", foreground: "c586c0" },
        { token: "keyword.operator", foreground: "d4d4d4" },
        { token: "keyword.other", foreground: "569cd6" },
        // ── Storage ──
        { token: "storage", foreground: "569cd6" },
        { token: "storage.type", foreground: "569cd6" },
        { token: "storage.modifier", foreground: "569cd6" },
        // ── Strings ──
        { token: "string", foreground: "ce9178" },
        { token: "string.quoted", foreground: "ce9178" },
        { token: "string.key.json", foreground: "9cdcfe" },
        { token: "string.regexp", foreground: "d16969" },
        // ── Numbers ──
        { token: "number", foreground: "b5cea8" },
        // ── Types ──
        { token: "type", foreground: "4ec9b0" },
        { token: "type.identifier", foreground: "4ec9b0" },
        { token: "support.type", foreground: "4ec9b0" },
        // ── Functions ──
        { token: "function", foreground: "dcdcaa" },
        { token: "function.declaration", foreground: "dcdcaa" },
        { token: "support.function", foreground: "dcdcaa" },
        // ── Variables ──
        { token: "variable", foreground: "9cdcfe" },
        { token: "variable.other.readwrite", foreground: "9cdcfe" },
        { token: "variable.parameter", foreground: "9cdcfe" },
        // ── Constants ──
        { token: "constant", foreground: "4fc1ff" },
        { token: "constant.language", foreground: "569cd6" },
        { token: "constant.numeric", foreground: "b5cea8" },
        // ── Entities ──
        { token: "entity.name.type", foreground: "4ec9b0" },
        { token: "entity.name.function", foreground: "dcdcaa" },
        // ── Tags / Markup ──
        { token: "tag", foreground: "569cd6" },
        { token: "attribute.name", foreground: "9cdcfe" },
        { token: "attribute.value", foreground: "ce9178" },
        { token: "delimiter", foreground: "808080" },
        // ── Markdown ──
        { token: "markup.heading", foreground: "569cd6", fontStyle: "bold" },
        { token: "markup.heading.setext", foreground: "569cd6", fontStyle: "bold" },
        { token: "markup.bold", foreground: "d4d4d4", fontStyle: "bold" },
        { token: "markup.italic", foreground: "d4d4d4", fontStyle: "italic" },
        { token: "markup.inline.raw", foreground: "ce9178" },
        { token: "markup.fenced_code", foreground: "ce9178" },
        { token: "markup.list", foreground: "569cd6" },
        { token: "markup.link", foreground: "569cd6" },
        // ── Others ──
        { token: "regexp", foreground: "d16969" },
        { token: "regexp.quantifier", foreground: "d7ba7d" },
        { token: "meta.embedded", foreground: "d4d4d4" },
        { token: "invalid", foreground: "f44747" },
        { token: "invalid.deprecated", foreground: "f44747", fontStyle: "underline" },
      ],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "editor.lineHighlightBackground": "#2a2d2e",
        "editor.selectionBackground": "#264f78",
        "editor.inactiveSelectionBackground": "#3a3d41",
        "editorCursor.foreground": "#aeafad",
        "editorLineNumber.foreground": "#858585",
        "editorLineNumber.activeForeground": "#c6c6c6",
        "editorBracketMatch.background": "#0d3a58",
        "editorBracketMatch.border": "#007acc",
        "editor.findMatchBackground": "#515c6a",
        "editor.findMatchHighlightBackground": "#3a3d41",
        "editor.hoverHighlightBackground": "#2a2d2e",
        "editorIndentGuide.background": "#404040",
        "editorIndentGuide.activeBackground": "#707070",
        "editorWhitespace.foreground": "#3b3b3b",
      },
    });

    // ── lv-zero Light Theme (VS Code Light+ inspired) ──────────────────────
    this.monaco.editor.defineTheme("lvzero-light", {
      base: "vs",
      inherit: true,
      rules: [
        // ── Comments ──
        { token: "comment", foreground: "008000", fontStyle: "italic" },
        { token: "comment.line", foreground: "008000", fontStyle: "italic" },
        { token: "comment.block", foreground: "008000", fontStyle: "italic" },
        { token: "comment.block.documentation", foreground: "008000", fontStyle: "italic" },
        // ── Keywords ──
        { token: "keyword", foreground: "0000ff" },
        { token: "keyword.control", foreground: "af00db" },
        { token: "keyword.operator", foreground: "000000" },
        { token: "keyword.other", foreground: "0000ff" },
        // ── Storage ──
        { token: "storage", foreground: "0000ff" },
        { token: "storage.type", foreground: "0000ff" },
        { token: "storage.modifier", foreground: "0000ff" },
        // ── Strings ──
        { token: "string", foreground: "a31515" },
        { token: "string.quoted", foreground: "a31515" },
        { token: "string.key.json", foreground: "0451a5" },
        { token: "string.regexp", foreground: "811f3f" },
        // ── Numbers ──
        { token: "number", foreground: "098658" },
        // ── Types ──
        { token: "type", foreground: "267f99" },
        { token: "type.identifier", foreground: "267f99" },
        { token: "support.type", foreground: "267f99" },
        // ── Functions ──
        { token: "function", foreground: "795e26" },
        { token: "function.declaration", foreground: "795e26" },
        { token: "support.function", foreground: "795e26" },
        // ── Variables ──
        { token: "variable", foreground: "001080" },
        { token: "variable.other.readwrite", foreground: "001080" },
        { token: "variable.parameter", foreground: "001080" },
        // ── Constants ──
        { token: "constant", foreground: "0070c1" },
        { token: "constant.language", foreground: "0000ff" },
        { token: "constant.numeric", foreground: "098658" },
        // ── Entities ──
        { token: "entity.name.type", foreground: "267f99" },
        { token: "entity.name.function", foreground: "795e26" },
        // ── Tags / Markup ──
        { token: "tag", foreground: "800000" },
        { token: "attribute.name", foreground: "ff0000" },
        { token: "attribute.value", foreground: "0451a5" },
        { token: "delimiter", foreground: "808080" },
        // ── Markdown ──
        { token: "markup.heading", foreground: "800000", fontStyle: "bold" },
        { token: "markup.heading.setext", foreground: "800000", fontStyle: "bold" },
        { token: "markup.bold", foreground: "000000", fontStyle: "bold" },
        { token: "markup.italic", foreground: "000000", fontStyle: "italic" },
        { token: "markup.inline.raw", foreground: "a31515" },
        { token: "markup.fenced_code", foreground: "a31515" },
        { token: "markup.list", foreground: "800000" },
        { token: "markup.link", foreground: "0000ff" },
        // ── Others ──
        { token: "regexp", foreground: "811f3f" },
        { token: "regexp.quantifier", foreground: "d7ba7d" },
        { token: "meta.embedded", foreground: "000000" },
        { token: "invalid", foreground: "f44747" },
        { token: "invalid.deprecated", foreground: "f44747", fontStyle: "underline" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#000000",
        "editor.lineHighlightBackground": "#e8e8e8",
        "editor.selectionBackground": "#add6ff",
        "editor.inactiveSelectionBackground": "#e5ebf1",
        "editorCursor.foreground": "#000000",
        "editorLineNumber.foreground": "#237893",
        "editorLineNumber.activeForeground": "#0b4a63",
        "editorBracketMatch.background": "#e8e8e8",
        "editorBracketMatch.border": "#007acc",
        "editor.findMatchBackground": "#e8e8e8",
        "editor.findMatchHighlightBackground": "#d7d7d7",
        "editor.hoverHighlightBackground": "#e8e8e8",
        "editorIndentGuide.background": "#d3d3d3",
        "editorIndentGuide.activeBackground": "#a0a0a0",
        "editorWhitespace.foreground": "#d3d3d3",
      },
    });

    // Create a welcome model
    const welcomeUri = this.monaco.Uri.parse("inmemory://welcome");
    const welcomeModel = this.monaco.editor.createModel(
      `// Welcome to lv-zero IDE\n// Open a file from the Explorer to start editing.\n\n// Tip: Use the AI Chat (right panel) to interact with the agent.\n// Type /plan, /code, /debug to activate workflows.\n`,
      "javascript",
      welcomeUri
    );

    this.editor = this.monaco.editor.create(this.els.editorContainer, {
      model: welcomeModel,
      theme: "lvzero-dark",
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontLigatures: true,
      lineNumbers: "on",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: "on",
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      padding: { top: 8 },
    });

    // Store welcome as first "tab"
    this.openTabs["__welcome__"] = {
      model: welcomeModel,
      lang: "javascript",
      fileName: "Welcome",
      savedContent: "",
    };
    this.activeTabPath = "__welcome__";

    // Handle editor resize when container resizes
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        this.editor?.layout();
      });
      ro.observe(this.els.editorContainer);
    }

    // Render initial tab bar
    this._renderTabs();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB SYSTEM (Misión 1)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Renders all tabs in the tab bar.
   */
  _renderTabs() {
    if (!this.els.editorTabsBar) return;
    this.els.editorTabsBar.innerHTML = "";

    const entries = Object.entries(this.openTabs);
    if (entries.length === 0) {
      // Show empty tab bar
      return;
    }

    for (const [filePath, tab] of entries) {
      const tabEl = document.createElement("div");
      tabEl.className = "editor-tab-item";
      if (filePath === this.activeTabPath) {
        tabEl.classList.add("active");
      }

      const icon = tab.fileName === "Welcome" ? "🏠" : "📄";
      const isDirty = tab.model && tab.model.getValue() !== tab.savedContent;

      tabEl.innerHTML = `
        <span class="tab-icon">${icon}</span>
        <span class="tab-name">${this._escapeHtml(tab.fileName)}</span>
        ${isDirty ? '<span class="tab-dirty">●</span>' : ""}
        <span class="tab-close" data-path="${this._escapeHtml(filePath)}">×</span>
      `;

      // Click to switch tab
      tabEl.addEventListener("click", (e) => {
        // Don't switch if clicking close button
        if (e.target.classList.contains("tab-close")) return;
        this._switchTab(filePath);
      });

      // Close button
      const closeBtn = tabEl.querySelector(".tab-close");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._closeTab(filePath);
      });

      this.els.editorTabsBar.appendChild(tabEl);
    }

    // Scroll to active tab
    const activeEl = this.els.editorTabsBar.querySelector(".editor-tab-item.active");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }

    // ── Code Review button ──
    // Remove existing review button if any (clean slate on re-render)
    const oldBtn = this.els.editorTabsBar.querySelector(".btn-review");
    if (oldBtn) oldBtn.remove();

    const reviewBtn = document.createElement("button");
    reviewBtn.className = "btn-review";
    reviewBtn.title = "Review current file (Ctrl+Shift+R)";
    reviewBtn.textContent = "📋 Review";
    reviewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._triggerCodeReview();
    });
    this.els.editorTabsBar.appendChild(reviewBtn);

    // ── 🚀 Deploy button (Phase 6) ──
    // Remove existing deploy button if any (clean slate on re-render)
    const oldDeployBtn = this.els.editorTabsBar.querySelector(".btn-deploy");
    if (oldDeployBtn) oldDeployBtn.remove();

    const deployBtn = document.createElement("button");
    deployBtn.className = "btn-deploy";
    deployBtn.title = "Run deploy pipeline (audit → build → release)";
    deployBtn.textContent = "🚀 Deploy";
    deployBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._triggerDeploy();
    });
    this.els.editorTabsBar.appendChild(deployBtn);

    // ── 🧪 Diagnose button (Phase 10) ──
    // Remove existing diagnose button if any (clean slate on re-render)
    const oldDiagnoseBtn = this.els.editorTabsBar.querySelector(".btn-diagnose");
    if (oldDiagnoseBtn) oldDiagnoseBtn.remove();

    const diagnoseBtn = document.createElement("button");
    diagnoseBtn.className = "btn-diagnose";
    diagnoseBtn.title = "Open Diagnose Wizard — 5-step guided debugging";
    diagnoseBtn.textContent = "🧪 Debug";
    diagnoseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._showDiagnoseWizard();
    });
    this.els.editorTabsBar.appendChild(diagnoseBtn);

    // ── 🎨 Frontend-Design Auditor button ──
    // Remove existing frontend-audit button if any (clean slate on re-render)
    const oldAuditBtn = this.els.editorTabsBar.querySelector(".btn-frontend-audit");
    if (oldAuditBtn) oldAuditBtn.remove();

    const auditBtn = document.createElement("button");
    auditBtn.className = "btn-frontend-audit";
    auditBtn.title = "🎨 UI Audit — analyze frontend code for design quality & accessibility";
    auditBtn.textContent = "🎨 UI Audit";
    auditBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._triggerFrontendAudit();
    });
    this.els.editorTabsBar.appendChild(auditBtn);

    // ── 🔥 Grill Me button (Phase 4 – Scope Interview) ──
    // Remove existing grill-me button if any (clean slate on re-render)
    const oldGrillBtn = this.els.editorTabsBar.querySelector(".btn-grill-me");
    if (oldGrillBtn) oldGrillBtn.remove();

    const grillBtn = document.createElement("button");
    grillBtn.className = "btn-grill-me";
    grillBtn.title = "🔥 Grill Me — 7-step scope interview for enriched specs";
    grillBtn.textContent = "🔥 Grill";
    grillBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._showGrillMeWizard();
    });
    this.els.editorTabsBar.appendChild(grillBtn);
  }

  /**
   * Switches to the given tab.
   */
  _switchTab(filePath) {
    if (filePath === this.activeTabPath) return;
    const tab = this.openTabs[filePath];
    if (!tab) return;

    this.activeTabPath = filePath;
    this.currentFilePath = filePath === "__welcome__" ? null : filePath;

    // Set the model on the editor
    this.editor.setModel(tab.model);

    // Update tree active state
    document.querySelectorAll(".tree-item.active").forEach((el) => el.classList.remove("active"));
    if (filePath !== "__welcome__") {
      const treeItem = document.querySelector(`.tree-item[data-path="${filePath}"]`);
      if (treeItem) treeItem.classList.add("active");
    }

    this._renderTabs();
    // Save workspace state (debounced)
    this._debouncedSaveWorkspaceState();
  }

  /**
   * Closes the given tab.
   */
  _closeTab(filePath) {
    if (filePath === "__welcome__") return; // Can't close welcome
    const tab = this.openTabs[filePath];
    if (!tab) return;

    const isDirty = tab.model && tab.model.getValue() !== tab.savedContent;
    if (isDirty) {
      if (!confirm(`"${tab.fileName}" has unsaved changes. Close anyway?`)) return;
    }

    // Dispose the model
    tab.model.dispose();
    delete this.openTabs[filePath];

    // Switch to another tab
    const remaining = Object.keys(this.openTabs);
    if (remaining.length > 0) {
      // Switch to the last remaining tab, or the one before the closed one
      const idx = remaining.indexOf(filePath);
      // Actually filePath is deleted, so remaining no longer has it
      this._switchTab(remaining[remaining.length - 1]);
    }

    this._renderTabs();
    // Save workspace state after closing a tab
    this._debouncedSaveWorkspaceState();
  }

  /**
   * Tracks model changes to update the dirty indicator on tabs.
   */
  _trackModelChanges(model, filePath) {
    model.onDidChangeContent(() => {
      // Only re-render tabs if this is the active tab (dirty indicator)
      if (filePath === this.activeTabPath) {
        this._renderTabs();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIFF EDITOR (Misión 2) — Control de Cambios
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows the Monaco Diff Editor overlay with original vs proposed content.
   */
  async _showDiffEditor(filePath, originalContent, newContent) {
    if (!this.monaco) return;

    // Store pending diff state
    this._pendingDiff = { filePath, originalContent, newContent };

    // Show overlay
    if (this.els.diffOverlay) this.els.diffOverlay.classList.remove("hidden");
    this.els.diffFilePath.textContent = filePath;

    // Clear previous diff editor content
    this.els.diffEditorContainer.innerHTML = "";

    // Create original and modified models
    const originalUri = this.monaco.Uri.parse(`diff://original/${filePath.replace(/\\/g, "/")}`);
    const modifiedUri = this.monaco.Uri.parse(`diff://modified/${filePath.replace(/\\/g, "/")}`);

    const ext = filePath.split(".").pop().toLowerCase();
    const lang = this._extToLanguage(ext);

    const originalModel = this.monaco.editor.createModel(originalContent, lang, originalUri);
    const modifiedModel = this.monaco.editor.createModel(newContent, lang, modifiedUri);

    // Create or reuse diff editor
    if (this.diffEditor) {
      this.diffEditor.dispose();
    }

    this.diffEditor = this.monaco.editor.createDiffEditor(this.els.diffEditorContainer, {
      theme: "lvzero-dark",
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      fontLigatures: true,
      lineNumbers: "on",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      enableSplitViewResizing: true,
      renderSideBySide: true,
      originalEditable: false,
      automaticLayout: true,
      wordWrap: "on",
      bracketPairColorization: { enabled: true },
    });

    this.diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    // Layout after a tick to ensure container is visible
    setTimeout(() => {
      this.diffEditor?.layout();
    }, 50);

    // Focus the Accept button for keyboard convenience
    setTimeout(() => {
      this.els.diffBtnAccept?.focus();
    }, 100);

    this.addLogEntry("info", `🔍 Diff review: ${filePath}`);
  }

  /**
   * Hides the diff overlay and disposes diff editor resources.
   * @param {boolean} accepted - Whether the diff was accepted (true) or rejected (false)
   */
  _hideDiffEditor(accepted) {
    // Dispose diff editor and models
    if (this.diffEditor) {
      try {
        const models = this.diffEditor.getModel();
        if (models) {
          models.original?.dispose();
          models.modified?.dispose();
        }
      } catch {}
      this.diffEditor.dispose();
      this.diffEditor = null;
    }

    // Clean up any leftover editor instances in the container
    this.els.diffEditorContainer.innerHTML = "";

    // Hide overlay
    if (this.els.diffOverlay) this.els.diffOverlay.classList.add("hidden");
    this.els.diffFilePath.textContent = "";

    const filePath = this._pendingDiff?.filePath || "";
    this._pendingDiff = null;

    this.addLogEntry("info", `${accepted ? "✅" : "❌"} Diff ${accepted ? "accepted" : "rejected"}: ${filePath}`);

    // Re-layout the main editor since overlay is gone
    setTimeout(() => {
      this.editor?.layout();
    }, 50);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE OPERATIONS (Tab-aware)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Opens a file in the Monaco editor (tab-aware).
   */
  async openFile(filePath) {
    if (!filePath) return;

    const fileName = filePath.split("/").pop() || filePath.split("\\").pop();

    // Normalise path so keys are consistent cross-platform
    const normalisedKey = filePath.replace(/\\/g, "/");
    // If already open, just switch to it
    if (this.openTabs[normalisedKey]) {
      this._switchTab(normalisedKey);
      return;
    }

    try {
      const result = await window.lvzero["file:read"](filePath);
      if (result.success) {
        const ext = fileName.split(".").pop().toLowerCase();
        const lang = this._extToLanguage(ext);

        // Create model with file URI (normalise path for cross-platform key)
        const normalisedPath = filePath.replace(/\\/g, "/");
        const fileUri = this.monaco.Uri.parse(`file:///${normalisedPath}`);
        const model = this.monaco.editor.createModel(result.content, lang, fileUri);

        // Store tab (use normalised path so _reloadChangedFile can find it)
        this.openTabs[normalisedPath] = {
          model,
          lang,
          fileName,
          savedContent: result.content,
        };

        // Track changes for dirty indicator
        this._trackModelChanges(model, normalisedPath);

        // Switch to new tab
        this._switchTab(normalisedPath);
      } else {
        this.addLogEntry("error", `Failed to open ${fileName}: ${result.error}`);
      }
    } catch (err) {
      console.error("[IDE] Error opening file:", err);
      this.addLogEntry("error", `Error opening ${fileName}: ${err.message}`);
    }
  }

  /**
   * Saves the current editor content back to the file.
   */
  async saveCurrentFile() {
    if (!this.currentFilePath || !this.editor) return false;

    const content = this.editor.getValue();
    try {
      const result = await window.lvzero["file:write"](this.currentFilePath, content);
      if (result.success) {
        // Update saved content marker
        const tab = this.openTabs[this.activeTabPath];
        if (tab) {
          tab.savedContent = content;
        }
        this._renderTabs();
        const fileName = this.currentFilePath.split(/[\\/]/).pop();
        this._showToast('success', `💾 Saved ${fileName}`, 3000);
        return true;
      }
      return false;
    } catch (err) {
      console.error("[IDE] Error saving file:", err);
      return false;
    }
  }

  _extToLanguage(ext) {
    const map = {
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      ts: "typescript",
      tsx: "typescript",
      json: "json",
      html: "html",
      htm: "html",
      css: "css",
      scss: "scss",
      less: "less",
      md: "markdown",
      py: "python",
      sql: "sql",
      yaml: "yaml",
      yml: "yaml",
      xml: "xml",
      svg: "xml",
      sh: "shell",
      bash: "shell",
      env: "dotenv",
      gitignore: "ignore",
      dockerfile: "dockerfile",
      txt: "plaintext",
      log: "plaintext",
    };
    return map[ext] || "plaintext";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPLIT.JS LAYOUT
  // ═══════════════════════════════════════════════════════════════════════════

  _createSplitLayout() {
    // Horizontal split: Explorer | Center | Chat
    this.splitHoriz = Split(["#panel-explorer", "#panel-center", "#panel-chat"], {
      sizes: [18, 52, 30],
      minSize: [180, 300, 280],
      gutterSize: 4,
      cursor: "col-resize",
      snapOffset: 30,
      onDragEnd: () => {
        this.editor?.layout();
        this._fitTerminal();
      },
    });

    // Vertical split inside Center: Editor | Terminal
    this.splitVert = Split(["#editor-container", "#terminal-container"], {
      direction: "vertical",
      sizes: [70, 30],
      minSize: [100, 80],
      gutterSize: 4,
      cursor: "row-resize",
      snapOffset: 30,
      onDragEnd: () => {
        this.editor?.layout();
        this._fitTerminal();
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // XTERM TERMINAL
  // ═══════════════════════════════════════════════════════════════════════════

  _createTerminal() {
    // Create XTerm instance
    // NOTE: @xterm/addon-fit UMD wrapper assigns the whole module object
    // to window.FitAddon ({ __esModule: true, FitAddon: class }),
    // not the class directly. Unwrap it:
    const FitAddonClass = (typeof FitAddon !== "undefined" && FitAddon.FitAddon) || FitAddon;
    this.fitAddon = new FitAddonClass();

    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      theme: {
        background: "#000000",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
      allowTransparency: false,
      scrollback: 5000,
      tabStopWidth: 4,
    });

    // Load addons
    this.terminal.loadAddon(this.fitAddon);

    // Render into DOM
    this.terminal.open(this.els.xtermContainer);

    // Fit terminal to container
    setTimeout(() => this._fitTerminal(), 100);

    // Create Smart Launcher toolbar
    this._createLauncherToolbar();
  }

  /**
   * Creates the Smart Launcher toolbar above the terminal.
   */
  _createLauncherToolbar() {
    try {
      const existing = document.getElementById("launcher-toolbar");
      if (existing) existing.remove();

      const toolbar = document.createElement("div");
      toolbar.id = "launcher-toolbar";
      toolbar.className = "launcher-toolbar";
      toolbar.style.display = "none";
      toolbar.innerHTML =
        '<span class="launcher-env-badge" id="launcher-env-badge">Detection...</span>' +
        '<span class="launcher-actions" id="launcher-actions"></span>' +
        '<span class="launcher-precheck-warning" id="launcher-precheck-warning" style="display:none"></span>';

      const terminalContainer = this.els.terminalContainer;
      if (terminalContainer) {
        const panelHeader = terminalContainer.querySelector(".panel-header");
        if (panelHeader) {
          panelHeader.parentNode.insertBefore(toolbar, panelHeader.nextSibling);
        }
      }
    } catch (err) {
      console.warn("[IDE] Failed to create launcher toolbar:", err.message);
    }
  }

  /**
   * Updates the launcher toolbar with detected environment info.
   */
  async _updateLauncherToolbar() {
    try {
      const toolbar = document.getElementById("launcher-toolbar");
      if (!toolbar) return;

      const badge = document.getElementById("launcher-env-badge");
      const actions = document.getElementById("launcher-actions");
      const warning = document.getElementById("launcher-precheck-warning");
      if (!badge || !actions) return;

      const projectPath = window.__LV_ZERO_PROJECT_PATH__ || "";
      const result = await window.lvzero["launcher:detect"](projectPath);

      if (!result || !result.success) {
        toolbar.style.display = "none";
        return;
      }

      badge.textContent = result.label || result.type || "Unknown";
      actions.innerHTML = "";

      if (result.targets && result.targets.length > 0) {
        for (const target of result.targets) {
          const btn = document.createElement("button");
          btn.className = "launcher-run-btn";
          btn.title = target.description || target.command;
          btn.dataset.targetName = target.name;
          btn.dataset.targetCommand = target.command;
          btn.innerHTML = "&#9654; " + target.name;
          btn.addEventListener("click", () => this._runLauncherTarget(target));
          actions.appendChild(btn);
        }
        toolbar.style.display = "flex";
      } else {
        toolbar.style.display = "none";
      }

      if (warning) warning.style.display = "none";
    } catch (err) {
      console.warn("[IDE] Failed to update launcher toolbar:", err.message);
      const toolbar = document.getElementById("launcher-toolbar");
      if (toolbar) toolbar.style.display = "none";
    }
  }

  /**
   * Execute a launcher target command in the terminal.
   */
  async _runLauncherTarget(target) {
    try {
      if (!target || !target.command) return;

      const projectPath = window.__LV_ZERO_PROJECT_PATH__ || "";
      const warning = document.getElementById("launcher-precheck-warning");
      const actions = document.getElementById("launcher-actions");

      if (actions) {
        const btns = actions.querySelectorAll(".launcher-run-btn");
        btns.forEach((b) => (b.disabled = true));
      }

      const precheckResult = await window.lvzero["launcher:precheck"](projectPath, target);

      if (warning && precheckResult) {
        const warnings = precheckResult.warnings || [];
        const errors = precheckResult.errors || [];
        const allIssues = [].concat(warnings, errors);
        if (allIssues.length > 0) {
          warning.textContent = "Warnings: " + allIssues.join(" | ");
          warning.style.display = "inline";
          setTimeout(() => { warning.style.display = "none"; }, 8000);
        } else {
          warning.style.display = "none";
        }
      }

      if (this.terminalActive) {
        this.terminal.write("\r\n\x1b[36m[Launcher] " + target.command + "\x1b[0m\r\n");
        window.lvzero["terminal:write"](target.command + "\n");
      } else {
        try {
          const execResult = await window.lvzero["terminal:execCommand"](target.command, { cwd: projectPath });
          if (execResult && execResult.stdout) {
            this.terminal.write(execResult.stdout);
          }
          if (execResult && execResult.stderr) {
            this.terminal.write("\x1b[31m" + execResult.stderr + "\x1b[0m");
          }
        } catch (execErr) {
          this.terminal.write("\r\n\x1b[31m[Launcher] Error: " + execErr.message + "\x1b[0m\r\n");
        }
      }

      setTimeout(() => {
        if (actions) {
          const btns = actions.querySelectorAll(".launcher-run-btn");
          btns.forEach((b) => (b.disabled = false));
        }
      }, 2000);
    } catch (err) {
      console.warn("[IDE] Launcher run error:", err.message);
      const actions = document.getElementById("launcher-actions");
      if (actions) {
        const btns = actions.querySelectorAll(".launcher-run-btn");
        btns.forEach((b) => (b.disabled = false));
      }
    }
  }

  _fitTerminal() {
    try {
      this.fitAddon?.fit();
    } catch {
      // container not visible yet
    }
  }

  /**
   * Starts the real PTY shell process via IPC.
   */
  async startTerminal() {
    if (this.terminalActive) return;

    try {
      const result = await window.lvzero["terminal:create"]();
      if (result && result.pid) {
        this.terminalActive = true;
        this.els.initTerminalBtn.textContent = "●";
        this.els.initTerminalBtn.title = "Terminal connected";

        // Listen for PTY output
        const unsubData = window.lvzero.events.onTerminal((data) => {
          this.terminal.write(data);
        });

        const unsubExit = window.lvzero.events.onTerminalExit(({ exitCode }) => {
          // Suppress exit message when switching shells (old PTY is killed intentionally)
          if (!this.switchingShell) {
            this.terminal.write(`\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
            this.terminalActive = false;
            this.els.initTerminalBtn.textContent = "▶";
            this.els.initTerminalBtn.title = "Restart terminal";
          }
        });

        this.unsubscribers.push(unsubData, unsubExit);

        // Forward user input to PTY
        this.terminal.onData((data) => {
          window.lvzero["terminal:write"](data);
        });

        // Resize handler
        this._setupTerminalResize();

        this.terminal.focus();
        this.terminal.write(`\x1b[32mlv-zero terminal ready (PID: ${result.pid})\x1b[0m\r\n`);

        // Get current shell info and update selector
        try {
          const info = await window.lvzero["terminal:shellInfo"]();
          if (info && info.shell && this.els.terminalShellSelector) {
            this.els.terminalShellSelector.value = info.shell;
          }
        } catch { /* ignore */ }

        // Update launcher toolbar with environment detection (non-blocking)
        this._updateLauncherToolbar().catch((err) => {
          console.warn("[IDE] Launcher detection failed (non-critical):", err.message);
        });
      }
    } catch (err) {
      console.error("[IDE] Terminal creation failed:", err);
      this.terminal.write(`\r\n\x1b[31m[Terminal error: ${err.message}]\x1b[0m\r\n`);
    }
  }

  _setupTerminalResize() {
    // Debounced resize
    let resizeTimeout;
    const origWrite = this.terminal.write.bind(this.terminal);

    // Wrap onResize
    this.terminal.onResize(({ cols, rows }) => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        window.lvzero["terminal:resize"](cols, rows);
      }, 200);
    });
  }

  /**
   * Switch the active terminal shell via IPC.
   * Kills the current PTY and recreates with the new shell type.
   * The new PTY is already created by the main process — we just re-subscribe.
   */
  async _switchTerminalShell(shellType) {
    // Update selector UI optimistically
    const sel = this.els.terminalShellSelector;
    if (sel && sel.value !== shellType) sel.value = shellType;

    try {
      // Set flag to suppress exit message from the old PTY being killed
      this.switchingShell = true;

      const result = await window.lvzero["terminal:switchShell"](shellType);
      if (result.success) {
        if (result.unchanged) {
          this.switchingShell = false;
          return;
        }
        // PTY was already created by main process — just re-subscribe to events
        this.terminalActive = true;
        this.els.initTerminalBtn.textContent = "●";
        this.els.initTerminalBtn.title = "Terminal connected";

        // Re-subscribe to data events (clean old ones if any were pushed to unsubscribers)
        const unsubData = window.lvzero.events.onTerminal((data) => {
          this.terminal.write(data);
        });
        const unsubExit = window.lvzero.events.onTerminalExit(({ exitCode }) => {
          if (!this.switchingShell) {
            this.terminal.write(`\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
            this.terminalActive = false;
            this.els.initTerminalBtn.textContent = "▶";
            this.els.initTerminalBtn.title = "Restart terminal";
          }
        });
        this.unsubscribers.push(unsubData, unsubExit);

        // Get shell info to confirm
        try {
          const info = await window.lvzero["terminal:shellInfo"]();
          if (info && info.pid) {
            this.terminal.focus();
            this.terminal.write(`\r\n\x1b[32mShell switched to ${shellType} (PID: ${info.pid})\x1b[0m\r\n`);
          }
        } catch { /* ignore */ }

        this.addLogEntry("info", `🔄 Shell switched to ${shellType}`);
      } else {
        this.addLogEntry("error", `❌ Shell switch failed: ${result.error}`);
        // Revert selector
        if (sel) {
          const info = await window.lvzero["terminal:shellInfo"]().catch(() => ({}));
          if (info && info.shell) sel.value = info.shell;
        }
      }
    } catch (err) {
      this.addLogEntry("error", `❌ Shell switch error: ${err.message}`);
    } finally {
      this.switchingShell = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE EXPLORER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Loads the root-level file listing into the explorer panel.
   * Directories are expanded lazily — clicking a directory loads its children.
   */
  async _loadFileTree(dirPath) {
    this.els.fileTree.innerHTML = '<div class="tree-loading">⏳ Loading...</div>';

    try {
      // Race the IPC call against a 10s timeout
      const result = await Promise.race([
        window.lvzero["file:list"](dirPath || "."),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("File tree load timed out")), 10000)
        ),
      ]);

      if (result.success && result.items) {
        this.els.fileTree.innerHTML = "";
        this._fileList = []; // reset file list for @ mentions
        for (const item of result.items) {
          this._renderFileItem(item, this.els.fileTree, 0);
          this._collectFilePaths(item);
        }
      } else if (result && result.error) {
        console.warn("[IDE] File tree load error:", result.error);
        this.els.fileTree.innerHTML = `<div class="tree-empty tree-error">⚠️ ${this._escapeHtml(result.error)}</div>`;
      } else {
        this.els.fileTree.innerHTML = '<div class="tree-empty">📂 No files found</div>';
      }
    } catch (err) {
      console.warn("[IDE] File tree load failed:", err.message);
      this.els.fileTree.innerHTML = `<div class="tree-empty">${this._escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Recursively collects file paths from tree items for @ mentions.
   */
  _collectFilePaths(item) {
    if (item.type === "file") {
      if (!this._fileList.includes(item.path)) {
        this._fileList.push(item.path);
      }
    } else if (item.type === "directory" && item.children) {
      for (const child of item.children) {
        this._collectFilePaths(child);
      }
    }
  }

  /**
   * Renders a single file/directory item. Directories are lazy-loaded on click.
   */
  _renderFileItem(item, container, depth) {
    if (item.type === "file") {
      const el = document.createElement("div");
      el.className = "tree-item";
      el.dataset.path = item.path;
      el.dataset.ext = (item.name || "").split(".").pop().toLowerCase();
      el.style.paddingLeft = `${8 + depth * 16}px`;

      const ext = (item.name || "").split(".").pop().toLowerCase();
      const name = (item.name || "");
      // Spec files (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, TECH-SPEC.md) get a special icon
      const specFiles = ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "TECH-SPEC.md"];
      const isSpecFile = specFiles.includes(name);
      const icon = isSpecFile ? "📋" : this._getFileIcon(ext);
      el.innerHTML = `
        <span class="tree-icon">${icon}</span>
        <span class="tree-name">${this._escapeHtml(item.name)}</span>
      `;

      el.addEventListener("click", () => this.openFile(item.path));
      container.appendChild(el);
      return;
    }

    if (item.type === "directory") {
      const wrapper = document.createElement("div");
      wrapper.className = "tree-directory";

      const header = document.createElement("div");
      header.className = "tree-item directory";
      header.style.paddingLeft = `${8 + depth * 16}px`;
      header.innerHTML = `
        <span class="tree-toggle">▶</span>
        <span class="tree-icon">📁</span>
        <span class="tree-name">${this._escapeHtml(item.name)}</span>
      `;

      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      childrenContainer.style.display = "none"; // collapsed by default
      let loaded = false;

      header.addEventListener("click", async (e) => {
        e.stopPropagation();
        const toggle = header.querySelector(".tree-toggle");
        const isExpanded = childrenContainer.style.display !== "none";

        if (!isExpanded) {
          // Show children container (may be empty if loading)
          childrenContainer.style.display = "block";
          toggle.classList.add("expanded");

          // Lazy-load children if not loaded yet
          if (!loaded) {
            loaded = true;
            childrenContainer.innerHTML = '<div class="tree-loading" style="padding-left:24px">⏳ Loading...</div>';
            try {
              const result = await window.lvzero["file:list"](item.path);
              childrenContainer.innerHTML = "";
              if (result.success && result.items) {
                for (const child of result.items) {
                  this._renderFileItem(child, childrenContainer, depth + 1);
                }
              }
            } catch (err) {
              childrenContainer.innerHTML = `<div class="tree-empty">${this._escapeHtml(err.message)}</div>`;
            }
          }
        } else {
          childrenContainer.style.display = "none";
          toggle.classList.remove("expanded");
        }
      });

      wrapper.appendChild(header);
      wrapper.appendChild(childrenContainer);
      container.appendChild(wrapper);
    }
  }

  _getFileIcon(ext) {
    const icons = {
      js: "\ue60b",  // using text fallbacks
      jsx: "âš›",
      ts: "\u03BB",
      tsx: "âš›",
      json: "{ }",
      html: "< >",
      css: "#",
      md: "\u2714",
      py: "\u267B",
      sql: "\u2261",
      yaml: "\u2630",
      yml: "\u2630",
      env: "\u2699",
      gitignore: "\u2298",
      sh: ">_",
      log: "\u2630",
      txt: "\u2630",
    };
    return icons[ext] || "\u2630";
  }

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP SERVERS PANEL
  // ═══════════════════════════════════════════════════════════════════════════

  async _loadMCPStatus() {
    if (!window.lvzero["mcp:status"]) return;
    const status = await window.lvzero["mcp:status"]();
    this._renderMCPServerList(status.servers || []);
  }

  /**
   * Loads health status for all MCP servers.
   */
  async _loadMCPHealthStatus() {
    if (!window.lvzero["mcp:healthStatus"]) return;
    try {
      const result = await window.lvzero["mcp:healthStatus"]();
      if (result && result.servers) {
        // Merge health info into existing server display
        for (const server of result.servers) {
          const el = this.els.mcpServerList?.querySelector(`.mcp-server[data-server-name="${server.name}"]`);
          if (!el) continue;
          const dot = el.querySelector(".mcp-status-dot");
          if (!dot) continue;
          // Update dot based on health state
          if (server.healthState === "healthy") {
            dot.className = "mcp-status-dot green";
          } else if (server.healthState === "unhealthy") {
            dot.className = "mcp-status-dot yellow";
          } else if (server.healthState === "reconnecting") {
            dot.className = "mcp-status-dot yellow mcp-status-pulse";
          } else {
            dot.className = "mcp-status-dot red";
          }
          // Show reconnection status
          let statusEl = el.querySelector(".mcp-reconnect-status");
          if (server.healthState === "reconnecting") {
            if (!statusEl) {
              statusEl = document.createElement("div");
              statusEl.className = "mcp-reconnect-status";
              el.querySelector(".mcp-server-details")?.after(statusEl);
            }
            statusEl.textContent = `🔄 Reconnecting (attempt ${server.reconnectAttempt || 1})...`;
          } else if (statusEl) {
            statusEl.remove();
          }
        }
      }
    } catch (err) {
      console.warn("[IDE] MCP health status load:", err.message);
    }
  }

  _renderMCPServerList(servers) {
    const container = this.els.mcpServerList;
    if (!container) return;
    const badge = this.els.mcpCountBadge;
    if (badge) badge.textContent = servers.length;

    if (servers.length === 0) {
      container.innerHTML = '<div class="mcp-empty">No hay servidores MCP configurados</div>';
      return;
    }

    container.innerHTML = servers
      .map((s) => {
        const stateClass = s.state || "disconnected";
        const dotColor =
          stateClass === "connected"
            ? "green"
            : stateClass === "unhealthy"
              ? "yellow"
              : "red";
        return `
          <div class="mcp-server ${stateClass}" data-server-name="${this._escapeHtml(s.name)}">
            <div class="mcp-server-header">
              <span class="mcp-status-dot ${dotColor}"></span>
              <span class="mcp-server-name">${this._escapeHtml(s.name)}</span>
              <span class="mcp-server-type">${this._escapeHtml(s.type || "")}</span>
              <button class="mcp-tools-toggle" data-name="${this._escapeHtml(s.name)}" title="Toggle tools">🔧</button>
            </div>
            ${stateClass === "connected"
              ? `
              <div class="mcp-server-details">
                <span class="mcp-detail">v${this._escapeHtml(s.protocolVersion || "?")}</span>
                <span class="mcp-detail">${this._escapeHtml(s.serverInfo?.name || "")}</span>
              </div>`
              : `
              <div class="mcp-server-error">${this._escapeHtml(s.lastError || stateClass)}</div>
              <button class="mcp-reconnect-btn" data-name="${this._escapeHtml(s.name)}">Reconnect</button>`}
            <div class="mcp-server-tools hidden" data-server="${this._escapeHtml(s.name)}">
              <div class="mcp-tools-loading">⏳ Loading tools...</div>
            </div>
          </div>`;
      })
      .join("");

    // Attach reconnect button handlers
    container.querySelectorAll(".mcp-reconnect-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        btn.textContent = "Connecting...";
        btn.disabled = true;
        if (window.lvzero["mcp:reconnect"]) {
          await window.lvzero["mcp:reconnect"](name);
        }
      });
    });

    // Attach tools toggle handlers
    container.querySelectorAll(".mcp-tools-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        await this._toggleMCPServerTools(name);
      });
    });
  }

  /**
   * Toggles the tool list for a specific MCP server.
   * @param {string} serverName
   */
  async _toggleMCPServerTools(serverName) {
    const toolsContainer = this.els.mcpServerList?.querySelector(`.mcp-server-tools[data-server="${serverName}"]`);
    if (!toolsContainer) return;

    const isHidden = toolsContainer.classList.contains("hidden");
    if (!isHidden) {
      toolsContainer.classList.add("hidden");
      return;
    }

    toolsContainer.classList.remove("hidden");
    toolsContainer.innerHTML = '<div class="mcp-tools-loading">⏳ Loading tools...</div>';

    try {
      // Fetch tools and disabled tools in parallel
      const [toolsResult, disabledResult] = await Promise.all([
        window.lvzero["mcp:getTools"]?.(serverName),
        window.lvzero["mcp:getDisabledTools"]?.(serverName),
      ]);

      const tools = (toolsResult?.success && toolsResult.tools) || [];
      const allTools = (toolsResult?.success && toolsResult.total != null)
        ? toolsResult.total
        : tools.length;
      const disabledSet = new Set(
        (disabledResult?.success && disabledResult.disabled) || []
      );

      if (tools.length === 0 && disabledSet.size === 0) {
        toolsContainer.innerHTML = '<div class="mcp-tools-empty">No tools available</div>';
        return;
      }

      // We need to get ALL tools (including disabled) to show them
      // Try to get the full list via a separate call
      let allToolsList = [];
      try {
        // Fetch all tools without filtering by getting raw tools
        const rawResult = await window.lvzero["mcp:getTools"]?.(serverName);
        if (rawResult?.success && rawResult.total != null) {
          // We need to reconstruct the full list - get from the server directly
          // For now, use what we have
          allToolsList = tools;
        }
      } catch {}

      let toolsHtml = `<div class="mcp-tools-header">Tools (${allTools})</div>`;
      toolsHtml += '<div class="mcp-tools-list">';

      // Build a combined list of enabled + disabled tools
      const allToolNames = new Set();
      for (const t of tools) allToolNames.add(t.name);
      for (const d of disabledSet) allToolNames.add(d);

      for (const toolName of allToolNames) {
        const isDisabled = disabledSet.has(toolName);
        const toggleIcon = isDisabled ? "🔴" : "🟢";
        const toggleAction = isDisabled ? "enable" : "disable";
        toolsHtml += `
          <div class="mcp-tool-item ${isDisabled ? 'disabled' : 'enabled'}" data-server="${this._escapeHtml(serverName)}" data-tool="${this._escapeHtml(toolName)}">
            <span class="mcp-tool-toggle" data-action="${toggleAction}" title="${isDisabled ? 'Enable tool' : 'Disable tool'}">${toggleIcon}</span>
            <span class="mcp-tool-name">${this._escapeHtml(toolName)}</span>
            <span class="mcp-tool-status">${isDisabled ? 'disabled' : 'enabled'}</span>
          </div>`;
      }

      toolsHtml += '</div>';
      toolsContainer.innerHTML = toolsHtml;

      // Attach toggle handlers
      toolsContainer.querySelectorAll(".mcp-tool-toggle").forEach((toggle) => {
        toggle.addEventListener("click", async (e) => {
          e.stopPropagation();
          const item = toggle.closest(".mcp-tool-item");
          if (!item) return;
          const srv = item.dataset.server;
          const tool = item.dataset.tool;
          const action = toggle.dataset.action;

          toggle.textContent = "⏳";
          toggle.style.pointerEvents = "none";

          try {
            if (action === "disable") {
              await window.lvzero["mcp:disableTool"]?.(srv, tool);
            } else {
              await window.lvzero["mcp:enableTool"]?.(srv, tool);
            }
            // Re-render tools for this server
            await this._toggleMCPServerTools(srv);
          } catch (err) {
            console.warn(`[IDE] Tool toggle error: ${err.message}`);
            toggle.textContent = "❌";
          }
        });
      });
    } catch (err) {
      toolsContainer.innerHTML = `<div class="mcp-tools-error">❌ ${this._escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Toggles the MCP add-server form visibility.
   */
  _toggleMCPForm() {
    const form = this.els.mcpAddForm;
    if (!form) return;
    const isHidden = form.classList.contains("hidden");
    if (isHidden) {
      form.classList.remove("hidden");
      // Reset form fields
      if (this.els.mcpFormName) this.els.mcpFormName.value = "";
      if (this.els.mcpFormType) this.els.mcpFormType.value = "stdio";
      if (this.els.mcpFormCommand) this.els.mcpFormCommand.value = "";
      if (this.els.mcpFormArgs) this.els.mcpFormArgs.value = "";
      if (this.els.mcpFormUrl) this.els.mcpFormUrl.value = "";
      if (this.els.mcpFormEnv) this.els.mcpFormEnv.value = "";
      if (this.els.mcpFormAutoconnect) this.els.mcpFormAutoconnect.checked = true;
      if (this.els.mcpFormStatus) this.els.mcpFormStatus.textContent = "";
      this._toggleMCPFormFields();
      // Focus the name input
      setTimeout(() => this.els.mcpFormName?.focus(), 100);
    } else {
      form.classList.add("hidden");
    }
  }

  /**
   * Hides the MCP add-server form without saving.
   */
  _hideMCPForm() {
    if (this.els.mcpAddForm) {
      this.els.mcpAddForm.classList.add("hidden");
    }
  }

  /**
   * Toggles stdio vs HTTP fields based on the selected transport type.
   */
  _toggleMCPFormFields() {
    const type = this.els.mcpFormType?.value || "stdio";
    if (this.els.mcpFormStdioFields) {
      this.els.mcpFormStdioFields.classList.toggle("hidden", type !== "stdio");
    }
    if (this.els.mcpFormHttpFields) {
      this.els.mcpFormHttpFields.classList.toggle("hidden", type !== "streamable-http");
    }
  }

  /**
   * Saves a new MCP server configuration via mcp:configSave IPC.
   */
  async _saveMCPConfig() {
    const statusEl = this.els.mcpFormStatus;
    const saveBtn = this.els.mcpFormSave;
    if (!statusEl || !saveBtn) return;

    const name = this.els.mcpFormName?.value.trim();
    if (!name) {
      statusEl.textContent = "⚠️ Server name is required";
      statusEl.className = "mcp-form-status error";
      this.els.mcpFormName?.focus();
      return;
    }

    const type = this.els.mcpFormType?.value || "stdio";
    const autoConnect = this.els.mcpFormAutoconnect?.checked !== false;

    // Build server config
    const serverConfig = {};

    if (type === "stdio") {
      const command = this.els.mcpFormCommand?.value.trim();
      if (!command) {
        statusEl.textContent = "⚠️ Command is required for stdio servers";
        statusEl.className = "mcp-form-status error";
        this.els.mcpFormCommand?.focus();
        return;
      }
      serverConfig.command = command;
      const argsStr = this.els.mcpFormArgs?.value.trim();
      if (argsStr) {
        serverConfig.args = argsStr.split(/\s+/).filter(Boolean);
      }
    } else {
      const url = this.els.mcpFormUrl?.value.trim();
      if (!url) {
        statusEl.textContent = "⚠️ URL is required for HTTP servers";
        statusEl.className = "mcp-form-status error";
        this.els.mcpFormUrl?.focus();
        return;
      }
      serverConfig.url = url;
      serverConfig.type = "streamable-http";
    }

    // Parse env vars
    const envStr = this.els.mcpFormEnv?.value.trim();
    if (envStr) {
      try {
        const parsed = JSON.parse(envStr);
        if (typeof parsed === "object" && !Array.isArray(parsed)) {
          serverConfig.env = parsed;
        } else {
          statusEl.textContent = "⚠️ Env vars must be a JSON object { }";
          statusEl.className = "mcp-form-status error";
          return;
        }
      } catch {
        statusEl.textContent = "⚠️ Invalid JSON in env vars";
        statusEl.className = "mcp-form-status error";
        return;
      }
    }

    serverConfig.autoConnect = autoConnect;

    // Build full config in the format expected by saveConfig
    const config = {
      mcpServers: {
        [name]: serverConfig,
      },
    };

    // Save via IPC
    statusEl.textContent = "⏳ Saving...";
    statusEl.className = "mcp-form-status";
    saveBtn.disabled = true;

    try {
      const result = await window.lvzero["mcp:configSave"](config);
      if (result && result.success) {
        statusEl.textContent = `✅ Server "${name}" saved and connected`;
        statusEl.className = "mcp-form-status success";
        // Reload MCP status to show the new server
        await this._loadMCPStatus();
        // Close the form after a brief delay
        setTimeout(() => this._hideMCPForm(), 1500);
      } else {
        statusEl.textContent = `❌ ${result?.error || "Save failed"}`;
        statusEl.className = "mcp-form-status error";
      }
    } catch (err) {
      statusEl.textContent = `❌ Error: ${err.message}`;
      statusEl.className = "mcp-form-status error";
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP REGISTRY BROWSER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Opens the MCP Registry Browser modal and loads the server list.
   */
  async _openMCPRegistry() {
    if (!this.els.mcpRegistryOverlay) return;
    this.els.mcpRegistryOverlay.classList.remove("hidden");
    this.els.mcpRegistryList.innerHTML = '<div class="mcp-registry-loading">Loading registry...</div>';
    if (this.els.mcpRegistrySearch) this.els.mcpRegistrySearch.value = "";
    this._pendingRegistryServer = null;
    await this._loadMCPRegistry();
  }

  /**
   * Closes the MCP Registry Browser modal.
   */
  _closeMCPRegistry() {
    if (this.els.mcpRegistryOverlay) {
      this.els.mcpRegistryOverlay.classList.add("hidden");
    }
  }

  /**
   * Fetches the MCP registry from the main process and renders it.
   */
  async _loadMCPRegistry() {
    try {
      let registry = [];
      if (window.lvzero && window.lvzero["mcp:listRegistry"]) {
        const result = await window.lvzero["mcp:listRegistry"]();
        if (result && result.success && Array.isArray(result.registry)) {
          registry = result.registry;
        }
      }

      // Fallback: hardcoded popular servers if IPC unavailable
      if (registry.length === 0) {
        registry = this._getFallbackRegistry();
      }

      // Get currently enabled servers
      let enabledSet = new Set();
      try {
        if (window.lvzero && window.lvzero["mcp:getEnabled"]) {
          const enabledResult = await window.lvzero["mcp:getEnabled"]();
          const enabledStr = (enabledResult && enabledResult.enabled) || "";
          enabledSet = new Set(enabledStr.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
        }
      } catch (_) {}

      this._cachedRegistry = registry;
      this._cachedEnabledSet = enabledSet;
      this._renderMCPRegistry(registry, enabledSet, "");
    } catch (err) {
      console.error("Failed to load MCP registry:", err);
      if (this.els.mcpRegistryList) {
        this.els.mcpRegistryList.innerHTML = '<div class="mcp-registry-empty">Failed to load registry</div>';
      }
    }
  }

  /**
   * Filters the MCP registry list based on search input.
   */
  _filterMCPRegistry() {
    const query = (this.els.mcpRegistrySearch?.value || "").trim().toLowerCase();
    this._renderMCPRegistry(this._cachedRegistry || [], this._cachedEnabledSet || new Set(), query);
  }

  /**
   * Renders the MCP registry list grouped by category.
   */
  _renderMCPRegistry(registry, enabledSet, query) {
    const container = this.els.mcpRegistryList;
    if (!container) return;

    // Group by category
    const categories = {};
    for (const server of registry) {
      // Filter by search query
      if (query) {
        const matchName = server.name.toLowerCase().includes(query);
        const matchDesc = (server.description || "").toLowerCase().includes(query);
        const matchId = server.id.toLowerCase().includes(query);
        if (!matchName && !matchDesc && !matchId) continue;
      }
      const cat = server.category || "Other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(server);
    }

    const catKeys = Object.keys(categories);
    if (catKeys.length === 0) {
      container.innerHTML = '<div class="mcp-registry-empty">No servers match your search</div>';
      return;
    }

    let html = "";
    for (const category of catKeys) {
      html += `<div class="mcp-registry-category">${category}</div>`;
      for (const server of categories[category]) {
        const isActive = enabledSet.has(server.id);
        const badgeClass = isActive ? "mcp-registry-item-badge active" : "mcp-registry-item-badge";
        const badgeText = isActive ? "ACTIVE" : "ADD";
        html += `
          <div class="mcp-registry-item" data-server-id="${this._escapeHtml(server.id)}">
            <span class="mcp-registry-item-name">${this._escapeHtml(server.name)}</span>
            <span class="mcp-registry-item-desc">${this._escapeHtml(server.description || "")}</span>
            <span class="${badgeClass}">${badgeText}</span>
          </div>
        `;
      }
    }

    container.innerHTML = html;

    // Bind click handlers
    container.querySelectorAll(".mcp-registry-item").forEach((item) => {
      item.addEventListener("click", () => {
        const serverId = item.dataset.serverId;
        const server = registry.find((s) => s.id === serverId);
        if (server) {
          this._openMCPEnvConfig(server);
        }
      });
    });
  }

  /**
   * Fallback registry when IPC is unavailable.
   */
  _getFallbackRegistry() {
    return [
      { id: "git", name: "Git", category: "🔧 Development Tools", description: "Git operations: commit, branch, merge" },
      { id: "github", name: "GitHub", category: "🔧 Development Tools", description: "Issues, PRs, repos, code reviews" },
      { id: "docker", name: "Docker", category: "☁️ Cloud Platforms & DevOps", description: "Containers, images, volumes, Compose" },
      { id: "postgres", name: "PostgreSQL", category: "🗄️ Databases & Storage", description: "SQL queries, schema introspection" },
      { id: "supabase", name: "Supabase", category: "🗄️ Databases & Storage", description: "CRUD, SQL, RLS management" },
      { id: "slack", name: "Slack", category: "📝 Productivity & Collaboration", description: "Messages, channels, workspace" },
      { id: "jira", name: "Jira", category: "🔧 Development Tools", description: "Issues, sprints, project tracking" },
      { id: "notion", name: "Notion", category: "📝 Productivity & Collaboration", description: "Pages, databases, blocks" },
      { id: "aws", name: "AWS", category: "☁️ Cloud Platforms & DevOps", description: "EC2, S3, Lambda, IAM" },
      { id: "kubernetes", name: "Kubernetes", category: "☁️ Cloud Platforms & DevOps", description: "Pods, deployments, services" },
      { id: "sentry", name: "Sentry", category: "🔧 Development Tools", description: "Error tracking, performance" },
      { id: "linear", name: "Linear", category: "📝 Productivity & Collaboration", description: "Issue tracking, cycles" },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP ENV CONFIG MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Opens the env config modal for a specific registry server.
   * Shows required env var fields that the user must fill in.
   */
  _openMCPEnvConfig(server) {
    if (!this.els.mcpEnvOverlay) return;
    this._pendingRegistryServer = server;
    this.els.mcpEnvOverlay.classList.remove("hidden");
    this.els.mcpEnvStatus.textContent = "";
    this.els.mcpEnvStatus.className = "mcp-env-status";

    // Set title and description
    if (this.els.mcpEnvTitle) {
      this.els.mcpEnvTitle.textContent = `📦 Configure ${server.name}`;
    }
    if (this.els.mcpEnvDescription) {
      const cmd = server.command ? `${server.command} ${(server.args || []).join(" ")}` : server.url || "N/A";
      this.els.mcpEnvDescription.textContent = `${server.description}\nCommand: ${cmd}`;
    }

    // Build env var fields
    const fieldsContainer = this.els.mcpEnvFields;
    if (!fieldsContainer) return;

    const envConfig = server.env || {};
    const envKeys = Object.keys(envConfig);

    if (envKeys.length === 0) {
      // No env vars needed — show a simple confirmation
      fieldsContainer.innerHTML = `
        <div class="mcp-env-field">
          <p style="font-size:12px;color:var(--text-secondary);">No additional configuration needed. Click "Activate & Connect" to enable this server.</p>
        </div>
      `;
    } else {
      let fieldsHtml = "";
      for (const key of envKeys) {
        const hint = envConfig[key] || "";
        fieldsHtml += `
          <div class="mcp-env-field">
            <label for="mcp-env-${key}">${this._escapeHtml(key)}</label>
            <input id="mcp-env-${key}" class="mcp-env-input" type="password" data-env-key="${this._escapeHtml(key)}" placeholder="${this._escapeHtml(key)}" autocomplete="off" />
            <div class="mcp-env-field-hint">${this._escapeHtml(hint)}</div>
          </div>
        `;
      }
      fieldsContainer.innerHTML = fieldsHtml;
    }

    // Enable the activate button
    if (this.els.mcpEnvActivate) {
      this.els.mcpEnvActivate.disabled = false;
      this.els.mcpEnvActivate.textContent = envKeys.length > 0 ? "Activate & Connect" : "Enable & Connect";
    }
  }

  /**
   * Closes the MCP env config modal.
   */
  _closeMCPEnvConfig() {
    if (this.els.mcpEnvOverlay) {
      this.els.mcpEnvOverlay.classList.add("hidden");
    }
    this._pendingRegistryServer = null;
  }

  /**
   * Activates a registry server: saves env vars and connects.
   */
  async _activateMCPServer() {
    const server = this._pendingRegistryServer;
    if (!server) return;

    const statusEl = this.els.mcpEnvStatus;
    const activateBtn = this.els.mcpEnvActivate;
    if (!statusEl || !activateBtn) return;

    // Collect env var values
    const envConfig = server.env || {};
    const envKeys = Object.keys(envConfig);
    const envValues = {};

    for (const key of envKeys) {
      const input = document.getElementById(`mcp-env-${key}`);
      if (input) {
        envValues[key] = input.value.trim();
      }
    }

    statusEl.textContent = "⏳ Activating...";
    statusEl.className = "mcp-env-status";
    activateBtn.disabled = true;

    try {
      // 1. Add to MCP_ENABLED_SERVERS
      let enabledServers = [];
      try {
        if (window.lvzero && window.lvzero["mcp:getEnabled"]) {
          const result = await window.lvzero["mcp:getEnabled"]();
          const currentStr = (result && result.enabled) || "";
          enabledServers = currentStr.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        }
      } catch (_) {}

      if (!enabledServers.includes(server.id)) {
        enabledServers.push(server.id);
      }
      const newEnabledValue = enabledServers.join(",");

      if (window.lvzero && window.lvzero["mcp:saveEnabled"]) {
        const saveResult = await window.lvzero["mcp:saveEnabled"](newEnabledValue);
        if (!saveResult || !saveResult.success) {
          throw new Error(saveResult?.error || "Failed to save enabled servers");
        }
      }

      // 2. Save env vars to the server config via mcp:configSave
      const config = {
        name: server.id,
        type: server.type || "stdio",
        command: server.command || "npx",
        args: server.args || [],
        url: server.url || "",
        env: envValues,
        autoConnect: true,
      };

      if (window.lvzero && window.lvzero["mcp:configSave"]) {
        const configResult = await window.lvzero["mcp:configSave"](config);
        if (!configResult || !configResult.success) {
          // Non-fatal: the server is at least enabled
          console.warn("MCP config save warning:", configResult?.error);
        }
      }

      statusEl.textContent = `✅ ${server.name} activated! Restart may be required.`;
      statusEl.className = "mcp-env-status success";

      // Update the registry display
      if (this._cachedEnabledSet) {
        this._cachedEnabledSet.add(server.id);
      }
      this._renderMCPRegistry(this._cachedRegistry || [], this._cachedEnabledSet || new Set(), this.els.mcpRegistrySearch?.value || "");

      // Reload MCP status
      await this._loadMCPStatus();

      // Close after delay
      setTimeout(() => {
        this._closeMCPEnvConfig();
        this._closeMCPRegistry();
      }, 1500);

    } catch (err) {
      statusEl.textContent = `❌ ${err.message}`;
      statusEl.className = "mcp-env-status error";
      activateBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Loads current project state from main process on init.
   * If a project is already open, updates the explorer header.
   * Otherwise, shows the welcome screen.
   */
  async _loadProject() {
    try {
      const result = await window.lvzero["project:current"]();
      if (result && result.isOpen) {
        this._project = { name: result.name, path: result.path, isOpen: true };
        // Also load project identity config
        try {
          const identityResult = await window.lvzero["project:identity"](result.path);
          if (identityResult && identityResult.success) {
            this._project.identity = identityResult.config;
          }
        } catch (identityErr) {
          console.warn("[IDE] Could not load project identity:", identityErr.message);
        }
        // Load permission state (Phase 2)
        await this._loadPermissions();
        this._updateExplorerHeader();
      } else {
        this._showWelcomeScreen();
      }
    } catch (err) {
      console.warn("[IDE] Could not load project state:", err.message);
      this._showWelcomeScreen();
    }
  }

  /**
   * Loads permission state for the current project.
   * Non-blocking: if permissions module is unavailable, permissions remain inactive.
   */
  async _loadPermissions() {
    try {
      if (!window.lvzero["permissions:list"]) {
        this._permissions.active = false;
        return;
      }
      const projectPath = this._project?.path;
      if (!projectPath) {
        this._permissions.active = false;
        return;
      }
      const result = await window.lvzero["permissions:list"](projectPath);
      if (result && result.success && result.permissions) {
        this._permissions.active = true;
        this._permissions.projectPerms = result.permissions;
        // Clear cache on permission reload
        this._permissions.cache = {};
      } else {
        this._permissions.active = false;
        this._permissions.projectPerms = null;
      }
    } catch (err) {
      console.warn("[IDE] Could not load permissions:", err.message);
      this._permissions.active = false;
    }
  }

  /**
   * Checks a permission via IPC and caches the result.
   * @param {string} permissionType - "read_file" | "write_file" | "command" | "read_url" | "mcp"
   * @param {string} target - File path, command name, URL, or MCP tool name
   * @returns {Promise<{allowed: boolean, reason: string}>}
   */
  async _checkPermission(permissionType, target) {
    try {
      // Check cache first
      const cacheKey = `${permissionType}:${target}`;
      if (this._permissions.cache[cacheKey]) {
        return this._permissions.cache[cacheKey];
      }

      if (!window.lvzero["permissions:check"]) {
        return { allowed: true, reason: "Permissions IPC not available" };
      }

      const projectPath = this._project?.path;
      const result = await window.lvzero["permissions:check"](projectPath, permissionType, target);

      // Cache the result
      if (result) {
        this._permissions.cache[cacheKey] = result;
      }

      return result || { allowed: true, reason: "No response from permission check" };
    } catch (err) {
      console.warn(`[IDE] Permission check error for ${permissionType} "${target}":`, err.message);
      return { allowed: true, reason: `Permission check error: ${err.message}` };
    }
  }

  /**
   * Shows the welcome screen in the file tree area when no project is open.
   * Renders New Project and Open Project buttons, plus recent projects list.
   */
  _showWelcomeScreen() {
    const treeEl = this.els.fileTree;
    if (!treeEl) return;

    // Determine identity badge text based on current project if open
    let identityBadge = "";
    if (this._project && this._project.identity) {
      const id = this._project.identity;
      identityBadge = `<span class="identity-badge">${this._escapeHtml(id.type)} | ${this._escapeHtml(id.stage)}</span>`;
    }

    treeEl.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-icon">👋</div>
        <h2 class="welcome-title">Welcome to lv-zero</h2>
        <p class="welcome-subtitle">Open a project to get started</p>
        <div class="welcome-identity-hint">
          <span class="identity-badge">desktop | prototype</span>
          <span class="identity-hint-text">Default project identity</span>
        </div>
        <div class="welcome-actions">
          <button class="welcome-btn" data-action="new">
            <span class="welcome-btn-icon">📁</span>
            <span class="welcome-btn-label">New Project</span>
          </button>
          <button class="welcome-btn" data-action="open">
            <span class="welcome-btn-icon">📂</span>
            <span class="welcome-btn-label">Open Project</span>
          </button>
        </div>
        <div class="recent-projects-container">
          <h3 class="recent-projects-title">Recent Projects</h3>
          <div id="recent-projects-list" class="recent-projects-list">
            <div class="recent-loading">Loading...</div>
          </div>
        </div>
      </div>
    `;

    // Bind button clicks
    treeEl.querySelector("[data-action='new']")?.addEventListener("click", () => this._newProject());
    treeEl.querySelector("[data-action='open']")?.addEventListener("click", () => this._openProject());

    // Load recent projects asynchronously
    this._loadRecentProjects();
  }

  /**
   * Loads and renders the recent projects list into the welcome screen.
   */
  async _loadRecentProjects() {
    const listEl = document.getElementById("recent-projects-list");
    if (!listEl) return;

    try {
      const result = await window.lvzero["project:listRecent"]();
      const projects = result?.projects || [];

      if (projects.length === 0) {
        listEl.innerHTML = `<div class="recent-empty">No recent projects</div>`;
        return;
      }

      listEl.innerHTML = projects
        .map((p) => {
          const timeAgo = this._timeAgo(new Date(p.lastOpened));
          const name = this._escapeHtml(p.name || "untitled");
          const dir = this._escapeHtml(p.path);
          return `<div class="recent-project-item" data-path="${this._escapeHtml(p.path)}">
            <span class="recent-project-name">${name}</span>
            <span class="recent-project-time">${timeAgo}</span>
            <span class="recent-project-path">${dir}</span>
          </div>`;
        })
        .join("");

      // Bind click events
      listEl.querySelectorAll(".recent-project-item").forEach((el) => {
        el.addEventListener("click", () => this._openProject(el.dataset.path));
      });
    } catch (err) {
      console.warn("[IDE] Could not load recent projects:", err.message);
      if (listEl) listEl.innerHTML = `<div class="recent-empty">Could not load recent projects</div>`;
    }
  }

  /**
   * Returns a human-readable relative time string from a Date object.
   */
  _timeAgo(date) {
    if (!date || isNaN(date.getTime())) return "unknown";
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  }

  /**
   * Updates the explorer panel header text to show the current project name.
   */
  _updateExplorerHeader() {
    const header = this.els.projectHeader;
    if (!header) return;

    if (this._project.isOpen && this._project.name) {
      let label = `📁 ${this._project.name}`;
      // Append identity badge if available
      if (this._project.identity) {
        const id = this._project.identity;
        label += ` <span class="identity-badge">${this._escapeHtml(id.type)} | ${this._escapeHtml(id.stage)}</span>`;
      }
      // Append permission indicator (Phase 2)
      if (this._permissions.active) {
        label += ` <span class="permission-badge" title="Permissions active: ${this._permissions.projectPerms ? Object.keys(this._permissions.projectPerms).length : 0} permission types configured">🔒</span>`;
      } else {
        label += ` <span class="permission-badge permission-badge--off" title="Permissions: permissive (no project config)">🔓</span>`;
      }
      header.innerHTML = label;
    } else {
      header.textContent = "📁 Explorer";
    }
  }

  /**
   * Creates a new project — shows the guided setup wizard first.
   * Falls back to the simple flow if wizard is dismissed or fails.
   */
  async _newProject() {
    try {
      // Try wizard first; falls back to simple creation if wizard is dismissed
      const wizardResult = await this._showNewProjectWizard();

      // If wizard was dismissed/cancelled, fall back to simple creation
      if (!wizardResult) {
        const result = await window.lvzero["project:new"]();
        if (!result || !result.success) {
          if (result?.cancelled) return;
          this.addLogEntry("error", `❌ Could not create project: ${result?.error || "unknown"}`);
          console.warn("[IDE] New project failed:", result?.error);
          return;
        }
        await this._createProjectWithIdentity(result, null);
        return;
      }

      // Wizard completed — use collected config
      const { projectName, projectPath, projectType, framework, stage, languages, customTags, trelloSync } = wizardResult;

      // Ask main process to create the directory
      const result = await window.lvzero["project:new"]({ path: projectPath, name: projectName });
      if (!result || !result.success) {
        if (result?.cancelled) return;
        this.addLogEntry("error", `❌ Could not create project: ${result?.error || "unknown"}`);
        return;
      }

      // Create identity with wizard config
      await this._createProjectWithIdentity(result, {
        type: projectType,
        stage,
        languages,
        frameworks: framework ? [framework] : [],
        platform: projectType === "desktop" ? "electron" : projectType,
        automation: {
          trello: { enabled: trelloSync, apiKey: "", token: "", listId: "" },
          symphony: { enabled: true }
        },
        permissions: {
          read_file: ["**/*"],
          write_file: ["**/*"],
          command: []
        },
        custom_tags: customTags || [],
      });

      // Run init pipeline
      if (result.path) {
        try {
          const pipelineResult = await window.lvzero["init-pipeline:run"](result.path);
          if (pipelineResult && pipelineResult.success) {
            const okCount = pipelineResult.steps ? pipelineResult.steps.filter(s => s.ok).length : 0;
            const totalCount = pipelineResult.steps ? pipelineResult.steps.length : 0;
            this.addLogEntry("info", `📋 Init pipeline: ${okCount}/${totalCount} steps completed`);
          }
        } catch (pipelineErr) {
          console.warn("[IDE] Init pipeline (non-blocking) failed:", pipelineErr.message);
        }
      }

      this._loadRecentProjects();
      this.addLogEntry("info", `📁 Project created: ${result.name || projectName}`);
    } catch (err) {
      console.warn("[IDE] New project error:", err.message);
      this.addLogEntry("error", `❌ New project error: ${err.message}`);
    }
  }

  /**
   * Shared helper: creates project identity config and runs init pipeline.
   * @param {Object} result - Result from project:new IPC
   * @param {Object|null} config - Identity config, or null for defaults
   */
  async _createProjectWithIdentity(result, config) {
    if (!result.path) return;
    const identityConfig = config || {
      type: "desktop",
      stage: "prototype",
      languages: [],
      frameworks: [],
      platform: "electron",
      automation: {
        trello: { enabled: false, apiKey: "", token: "", listId: "" },
        symphony: { enabled: true }
      },
      permissions: {
        read_file: ["**/*"],
        write_file: ["**/*"],
        command: []
      },
      custom_tags: [],
    };
    try {
      const identityResult = await window.lvzero["project:identity-create"](result.path, identityConfig);
      if (identityResult && identityResult.success) {
        console.log("[IDE] Project identity created for:", result.name);
      } else {
        console.warn("[IDE] Could not create project identity:", identityResult?.error);
      }
    } catch (identityErr) {
      console.warn("[IDE] Could not create project identity:", identityErr.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECT WIZARD (Phase 9 — Init Pipeline Manager)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Opens the new project wizard modal.
   * Returns a promise that resolves with the collected config or null if dismissed.
   * @returns {Promise<Object|null>}
   */
  _showNewProjectWizard() {
    return new Promise((resolve) => {
      try {
        // Store resolve callback so _hideNewProjectWizard can use it
        this._wizardResolve = resolve;

        // Initialize wizard state
        this._wizardState = {
          step: 0,
          projectName: "",
          projectPath: "",
          projectType: "web",
          framework: "",
          stage: "prototype",
          languages: [],
          customTags: [],
          trelloSync: false,
          visible: true,
          finished: false,
        };

        // Show overlay
        if (this.els.wizardOverlay) {
          this.els.wizardOverlay.classList.remove("hidden");
        }

        // Render first step
        this._renderWizardStep(0);
        this._updateWizardProgress();
      } catch (err) {
        console.warn("[IDE] Wizard open error:", err.message);
        resolve(null);
      }
    });
  }

  /**
   * Hides the wizard and resolves the pending promise.
   * @param {boolean} cancelled - true if user dismissed without finishing
   */
  _hideNewProjectWizard(cancelled) {
    try {
      if (this.els.wizardOverlay) {
        this.els.wizardOverlay.classList.add("hidden");
      }
      if (this._wizardState) {
        this._wizardState.visible = false;
      }
      const resolve = this._wizardResolve;
      this._wizardResolve = null;
      if (resolve) {
        resolve(cancelled ? null : this._wizardState);
      }
    } catch (err) {
      console.warn("[IDE] Wizard close error:", err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DIAGNOSE WIZARD (Phase 10) — 5-Step Guided Debugging
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Opens the Diagnose Wizard overlay and creates a new debug session via IPC.
   */
  async _showDiagnoseWizard() {
    try {
      const projectPath = this._project && this._project.path;
      if (!projectPath) {
        this._showToast("error", "No project is open. Open a project first to use the Diagnose Wizard.");
        return;
      }

      // Create a new session via IPC
      const result = await window.lvzero["diagnose:create-session"](projectPath);
      if (!result || !result.success) {
        this._showToast("error", "Could not create debug session: " + (result?.error || "Unknown error"));
        return;
      }

      const session = result.session;
      this._diagnoseState = {
        visible: true,
        sessionId: session.id,
        stepIndex: 0,
        session: session,
      };

      // Show overlay
      if (this.els.diagnoseOverlay) {
        this.els.diagnoseOverlay.classList.remove("hidden");
      }

      // Render first step
      this._renderDiagnoseStep(0);
      this._updateDiagnoseProgress();
    } catch (err) {
      console.warn("[IDE] Diagnose wizard open error:", err.message);
      this._showToast("error", "Failed to open Diagnose Wizard: " + err.message);
    }
  }

  /**
   * Hides the Diagnose Wizard overlay.
   * @param {boolean} [cancelled=false] - If true, the session is aborted silently
   */
  _hideDiagnoseWizard(cancelled) {
    try {
      if (this.els.diagnoseOverlay) {
        this.els.diagnoseOverlay.classList.add("hidden");
      }
      if (this._diagnoseState) {
        this._diagnoseState.visible = false;
      }
      if (cancelled) {
        // Optionally delete the empty session
        const projectPath = this._project && this._project.path;
        const sessionId = this._diagnoseState?.sessionId;
        if (projectPath && sessionId && window.lvzero["diagnose:delete-session"]) {
          window.lvzero["diagnose:delete-session"](projectPath, sessionId).catch(() => {});
        }
      }
      this._diagnoseState = null;
    } catch (err) {
      console.warn("[IDE] Diagnose wizard close error:", err.message);
    }
  }

  /**
   * Renders the content for a given diagnose wizard step.
   * @param {number} stepIndex - 0-based step index (0-4)
   */
  _renderDiagnoseStep(stepIndex) {
    const body = this.els.diagnoseBody;
    if (!body || !this._diagnoseState) return;

    // Step definitions matching the backend
    const steps = [
      {
        id: "reproduce",
        icon: "🔍",
        title: "Reproducir (Reproduce)",
        desc: "Produce the specific error or bug systematically — describe input, expected vs actual output, and reproduction steps.",
        fields: [
          { key: "errorDescription", label: "Error Description", type: "textarea", placeholder: "What is the bug or error you are experiencing?" },
          { key: "reproductionSteps", label: "Reproduction Steps", type: "textarea", placeholder: "List the exact steps to reproduce the bug..." },
          { key: "expectedBehavior", label: "Expected Behavior", type: "textarea", placeholder: "What should happen instead?" },
        ],
      },
      {
        id: "isolate",
        icon: "🎯",
        title: "Aislar (Isolate)",
        desc: "Isolate the root cause by narrowing down variables — which module, function, or condition triggers the bug?",
        fields: [
          { key: "affectedModule", label: "Affected Module / File", type: "text", placeholder: "e.g. src/core/parser.js or the specific function" },
          { key: "suspectedCause", label: "Suspected Cause", type: "textarea", placeholder: "What variable, condition, or logic seems to be failing?" },
          { key: "relatedCode", label: "Related Code Snippet", type: "textarea", placeholder: "Paste the relevant code around the suspected failure..." },
        ],
      },
      {
        id: "hypothesize",
        icon: "💡",
        title: "Hipótesis (Hypothesize)",
        desc: "Hypothesize what is causing the behavior — formulate a clear root cause statement.",
        fields: [
          { key: "rootCause", label: "Root Cause Hypothesis", type: "textarea", placeholder: "I believe the root cause is..." },
          { key: "whyHypothesis", label: "Why This Hypothesis?", type: "textarea", placeholder: "Explain the reasoning behind your hypothesis..." },
        ],
      },
      {
        id: "instrument",
        icon: "🔧",
        title: "Instrumentar (Instrument)",
        desc: "Instrument the code to test the hypothesis — add logs, assertions, or minimal experiments to confirm.",
        fields: [
          { key: "instrumentationPlan", label: "Instrumentation Plan", type: "textarea", placeholder: "What logs, assertions, or tests will confirm or disprove the hypothesis?" },
          { key: "testResults", label: "Test / Log Results", type: "textarea", placeholder: "Paste the results from running the instrumentation..." },
        ],
      },
      {
        id: "fix_and_test",
        icon: "✅",
        title: "Reparar & Testear (Fix & Test)",
        desc: "Apply the fix and test it — verify the bug is resolved and no regressions were introduced.",
        fields: [
          { key: "fixDescription", label: "Fix Description", type: "textarea", placeholder: "Describe the fix applied..." },
          { key: "fixVerification", label: "Verification", type: "textarea", placeholder: "How did you verify the fix works? Paste test output or evidence..." },
        ],
      },
    ];

    const step = steps[stepIndex];
    if (!step) return;

    // Get any previously entered data
    const session = this._diagnoseState.session;
    const stepData = (session && session.steps && session.steps[stepIndex]?.data) || {};

    let html = `<div class="diagnose-step-title">${step.icon} ${this._escapeHtml(step.title)}</div>
<div class="diagnose-step-desc">${this._escapeHtml(step.desc)}</div>
<div class="diagnose-step-fields">`;

    for (const field of step.fields) {
      const value = stepData[field.key] || "";
      if (field.type === "textarea") {
        html += `<div class="diagnose-field">
          <label class="diagnose-field-label">${this._escapeHtml(field.label)}</label>
          <textarea class="diagnose-field-input diagnose-textarea" data-key="${this._escapeHtml(field.key)}" placeholder="${this._escapeHtml(field.placeholder)}">${this._escapeHtml(value)}</textarea>
        </div>`;
      } else {
        html += `<div class="diagnose-field">
          <label class="diagnose-field-label">${this._escapeHtml(field.label)}</label>
          <input class="diagnose-field-input diagnose-input" data-key="${this._escapeHtml(field.key)}" type="text" placeholder="${this._escapeHtml(field.placeholder)}" value="${this._escapeHtml(value)}" />
        </div>`;
      }
    }

    html += `</div>`;
    body.innerHTML = html;

    // Update footer buttons
    this._updateDiagnoseFooter(stepIndex);
  }

  /**
   * Updates the diagnose wizard step indicator dots.
   */
  _updateDiagnoseProgress() {
    const indicator = this.els.diagnoseStepIndicator;
    if (!indicator || !this._diagnoseState) return;

    const currentIdx = this._diagnoseState.stepIndex;
    const stepLabels = ["🔍", "🎯", "💡", "🔧", "✅"];
    const stepTitles = ["Reproduce", "Isolate", "Hypothesize", "Instrument", "Fix & Test"];

    let html = '<div class="diagnose-step-dots">';
    for (let i = 0; i < 5; i++) {
      const isActive = i === currentIdx;
      const isCompleted = i < currentIdx;
      const cls = isCompleted ? "diagnose-dot completed" : isActive ? "diagnose-dot active" : "diagnose-dot";
      html += `<div class="${cls}" title="${this._escapeHtml(stepTitles[i])}">
        <span class="diagnose-dot-icon">${stepLabels[i]}</span>
        <span class="diagnose-dot-label">${this._escapeHtml(stepTitles[i])}</span>
      </div>`;
    }
    html += "</div>";

    // Progress text
    const progressText = `Step ${currentIdx + 1} of 5`;
    html += `<div class="diagnose-progress-text">${progressText}</div>`;

    indicator.innerHTML = html;
  }

  /**
   * Updates the footer buttons based on current step.
   */
  _updateDiagnoseFooter(stepIndex) {
    const btnPrev = this.els.diagnoseBtnPrev;
    const btnNext = this.els.diagnoseBtnNext;
    const progress = this.els.diagnoseProgress;

    if (!btnPrev || !btnNext) return;

    // Previous step button visibility
    if (stepIndex === 0) {
      btnPrev.classList.add("hidden");
    } else {
      btnPrev.classList.remove("hidden");
    }

    // Next / Complete button text
    if (stepIndex >= 4) {
      btnNext.textContent = "✅ Complete Session";
      btnNext.title = "Complete the debug session and save evidence";
    } else {
      btnNext.textContent = "Next →";
      btnNext.title = "Save and advance to next step";
    }

    if (progress) {
      progress.textContent = `Step ${stepIndex + 1} / 5`;
    }
  }

  /**
   * Collects field data from the current diagnose step.
   */
  _collectDiagnoseFieldData() {
    const body = this.els.diagnoseBody;
    if (!body) return {};

    const data = {};
    const inputs = body.querySelectorAll(".diagnose-field-input");
    inputs.forEach((el) => {
      const key = el.getAttribute("data-key");
      if (key) {
        data[key] = el.value.trim();
      }
    });
    return data;
  }

  /**
   * Advances to the next diagnose step.
   */
  async _nextDiagnoseStep() {
    try {
      if (!this._diagnoseState) return;

      const projectPath = this._project && this._project.path;
      if (!projectPath) return;

      const currentIdx = this._diagnoseState.stepIndex;

      // Collect field data
      const fieldData = this._collectDiagnoseFieldData();

      // Advance step via IPC
      const result = await window.lvzero["diagnose:advance-step"](projectPath, this._diagnoseState.sessionId, fieldData);
      if (!result || !result.success) {
        this._showToast("error", "Failed to save step data: " + (result?.error || "Unknown error"));
        return;
      }

      // Update local state
      this._diagnoseState.session = result.session;

      if (result.stepChanged) {
        // Move to next step
        const nextIdx = currentIdx + 1;
        this._diagnoseState.stepIndex = nextIdx;
        this._renderDiagnoseStep(nextIdx);
        this._updateDiagnoseProgress();
      } else {
        // All steps complete
        this._diagnoseState.stepIndex = 5; // Past the last step
        this._renderDiagnoseComplete();
      }
    } catch (err) {
      console.warn("[IDE] Diagnose next step error:", err.message);
      this._showToast("error", "Error advancing step: " + err.message);
    }
  }

  /**
   * Goes back to the previous diagnose step (re-reads from server).
   */
  async _prevDiagnoseStep() {
    try {
      if (!this._diagnoseState) return;
      const currentIdx = this._diagnoseState.stepIndex;
      if (currentIdx <= 0) return;

      const projectPath = this._project && this._project.path;
      if (!projectPath) return;

      // Fetch the session again to get the latest data
      const result = await window.lvzero["diagnose:get-session"](projectPath, this._diagnoseState.sessionId);
      if (result && result.success) {
        this._diagnoseState.session = result.session;
      }

      const prevIdx = currentIdx - 1;
      this._diagnoseState.stepIndex = prevIdx;
      this._renderDiagnoseStep(prevIdx);
      this._updateDiagnoseProgress();
    } catch (err) {
      console.warn("[IDE] Diagnose prev step error:", err.message);
    }
  }

  /**
   * Renders the completion screen when all 5 steps are done.
   */
  _renderDiagnoseComplete() {
    const body = this.els.diagnoseBody;
    if (!body) return;

    const session = this._diagnoseState?.session;
    let summaryHtml = "";

    if (session && session.steps) {
      for (const st of session.steps) {
        const icon = st.icon || "📋";
        const dataStr = st.data && Object.keys(st.data).length > 0
          ? `<pre class="diagnose-summary-data">${this._escapeHtml(JSON.stringify(st.data, null, 2))}</pre>`
          : "<em>No data recorded</em>";
        summaryHtml += `<div class="diagnose-summary-step">
          <div class="diagnose-summary-step-header">${icon} ${this._escapeHtml(st.label)} ${st.completed ? "✅" : "⏳"}</div>
          ${dataStr}
        </div>`;
      }
    }

    body.innerHTML = `
      <div class="diagnose-complete-icon">🎉</div>
      <div class="diagnose-step-title">Debug Session Complete</div>
      <div class="diagnose-step-desc">All 5 steps have been completed. Review the summary below and click "Complete & Save" to persist the evidence.</div>
      <div class="diagnose-summary">${summaryHtml}</div>
    `;

    // Update footer
    const btnPrev = this.els.diagnoseBtnPrev;
    const btnNext = this.els.diagnoseBtnNext;
    const progress = this.els.diagnoseProgress;

    if (btnPrev) btnPrev.classList.add("hidden");
    if (btnNext) {
      btnNext.textContent = "💾 Complete & Save";
      btnNext.title = "Finalize debug session and save to evidence store";
    }
    if (progress) progress.textContent = "✅ Complete";
  }

  /**
   * Completes the diagnose session and saves evidence.
   */
  async _finishDiagnoseSession() {
    try {
      if (!this._diagnoseState) return;

      const projectPath = this._project && this._project.path;
      const sessionId = this._diagnoseState.sessionId;
      if (!projectPath || !sessionId) return;

      // Collect any field data from the completion screen
      const fieldData = this._collectDiagnoseFieldData();

      // Complete the session via IPC
      const result = await window.lvzero["diagnose:complete-session"](projectPath, sessionId, fieldData);
      if (!result || !result.success) {
        this._showToast("error", "Failed to complete session: " + (result?.error || "Unknown error"));
        return;
      }

      this._showToast("success", "🧪 Debug session completed and evidence saved!");
      this._hideDiagnoseWizard(false);
    } catch (err) {
      console.warn("[IDE] Diagnose finish error:", err.message);
      this._showToast("error", "Error completing session: " + err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRILL ME WIZARD — Scope Interview (Phase 4)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The 7 scoping questions used in the Grill Me interview.
   * Each question has: id, icon, title, desc, placeholder, and optional validation.
   */
  _getGrillMeQuestions() {
    return [
      {
        id: "problem",
        icon: "🎯",
        title: "What problem are you solving?",
        desc: "Describe the core problem or need that this project addresses. Be specific about pain points, inefficiencies, or gaps you've identified.",
        placeholder: "e.g., Small teams struggle to track project dependencies across multiple tools, leading to missed deadlines and communication gaps.",
        validation: { required: true, minLength: 10 },
      },
      {
        id: "users",
        icon: "👥",
        title: "Who are your target users?",
        desc: "Describe the primary and secondary user groups. Consider their technical skill level, workflow, and what they expect from the solution.",
        placeholder: "e.g., Project managers, developers, and stakeholders in teams of 5-20 people. They are technically proficient but value simplicity.",
        validation: { required: true, minLength: 10 },
      },
      {
        id: "core_feature",
        icon: "⚡",
        title: "What is the core feature?",
        desc: "Define the single most important feature that must work perfectly for the project to succeed. What is the 'magic' your project delivers?",
        placeholder: "e.g., Real-time dependency graph that auto-updates when any team member modifies a task, with visual indicators for blockers.",
        validation: { required: true, minLength: 15 },
      },
      {
        id: "constraints",
        icon: "🔒",
        title: "What constraints or limitations exist?",
        desc: "Identify technical, business, or timeline constraints. Consider budget, deadline, team size, existing systems, data privacy, or platform restrictions.",
        placeholder: "e.g., Must integrate with existing Jira and Slack. No cloud storage allowed — all data must remain on-premises. Delivery in 8 weeks.",
        validation: { required: false },
      },
      {
        id: "competition",
        icon: "🏆",
        title: "Who are your competitors / alternatives?",
        desc: "What other solutions do users currently rely on? How is your approach different or better? If you don't know, what's the current workaround?",
        placeholder: "e.g., Teams currently use spreadsheets + email. Competitors like Asana and Monday.com are too heavy for small teams. Our niche is lightweight + auto-mapping.",
        validation: { required: false },
      },
      {
        id: "success",
        icon: "📈",
        title: "How will you measure success?",
        desc: "Define concrete, measurable success criteria. What metrics, KPIs, or user feedback will tell you the project is working? Be specific.",
        placeholder: "e.g., 80% of team onboarded within first week. Average task completion time reduced by 30%. Zero critical bugs in first month.",
        validation: { required: true, minLength: 10 },
      },
      {
        id: "mvp",
        icon: "🚀",
        title: "What does the MVP look like?",
        desc: "Define the minimum viable product scope. What are the absolute essentials for a first release? What can wait for later?",
        placeholder: "e.g., Phase 1: User auth + project creation + dependency graph view + manual task linking. Phase 2: Auto-linking, notifications, reports.",
        validation: { required: true, minLength: 15 },
      },
    ];
  }

  /**
   * Opens the Grill Me scope interview wizard.
   * Creates a session via IPC and renders the first question.
   */
  async _showGrillMeWizard() {
    try {
      // Create overlay elements if they don't exist yet
      if (!this.els.grillMeOverlay) {
        this._createGrillMeOverlay();
      }

      // Create a new scoping session via IPC
      const projectPath = this._project && this._project.path;
      const result = await window.lvzero["grill-me:create-session"](projectPath);
      if (!result || !result.success) {
        this._showToast("error", "Could not create scoping session: " + (result?.error || "Unknown error"));
        return;
      }

      const questions = this._getGrillMeQuestions();
      this._grillMeState = {
        visible: true,
        sessionId: result.sessionId,
        currentIdx: 0,
        questions: questions,
        answers: {},
        completed: false,
      };

      // Show overlay
      if (this.els.grillMeOverlay) {
        this.els.grillMeOverlay.classList.remove("hidden");
      }

      // Render first question
      this._renderGrillMeQuestion(0);
      this._updateGrillMeProgress();
    } catch (err) {
      console.warn("[IDE] Grill Me wizard open error:", err.message);
      this._showToast("error", "Failed to open Grill Me wizard: " + err.message);
    }
  }

  /**
   * Creates the grill-me overlay DOM elements dynamically if not in index.html.
   */
  _createGrillMeOverlay() {
    const existing = document.getElementById("grill-me-overlay");
    if (existing) {
      // Re-cache DOM references
      this.els.grillMeOverlay = existing;
      this.els.grillMeClose = document.getElementById("btn-grill-me-close");
      this.els.grillMeStepIndicator = document.getElementById("grill-me-step-indicator");
      this.els.grillMeBody = document.getElementById("grill-me-body");
      this.els.grillMeFooter = document.getElementById("grill-me-footer");
      this.els.grillMeBtnPrev = document.getElementById("btn-grill-me-prev");
      this.els.grillMeBtnNext = document.getElementById("btn-grill-me-next");
      this.els.grillMeProgress = document.getElementById("grill-me-progress");
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "grill-me-overlay";
    overlay.className = "grill-me-overlay hidden";
    overlay.innerHTML = `
      <div class="grill-me-modal">
        <div class="grill-me-header">
          <h2 class="grill-me-title">🔥 Grill Me — Scope Interview</h2>
          <button class="grill-me-close" id="btn-grill-me-close" title="Close">✕</button>
        </div>
        <div class="grill-me-step-indicator" id="grill-me-step-indicator"></div>
        <div class="grill-me-body" id="grill-me-body"></div>
        <div class="grill-me-footer" id="grill-me-footer">
          <button class="grill-me-btn grill-me-btn-prev hidden" id="btn-grill-me-prev">← Back</button>
          <span class="grill-me-progress" id="grill-me-progress">Question 1 / 7</span>
          <button class="grill-me-btn grill-me-btn-next" id="btn-grill-me-next">Next →</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Cache DOM references
    this.els.grillMeOverlay = overlay;
    this.els.grillMeClose = document.getElementById("btn-grill-me-close");
    this.els.grillMeStepIndicator = document.getElementById("grill-me-step-indicator");
    this.els.grillMeBody = document.getElementById("grill-me-body");
    this.els.grillMeFooter = document.getElementById("grill-me-footer");
    this.els.grillMeBtnPrev = document.getElementById("btn-grill-me-prev");
    this.els.grillMeBtnNext = document.getElementById("btn-grill-me-next");
    this.els.grillMeProgress = document.getElementById("grill-me-progress");

    // Bind close events for the dynamically created overlay
    this._bindGrillMeEvents();
  }

  /**
   * Binds events for the grill-me overlay (close, prev, next buttons).
   */
  _bindGrillMeEvents() {
    const ov = this.els.grillMeOverlay;
    if (!ov) return;

    // Close via ✕ button
    if (this.els.grillMeClose) {
      this.els.grillMeClose.addEventListener("click", () => {
        this._hideGrillMeWizard(true);
      });
    }

    // Close by clicking overlay background
    ov.addEventListener("click", (e) => {
      if (e.target === ov) {
        this._hideGrillMeWizard(true);
      }
    });

    // Previous step
    if (this.els.grillMeBtnPrev) {
      this.els.grillMeBtnPrev.addEventListener("click", () => {
        this._prevGrillMeQuestion();
      });
    }

    // Next step / Submit
    if (this.els.grillMeBtnNext) {
      this.els.grillMeBtnNext.addEventListener("click", () => {
        const btn = this.els.grillMeBtnNext;
        const isSubmit = btn.textContent.includes("Generate Specs");
        if (isSubmit) {
          this._submitGrillMeAnswers();
        } else {
          this._nextGrillMeQuestion();
        }
      });
    }

    // Keyboard: Escape dismisses
    document.addEventListener("keydown", (e) => {
      if (!this._grillMeState || !this._grillMeState.visible) return;
      if (e.key === "Escape") {
        this._hideGrillMeWizard(true);
      }
    });
  }

  /**
   * Hides the Grill Me wizard overlay.
   * @param {boolean} [cancelled=false]
   */
  _hideGrillMeWizard(cancelled) {
    try {
      if (this.els.grillMeOverlay) {
        this.els.grillMeOverlay.classList.add("hidden");
      }
      if (this._grillMeState) {
        this._grillMeState.visible = false;
      }
      if (cancelled && this._grillMeState) {
        this._showToast("info", "Scope interview cancelled. You can start again anytime.");
      }
      this._grillMeState = null;
    } catch (err) {
      console.warn("[IDE] Grill Me wizard close error:", err.message);
    }
  }

  /**
   * Renders the question at the given index.
   * @param {number} idx - 0-based question index (0-6)
   */
  _renderGrillMeQuestion(idx) {
    const body = this.els.grillMeBody;
    if (!body || !this._grillMeState) return;

    const questions = this._grillMeState.questions;
    const question = questions[idx];
    if (!question) return;

    // Get previously entered answer
    const savedAnswer = this._grillMeState.answers[question.id] || "";

    let html = `<div class="grill-me-question-icon">${question.icon}</div>
      <div class="grill-me-question-title">${this._escapeHtml(question.title)}</div>
      <div class="grill-me-question-desc">${this._escapeHtml(question.desc)}</div>
      <div class="grill-me-question-field">
        <textarea class="grill-me-textarea" data-qid="${this._escapeHtml(question.id)}" placeholder="${this._escapeHtml(question.placeholder)}" rows="5">${this._escapeHtml(savedAnswer)}</textarea>
      </div>
      <div class="grill-me-question-validation hidden" id="grill-me-validation-msg"></div>`;

    body.innerHTML = html;

    // Auto-focus the textarea
    const textarea = body.querySelector(".grill-me-textarea");
    if (textarea) {
      setTimeout(() => textarea.focus(), 100);
    }

    // Update footer
    this._updateGrillMeFooter(idx);
  }

  /**
   * Updates the step indicator dots.
   */
  _updateGrillMeProgress() {
    const indicator = this.els.grillMeStepIndicator;
    if (!indicator || !this._grillMeState) return;

    const currentIdx = this._grillMeState.currentIdx;
    const questions = this._grillMeState.questions;
    const total = questions.length;

    let html = '<div class="grill-me-step-dots">';
    for (let i = 0; i < total; i++) {
      const q = questions[i];
      const isActive = i === currentIdx;
      const isAnswered = !!this._grillMeState.answers[q.id];
      let cls = "grill-me-dot";
      if (isAnswered) cls += " answered";
      if (isActive) cls += " active";
      html += `<div class="${cls}" title="${this._escapeHtml(q.title)}">
        <span class="grill-me-dot-icon">${q.icon}</span>
        <span class="grill-me-dot-label">${this._escapeHtml(q.title.split(" ").slice(0, 3).join(" "))}</span>
      </div>`;
    }
    html += "</div>";

    indicator.innerHTML = html;
  }

  /**
   * Updates the footer buttons based on current question index.
   */
  _updateGrillMeFooter(idx) {
    const btnPrev = this.els.grillMeBtnPrev;
    const btnNext = this.els.grillMeBtnNext;
    const progress = this.els.grillMeProgress;
    if (!btnPrev || !btnNext) return;

    const total = this._grillMeState ? this._grillMeState.questions.length : 7;

    // Previous button visibility
    if (idx === 0) {
      btnPrev.classList.add("hidden");
    } else {
      btnPrev.classList.remove("hidden");
    }

    // Next / Submit button text
    if (idx >= total - 1) {
      btnNext.textContent = "🔥 Generate Specs";
      btnNext.title = "Submit all answers and generate enriched specifications";
    } else {
      btnNext.textContent = "Next →";
      btnNext.title = "Save answer and go to next question";
    }

    if (progress) {
      progress.textContent = `Question ${idx + 1} / ${total}`;
    }
  }

  /**
   * Collects the answer from the current question textarea.
   */
  _collectGrillMeAnswer() {
    const body = this.els.grillMeBody;
    if (!body) return null;
    const textarea = body.querySelector(".grill-me-textarea");
    if (!textarea) return null;
    return textarea.value.trim();
  }

  /**
   * Validates the current answer against the question's rules.
   * @param {object} question - The question object
   * @param {string} answer - The answer text
   * @returns {{ valid: boolean, message: string }}
   */
  _validateGrillMeAnswer(question, answer) {
    if (!question.validation) return { valid: true, message: "" };
    if (question.validation.required && (!answer || answer.length === 0)) {
      return { valid: false, message: "This question requires an answer." };
    }
    if (question.validation.minLength && answer.length < question.validation.minLength) {
      return { valid: false, message: `Please provide at least ${question.validation.minLength} characters.` };
    }
    return { valid: true, message: "" };
  }

  /**
   * Advances to the next question.
   */
  async _nextGrillMeQuestion() {
    try {
      if (!this._grillMeState) return;

      const currentIdx = this._grillMeState.currentIdx;
      const question = this._grillMeState.questions[currentIdx];
      const answer = this._collectGrillMeAnswer();

      // Validate answer
      const validation = this._validateGrillMeAnswer(question, answer);
      const msgEl = document.getElementById("grill-me-validation-msg");
      if (!validation.valid) {
        if (msgEl) {
          msgEl.textContent = validation.message;
          msgEl.classList.remove("hidden");
        }
        return;
      }
      if (msgEl) {
        msgEl.classList.add("hidden");
      }

      // Save answer locally
      this._grillMeState.answers[question.id] = answer;

      // Submit via IPC
      if (window.lvzero["grill-me:submit-answer"]) {
        await window.lvzero["grill-me:submit-answer"](this._grillMeState.sessionId, question.id, answer);
      }

      // Check if all questions answered
      if (currentIdx >= this._grillMeState.questions.length - 1) {
        // All answered — show completion
        this._grillMeState.completed = true;
        this._renderGrillMeComplete();
        return;
      }

      // Move to next question
      const nextIdx = currentIdx + 1;
      this._grillMeState.currentIdx = nextIdx;
      this._renderGrillMeQuestion(nextIdx);
      this._updateGrillMeProgress();
    } catch (err) {
      console.warn("[IDE] Grill Me next question error:", err.message);
      this._showToast("error", "Error saving answer: " + err.message);
    }
  }

  /**
   * Goes back to the previous question.
   */
  async _prevGrillMeQuestion() {
    try {
      if (!this._grillMeState) return;
      const currentIdx = this._grillMeState.currentIdx;
      if (currentIdx <= 0) return;

      // Save current answer before going back
      const question = this._grillMeState.questions[currentIdx];
      const answer = this._collectGrillMeAnswer();
      if (answer) {
        this._grillMeState.answers[question.id] = answer;
        if (window.lvzero["grill-me:submit-answer"]) {
          await window.lvzero["grill-me:submit-answer"](this._grillMeState.sessionId, question.id, answer);
        }
      }

      const prevIdx = currentIdx - 1;
      this._grillMeState.currentIdx = prevIdx;
      this._renderGrillMeQuestion(prevIdx);
      this._updateGrillMeProgress();
    } catch (err) {
      console.warn("[IDE] Grill Me prev question error:", err.message);
    }
  }

  /**
   * Renders the completion screen after all 7 questions.
   */
  _renderGrillMeComplete() {
    const body = this.els.grillMeBody;
    if (!body || !this._grillMeState) return;

    const answers = this._grillMeState.answers;
    const questions = this._grillMeState.questions;

    let summaryHtml = "";
    for (const q of questions) {
      const answer = answers[q.id] || "<em>Skipped</em>";
      summaryHtml += `<div class="grill-me-summary-item">
        <div class="grill-me-summary-question">${q.icon} ${this._escapeHtml(q.title)}</div>
        <div class="grill-me-summary-answer">${this._escapeHtml(answer)}</div>
      </div>`;
    }

    body.innerHTML = `
      <div class="grill-me-complete-icon">🎉</div>
      <div class="grill-me-question-title">Scope Interview Complete!</div>
      <div class="grill-me-question-desc">All 7 questions answered. Review your answers below, then click "Generate Specs" to create enriched project specifications.</div>
      <div class="grill-me-summary">${summaryHtml}</div>
    `;

    // Update footer for completion state
    const btnPrev = this.els.grillMeBtnPrev;
    const btnNext = this.els.grillMeBtnNext;
    const progress = this.els.grillMeProgress;

    if (btnPrev) btnPrev.classList.add("hidden");
    if (btnNext) {
      btnNext.textContent = "🔥 Generate Specs";
      btnNext.title = "Create enriched project specifications from your answers";
    }
    if (progress) progress.textContent = "✅ Complete";

    // Update step indicator
    this._updateGrillMeProgress();
  }

  /**
   * Submits all answers and triggers scoped spec generation.
   * Calls the grill-me:generate-specs IPC handler, which runs the
   * scope-enhanced init pipeline.
   */
  async _submitGrillMeAnswers() {
    try {
      if (!this._grillMeState) return;

      const projectPath = this._project && this._project.path;
      if (!projectPath) {
        this._showToast("error", "No project open. Please open or create a project first.");
        return;
      }

      const btnNext = this.els.grillMeBtnNext;
      if (btnNext) {
        btnNext.disabled = true;
        btnNext.textContent = "⏳ Generating...";
      }

      // Generate specs via IPC (this runs the scoped init pipeline)
      const result = await window.lvzero["grill-me:generate-specs"](
        this._grillMeState.sessionId,
        projectPath,
        null // identity will be resolved in main process
      );

      if (!result || !result.success) {
        this._showToast("error", "Failed to generate specs: " + (result?.error || "Unknown error"));
        if (btnNext) {
          btnNext.disabled = false;
          btnNext.textContent = "🔥 Generate Specs";
        }
        return;
      }

      this._showToast("success", "🔥 Scope-enriched specifications generated successfully!");
      this._hideGrillMeWizard(false);
    } catch (err) {
      console.warn("[IDE] Grill Me submit error:", err.message);
      this._showToast("error", "Error generating specs: " + err.message);
      const btnNext = this.els.grillMeBtnNext;
      if (btnNext) {
        btnNext.disabled = false;
        btnNext.textContent = "🔥 Generate Specs";
      }
    }
  }

  /**
   * Renders the content for a given wizard step.
   * @param {number} step - 0-based step index (0-4)
   */
  _renderWizardStep(step) {
    const body = this.els.wizardBody;
    if (!body) return;

    const state = this._wizardState;
    if (!state) return;

    const steps = [
      { title: "Project Name & Path", desc: "Choose a name and location for your new project." },
      { title: "Project Type", desc: "What kind of project are you building?" },
      { title: "Stage & Details", desc: "Define the stage, languages, and tags." },
      { title: "Automation (Optional)", desc: "Configure sync integrations." },
      { title: "Create & Init", desc: "Review your choices and create the project." },
    ];

    const stepInfo = steps[step] || steps[0];
    let html = `<div class="project-wizard-step-title">${this._escapeHtml(stepInfo.title)}</div>
<div class="project-wizard-step-desc">${this._escapeHtml(stepInfo.desc)}</div>`;

    switch (step) {
      case 0:
        html += this._renderStepNamePath(state);
        break;
      case 1:
        html += this._renderStepType(state);
        break;
      case 2:
        html += this._renderStepDetails(state);
        break;
      case 3:
        html += this._renderStepAutomation(state);
        break;
      case 4:
        html += this._renderStepSummary(state);
        break;
    }

    body.innerHTML = html;
    this._attachWizardEvents(step);
  }

  /**
   * Renders Step 1: Project Name & Path.
   */
  _renderStepNamePath(state) {
    return `
<div class="project-wizard-field">
  <label class="project-wizard-label">Project Name</label>
  <input id="wiz-input-name" class="project-wizard-input" type="text" value="${this._escapeHtml(state.projectName)}" placeholder="e.g. my-awesome-app" spellcheck="false" />
</div>
<div class="project-wizard-field">
  <label class="project-wizard-label">Project Path</label>
  <div class="project-wizard-path-row">
    <input id="wiz-input-path" class="project-wizard-input" type="text" value="${this._escapeHtml(state.projectPath)}" placeholder="e.g. C:/Users/MyProjects" spellcheck="false" />
    <button id="wiz-btn-browse" class="project-wizard-btn-browse" title="Browse...">📂 Browse</button>
  </div>
</div>`;
  }

  /**
   * Renders Step 2: Project Type.
   */
  _renderStepType(state) {
    const types = [
      { id: "web", icon: "🌐", name: "Web" },
      { id: "mobile", icon: "📱", name: "Mobile" },
      { id: "backend", icon: "⚙️", name: "Backend" },
      { id: "desktop", icon: "🖥️", name: "Desktop" },
      { id: "api", icon: "🔌", name: "API" },
      { id: "other", icon: "📦", name: "Other" },
    ];

    const frameworks = {
      web: ["React", "Next.js", "Vue", "Svelte", "Vanilla HTML"],
      mobile: ["React Native", "Expo", "Flutter"],
      backend: ["Node.js", "Python", "NestJS", "Express"],
      desktop: ["Electron", "Tauri", "Wails"],
      api: ["Node.js", "Python FastAPI", "Express", "NestJS"],
      other: [],
    };

    const typeCards = types.map(t => `
<div class="project-wizard-type-card${state.projectType === t.id ? " selected" : ""}" data-type="${t.id}">
  <span class="type-icon">${t.icon}</span>
  <span class="type-name">${t.name}</span>
</div>`).join("");

    const currentFrameworks = frameworks[state.projectType] || [];
    const frameworkChips = currentFrameworks.map(f => `
<span class="project-wizard-chip${state.framework === f ? " selected" : ""}" data-framework="${this._escapeHtml(f)}">${this._escapeHtml(f)}</span>`).join("");

    return `
<div class="project-wizard-field">
  <label class="project-wizard-label">Project Type</label>
  <div class="project-wizard-type-grid">${typeCards}</div>
</div>
${currentFrameworks.length ? `
<div class="project-wizard-frameworks">
  <div class="project-wizard-frameworks-label">Suggested Frameworks</div>
  <div class="project-wizard-framework-chips">${frameworkChips}</div>
</div>` : ""}`;
  }

  /**
   * Renders Step 3: Stage & Details.
   */
  _renderStepDetails(state) {
    const stages = [
      { id: "prototype", name: "Prototype", desc: "Quick proof of concept" },
      { id: "mvp", name: "MVP", desc: "Minimum viable product" },
      { id: "production", name: "Production", desc: "Ready for users" },
      { id: "maintenance", name: "Maintenance", desc: "Ongoing updates" },
    ];

    const stageCards = stages.map(s => `
<div class="project-wizard-stage-card${state.stage === s.id ? " selected" : ""}" data-stage="${s.id}">
  <span class="stage-name">${s.name}</span>
  <span class="stage-desc">${s.desc}</span>
</div>`).join("");

    const langs = ["JavaScript", "TypeScript", "Python", "Java", "C#", "Go", "Rust", "C++", "Ruby", "PHP", "Swift", "Kotlin", "Dart"];
    const langItems = langs.map(l => {
      const selected = state.languages.includes(l);
      return `<div class="project-wizard-lang-item${selected ? " selected" : ""}" data-lang="${this._escapeHtml(l)}">
  <span class="lang-check">${selected ? "✓" : ""}</span>
  <span>${this._escapeHtml(l)}</span>
</div>`;
    }).join("");

    return `
<div class="project-wizard-field">
  <label class="project-wizard-label">Project Stage</label>
  <div class="project-wizard-stage-grid">${stageCards}</div>
</div>
<div class="project-wizard-field">
  <label class="project-wizard-label">Languages</label>
  <div class="project-wizard-lang-grid">${langItems}</div>
</div>
<div class="project-wizard-field">
  <label class="project-wizard-label">Custom Tags (optional, comma-separated)</label>
  <input id="wiz-input-tags" class="project-wizard-input" type="text" value="${this._escapeHtml(state.customTags ? state.customTags.join(", ") : "")}" placeholder="e.g. team-alpha, experimental" spellcheck="false" />
</div>`;
  }

  /**
   * Renders Step 4: Automation.
   */
  _renderStepAutomation(state) {
    return `
<div class="project-wizard-field">
  <label class="project-wizard-toggle">
    <input type="checkbox" id="wiz-chk-trello" ${state.trelloSync ? "checked" : ""} />
    <span class="toggle-slider"></span>
    <span class="toggle-label">Trello Sync <span class="toggle-hint">Can be configured later</span></span>
  </label>
</div>
<div style="padding: 8px 10px; font-size: var(--font-size-xs); color: var(--text-tertiary);">
  Automation settings can be modified at any time from the project configuration.
</div>`;
  }

  /**
   * Renders Step 5: Summary & Create.
   */
  _renderStepSummary(state) {
    const typeLabels = { web: "Web", mobile: "Mobile", backend: "Backend", desktop: "Desktop", api: "API", other: "Other" };
    const stageLabels = { prototype: "Prototype", mvp: "MVP", production: "Production", maintenance: "Maintenance" };

    return `
<div class="project-wizard-summary">
  <div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Name</span>
    <span class="project-wizard-summary-value">${this._escapeHtml(state.projectName || "(not set)")}</span>
  </div>
  <div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Type</span>
    <span class="project-wizard-summary-value">${typeLabels[state.projectType] || state.projectType}</span>
  </div>
  ${state.framework ? `<div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Framework</span>
    <span class="project-wizard-summary-value">${this._escapeHtml(state.framework)}</span>
  </div>` : ""}
  <div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Stage</span>
    <span class="project-wizard-summary-value">${stageLabels[state.stage] || state.stage}</span>
  </div>
  ${state.languages.length ? `<div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Languages</span>
    <span class="project-wizard-summary-value">${this._escapeHtml(state.languages.join(", "))}</span>
  </div>` : ""}
  ${state.customTags.length ? `<div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Tags</span>
    <span class="project-wizard-summary-value">${this._escapeHtml(state.customTags.join(", "))}</span>
  </div>` : ""}
  <div class="project-wizard-summary-row">
    <span class="project-wizard-summary-label">Trello Sync</span>
    <span class="project-wizard-summary-value">${state.trelloSync ? "✅ Enabled" : "❌ Disabled"}</span>
  </div>
</div>
<button id="wiz-btn-create" class="project-wizard-btn project-wizard-btn-create">🚀 Create Project</button>
<div id="wizard-create-progress" class="project-wizard-create-progress"></div>
<div id="wizard-result" class="project-wizard-result" style="display:none;"></div>`;
  }

  /**
   * Updates the step indicator dots at the top.
   */
  _updateWizardProgress() {
    const indicator = this.els.wizardStepIndicator;
    const progress = this.els.wizardProgress;
    if (!indicator) return;

    const step = this._wizardState ? this._wizardState.step : 0;
    const total = 5;

    const dots = Array.from({ length: total }, (_, i) => {
      let cls = "project-wizard-dot";
      if (i === step) cls += " active";
      else if (i < step) cls += " completed";
      return `<span class="${cls}"></span>`;
    }).join("");

    indicator.innerHTML = dots;

    if (progress) {
      progress.textContent = `Step ${step + 1} of ${total}`;
    }
  }

  /**
   * Attaches event listeners to dynamic elements in the current step.
   */
  _attachWizardEvents(step) {
    const state = this._wizardState;
    if (!state) return;

    switch (step) {
      case 0: {
        const nameInput = document.getElementById("wiz-input-name");
        const pathInput = document.getElementById("wiz-input-path");
        const browseBtn = document.getElementById("wiz-btn-browse");

        if (nameInput) {
          nameInput.addEventListener("input", (e) => { state.projectName = e.target.value; });
        }
        if (pathInput) {
          pathInput.addEventListener("input", (e) => { state.projectPath = e.target.value; });
        }
        if (browseBtn) {
          browseBtn.addEventListener("click", async () => {
            try {
              const result = await window.lvzero["dialog:openDirectory"]();
              if (result && !result.cancelled && result.path) {
                state.projectPath = result.path;
                if (pathInput) pathInput.value = result.path;
              }
            } catch (err) {
              console.warn("[IDE] Browse directory error:", err.message);
            }
          });
        }
        break;
      }
      case 1: {
        // Type cards
        document.querySelectorAll(".project-wizard-type-card").forEach(card => {
          card.addEventListener("click", () => {
            const type = card.dataset.type;
            state.projectType = type;
            state.framework = ""; // reset framework on type change
            // Re-render with new type selected
            this._renderWizardStep(1);
          });
        });

        // Framework chips
        document.querySelectorAll(".project-wizard-chip").forEach(chip => {
          chip.addEventListener("click", () => {
            const framework = chip.dataset.framework;
            state.framework = state.framework === framework ? "" : framework;
            // Re-render to update selection visual
            this._renderWizardStep(1);
          });
        });
        break;
      }
      case 2: {
        // Stage cards
        document.querySelectorAll(".project-wizard-stage-card").forEach(card => {
          card.addEventListener("click", () => {
            state.stage = card.dataset.stage;
            this._renderWizardStep(2);
          });
        });

        // Language items
        document.querySelectorAll(".project-wizard-lang-item").forEach(item => {
          item.addEventListener("click", () => {
            const lang = item.dataset.lang;
            const idx = state.languages.indexOf(lang);
            if (idx >= 0) {
              state.languages.splice(idx, 1);
            } else {
              state.languages.push(lang);
            }
            this._renderWizardStep(2);
          });
        });

        // Tags input
        const tagsInput = document.getElementById("wiz-input-tags");
        if (tagsInput) {
          tagsInput.addEventListener("input", (e) => {
            state.customTags = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
          });
        }
        break;
      }
      case 3: {
        const trelloChk = document.getElementById("wiz-chk-trello");
        if (trelloChk) {
          trelloChk.addEventListener("change", (e) => {
            state.trelloSync = e.target.checked;
          });
        }
        break;
      }
      case 4: {
        const createBtn = document.getElementById("wiz-btn-create");
        if (createBtn) {
          createBtn.addEventListener("click", () => this._finishWizard());
        }
        break;
      }
    }
  }

  /**
   * Advances to the next wizard step.
   */
  _nextWizardStep() {
    const state = this._wizardState;
    if (!state || !state.visible) return;

    // Validate current step before advancing
    if (state.step === 0) {
      // Re-read values from inputs
      const nameInput = document.getElementById("wiz-input-name");
      const pathInput = document.getElementById("wiz-input-path");
      if (nameInput) state.projectName = nameInput.value.trim();
      if (pathInput) state.projectPath = pathInput.value.trim();

      if (!state.projectName) {
        this._showWizardError("Please enter a project name.");
        return;
      }
      if (!state.projectPath) {
        this._showWizardError("Please specify a project path.");
        return;
      }
    }

    if (state.step < 4) {
      state.step++;
      this._renderWizardStep(state.step);
      this._updateWizardProgress();
      this._updateWizardFooter();

      // Focus name input on step 0
      if (state.step === 0) {
        setTimeout(() => document.getElementById("wiz-input-name")?.focus(), 50);
      }
    }
  }

  /**
   * Goes back one wizard step.
   */
  _prevWizardStep() {
    const state = this._wizardState;
    if (!state || !state.visible) return;

    if (state.step > 0) {
      state.step--;
      this._renderWizardStep(state.step);
      this._updateWizardProgress();
      this._updateWizardFooter();
    }
  }

  /**
   * Updates the prev/next button visibility.
   */
  _updateWizardFooter() {
    const state = this._wizardState;
    if (!state) return;

    const prevBtn = this.els.wizardBtnPrev;
    const nextBtn = this.els.wizardBtnNext;

    if (prevBtn) {
      prevBtn.classList.toggle("hidden", state.step === 0);
    }

    if (nextBtn) {
      if (state.step === 4) {
        nextBtn.textContent = "Create";
      } else {
        nextBtn.textContent = "Next →";
      }
      // Hide the next button on the summary step; the Create button is there
      nextBtn.classList.toggle("hidden", state.step === 4);
    }
  }

  /**
   * Shows an inline error message in the step body.
   */
  _showWizardError(msg) {
    // Remove existing error
    const existing = document.querySelector(".project-wizard-error");
    if (existing) existing.remove();

    const body = this.els.wizardBody;
    if (!body) return;

    const errEl = document.createElement("div");
    errEl.className = "project-wizard-error visible";
    errEl.textContent = msg;
    body.appendChild(errEl);
  }

  /**
   * Called when the user clicks "Create Project" on the summary step.
   * Runs the creation with progress updates, then shows results.
   */
  async _finishWizard() {
    const state = this._wizardState;
    if (!state || !state.visible) return;

    const createBtn = document.getElementById("wiz-btn-create");
    const progressEl = document.getElementById("wizard-create-progress");
    const resultEl = document.getElementById("wizard-result");

    if (createBtn) createBtn.disabled = true;

    // Show progress steps
    if (progressEl) {
      progressEl.innerHTML = `
<div class="project-wizard-create-step active" data-step="dir">
  <span class="step-icon">⏳</span> Creating directory...
</div>
<div class="project-wizard-create-step pending" data-step="identity">
  <span class="step-icon">⏳</span> Configuring project identity...
</div>
<div class="project-wizard-create-step pending" data-step="pipeline">
  <span class="step-icon">⏳</span> Running init pipeline...
</div>`;
    }

    const updateStep = (stepId, status, icon) => {
      if (!progressEl) return;
      const step = progressEl.querySelector(`[data-step="${stepId}"]`);
      if (!step) return;
      step.className = `project-wizard-create-step ${status}`;
      const iconEl = step.querySelector(".step-icon");
      if (iconEl) iconEl.textContent = icon;
    };

    try {
      // Step 1: Create directory via IPC
      updateStep("dir", "active", "⏳");
      const result = await window.lvzero["project:new"]({ path: state.projectPath, name: state.projectName });

      if (!result || !result.success) {
        updateStep("dir", "error", "❌");
        this._showWizardError(result?.error || "Directory creation failed");
        if (createBtn) createBtn.disabled = false;
        return;
      }
      updateStep("dir", "done", "✅");

      // Step 2: Create identity
      updateStep("identity", "active", "⏳");
      const identityConfig = {
        type: state.projectType,
        stage: state.stage,
        languages: state.languages,
        frameworks: state.framework ? [state.framework] : [],
        platform: state.projectType === "desktop" ? "electron" : state.projectType,
        automation: {
          trello: { enabled: state.trelloSync, apiKey: "", token: "", listId: "" },
          symphony: { enabled: true }
        },
        permissions: {
          read_file: ["**/*"],
          write_file: ["**/*"],
          command: []
        },
        custom_tags: state.customTags || [],
      };

      try {
        const identityResult = await window.lvzero["project:identity-create"](result.path, identityConfig);
        if (identityResult && identityResult.success) {
          updateStep("identity", "done", "✅");
        } else {
          updateStep("identity", "error", "⚠️");
          console.warn("[IDE] Identity creation:", identityResult?.error);
        }
      } catch (identityErr) {
        updateStep("identity", "error", "⚠️");
        console.warn("[IDE] Identity error:", identityErr.message);
      }

      // Step 3: Run init pipeline
      updateStep("pipeline", "active", "⏳");
      try {
        const pipelineResult = await window.lvzero["init-pipeline:run"](result.path);
        if (pipelineResult && pipelineResult.success) {
          const okCount = pipelineResult.steps ? pipelineResult.steps.filter(s => s.ok).length : 0;
          const totalCount = pipelineResult.steps ? pipelineResult.steps.length : 0;
          updateStep("pipeline", "done", `✅ (${okCount}/${totalCount})`);
        } else {
          updateStep("pipeline", "error", "⚠️");
        }
      } catch (pipelineErr) {
        updateStep("pipeline", "error", "⚠️");
        console.warn("[IDE] Pipeline error:", pipelineErr.message);
      }

      // Show success result
      if (resultEl) {
        resultEl.style.display = "block";
        resultEl.innerHTML = `
<div class="project-wizard-result-icon">🚀</div>
<div class="project-wizard-result-title">Project Created!</div>
<div class="project-wizard-result-desc">${this._escapeHtml(state.projectName)} has been created successfully.</div>
<button id="wiz-btn-finish" class="project-wizard-btn project-wizard-btn-finish">Finish</button>`;

        // Attach finish button
        setTimeout(() => {
          const finishBtn = document.getElementById("wiz-btn-finish");
          if (finishBtn) {
            finishBtn.addEventListener("click", () => {
              state.finished = true;
              this._hideNewProjectWizard(false);
            });
          }
        }, 50);
      } else {
        // No result element, just close
        state.finished = true;
        this._hideNewProjectWizard(false);
      }

      // Hide create button
      if (createBtn) createBtn.style.display = "none";

      // Refresh recent projects
      this._loadRecentProjects();
      this.addLogEntry("info", `📁 Project created via wizard: ${state.projectName}`);

    } catch (err) {
      console.warn("[IDE] Wizard finish error:", err.message);
      this._showWizardError(`Creation failed: ${err.message}`);
      if (createBtn) createBtn.disabled = false;
    }
  }

  /**
   * Opens an existing project — optionally with a specific path.
   * If no path provided, the main process shows the native folder dialog.
   */
  async _openProject(projectPath) {
    try {
      const result = await window.lvzero["project:open"]({ path: projectPath || null });

      if (!result || !result.success) {
        if (result?.cancelled) return;
        const errMsg = result?.error || "IPC returned null/undefined — check main process logs";
        console.warn("[IDE] Could not open project:", errMsg, { result });
        this.addLogEntry("error", `❌ Could not open project: ${errMsg}`);
        this._showToast("error", `❌ Could not open project: ${errMsg}`, 4000);
      }
    } catch (err) {
      console.warn("[IDE] Open project error:", err.message);
      this.addLogEntry("error", `❌ Open project error: ${err.message}`);
      this._showToast("error", `❌ Open project error: ${err.message}`, 4000);
    }
  }

  /**
   * Closes the current project.
   */
  async _closeProject() {
    try {
      const result = await window.lvzero["project:close"]();
      if (!result || !result.success) {
        this.addLogEntry("error", `❌ Could not close project: ${result?.error || "unknown"}`);
      }
    } catch (err) {
      console.warn("[IDE] Close project error:", err.message);
      this.addLogEntry("error", `❌ Close project error: ${err.message}`);
    }
  }

  /**
   * Duplicates the current project — main process shows prompt for new name.
   */
  async _duplicateProject() {
    try {
      const result = await window.lvzero["project:duplicate"]();
      if (!result || !result.success) {
        if (result?.cancelled) return;
        this.addLogEntry("error", `❌ Could not duplicate project: ${result?.error || "unknown"}`);
      } else {
        this.addLogEntry("info", `📁 Project duplicated`);
      }
    } catch (err) {
      console.warn("[IDE] Duplicate project error:", err.message);
      this.addLogEntry("error", `❌ Duplicate project error: ${err.message}`);
    }
  }

  /**
   * Exports the current project as a ZIP archive via Save As dialog.
   */
  async _exportProject() {
    try {
      const result = await window.lvzero["project:export"]();
      if (!result || !result.success) {
        if (result?.cancelled) return;
        this.addLogEntry("error", `❌ Could not export project: ${result?.error || "unknown"}`);
      } else {
        this.addLogEntry("info", `📦 Project exported`);
      }
    } catch (err) {
      console.warn("[IDE] Export project error:", err.message);
      this.addLogEntry("error", `❌ Export project error: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKSPACE STATE (per-project persistence, inspired by VS Code)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load workspace state from main process and restore it.
   * Called when a project is opened/restored.
   */
  async _loadAndRestoreWorkspaceState(projectPath) {
    try {
      // Try enhanced 4-phase restore via session:restore-full
      const sessionResult = await window.lvzero["session:restore-full"]({ projectPath });
      if (sessionResult && sessionResult.success && sessionResult.fullState) {
        const full = sessionResult.fullState;
        // Restore workspace UI (Phase 2)
        if (full.workspace) {
          this._restoreWorkspaceState({
            openTabs: full.workspace.openTabs,
            activeTab: full.workspace.activeTab,
            panelLayout: full.workspace.panelLayout,
          });
        }
        return;
      }
    } catch (_) {
      // Fallback to legacy workspace restore
    }

    // Legacy fallback
    try {
      const result = await window.lvzero["workspace:getState"]({ path: projectPath });
      if (result && result.success && result.state) {
        this._restoreWorkspaceState(result.state);
      }
    } catch (err) {
      console.warn("[IDE] Could not load workspace state:", err.message);
    }
  }

  /**
   * Restore workspace state: open tabs, active file, panel layout.
   * @param {Object} state - The workspace state from main process.
   */
  _restoreWorkspaceState(state) {
    if (!state || !state.openTabs) return;

    console.log(`[IDE] Restoring workspace state: ${state.openTabs.length} tabs`);

    // Restore open tabs (async, handle each file)
    if (Array.isArray(state.openTabs)) {
      state.openTabs.forEach((tab) => {
        if (tab && tab.path) {
          this.openFile(tab.path).catch((err) => {
            console.warn(`[IDE] Could not restore tab ${tab.path}:`, err.message);
          });
        }
      });
    }

    // Restore active tab (switch to it after a short delay to let tabs load)
    if (state.activeTab) {
      setTimeout(() => {
        if (this.openTabs[state.activeTab]) {
          this._switchTab(state.activeTab);
        }
      }, 500);
    }

    // Restore last active file (for reference)
    if (state.lastActiveFile) {
      this._lastActiveFile = state.lastActiveFile;
    }
  }

  /**
   * Save the current workspace state to the main process.
   * Called when tabs change, project is closed, or periodically.
   */
  async _saveWorkspaceState() {
    if (!this._project || !this._project.isOpen || !this._project.path) return;

    try {
      const openTabs = Object.keys(this.openTabs).map((filePath) => ({
        path: filePath,
        active: filePath === this.activeTabPath,
      }));

      const state = {
        version: 1,
        projectPath: this._project.path,
        lastOpened: new Date().toISOString(),
        openTabs,
        activeTab: this.activeTabPath,
        lastActiveFile: this.activeTabPath || this._lastActiveFile,
        lastActiveMode: this._mode?.slug || null,
      };

      // Save via session:save-workspace (SQLite-backed)
      try {
        await window.lvzero["session:save-workspace"]({
          projectPath: this._project.path,
          workspace: { openTabs, activeTab: this.activeTabPath },
        });
      } catch (_) {
        // Fallback to legacy workspace save
        await window.lvzero["workspace:saveState"]({ state, path: this._project.path });
      }
    } catch (err) {
      // Silently fail — workspace state saving is non-critical
      console.warn("[IDE] Could not save workspace state:", err.message);
    }
  }

  /**
   * Debounced version of _saveWorkspaceState to avoid excessive IPC calls
   * when rapidly switching/closing tabs.
   */
  _debouncedSaveWorkspaceState() {
    if (this._workspaceSaveTimer) {
      clearTimeout(this._workspaceSaveTimer);
    }
    this._workspaceSaveTimer = setTimeout(() => {
      this._saveWorkspaceState();
      this._workspaceSaveTimer = null;
    }, 2000); // 2 second debounce
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION CONTROL (Fase 3)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetches git status from the main process and renders the VC panel.
   */
  async _loadGitStatus() {
    const branchEl = this.els.vcBranchName;
    const listEl = this.els.vcFileList;
    if (!listEl) return;

    // Show loading state
    listEl.innerHTML = `<div class="vc-loading">⏳ Scanning...</div>`;

    try {
      const result = await window.lvzero["git:status"]();
      if (!result || !result.success) {
        if (result && result.isRepo === false) {
          listEl.innerHTML = `<div class="vc-empty">Not a Git repository</div>`;
          if (branchEl) branchEl.textContent = "—";
        } else {
          listEl.innerHTML = `<div class="vc-empty">${result?.error || "Could not get status"}</div>`;
        }
        return;
      }

      // Update branch name
      if (branchEl) {
        branchEl.textContent = result.branch || "unknown";
      }

      // Render file list
      if (!result.files || result.files.length === 0) {
        listEl.innerHTML = `<div class="vc-empty">✓ No changes</div>`;
        return;
      }

      this._renderVCItems(result.files);
    } catch (err) {
      listEl.innerHTML = `<div class="vc-empty">Error: ${this._escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Renders the list of changed files in the VC panel.
   */
  _renderVCItems(files) {
    const listEl = this.els.vcFileList;
    if (!listEl) return;

    listEl.innerHTML = "";

    for (const file of files) {
      const item = document.createElement("div");
      item.className = "vc-file-item";

      // Status badge
      const badge = document.createElement("span");
      badge.className = "vc-file-status";

      // Determine status color
      const st = file.status || "modified";
      let symbol = "M";
      switch (st) {
        case "added":    symbol = "A"; badge.style.color = "#3fb950"; break; // green
        case "modified": symbol = "M"; badge.style.color = "#d29922"; break; // yellow
        case "deleted":  symbol = "D"; badge.style.color = "#f85149"; break; // red
        case "renamed":  symbol = "R"; badge.style.color = "#bc8cff"; break; // purple
        case "copied":   symbol = "C"; badge.style.color = "#58a6ff"; break; // blue
        default:         symbol = "?"; badge.style.color = "#8b949e"; break; // gray
      }
      badge.textContent = symbol;

      // File path
      const pathSpan = document.createElement("span");
      pathSpan.className = "vc-file-path";
      pathSpan.textContent = file.filePath || "unknown";

      item.appendChild(badge);
      item.appendChild(pathSpan);

      // Click to open file in editor
      item.addEventListener("click", () => {
        this.openFile(file.filePath).catch((err) => {
          console.warn("[VC] Could not open file:", err);
        });
      });

      listEl.appendChild(item);
    }
  }

  /**
   * Strips the [THOUGHT]... prefix from a response string.
   * The thought block is everything from [THOUGHT] until the first \n\n or end of string.
   * Returns the clean response text.
   */
  _stripThought(text) {
    if (!text || typeof text !== "string") return text || "";
    return text.replace(/^\[THOUGHT\][^]*?(?:\n\n|$)/, "").trim();
  }

  // Syntax Highlighting (highlight.js)
  async _initHighlightJs() {
    try {
      const mod = await import("../node_modules/highlight.js/es/index.js");
      this._hljs = mod.default || mod.HighlightJS || mod;
      this._hljsReady = true;
      console.log("[IDE] highlight.js loaded");
    } catch (err) {
      console.warn("[IDE] highlight.js failed to load:", err.message);
      this._hljsReady = false;
    }
  }

  _applyHighlighting(container) {
    if (!this._hljsReady || !this._hljs) return;
    try {
      container.querySelectorAll("pre code").forEach((el) => {
        if (el.classList.contains("hljs")) return;
        const parentContainer = el.closest(".code-block-container");
        let lang = "";
        if (parentContainer) {
          const langLabel = parentContainer.querySelector(".code-lang");
          if (langLabel) lang = langLabel.textContent.trim().toLowerCase();
        }
        if (lang) el.classList.add("language-" + lang);
        this._hljs.highlightElement(el);
      });
    } catch (err) {
      console.warn("[IDE] highlight error:", err.message);
    }
  }

  /**
   * Renders markdown text as HTML with code block detection and copy buttons.
   * Detects fenced code blocks (```lang ... ```) and wraps them in a styled
   * container with a language label and copy-to-clipboard button.
   *
   * @param {string} text - Raw markdown text
   * @returns {string} - HTML string with code blocks rendered as interactive elements
   */
  /**
   * Detects and fixes garbled UTF-8 text where UTF-8 bytes were incorrectly
   * decoded as Latin-1/Windows-1252 (e.g., "ðŸ‘¤" instead of "🤔").
   * This is a defensive fix for encoding issues in the stream pipeline.
   */
  _fixEncoding(str) {
    if (!str || typeof str !== "string") return str;

    // Heuristic: check if a significant portion of the string contains
    // characters in the UTF-8 continuation byte range (0x80-0xBF) when
    // those bytes are misinterpreted as Latin-1 characters.
    // These characters would not normally appear in LLM output text.
    let suspectBytes = 0;
    const len = Math.min(str.length, 1000); // sample first 1000 chars
    for (let i = 0; i < len; i++) {
      const code = str.charCodeAt(i);
      // 0x80-0xBF are UTF-8 continuation bytes; as Latin-1 they become
      // control chars or extended Latin chars unlikely in normal text.
      if (code >= 0x80 && code <= 0xBF) {
        suspectBytes++;
      }
    }

    // If >15% of sampled characters look like mis-decoded UTF-8 continuation bytes,
    // attempt to re-interpret the string as UTF-8
    if (suspectBytes > 5 && suspectBytes / len > 0.15) {
      try {
        // Convert each character back to its byte value (Latin-1 mapping)
        // and re-decode as UTF-8
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
          bytes[i] = str.charCodeAt(i) & 0xFF;
        }
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const fixed = decoder.decode(bytes);
        // Verify the fix produced valid, non-empty text
        if (fixed && fixed.length > 0) {
          return fixed;
        }
      } catch {
        // If strict decoding fails, try non-fatal mode
        try {
          const decoder = new TextDecoder("utf-8", { fatal: false });
          const fixed = decoder.decode(bytes);
          if (fixed && !fixed.includes("\uFFFD") && fixed.length > 0) {
            return fixed;
          }
        } catch {
          // Fall through to return original
        }
      }
    }

    return str;
  }

  _renderMarkdown(text) {
    if (!text) return "";

    // Normalize line endings to prevent regex issues with Windows-style \r\n
    text = text.replace(/\r\n/g, "\n");

    // Fix garbled UTF-8 encoding (emoji corruption: ðŸ‘¤ → 🤔)
    text = this._fixEncoding(text);

    const esc = (str) => {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\x22/g, "&#34;")
        .replace(/'/g, "&#39;");
    };

    // Split by fenced code blocks: ```lang\n...\n```
    const parts = [];
    let lastIndex = 0;
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Add text before this code block
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: esc(text.slice(lastIndex, match.index)),
        });
      }

      parts.push({
        type: "code",
        language: match[1] || "",
        content: esc(match[2]),
      });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last code block
    if (lastIndex < text.length) {
      parts.push({
        type: "text",
        content: esc(text.slice(lastIndex)),
      });
    }

    // If no code blocks found, return escaped text
    if (parts.length === 0) {
      return esc(text);
    }

    // If only one text part, return early
    if (parts.length === 1 && parts[0].type === "text") {
      return parts[0].content;
    }

    // Build HTML
    const blockId = `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let blockCount = 0;

    return parts
      .map((part) => {
        if (part.type === "text") {
          // Convert double newlines to paragraph breaks for readability
          return part.content
            .split(/\n\n+/)
            .map((p) => p.trim())
            .filter((p) => p)
            .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
            .join("\n");
        } else {
          const id = `${blockId}-${blockCount++}`;
          const langLabel = part.language
            ? `<span class="code-lang">${esc(part.language)}</span>`
            : `<span class="code-lang">code</span>`;
          return [
            `<div class="code-block-container">`,
            `  <div class="code-block-header">`,
            `    ${langLabel}`,
            `  </div>`,
            `  <pre><code id="${id}">${part.content}</code></pre>`,
            `  <div class="code-block-footer">`,
            `    <button class="copy-btn" data-copy-id="${id}" title="Copy to clipboard">📋 Copy</button>`,
            `  </div>`,
            `</div>`,
          ].join("\n");
        }
      })
      .join("\n");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AI CHAT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sends a message to the orchestrator agent.
   */
  async sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // If agent is running, queue the message (Feature 3)
    if (this._isProcessing) {
      this._messageQueue.push(trimmed);
      this._updateQueueBadge();
      this.addLogEntry("info", `📨 Mensaje en cola (${this._messageQueue.length}): "${trimmed.slice(0, 50)}..."`);
      this.els.chatInput.value = "";
      return;
    }

    this._isProcessing = true;
    this.busy = true;
    this.els.sendBtn.disabled = true;
    this.els.sendBtn.textContent = "⏳";
    // Show stop button while agent is running
    this.els.stopBtn?.classList.remove("hidden");
    this.els.sendBtn?.classList.add("hidden");
    // Reset pending reasoning state for new turn
    this._pendingReasoningEl = null;
    this._pendingReasoningText = "";

    // ── @ Mentions: build file context ──
    const mentionContext = await this._getMentionContext();

    // Clear input
    this.els.chatInput.value = "";
    this._autoResizeInput();
    this.addMessage("user", trimmed);
    this._updateBadge("busy", "⏳ Processing...");

    // Add assistant placeholder
    const assistantMsg = this.addMessage("assistant", "⏳ Thinking...");
    const assistantBody = assistantMsg.querySelector(".message-body");

    try {
      // Append file context from @ mentions to the message
      const enrichedText = mentionContext
        ? `${trimmed}\n\n${mentionContext}`
        : trimmed;
      const response = await window.lvzero["agent:send"](enrichedText);

      if (typeof response === "string") {
        // ── Raw string response from agentLoop() ──────────────────────────
        // The "response" event (IPC push via connectOrchestratorEvents) may
        // have already updated the message body. Only update if it's still
        // showing the "⏳ Thinking..." placeholder to avoid double-write.
        if (assistantBody.textContent === "⏳ Thinking...") {
          const cleanContent = this._stripThought(response);
          if (this._pendingThought) {
            const detailsEl = document.createElement("details");
            detailsEl.className = "thought-details";
            detailsEl.style.marginBottom = "8px";
            const summaryEl = document.createElement("summary");
            summaryEl.textContent = "💭 Thinking";
            const thoughtBody = document.createElement("div");
            thoughtBody.className = "thought-body";
            thoughtBody.textContent = this._pendingThought;
            detailsEl.appendChild(summaryEl);
            detailsEl.appendChild(thoughtBody);
            // Insert into .message-content (parent of .message-body)
            assistantBody.parentNode.insertBefore(detailsEl, assistantBody);
            this._pendingThought = null;
          }
          this._setMessageBody(assistantBody, cleanContent);
        }
        // If event handler already updated it, don't double-write
      } else if (response && response.message) {
        // ── Structured object response ────────────────────────────────────
        const cleanContent = this._stripThought(response.message);
        if (this._pendingThought) {
          const detailsEl = document.createElement("details");
          detailsEl.className = "thought-details";
          detailsEl.style.marginBottom = "8px";
          const summaryEl = document.createElement("summary");
          summaryEl.textContent = "💭 Thinking";
          const thoughtBody = document.createElement("div");
          thoughtBody.className = "thought-body";
          thoughtBody.textContent = this._pendingThought;
          detailsEl.appendChild(summaryEl);
          detailsEl.appendChild(thoughtBody);
          // Insert into .message-content (parent of .message-body)
          assistantBody.parentNode.insertBefore(detailsEl, assistantBody);
          this._pendingThought = null;
        }
        this._setMessageBody(assistantBody, cleanContent);
      } else if (response && response.error) {
        this._setMessageBody(assistantBody, `Error: ${response.error}`);
        assistantMsg.className = "message error";
      } else {
        this._setMessageBody(assistantBody, response ? JSON.stringify(response, null, 2) : "(empty response)");
      }
    } catch (err) {
      this._setMessageBody(assistantBody, `Error: ${err.message}`);
      assistantMsg.className = "message error";
    } finally {
      this._isProcessing = false;
      this.busy = false;
      this.els.sendBtn.disabled = false;
      this.els.sendBtn.textContent = "➤";
      // Reset stop/send button visibility (safety net if response/error events didn't fire)
      this.els.stopBtn?.classList.add("hidden");
      this.els.sendBtn?.classList.remove("hidden");
      this._updateBadge("ready", "✓ Ready");
      this.els.chatInput.focus();

      // Clear @ mention pills after sending
      this._mentionFiles = [];
      const pillsContainer = this.els.chatInput.parentElement?.querySelector(".mention-pills");
      if (pillsContainer) {
        pillsContainer.remove();
      }

      // Flush message queue (Feature 3)
      if (this._messageQueue.length > 0) {
        const nextMsg = this._messageQueue.shift();
        this._updateQueueBadge();
        this.els.chatInput.value = nextMsg;
        setTimeout(() => this.sendMessage(nextMsg), 500);
      }
    }
  }

  /**
   * Sets the inner HTML of a message body element with rendered markdown.
   * This is the single point of update for ALL message body content.
   * Uses _renderMarkdown() to handle code blocks with copy buttons.
   */
  _setMessageBody(element, content) {
    if (!element) return;
    element.innerHTML = this._renderMarkdown(content || "");
    this._applyHighlighting(element);
  }

  /**
   * Adds a message to the chat panel.
   */
  addMessage(type, content, author) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${type}`;

    const avatarMap = {
      system: "⚡",
      user: "👤",
      assistant: "🤖",
      tool: "🔧",
      tool_result: "✅",
      error: "⚠️",
    };

    const authorName = author || (type === "user" ? "You" : type.charAt(0).toUpperCase() + type.slice(1));

    msgDiv.innerHTML = `
      <div class="message-avatar">${avatarMap[type] || "⚡"}</div>
      <div class="message-content">
        <div class="message-header"><strong>${this._escapeHtml(authorName)}</strong></div>
        <div class="message-body"></div>
      </div>
    `;

    // Render content with markdown support (code blocks, copy buttons)
    const body = msgDiv.querySelector(".message-body");
    this._setMessageBody(body, content);

    this.els.chatMessages.appendChild(msgDiv);
    // Smooth scroll to bottom when a new message is added
    // Use requestAnimationFrame to ensure DOM is painted before scrolling
    requestAnimationFrame(() => {
      this.els.chatMessages.scrollTo({
        top: this.els.chatMessages.scrollHeight,
        behavior: "smooth",
      });
    });

    // Auto-save session after message is added
    this._saveCurrentSession();

    return msgDiv;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTOCOMPLETE
  // ═══════════════════════════════════════════════════════════════════════════

  _showAutocomplete(filter) {
    const commands = ["/plan", "/code", "/debug", "/review", "/clear", "/help", "/skills", "/status"];
    const descriptions = {
      "/plan": "Strategic planning workflow",
      "/code": "Code generation workflow",
      "/debug": "Debugging workflow",
      "/review": "Code review workflow",
      "/clear": "Clear conversation history",
      "/help": "Show available commands",
      "/skills": "List loaded skills",
      "/status": "Show system status",
    };

    // Check if input starts with /
    if (!filter.startsWith("/")) {
      this.els.autocompleteBox.classList.add("hidden");
      return;
    }

    const matching = commands.filter((cmd) => cmd.startsWith(filter));
    if (matching.length === 0 || matching.length === commands.length) {
      this.els.autocompleteBox.classList.add("hidden");
      return;
    }

    this.els.autocompleteBox.innerHTML = matching
      .map(
        (cmd) =>
          `<div class="autocomplete-item" data-cmd="${cmd}">
            <span class="cmd">${cmd}</span>
            <span class="desc">${descriptions[cmd] || ""}</span>
          </div>`
      )
      .join("");

    this.els.autocompleteBox.classList.remove("hidden");

    // Click handler
    this.els.autocompleteBox.querySelectorAll(".autocomplete-item").forEach((el) => {
      el.addEventListener("click", () => {
        this.els.chatInput.value = el.dataset.cmd + " ";
        this.els.autocompleteBox.classList.add("hidden");
        this.els.chatInput.focus();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // @ FILE MENTIONS (Misión 3)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows file autocomplete when @ is typed in the chat input.
   * Uses the existing autocomplete-box but with file entries.
   */
  _showFileAutocomplete(filter) {
    const box = this.els.autocompleteBox;
    if (!box) return;

    if (!filter.startsWith("@") || this._fileList.length === 0) {
      // Don't hide if showing command autocomplete
      if (!filter.startsWith("/")) {
        box.classList.add("hidden");
      }
      return;
    }

    // Filter files by the text after @
    const query = filter.slice(1).toLowerCase().trim();
    const matching = this._fileList.filter((fp) => {
      const fileName = fp.split("/").pop() || fp.split("\\").pop();
      return fileName.toLowerCase().includes(query) || fp.toLowerCase().includes(query);
    });

    // Check if query matches "@codebase" special mention
    const codebaseMatch = "codebase".includes(query) || query.includes("codebase");
    const showCodebase = query.length > 0 && codebaseMatch;

    // Limit to top 20 matches (less one slot if @codebase shown)
    const maxFiles = showCodebase ? 19 : 20;
    const topMatches = matching.slice(0, maxFiles);

    let html = `<div class="autocomplete-header" style="padding:4px 10px;font-size:11px;color:#888;border-bottom:1px solid #333;">
        📎 Files
      </div>`;

    // Add @codebase as a special static mention option
    if (showCodebase) {
      html += `<div class="autocomplete-item file-autocomplete" data-path="__codebase__">
          <span class="tree-icon">🧠</span>
          <span class="cmd">@codebase <span style="color:#888;font-size:11px;">(Repo Map)</span></span>
        </div>`;
    }

    html += topMatches
        .map(
          (fp) =>
            `<div class="autocomplete-item file-autocomplete" data-path="${this._escapeHtml(fp)}">
              <span class="tree-icon">📄</span>
              <span class="cmd">${this._escapeHtml(fp)}</span>
            </div>`
        )
        .join("");

    box.innerHTML = html;

    box.classList.remove("hidden");

    // Click handler
    box.querySelectorAll(".autocomplete-item.file-autocomplete").forEach((el) => {
      el.addEventListener("click", () => {
        const filePath = el.dataset.path;
        this._insertMentionPill(filePath);
        box.classList.add("hidden");
        this.els.chatInput.focus();
      });
    });
  }

  /**
   * Inserts an @ mention pill for a file into the chat input area.
   * The pill is a visual badge and the file path is stored in _mentionFiles.
   */
  _insertMentionPill(filePath) {
    if (!filePath) return;

    // Avoid duplicates
    if (this._mentionFiles.includes(filePath)) return;
    this._mentionFiles.push(filePath);

    // Replace the @text with the pill
    const currentValue = this.els.chatInput.value;
    const atIndex = currentValue.lastIndexOf("@");
    if (atIndex !== -1) {
      // Remove the @ and partial text after it
      const before = currentValue.substring(0, atIndex);
      const after = currentValue.substring(atIndex + 1).replace(/^\S*\s*/, "");
      this.els.chatInput.value = before + after;
    }

    // Create pill UI near the input area
    const pillArea = this.els.chatInput.parentElement;
    const existingPills = pillArea.querySelector(".mention-pills");
    let pillsContainer = existingPills;

    if (!pillsContainer) {
      pillsContainer = document.createElement("div");
      pillsContainer.className = "mention-pills";
      pillArea.insertBefore(pillsContainer, this.els.chatInput);
    }

    const pill = document.createElement("span");
    pill.className = "mention-pill";
    pill.dataset.path = filePath;

    // Handle @codebase special mention
    const isCodebase = filePath === "__codebase__";
    const displayName = isCodebase ? "🧠 @codebase" : `@${this._escapeHtml(filePath.split("/").pop() || filePath.split("\\").pop())}`;
    const logMessage = isCodebase ? "🧠 @codebase attached (Repo Map)" : `📎 File attached: ${filePath}`;

    pill.innerHTML = `
      ${displayName}
      <span class="mention-pill-remove" data-path="${this._escapeHtml(filePath)}">×</span>
    `;

    // Remove on × click
    pill.querySelector(".mention-pill-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = this._mentionFiles.indexOf(filePath);
      if (idx !== -1) this._mentionFiles.splice(idx, 1);
      pill.remove();
      // Remove container if empty
      if (pillsContainer.children.length === 0) {
        pillsContainer.remove();
      }
    });

    pillsContainer.appendChild(pill);
    this.addLogEntry("info", logMessage);
  }

  /**
   * Builds file context string from @ mentioned files to prepend to the prompt.
   */
  async _getMentionContext() {
    if (this._mentionFiles.length === 0) return "";

    const parts = [];
    for (const filePath of this._mentionFiles) {
      // ── @codebase special mention ──
      if (filePath === "__codebase__") {
        try {
          const result = await window.lvzero["skill:runRepoMapper"](".");
          if (result && result.success && result.map) {
            const mapText = result.map.length > 5000
              ? result.map.substring(0, 5000) + "\n... (repo map truncated to 5000 chars)"
              : result.map;
            parts.push(`### 📊 Repo Map (Full Codebase Context)\n\`\`\`\n${mapText}\n\`\`\``);
          } else if (result && result.error) {
            parts.push(`### 📊 Repo Map\n⚠️ Could not generate repo map: ${result.error}`);
          }
        } catch (err) {
          parts.push(`### 📊 Repo Map\n⚠️ Error generating repo map: ${err.message}`);
        }
        continue;
      }

      // ── Regular file @ mention ──
      try {
        const result = await window.lvzero["file:read"](filePath);
        if (result.success && result.content) {
          // Truncate large files to first 2000 chars
          const content = result.content.length > 2000
            ? result.content.substring(0, 2000) + "\n... (truncated)"
            : result.content;
          parts.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
        }
      } catch {
        // Skip files that can't be read
      }
    }

    if (parts.length === 0) return "";

    return `\n\n[Attached Files — Read-Only Context]\n${parts.join("\n\n")}\n\n---\n`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG & DROP FILE HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Maneja el evento drop de archivos en el chat.
   * Para archivos de texto: lee el contenido y lo inserta en el textarea.
   * Para binarios: muestra un warning.
   */
  async _handleFileDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Binary file extensions to skip
    const binaryExts = new Set([
      '.exe','.dll','.so','.dylib','.png','.jpg','.jpeg','.gif','.ico',
      '.bmp','.webp','.svg','.woff','.woff2','.ttf','.eot','.zip','.tar',
      '.gz','.7z','.rar','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
      '.mp3','.mp4','.avi','.mov','.mkv','.wasm','.o','.a','.lib',
    ]);

    let totalInsert = '';

    for (const file of files) {
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '';
      const filePath = file.path || file.name; // Electron gives full path

      if (binaryExts.has(ext)) {
        this.addLogEntry('warn', `⚠️ Archivo ignorado (binario): ${file.name}`);
        continue;
      }

      try {
        const text = await file.text();
        const preview = text.length > 5000 ? text.substring(0, 5000) + '\n\n... [truncated, file too large]' : text;
        const escapedName = this._escapeHtml(file.name);
        totalInsert += `📄 \`${escapedName}\`\n\`\`\`\n${preview}\n\`\`\`\n\n`;
        this.addLogEntry('info', `📎 Archivo agregado: ${file.name} (${(text.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        this.addLogEntry('error', `❌ Error leyendo archivo: ${file.name} — ${err.message}`);
      }
    }

    if (totalInsert) {
      const ta = this.els.chatInput;
      ta.focus();
      // Insert at cursor position or append
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = ta.value.substring(0, start);
      const after = ta.value.substring(end);
      ta.value = before + totalInsert + after;
      // Move cursor after inserted content
      const newPos = before.length + totalInsert.length;
      ta.selectionStart = ta.selectionEnd = newPos;
      this._autoResizeInput();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSPECTOR LOG
  // ═══════════════════════════════════════════════════════════════════════════

  addLogEntry(type, message) {
    const entry = document.createElement("div");
    const msgStr = String(message);

    // Detect [TIMEOUT] prefix and apply special styling
    let extraClass = "";
    if (msgStr.includes("[TIMEOUT]")) {
      if (type === "error") {
        extraClass = " log-timeout";
      } else {
        extraClass = " log-timeout log-timeout-warn";
      }
    }

    entry.className = `log-entry ${type}${extraClass}`;
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="timestamp">[${time}]</span> ${this._escapeHtml(msgStr)}`;
    this.els.inspectorLog.appendChild(entry);
    this.els.inspectorLog.scrollTop = this.els.inspectorLog.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  async _updateStatus() {
    try {
      const status = await window.lvzero["agent:status"]();
      if (status) {
        const skillsCount = status.skillsCount || 0;
        const msgCount = status.messagesCount || 0;
        const sessionId = status.session?.sessionId || status.sessionId || "unknown";

        this._updateBadge("ready", `✓ ${skillsCount} skills · ${msgCount} msgs`);
        this.addLogEntry("info", `Session: ${sessionId} | Skills: ${skillsCount} | Messages: ${msgCount}`);

        // ── Context Gauge (Termómetro de Contexto) ──
        const gauge = this.els.contextGauge;
        const fill = this.els.gaugeFill;
        const label = this.els.gaugeLabel;
        if (gauge && fill && label && status.contextUsedPct !== undefined) {
          gauge.classList.remove("hidden");
          const pct = Math.min(100, status.contextUsedPct);
          fill.style.width = pct + "%";
          // Color thresholds: green (<60%), yellow (60-85%), red (>85%)
          fill.className = "gauge-fill" + (pct > 85 ? " level-danger" : pct > 60 ? " level-warning" : "");
          // Label: e.g. "4.2K/64K"
          const tokensK = (status.estimatedTokens / 1000).toFixed(1);
          const budgetK = (status.tokenBudget / 1000);
          label.textContent = `${tokensK}K/${budgetK}K`;
        }

        // ── Model Display: sync label from orchestrator status ──
        if (this.els.currentModelLabel) {
          this._updateModelDisplay(status.currentTier || null, status.model);
        }

        // If orchestrator is already initialized (IPC "ready" event was
        // emitted before the window existed), update the system message now
        if (status.ready) {
          const sysMsg = this.els.chatMessages.querySelector(".message.system .message-body");
          if (sysMsg) {
            const currentText = sysMsg.textContent || "";
            // Only update if the message is still the default welcome/text
            // (avoid overwriting user-facing messages like "Conversation cleared.")
            const isDefault = currentText.includes("Initializing") ||
                              currentText.includes("initializing") ||
                              currentText.includes("Welcome") ||
                              currentText === "Autonomous System Architect";
            if (isDefault) {
              sysMsg.textContent = `✓ System ready · ${skillsCount} skills loaded`;
            }
          }
        }
      }
    } catch (err) {
      this._updateBadge("error", "✗ Status error");
    }
  }

  _updateBadge(state, text) {
    this.els.statusBadge.className = `status-badge ${state}`;
    this.els.statusBadge.textContent = text;
  }

  /**
   * Position the model dropdown using fixed coordinates relative to the
   * model-selector button. Uses position:fixed to escape the panel's
   * overflow:hidden clipping.
   */
  _positionModelDropdown() {
    const dd = this.els.modelDropdown;
    const btn = this.els.modelSelector;
    if (!dd || !btn) return;
    const rect = btn.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${Math.max(0, rect.right - 200)}px`;
    dd.style.maxHeight = `${Math.min(260, window.innerHeight - rect.bottom - 20)}px`;
  }

  /**
   * Update the model override display in the mode-selector bar.
   * Tier "auto" clears the override (back to automatic selection).
   * Tier "free" forces OpenRouter Free (Google Gemma 4 31B / OpenAI GPT-OSS 120B).
   * Tier "cheap" forces Flash (deepseek-v4-flash).
   * @param {"auto"|"cheap"|"reasoner"|null} tier
   * @param {string} [modelName] - The resolved model name
   */
  _updateModelDisplay(tier, modelName) {
    const label = this.els.currentModelLabel;
    const btn = this.els.modelOverrideBtn;
    if (!label) return;

    // Map ANY internal model name to user-facing names
    const raw = (modelName || "").toLowerCase();
    let friendlyName = "";
    if (raw.includes("gemma")) friendlyName = "Gemma 4";
    else if (raw.includes("gpt-oss")) friendlyName = "GPT-OSS";
    else if (raw.includes("flash") || raw === "deepseek-chat") friendlyName = "Flash";
    else if (raw.includes("pro") || raw === "deepseek-reasoner") friendlyName = "Pro";
    else if (raw) friendlyName = modelName; // fallback — show as-is

    // Always update: use modelName for "auto" or when tier is null/undefined
    if (!tier || tier === "auto") {
      label.textContent = friendlyName ? `Auto · ${friendlyName}` : "Auto";
      label.classList.remove("overridden");
      if (btn) btn.title = `Auto — ${friendlyName || "automático"}`;
    } else if (tier === "free") {
      label.textContent = `🆓 ${friendlyName || "Free"}`;
      label.classList.add("overridden");
      if (btn) btn.title = `Override: Free (${modelName || "GPT-OSS 120B"})`;
    } else if (tier === "cheap") {
      label.textContent = `⚡ ${friendlyName || "Flash"}`;
      label.classList.add("overridden");
      if (btn) btn.title = `Override: Flash (${modelName || "deepseek-v4-flash"})`;
    } else if (tier === "reasoner") {
      label.textContent = `🧠 ${friendlyName || "Pro"}`;
      label.classList.add("overridden");
      if (btn) btn.title = `Override: Pro (${modelName || "deepseek-v4-pro"})`;
    }

    // Mark active option in dropdown
    this.els.modelOptions?.forEach(opt => {
      opt.classList.toggle("active", opt.dataset.tier === tier);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKFLOW PROGRESS BAR (Fase 5)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows and initializes the visual workflow progress bar.
   * Called when workflow_start event is received.
   */
  _showWorkflowProgress(command, totalSteps, steps, autoDetected) {
    const wp = this.els.workflowProgress;
    if (!wp) return;

    // Set command name
    if (this.els.wpCommand) {
      this.els.wpCommand.textContent = autoDetected
        ? `🤖 ${command}`
        : command;
    }

    // Set total steps
    if (this.els.wpTotal) {
      this.els.wpTotal.textContent = totalSteps || "?";
    }

    // Reset to step 1
    if (this.els.wpCurrent) {
      this.els.wpCurrent.textContent = "1";
    }

    // Set progress to first step
    if (this.els.wpFill) {
      const pct = totalSteps > 0 ? (1 / totalSteps) * 100 : 10;
      this.els.wpFill.style.width = `${Math.min(pct, 100)}%`;
    }

    // Set step name
    if (this.els.wpStepName && steps && steps.length > 0) {
      this.els.wpStepName.textContent = `📌 ${steps[0]}`;
    } else if (this.els.wpStepName) {
      this.els.wpStepName.textContent = "Iniciando...";
    }

    // Remove completed class and show
    wp.classList.remove("completed", "hidden");
  }

  /**
   * Updates the progress bar to reflect the current workflow step.
   * Called when workflow_step event is received.
   * If currentStep is missing/undefined, the bar is hidden (idle guard).
   */
  _updateWorkflowProgress(currentStep, totalSteps, stepName) {
    const wp = this.els.workflowProgress;
    if (!wp) return;

    // Guard: if currentStep is missing, the workflow is not actively
    // progressing — hide the bar instead of showing "undefined / total"
    if (currentStep == null) {
      this._hideWorkflowProgress();
      return;
    }

    // Ensure it's visible (in case workflow_start was missed)
    wp.classList.remove("completed", "hidden");

    if (this.els.wpCurrent) {
      this.els.wpCurrent.textContent = String(currentStep);
    }

    if (this.els.wpTotal && totalSteps) {
      this.els.wpTotal.textContent = String(totalSteps);
    }

    if (this.els.wpFill && totalSteps > 0) {
      const pct = (currentStep / totalSteps) * 100;
      this.els.wpFill.style.width = `${Math.min(pct, 100)}%`;
    }

    if (this.els.wpStepName && stepName) {
      this.els.wpStepName.textContent = `📌 ${stepName}`;
    }

    if (this.els.wpStatus) {
      this.els.wpStatus.textContent = `Paso ${currentStep}/${totalSteps || "?"}`;
    }
  }

  /**
   * Marks the progress bar as fully complete with a green fill.
   * Called on workflow_end or when workflow_step with completed=true arrives.
   */
  _completeWorkflowProgress(finalStepName) {
    const wp = this.els.workflowProgress;
    if (!wp) return;

    // Set fill to 100%
    if (this.els.wpFill) {
      this.els.wpFill.style.width = "100%";
    }

    // Update status text
    if (this.els.wpStatus) {
      this.els.wpStatus.textContent = "✅ Completado";
    }

    // Update icon
    if (this.els.wpIcon) {
      this.els.wpIcon.textContent = "✅";
    }

    // Update step name
    if (this.els.wpStepName && finalStepName) {
      this.els.wpStepName.textContent = `✅ ${finalStepName}`;
    }

    // Add completed class for green styling
    wp.classList.add("completed");
  }

  /**
   * Hides the progress bar (after auto-detection timeout or manual clear).
   */
  _hideWorkflowProgress() {
    const wp = this.els.workflowProgress;
    if (!wp) return;

    wp.classList.add("hidden");
    wp.classList.remove("completed");

    // Reset icon
    if (this.els.wpIcon) {
      this.els.wpIcon.textContent = "🔄";
    }

    // Reset state text
    if (this.els.wpStatus) {
      this.els.wpStatus.textContent = "Paso 1/1";
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODE UI
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Binds mode button click handlers and suggestion banner actions.
   */
  _bindModeUI() {
    // Mode button click handlers
    this.els.modeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const modeSlug = btn.dataset.mode;
        if (modeSlug === this._mode.slug) return; // Already in this mode
        this._switchMode(modeSlug);
      });
    });

    // Mode suggestion banner: Accept button
    // Calls acceptModeSuggestion() which consumes _pendingModeInput
    // and re-invokes agentLoop() with the stored user input
    if (this.els.modeSuggestionAccept) {
      this.els.modeSuggestionAccept.addEventListener("click", () => {
        this._hideModeSuggestion();
        window.lvzero["agent:accept_mode_suggestion"]?.().catch(err => {
          console.warn("Failed to accept mode suggestion:", err);
          this.addLogEntry("error", `❌ Failed to accept mode suggestion: ${err.message}`);
        });
      });
    }

    // Mode suggestion banner: Dismiss button
    // Calls denyModeSuggestion() which clears pending state in orchestrator
    if (this.els.modeSuggestionDismiss) {
      this.els.modeSuggestionDismiss.addEventListener("click", () => {
        this._hideModeSuggestion();
        window.lvzero["agent:deny_mode_suggestion"]?.().catch(err => {
          console.warn("Failed to deny mode suggestion:", err);
        });
      });
    }
  }

  /**
   * Sends a mode switch request to the orchestrator via IPC.
   * @param {string} modeSlug - The mode to switch to (architect, code, ask, debug).
   */
  async _switchMode(modeSlug) {
    try {
      const result = await window.lvzero["mode:switch"](modeSlug);
      if (!result || result.error) {
        this.addLogEntry("error", `❌ Mode switch failed: ${result?.error || "unknown error"}`);
      }
      // UI update is handled by the mode_changed event
    } catch (err) {
      this.addLogEntry("error", `❌ Mode switch error: ${err.message}`);
    }
  }

  /**
   * Adds a mode switch notification message to the chat.
   * @param {Object} data - { to, from, icon, name, color, reason }
   */
  _addModeSwitchNotification(data) {
    const notif = document.createElement("div");
    notif.className = "mode-switch-notification";

    // Color-coded background per mode
    const bgColors = {
      architect: "#4A9EFF22",
      code: "#22C55E22",
      ask: "#A855F722",
      debug: "#EF444422",
      orchestrator: "#3d1f0a",
    };
    const borderColors = {
      architect: "#4A9EFF",
      code: "#22C55E",
      ask: "#A855F7",
      debug: "#EF4444",
      orchestrator: "#FF6B35",
    };
    notif.style.background = bgColors[data.to] || "var(--bg-tertiary)";
    notif.style.border = `1px solid ${borderColors[data.to] || "var(--border-primary)"}`;

    notif.innerHTML = `
      <span class="mode-switch-notification-icon">${data.icon || "🔄"}</span>
      <span class="mode-switch-notification-text">
        Switched to <strong>${data.icon} ${data.name}</strong> mode
        ${data.reason ? `<span class="mode-switch-notification-desc">(${data.reason})</span>` : ""}
      </span>
    `;

    // Insert after the last message
    this.els.chatMessages.appendChild(notif);
    this.els.chatMessages.scrollTop = this.els.chatMessages.scrollHeight;

    // Auto-remove after 5 seconds with fade-out
    setTimeout(() => {
      if (notif.parentNode) {
        notif.style.opacity = "0";
        notif.style.transition = "opacity 0.3s";
        setTimeout(() => notif.remove(), 300);
      }
    }, 5000);
  }

  /**
   * Shows the mode suggestion banner for auto-detected mode changes.
   * @param {Object} data - { slug, icon, name, reason, confidence }
   */
  _showModeSuggestion(data) {
    this._pendingSuggestion = data;
    if (!this.els.modeSuggestionBanner) return;

    this.els.modeSuggestionText.innerHTML = `
      💡 Suggested mode: <strong>${data.icon || "🔄"} ${data.name}</strong>
      ${data.reason ? `<br><span style="opacity:0.7;font-size:11px;">${data.reason}</span>` : ""}
    `;
    this.els.modeSuggestionBanner.classList.remove("hidden");
    this.addLogEntry("info", `💡 Mode suggestion: ${data.icon} ${data.name} (${Math.round(data.confidence * 100)}%)`);
  }

  /**
   * Hides the mode suggestion banner.
   */
  _hideModeSuggestion() {
    this._pendingSuggestion = null;
    if (this.els.modeSuggestionBanner) {
      this.els.modeSuggestionBanner.classList.add("hidden");
    }
  }

  /**
   * Injects an inline mode-suggestion message with approve/deny buttons
   * directly into the chat message stream. This serves as a fallback when
   * the banner at the top of the chat panel doesn't appear or isn't visible.
   *
   * Creates a system-styled message with the suggestion details and two
   * clickable buttons (Approve / Deny) that call the corresponding IPC handlers.
   *
   * @param {Object} data - { slug, icon, name, reason, confidence, to }
   */
  _showModeSuggestionInline(data) {
    const container = this.els.chatMessages;
    if (!container) return;

    const msgDiv = document.createElement("div");
    msgDiv.className = "message system mode-suggestion-inline";
    msgDiv.dataset.modeSuggestion = data.to || "";

    const reasonHtml = data.reason
      ? `<br><span style="opacity:0.7;font-size:11px;">${this._escapeHtml(data.reason)}</span>`
      : "";

    msgDiv.innerHTML = `
      <div class="message-avatar">💡</div>
      <div class="message-content">
        <div class="message-header"><strong>Mode Suggestion</strong></div>
        <div class="message-body">
          Suggested mode: <strong>${data.icon || "🔄"} ${this._escapeHtml(data.name || data.to || "")}</strong>
          ${reasonHtml}
        </div>
        <div class="mode-suggestion-inline-actions" style="display:flex;gap:8px;margin-top:8px;">
          <button class="mode-suggestion-inline-btn mode-suggestion-inline-accept" style="padding:4px 14px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;background:#4CAF50;color:white;transition:filter 0.15s;">✓ Approve</button>
          <button class="mode-suggestion-inline-btn mode-suggestion-inline-deny" style="padding:4px 14px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;background:#f44336;color:white;transition:filter 0.15s;">✕ Deny</button>
        </div>
      </div>
    `;

    // Approve button
    const acceptBtn = msgDiv.querySelector(".mode-suggestion-inline-accept");
    acceptBtn.addEventListener("click", () => {
      acceptBtn.disabled = true;
      acceptBtn.textContent = "✓ Switching...";
      acceptBtn.style.opacity = "0.6";
      if (msgDiv.querySelector(".mode-suggestion-inline-deny")) {
        msgDiv.querySelector(".mode-suggestion-inline-deny").disabled = true;
        msgDiv.querySelector(".mode-suggestion-inline-deny").style.opacity = "0.4";
      }
      this._hideModeSuggestion();
      window.lvzero["agent:accept_mode_suggestion"]?.().catch(err => {
        console.warn("Failed to accept mode suggestion (inline):", err);
        this.addLogEntry("error", `❌ Failed to accept mode suggestion: ${err.message}`);
        acceptBtn.textContent = "✓ Retry";
        acceptBtn.disabled = false;
        acceptBtn.style.opacity = "1";
      });
    });

    // Deny button
    const denyBtn = msgDiv.querySelector(".mode-suggestion-inline-deny");
    denyBtn.addEventListener("click", () => {
      denyBtn.disabled = true;
      denyBtn.textContent = "✕ Denied";
      denyBtn.style.opacity = "0.6";
      if (msgDiv.querySelector(".mode-suggestion-inline-accept")) {
        msgDiv.querySelector(".mode-suggestion-inline-accept").disabled = true;
        msgDiv.querySelector(".mode-suggestion-inline-accept").style.opacity = "0.4";
      }
      this._hideModeSuggestion();
      window.lvzero["agent:deny_mode_suggestion"]?.().catch(err => {
        console.warn("Failed to deny mode suggestion (inline):", err);
      });
    });

    container.appendChild(msgDiv);
    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  /**
   * Shows the follow-up question banner when the agent asks a question.
   * @param {Object} data - { question, follow_up }
   */
  _showFollowUpQuestion(data) {
    const banner = document.getElementById("followup-question-banner");
    if (!banner) return;

    document.getElementById("followup-question-text").textContent = "❓ " + data.question;

    const optionsDiv = document.getElementById("followup-question-options");
    optionsDiv.innerHTML = "";
    data.follow_up.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "followup-option-btn";
      btn.textContent = opt.text || opt;
      btn.addEventListener("click", () => {
        this._sendFollowUpAnswer(typeof opt === "string" ? opt : opt.text);
      });
      optionsDiv.appendChild(btn);
    });

    banner.classList.remove("hidden");

    const input = document.getElementById("followup-question-input");
    input.focus();

    // Submit button — send typed answer
    const submitBtn = document.getElementById("followup-question-submit");
    submitBtn.onclick = () => {
      const answer = input.value.trim();
      if (answer) this._sendFollowUpAnswer(answer);
    };

    // Enter key on input — same as clicking Submit
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        const answer = input.value.trim();
        if (answer) this._sendFollowUpAnswer(answer);
      }
    };

    // Cancel/Dismiss button
    const dismissBtn = document.getElementById("followup-question-dismiss");
    dismissBtn.onclick = () => this._hideFollowUpQuestion();
  }

  /**
   * Hides the follow-up question banner.
   */
  _hideFollowUpQuestion() {
    const banner = document.getElementById("followup-question-banner");
    if (banner) banner.classList.add("hidden");
  }

  /**
   * Sends the user's answer to the follow-up question via IPC.
   * @param {string} answer
   */
  _sendFollowUpAnswer(answer) {
    this._hideFollowUpQuestion();
    // Send answer to orchestrator via IPC
    window.lvzero["agent:answer_followup"]?.(answer).catch(err => {
      console.warn("Failed to send followup answer:", err);
    });
  }

  /**
   * Shows the tool confirmation banner when a shell command requires approval.
   * @param {Object} data - { type, command, cwd, shell, toolIndex }
   */
  _showToolConfirmation(data) {
    const banner = document.getElementById("tool-confirmation-banner");
    if (!banner) return;

    document.getElementById("tool-confirmation-text").textContent = "⚠️ Shell command requires approval:";
    document.getElementById("tool-confirmation-command").textContent = data.command || "(unknown)";

    // Approve button — sends command to terminal
    const approveBtn = document.getElementById("tool-confirmation-approve");
    approveBtn.onclick = () => {
      this._hideToolConfirmation();
      this.addLogEntry("info", `✅ Shell command approved: ${data.command}`);
    };

    // Dismiss button — just hides the banner, command still runs in background
    const dismissBtn = document.getElementById("tool-confirmation-dismiss");
    dismissBtn.onclick = () => {
      this._hideToolConfirmation();
      this.addLogEntry("warn", `⏭️ Shell command dismissed (no approval): ${data.command}`);
    };

    banner.classList.remove("hidden");

    // Log the warning
    this.addLogEntry("warn", `⚠️ Shell command requires approval: ${data.command}`);
  }

  /**
   * Hides the tool confirmation banner.
   */
  _hideToolConfirmation() {
    const banner = document.getElementById("tool-confirmation-banner");
    if (banner) banner.classList.add("hidden");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORCHESTRATOR EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  _connectEvents() {
    const { events } = window.lvzero;

    // ── Heartbeat Timer (Feature 2) ──
    let taskTimer = null;
    let taskStartTime = null;

    const startTaskTimer = () => {
      taskStartTime = Date.now();
      this.els.taskStatusBar?.classList.remove("hidden");
      taskTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - taskStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        if (this.els.taskStatusTimer) this.els.taskStatusTimer.textContent = `${mins}:${secs}`;
      }, 1000);
    };

    const stopTaskTimer = () => {
      if (taskTimer) { clearInterval(taskTimer); taskTimer = null; }
      setTimeout(() => {
        this.els.taskStatusBar?.classList.add("hidden");
      }, 3000);
    };

    const subs = [
      events.on("log", (msg) => {
        this.addLogEntry("info", msg);
      }),

      events.on("thought", (thought) => {
        this.addLogEntry("thought", `💭 ${thought}`);
        // Store the thought for inline display in the next assistant message
        this._pendingThought = thought;
      }),

      events.on("step", ({ iteration, total }) => {
        this.addLogEntry("step", `📋 Step ${iteration}/${total}`);
        this._updateBadge("busy", `📋 Step ${iteration}/${total}`);
        // Show stop button, hide send button while agent is running
        this.els.stopBtn?.classList.remove("hidden");
        this.els.sendBtn?.classList.add("hidden");
        // Heartbeat: start timer on first step
        if (!taskTimer) startTaskTimer();
        if (this.els.taskStatusText) this.els.taskStatusText.textContent = "Processing...";
        // Also update workflow progress bar as a fallback, so the progress
        // indicator advances even if the LLM doesn't emit structured step markers
        const wp = this.els.workflowProgress;
        if (wp && !wp.classList.contains("hidden") && !wp.classList.contains("completed")) {
          this._updateWorkflowProgress(iteration, total, "Processing...");
        }
      }),

      events.on("summary", (data) => {
        const summaryText = data.summary ||
          `Contexto compactado: ${data.before} → ${data.after} mensajes`;
        this.addLogEntry("info", `📝 ${summaryText}`);
        // Also add as a subtle system message in chat
        this.addMessage("system", `📝 ${summaryText}`, "system");
      }),

      events.on("tool_call", ({ name, args }) => {
        this.addLogEntry("tool_call", `🔧 ${name}(${JSON.stringify(args).slice(0, 80)})`);
        // Feature: when autoApprove.read is OFF, skip read_file from inline chat display (reduce noise)
        const autoApprove = this._getAutoApproveState();
        if (name === "read_file" && !autoApprove.read) {
          return; // still logs, but doesn't clutter the chat
        }
        // Also show in chat — insert inline inside the last assistant message
        const argPreview = JSON.stringify(args).slice(0, 150);
        const msgs = this.els.chatMessages.querySelectorAll(".message.assistant");
        const lastAssistant = msgs[msgs.length - 1];
        if (lastAssistant) {
          const contentDiv = lastAssistant.querySelector(".message-content");
          const body = lastAssistant.querySelector(".message-body");
          if (contentDiv && body) {
            const detailsEl = document.createElement("details");
            detailsEl.className = "tool-call-inline";
            detailsEl.open = true;
            const summaryEl = document.createElement("summary");
            summaryEl.textContent = `🔧 ${name}`;
            detailsEl.appendChild(summaryEl);
            const preEl = document.createElement("pre");
            preEl.textContent = argPreview;
            detailsEl.appendChild(preEl);
            contentDiv.insertBefore(detailsEl, body);
          }
        }
      }),

      events.on("tool_result", ({ name, result }) => {
        const preview = typeof result === "string" ? result.slice(0, 60) : JSON.stringify(result).slice(0, 60);
        this.addLogEntry("tool_result", `✅ ${name} → ${preview}`);
        // Also show in chat — insert inline inside the last assistant message
        const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        const truncated = resultStr.length > 500 ? resultStr.slice(0, 500) + "\n... (truncado)" : resultStr;
        
        // Only wrap in code blocks for actual code tools
        const codeTools = ["shell_executor", "supabase_sql", "apply_diff", "code_mapper"];
        const isCode = codeTools.includes(name) ||
                       resultStr.match(/^(function |class |import |export |const |let |var |SELECT |INSERT |UPDATE |DELETE |CREATE |ALTER |DROP )/m);
        
        const formattedResult = isCode
            ? `\`\`\`\n${truncated}\n\`\`\``
            : truncated;
        
        const msgs = this.els.chatMessages.querySelectorAll(".message.assistant");
        const lastAssistant = msgs[msgs.length - 1];
        if (lastAssistant) {
          const contentDiv = lastAssistant.querySelector(".message-content");
          const body = lastAssistant.querySelector(".message-body");
          if (contentDiv && body) {
            const detailsEl = document.createElement("details");
            detailsEl.className = "tool-result-inline";
            detailsEl.open = false;
            const summaryEl = document.createElement("summary");
            summaryEl.textContent = `✅ ${name}`;
            detailsEl.appendChild(summaryEl);
            const resultBody = document.createElement("div");
            resultBody.className = "tool-result-body";
            resultBody.textContent = formattedResult;
            detailsEl.appendChild(resultBody);
            contentDiv.insertBefore(detailsEl, body);
          }
        }
      }),

      events.on("tool_progress", ({ name, index, total, status }) => {
        const icon = status === "running" ? "🔄" : status === "completed" ? "✅" : "❌";
        const statusText = `${icon} Tool ${index}/${total}: ${name} (${status})`;
        this.addLogEntry("tool_progress", statusText);
        // Update workflow progress bar subtitle
        const wpSubtitle = document.getElementById("workflow-progress-subtitle");
        if (wpSubtitle) {
          wpSubtitle.textContent = statusText;
        }
        // Heartbeat: start timer and update status (Feature 2)
        if (!taskTimer) startTaskTimer();
        const action = status === "running" ? "Running" : status === "completed" ? "Completed" : "Failed";
        if (this.els.taskStatusText) this.els.taskStatusText.textContent = `${action}: ${name}`;
      }),

      events.on("response", (content) => {
        // Stop heartbeat timer when agent finishes
        stopTaskTimer();
        this._isProcessing = false;
        // Update the last assistant message if it has the placeholder
        const msgs = this.els.chatMessages.querySelectorAll(".message.assistant");
        const last = msgs[msgs.length - 1];
        if (last) {
          const body = last.querySelector(".message-body");
          if (body && body.textContent === "⏳ Thinking...") {
            const cleanContent = this._stripThought(content);
            // If there's a pending thought, insert as collapsible section
            if (this._pendingThought) {
              const detailsEl = document.createElement("details");
              detailsEl.className = "thought-details";
              detailsEl.style.marginBottom = "8px";
              const summaryEl = document.createElement("summary");
              summaryEl.textContent = "💭 Thinking";
              const thoughtBody = document.createElement("div");
              thoughtBody.className = "thought-body";
              thoughtBody.textContent = this._pendingThought;
              detailsEl.appendChild(summaryEl);
              detailsEl.appendChild(thoughtBody);
              // Insert into .message-content (parent of .message-body)
              body.parentNode.insertBefore(detailsEl, body);
              this._pendingThought = null;
            }
            this._setMessageBody(body, cleanContent);
          }
          // NOTE: appendChild reorder removed — tool_call/tool_result are now
          // inserted inline inside the assistant message, preserving order
        }
        this._updateBadge("ready", "✓ Response received");
        this.addLogEntry("info", "📨 Response received");
        // Hide stop button, show send button when agent finishes
        this.els.stopBtn?.classList.add("hidden");
        this.els.sendBtn?.classList.remove("hidden");
        // Heartbeat: update status (Feature 2)
        if (this.els.taskStatusText) this.els.taskStatusText.textContent = "Streaming response...";
        // Scroll to the final response at the bottom
        setTimeout(() => {
          this.els.chatMessages.scrollTo({
            top: this.els.chatMessages.scrollHeight,
            behavior: "smooth",
          });
        }, 50);
        // Flush message queue (Feature 3)
        this._isProcessing = false;
        if (this._messageQueue.length > 0) {
          const nextMsg = this._messageQueue.shift();
          this._updateQueueBadge();
          this.els.chatInput.value = nextMsg;
          setTimeout(() => this.sendMessage(nextMsg), 500);
        }
      }),

      events.on("error", (errData) => {
        // Handle both legacy { message } and typed LvError.toJSON() format
        const message = errData.label
          ? `[${errData.label}] ${errData.message}`
          : errData.message || "Error desconocido";
        const isFatal = errData.fatal === true;
        const icon = isFatal ? "🔥" : "❌";

        this.addLogEntry("error", `${icon} ${message}`);
        this._updateBadge("error", isFatal ? "✗ Fatal Error" : "✗ Error");

        // Show toast notification
        this._showToast(isFatal ? 'fatal' : 'error', message);

        // Hide stop button, show send button on error too
        this.els.stopBtn?.classList.add("hidden");
        this.els.sendBtn?.classList.remove("hidden");
      }),

      events.on("ready", ({ skills, sessionId, config }) => {
        // Update the "Initializing..." system message in chat
        const sysMsg = this.els.chatMessages.querySelector(".message.system .message-body");
        if (sysMsg) {
          const skillCount = Array.isArray(skills) ? skills.length : (skills || 0);
          this._setMessageBody(sysMsg, `✓ System ready · ${skillCount} skills loaded`);
        }
        this._updateBadge("ready", `✓ ${Array.isArray(skills) ? skills.length : skills || 0} skills`);
        this.addLogEntry("info", `System ready · Session: ${sessionId || "active"}`);
      }),

      events.on("workflow_start", ({ command, totalSteps, steps, autoDetected, description }) => {
        this.addLogEntry("info", `🔄 Workflow started: ${command}${autoDetected ? " (auto-detected)" : ""}`);
        this._updateBadge("busy", `🔄 ${command}`);
        // Show and initialize the progress bar
        this._showWorkflowProgress(command, totalSteps, steps, autoDetected);
      }),

      events.on("workflow_suggest", ({ command, confidence, reason }) => {
        this.addLogEntry("info", `💡 Suggested: ${command} (${Math.round(confidence * 100)}%) — ${reason}`);
      }),

      events.on("workflow_step", ({ command, currentStep, totalSteps, stepName, completed }) => {
        if (completed) {
          this._completeWorkflowProgress(stepName || "Completado");
        } else {
          this._updateWorkflowProgress(currentStep, totalSteps, stepName);
        }
      }),

      events.on("workflow_end", ({ command, completedSteps, totalSteps }) => {
        this.addLogEntry("info", `✅ Workflow ended: ${command} (${completedSteps || totalSteps || "?"} steps completed)`);
        this._updateBadge("ready", "✓ Ready");
        // Complete the progress bar if not already done via workflow_step
        this._completeWorkflowProgress("Completado");
        // Auto-hide after 3 seconds
        setTimeout(() => {
          this._hideWorkflowProgress();
        }, 3000);
        // Heartbeat: stop timer (Feature 2)
        stopTaskTimer();
      }),

      // ── Abort / Stop Agent (Feature 2 Heartbeat) ────────────────────────────
      events.on("abort", () => {
        stopTaskTimer();
      }),

      events.on("skills_loaded", ({ count }) => {
        this.addLogEntry("info", `📦 ${count} skills loaded`);
      }),

      // ── Real-Time Reasoning (DeepSeek streaming) ────────────────────────
      events.on("reasoning", ({ text, delta, complete }) => {
        try {
          // Find the last assistant message to insert reasoning block
          const msgs = this.els.chatMessages.querySelectorAll(".message.assistant");
          const lastAssistant = msgs[msgs.length - 1];
          if (!lastAssistant) return;

          const body = lastAssistant.querySelector(".message-body");
          const contentDiv = lastAssistant.querySelector(".message-content");
          if (!body || !contentDiv) return;

          // On first reasoning chunk, create the collapsible <details> block
          if (!this._pendingReasoningEl) {
            // Show stop button if not already visible
            this.els.stopBtn?.classList.remove("hidden");
            this.els.sendBtn?.classList.add("hidden");

            const detailsEl = document.createElement("details");
            detailsEl.className = "reasoning-details";
            detailsEl.open = true; // start open so user sees the reasoning

            const summaryEl = document.createElement("summary");
            summaryEl.textContent = "🧠 Pensando...";
            detailsEl.appendChild(summaryEl);

            const reasoningBody = document.createElement("div");
            reasoningBody.className = "reasoning-body";
            reasoningBody.textContent = text || "";
            detailsEl.appendChild(reasoningBody);

            // Insert before the .message-body (inside .message-content)
            contentDiv.insertBefore(detailsEl, body);

            this._pendingReasoningEl = detailsEl;
            this._pendingReasoningText = text || "";
          } else {
            // Update existing reasoning block with new text
            // If complete=true, update summary; otherwise just append text
            const reasoningBody = this._pendingReasoningEl.querySelector(".reasoning-body");
            if (reasoningBody) {
              reasoningBody.textContent = text || this._pendingReasoningText;
              this._pendingReasoningText = text || this._pendingReasoningText;
            }

            if (complete) {
              const summary = this._pendingReasoningEl.querySelector("summary");
              if (summary) {
                const charCount = (text || this._pendingReasoningText).length;
                summary.textContent = `🧠 Pensamiento completo (${charCount} caracteres)`;
              }
              // Keep open so the user can see the full reasoning
              this._pendingReasoningEl.open = true;
            }
          }

          // Scroll to bottom to follow reasoning in real-time
          requestAnimationFrame(() => {
            this.els.chatMessages.scrollTo({
              top: this.els.chatMessages.scrollHeight,
              behavior: "smooth",
            });
          });
        } catch (err) {
          console.warn("[IDE] Error in reasoning handler:", err.message);
          // Reset pending state to allow recovery on next message
          this._pendingReasoningEl = null;
          this._pendingReasoningText = "";
        }
      }),

      // ── Content Streaming (token-by-token like ChatGPT) ───────────────────
      events.on("content_chunk", ({ text, delta, complete }) => {
        try {
          // Find the last assistant message to stream content into
          const msgs = this.els.chatMessages.querySelectorAll(".message.assistant");
          const lastAssistant = msgs[msgs.length - 1];
          if (!lastAssistant) return;

          const body = lastAssistant.querySelector(".message-body");
          if (!body) return;

          if (complete) {
            // Final chunk: render markdown for proper formatting
            const cleanContent = this._stripThought(text || "");
            try {
              this._setMessageBody(body, cleanContent);
            } catch (renderErr) {
              // Fallback: if markdown rendering fails, set as plain text
              console.warn("[IDE] Markdown render error, using textContent fallback:", renderErr.message);
              body.textContent = cleanContent;
            }
          } else if (body.textContent === "⏳ Thinking...") {
            // First real content chunk: replace placeholder with raw text
            // Show stop button if not already visible
            this.els.stopBtn?.classList.remove("hidden");
            this.els.sendBtn?.classList.add("hidden");
            body.textContent = text || "";
          } else {
            // Subsequent chunks: update raw text for performance
            // (avoid markdown re-render on every keystroke)
            body.textContent = text || "";
          }

          // Scroll to follow content in real-time
          requestAnimationFrame(() => {
            this.els.chatMessages.scrollTo({
              top: this.els.chatMessages.scrollHeight,
              behavior: "smooth",
            });
          });
        } catch (err) {
          console.warn("[IDE] Error in content_chunk handler:", err.message);
        }
      }),

      // ── Mode Switching ────────────────────────────────────────────────────
      events.on("mode_changed", (data) => {
        // Update button active states
        this.els.modeBtns.forEach(btn => {
          btn.classList.toggle("active", btn.dataset.mode === data.to);
        });
        // Update label
        if (this.els.currentModeLabel) {
          this.els.currentModeLabel.textContent = `${data.icon} ${data.name}`;
        }
        // Update internal state
        this._mode = { slug: data.to, icon: data.icon, name: data.name, color: data.color };
        // Add mode switch notification to chat
        this._addModeSwitchNotification(data);
        // Hide suggestion banner if visible
        this._hideModeSuggestion();
        // Hide follow-up question banner if visible
        this._hideFollowUpQuestion();
        this.addLogEntry("info", `🔄 Switched to ${data.icon} ${data.name} mode`);
        // Refresh model display (model may change per mode)
        this._updateStatus();
      }),

      events.on("mode_suggestion", (data) => {
        // Auto-approve based on source:
        //   mode_suggestion from mode detection → check autoApprove.mode
        //   mode_suggestion from agent delegation → check autoApprove.subtasks
        const autoApprove = this._getAutoApproveState();
        const isDelegation = data.source === "delegation";
        if ((!isDelegation && autoApprove.mode) || (isDelegation && autoApprove.subtasks)) {
          this.addLogEntry("info", `🤖 Auto-aprobado: cambio a ${data.icon} ${data.name}${isDelegation ? " (delegación)" : ""}`);
          window.lvzero["agent:accept_mode_suggestion"]?.().catch(err => {
            console.warn("Failed to auto-accept mode suggestion:", err);
          });
          return;
        }
        // Show banner at top of chat panel (existing path)
        this._showModeSuggestion(data);
        // ALSO inject inline approve/deny buttons inside the chat message stream
        // as a fallback — guarantees interactivity even if the banner's DOM element
        // is somehow not visible or not rendered.
        this._showModeSuggestionInline(data);
      }),

      // ── Follow-Up Question Events ──────────────────────────────────────────
      events.on("ask_question", (data) => {
        // Feature: auto-answer with first option if Question auto-approve is ON
        const autoApprove = this._getAutoApproveState();
        if (autoApprove.question && data.follow_up && data.follow_up.length > 0) {
          const firstOption = data.follow_up[0];
          const answer = typeof firstOption === "string" ? firstOption : firstOption.text;
          this.addLogEntry("info", `🤖 Auto-answered question (autoApprove.question=ON): "${answer}"`);
          this._sendFollowUpAnswer(answer);
          return;
        }
        this._showFollowUpQuestion(data);
      }),

      // ── 🚨 Crash Recovery (Batch 3 — Item #1) ─────────────────────────────
      events.onCrashDetected((data) => {
        this._showCrashRecovery(data);
      }),

      // ── ✅ Task Completion Banner (Batch 3 — Item #4) ─────────────────────
      events.on("task_complete", (data) => {
        this._showTaskBanner(data);
      }),

      // ── 🔑 Auth Required — Show onboarding when no API key is configured ──
      events.on("auth_required", (data) => {
        this.addLogEntry("warn", `🔑 ${data.message || "API key required — showing setup"}`);
        this._showAuthModal();
      }),
    ];

    // ── MCP Status Change (must be outside the array to avoid TDZ) ─────
    if (events.onMCPStatusChanged) {
      const unsubMCP = events.onMCPStatusChanged((status) => {
        this._renderMCPServerList(status.servers || []);
      });
      subs.push(unsubMCP);
    }

    // ── Tool Confirmation (Shell Execute Warning) ──────────────────────
    // When autoApprove.execute is OFF, main.cjs sends tool:requires_confirmation
    // for shell_executor commands. Show a banner so the user is aware.
    if (events.onToolRequiresConfirmation) {
      const unsubToolConfirm = events.onToolRequiresConfirmation((data) => {
        this._showToolConfirmation(data);
      });
      subs.push(unsubToolConfirm);
    }

    this.unsubscribers.push(...subs);

    // Initial state: stop button hidden, send button visible
    this.els.stopBtn?.classList.add("hidden");
    this.els.sendBtn?.classList.remove("hidden");

    // ── Reactive Events ───────────────────────────────────────────────────
    // File System changes → auto-refresh file tree + reload open tabs + auto-preview HTML
    if (events.onFsUpdate) {
      const unsubFs = events.onFsUpdate(({ type, path: changedPath }) => {
        this.addLogEntry("info", `📁 fs:update [${type}] ${changedPath}`);
        // If a file changed, check if it's open in the editor and reload it
        if (type === 'change' && changedPath) {
          this._reloadChangedFile(changedPath);
          // Auto-preview HTML files when they change (if preview is open)
          if (changedPath.toLowerCase().endsWith('.html')) {
            this._autoPreviewFile(changedPath);
          }
        }
        // Debounce file tree refresh (500ms)
        if (this._fsUpdateTimer) clearTimeout(this._fsUpdateTimer);
        this._fsUpdateTimer = setTimeout(() => {
          this._loadFileTree().catch(() => {});
        }, 500);
      });
      this.unsubscribers.push(unsubFs);
    }

    // Editor auto-open (Editor Reactivo)
    if (events.onEditorOpenFile) {
      const unsubEditor = events.onEditorOpenFile(({ filePath, action }) => {
        this.addLogEntry("info", `📄 Auto-opening: ${filePath} (${action})`);
        this.openFile(filePath);
      });
      this.unsubscribers.push(unsubEditor);
    }

    // Panel visibility toggles (View Menu)
    if (events.onPanelVisibility) {
      const unsubPanel = events.onPanelVisibility(({ panelId, visible }) => {
        this._togglePanel(panelId, visible);
      });
      this.unsubscribers.push(unsubPanel);
    }

    // Diff Review (Misión 2) — Control de Cambios
    if (events.onDiffReview) {
      const unsubDiff = events.onDiffReview(({ filePath, originalContent, newContent }) => {
        this.addLogEntry("info", `🔍 Diff review requested: ${filePath}`);
        this._showDiffEditor(filePath, originalContent, newContent);
      });
      this.unsubscribers.push(unsubDiff);
    }

    // ── Auto-Healing (Fase 4) ────────────────────────────────────────────
    // When a shell command fails, auto-inject a healing message to the agent
    if (events.onCommandError) {
      const unsubError = events.onCommandError(({ command, exitCode, stderr }) => {
        const errorText = (stderr || `Exit code ${exitCode}`).trim().substring(0, 500);
        this.addLogEntry("error", `🩺 Command failed: ${command} — ${errorText}`);

        // Only auto-heal if the system is not already busy processing
        if (this.busy) return;

        const healingMsg =
          `El último comando falló con este error: ${errorText}. ` +
          `Por favor, analízalo y arréglalo.`;

        // Small delay to let output settle, then auto-send the healing request
        setTimeout(() => {
          this.sendMessage(healingMsg).catch((err) => {
            console.warn("[Auto-Heal] Could not send healing message:", err.message);
          });
        }, 800);
      });
      this.unsubscribers.push(unsubError);
    }

    // ── Auth Guard (Fase 5) ──────────────────────────────────────────────
    // DISABLED: The event auth:requireKey is never sent by our code (confirmed by
    // full codebase search). It appears to come from node_modules or Electron runtime.
    // Auth checking is now handled by _checkApiKeys() called at init() time.
    // if (events.onAuthRequireKey) { ... }

    // ── Terminal Shell Changed Event ──────────────────────────────────────
    if (events.onTerminalShellChanged) {
      const unsubShell = events.onTerminalShellChanged(({ shell }) => {
        this.addLogEntry("info", `🔄 Terminal shell changed to ${shell}`);
        // Update selector UI
        if (this.els.terminalShellSelector) {
          this.els.terminalShellSelector.value = shell;
        }
      });
      this.unsubscribers.push(unsubShell);
    }

    // ── Project Management Events ──────────────────────────────────────
    if (events.onProjectChanged) {
      const unsubProj = events.onProjectChanged(({ name, path, action, workspaceState }) => {
        this.addLogEntry("info", `📁 Project ${action}: ${name || path || "(none)"}`);
        if (action === "closed") {
          this._project = { name: null, path: null, isOpen: false };
          this._showWelcomeScreen();
          this._updateExplorerHeader();
        } else if (name && path) {
          this._project = { name, path, isOpen: true };
          this._updateExplorerHeader();
          // Reload file tree at project path
          this._loadFileTree(path).catch((err) => {
            console.warn("[IDE] File tree reload:", err.message);
          });
          // Restore workspace state (tabs, active file, layout) if available
          if (workspaceState) {
            this._restoreWorkspaceState(workspaceState);
          } else {
            // Try to load workspace state from main process
            this._loadAndRestoreWorkspaceState(path);
          }
        }
      });
      this.unsubscribers.push(unsubProj);
    }

    if (events.onProjectMenuAction) {
      const unsubMenu = events.onProjectMenuAction(({ action }) => {
        switch (action) {
          case "new": this._newProject(); break;
          case "open": this._openProject(); break;
          case "close": this._closeProject(); break;
          case "duplicate": this._duplicateProject(); break;
          case "export": this._exportProject(); break;
        }
      });
      this.unsubscribers.push(unsubMenu);
    }

    // ── ⚖️ Iron Laws Violation (Phase 3) ─────────────────────────────────
    if (events.onIronLawViolation) {
      const unsubIronLaw = events.onIronLawViolation((violationData) => {
        this._showIronLawViolation(violationData);
      });
      this.unsubscribers.push(unsubIronLaw);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Settings (Auto-Approve)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Load settings from persistent store (with localStorage fallback),
   * apply to checkboxes, and sync to backend.
   */
  async _loadSettings() {
    try {
      // Try persistent settings store first
      let parsed = null;
      if (window.lvzero["settings:getAll"]) {
        try {
          const result = await window.lvzero["settings:getAll"]();
          if (result && result.success && result.settings) {
            parsed = result.settings;
          }
        } catch (_) {}
      }

      // Fallback to localStorage if persistent store not available
      if (!parsed) {
        const stored = localStorage.getItem("lvzero_settings");
        if (stored) {
          parsed = JSON.parse(stored);
        }
      }

      if (parsed) {
        if (typeof parsed.autoApproveEdits === "boolean") {
          this._settings.autoApproveEdits = parsed.autoApproveEdits;
        }
        if (typeof parsed.autoApproveTerminal === "boolean") {
          this._settings.autoApproveTerminal = parsed.autoApproveTerminal;
        }
        // Restore auto-approve toolbar state (Feature 1)
        if (parsed.autoApprove) {
          const aa = parsed.autoApprove;
          if (this.els.autoRead) this.els.autoRead.checked = aa.read ?? true;
          if (this.els.autoWrite) this.els.autoWrite.checked = aa.write ?? false;
          if (this.els.autoMode) this.els.autoMode.checked = aa.mode ?? true;
          if (this.els.autoExecute) this.els.autoExecute.checked = aa.execute ?? false;
          if (this.els.autoQuestion) this.els.autoQuestion.checked = aa.question ?? true;
          if (this.els.autoSubtasks) this.els.autoSubtasks.checked = aa.subtasks ?? true;
        }
        // Restore theme from settings store
        if (parsed.theme === "light" || parsed.theme === "dark") {
          this._theme = parsed.theme;
        }
      }
    } catch (err) {
      console.warn("[IDE] Failed to load settings:", err.message);
    }

    // Apply to checkboxes
    if (this.els.chkAutoApproveEdits) {
      this.els.chkAutoApproveEdits.checked = this._settings.autoApproveEdits;
    }
    if (this.els.chkAutoApproveTerminal) {
      this.els.chkAutoApproveTerminal.checked = this._settings.autoApproveTerminal;
    }

    // Sync to backend
    this._syncSettings();
  }

  /**
   * Save settings to persistent store (with localStorage fallback).
   */
  _saveSettings() {
    try {
      const autoApproveState = this._getAutoApproveState();
      const settings = {
        theme: this._theme,
        shellType: this._settings.shellType,
        autoApprove: autoApproveState,
        // Legacy keys for backward compatibility with backend
        autoApproveEdits: autoApproveState.write,
        autoApproveTerminal: autoApproveState.execute,
      };
      // Save to persistent store
      if (window.lvzero["settings:set"]) {
        window.lvzero["settings:set"]("lvzero_settings", settings).catch(() => {});
      }
      // Also save to localStorage as fallback
      localStorage.setItem("lvzero_settings", JSON.stringify(settings));
    } catch (err) {
      console.warn("[IDE] Failed to save settings:", err.message);
    }
  }

  /**
   * Sync current settings to the backend via IPC.
   */
  async _syncSettings() {
    try {
      if (window.lvzero["config:setAutoApprove"]) {
        await window.lvzero["config:setAutoApprove"](this._settings);
      }
    } catch (err) {
      console.warn("[IDE] Failed to sync settings to backend:", err.message);
    }
  }

  /**
   * Get current auto-approve state from toolbar checkboxes.
   */
  _getAutoApproveState() {
    return {
      read: this.els.autoRead?.checked ?? true,
      write: this.els.autoWrite?.checked ?? false,
      mode: this.els.autoMode?.checked ?? true,
      execute: this.els.autoExecute?.checked ?? false,
      question: this.els.autoQuestion?.checked ?? true,
      subtasks: this.els.autoSubtasks?.checked ?? true
    };
  }

  /**
   * Save auto-approve state on checkbox change (Feature 1).
   */
  _saveAutoApprove() {
    const state = this._getAutoApproveState();
    this._settings.autoApprove = state;
    // Sync legacy keys for backend compatibility
    this._settings.autoApproveEdits = state.write;
    this._settings.autoApproveTerminal = state.execute;
    this._saveSettings();
    this._syncSettings();
    this.addLogEntry("info", `⚙️ Auto-approve saved: read=${state.read}, write=${state.write}, mode=${state.mode}, execute=${state.execute}, question=${state.question}, subtasks=${state.subtasks}`);
  }

  /**
   * Update queue badge visibility and count (Feature 3).
   */
  _updateQueueBadge() {
    if (!this.els.queueBadge) return;
    const count = this._messageQueue.length;
    if (count > 0) {
      this.els.queueBadge.textContent = count;
      this.els.queueBadge.classList.remove("hidden");
    } else {
      this.els.queueBadge.classList.add("hidden");
    }
  }

  /**
   * Bind settings UI events: toggle modal, toggle checkboxes, close overlay.
   */
  _bindSettingsUI() {
    // ── Toggle settings modal via gear button ──
    if (this.els.chatSettingsBtn && this.els.settingsOverlay) {
      this.els.chatSettingsBtn.addEventListener("click", () => {
        const isHidden = this.els.settingsOverlay.classList.contains("hidden");
        this.els.settingsOverlay.classList.toggle("hidden");
        // Load API keys and providers when settings modal opens
        if (!isHidden) {
          this._loadApiKeys();
          this._loadProviders();
        }
      });
    }

    // ── 🌐 Language Selector ──
    const btnLangEn = document.getElementById("btn-lang-en");
    const btnLangEs = document.getElementById("btn-lang-es");

    if (btnLangEn) {
      btnLangEn.addEventListener("click", async () => {
        btnLangEn.classList.add("active");
        btnLangEs?.classList.remove("active");
        localStorage.setItem("lv-zero-language", "en");
        this._applyLanguage("en");
        this.addLogEntry("info", "🌐 Language switched to English");
      });
    }

    if (btnLangEs) {
      btnLangEs.addEventListener("click", async () => {
        btnLangEs.classList.add("active");
        btnLangEn?.classList.remove("active");
        localStorage.setItem("lv-zero-language", "es");
        this._applyLanguage("es");
        this.addLogEntry("info", "🌐 Idioma cambiado a Español");
      });
    }

    // Load saved language preference
    const savedLang = localStorage.getItem("lv-zero-language") || "en";
    if (savedLang === "es") {
      btnLangEn?.classList.remove("active");
      btnLangEs?.classList.add("active");
    }

    // ── Close modal via âœ• button ──
    if (this.els.settingsClose && this.els.settingsOverlay) {
      this.els.settingsClose.addEventListener("click", () => {
        this.els.settingsOverlay.classList.add("hidden");
      });
    }

    // ── Close modal by clicking overlay background ──
    if (this.els.settingsOverlay) {
      this.els.settingsOverlay.addEventListener("click", (e) => {
        if (e.target === this.els.settingsOverlay) {
          this.els.settingsOverlay.classList.add("hidden");
        }
      });
    }

    // ── Auto-Approve Edits toggle ──
    if (this.els.chkAutoApproveEdits) {
      this.els.chkAutoApproveEdits.addEventListener("change", (e) => {
        this._settings.autoApproveEdits = e.target.checked;
        this._saveSettings();
        this._syncSettings();
        this.addLogEntry("info", `⚙️ Auto-approve edits: ${e.target.checked ? "ON" : "OFF"}`);
      });
    }

    // ── Auto-Approve Terminal toggle ──
    if (this.els.chkAutoApproveTerminal) {
      this.els.chkAutoApproveTerminal.addEventListener("change", (e) => {
        this._settings.autoApproveTerminal = e.target.checked;
        this._saveSettings();
        this._syncSettings();
        this.addLogEntry("info", `⚙️ Auto-approve terminal: ${e.target.checked ? "ON" : "OFF"}`);
      });
    }

    // ── API Key Management (Phase 0.1) ──
    if (this.els.apiKeyAddBtn && this.els.apiKeyInput && this.els.apiKeyServiceSelect) {
      this.els.apiKeyAddBtn.addEventListener("click", () => this._handleAddApiKey());
      this.els.apiKeyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._handleAddApiKey();
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API KEY MANAGEMENT (Phase 0.1)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Known services for API key management.
   */
  _getKnownServices() {
    return [
      { id: "deepseek", name: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
      { id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY" },
      { id: "anthropic", name: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
      { id: "gemini", name: "Gemini", envVar: "GEMINI_API_KEY" },
    ];
  }

  /**
   * Load all stored API keys and render the list.
   */
  async _loadApiKeys() {
    const listEl = this.els.apiKeyList;
    if (!listEl) return;

    // Check if secrets IPC is available
    if (!window.lvzero["secrets:list"]) {
      listEl.innerHTML = '<div class="api-key-empty">Secret storage not available</div>';
      return;
    }

    listEl.innerHTML = '<div class="api-key-loading">Loading keys...</div>';

    try {
      // Get stored services
      const listResult = await window.lvzero["secrets:list"]();
      const storedServices = (listResult.success && listResult.services) || [];

      // Build a set for quick lookup
      const storedSet = new Set(storedServices.map((s) => s.toLowerCase()));

      // Render known services with their status
      const knownServices = this._getKnownServices();
      let html = "";

      for (const svc of knownServices) {
        const isConfigured = storedSet.has(svc.id);
        html += `
          <div class="api-key-item ${isConfigured ? "configured" : "missing"}" data-service="${this._escapeHtml(svc.id)}">
            <span class="api-key-item-service">${this._escapeHtml(svc.name)}</span>
            <span class="api-key-item-status ${isConfigured ? "configured" : "missing"}">
              ${isConfigured ? "✅ Configured" : "❌ Missing"}
            </span>
            ${isConfigured
              ? `<button class="api-key-item-delete" data-service="${this._escapeHtml(svc.id)}" title="Delete key">🗑</button>`
              : ""}
          </div>
        `;
      }

      // Also show any custom services not in the known list
      for (const svc of storedServices) {
        const lower = svc.toLowerCase();
        if (!knownServices.some((k) => k.id === lower)) {
          html += `
            <div class="api-key-item configured" data-service="${this._escapeHtml(svc)}">
              <span class="api-key-item-service">${this._escapeHtml(svc)}</span>
              <span class="api-key-item-status configured">✅ Configured</span>
              <button class="api-key-item-delete" data-service="${this._escapeHtml(svc)}" title="Delete key">🗑</button>
            </div>
          `;
        }
      }

      if (!html) {
        html = '<div class="api-key-empty">No API keys stored. Add one below.</div>';
      }

      listEl.innerHTML = html;

      // Bind delete buttons
      listEl.querySelectorAll(".api-key-item-delete").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const service = btn.dataset.service;
          await this._handleDeleteApiKey(service);
        });
      });
    } catch (err) {
      console.error("[IDE] Error loading API keys:", err);
      listEl.innerHTML = `<div class="api-key-empty">Error loading keys: ${this._escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Handle adding a new API key.
   */
  async _handleAddApiKey() {
    const serviceSelect = this.els.apiKeyServiceSelect;
    const input = this.els.apiKeyInput;
    const statusEl = this.els.apiKeyStatus;
    const addBtn = this.els.apiKeyAddBtn;

    if (!serviceSelect || !input || !statusEl || !addBtn) return;

    let service = serviceSelect.value;
    const key = input.value.trim();

    if (!key) {
      statusEl.textContent = "⚠️ Please enter an API key";
      statusEl.className = "api-key-status error";
      return;
    }

    // If "custom" is selected, prompt for service name
    if (service === "custom") {
      const customService = prompt("Enter service name (e.g., 'cohere', 'huggingface'):");
      if (!customService || !customService.trim()) {
        statusEl.textContent = "⚠️ Service name is required for custom keys";
        statusEl.className = "api-key-status error";
        return;
      }
      service = customService.trim().toLowerCase();
    }

    // Disable button while saving
    addBtn.disabled = true;
    addBtn.textContent = "⏳ Saving...";
    statusEl.textContent = "";
    statusEl.className = "api-key-status";

    try {
      if (!window.lvzero["secrets:saveKey"]) {
        statusEl.textContent = "❌ Secret storage not available";
        statusEl.className = "api-key-status error";
        addBtn.disabled = false;
        addBtn.textContent = "➕ Add";
        return;
      }

      const result = await window.lvzero["secrets:saveKey"](service, key);

      if (result.success) {
        statusEl.textContent = `✅ Key saved for ${service}`;
        statusEl.className = "api-key-status success";
        input.value = ""; // Clear input
        // Reload the list
        await this._loadApiKeys();
      } else {
        statusEl.textContent = `❌ ${result.error || "Failed to save key"}`;
        statusEl.className = "api-key-status error";
      }
    } catch (err) {
      statusEl.textContent = `❌ Error: ${err.message}`;
      statusEl.className = "api-key-status error";
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = "➕ Add";
    }
  }

  /**
   * Handle deleting an API key.
   * @param {string} service - Service name to delete
   */
  async _handleDeleteApiKey(service) {
    if (!service) return;

    const statusEl = this.els.apiKeyStatus;
    if (!statusEl) return;

    if (!confirm(`Delete the stored API key for "${service}"?`)) return;

    statusEl.textContent = "";
    statusEl.className = "api-key-status";

    try {
      if (!window.lvzero["secrets:deleteKey"]) {
        statusEl.textContent = "❌ Secret storage not available";
        statusEl.className = "api-key-status error";
        return;
      }

      const result = await window.lvzero["secrets:deleteKey"](service);

      if (result.success) {
        statusEl.textContent = `🗑️ Key deleted for ${service}`;
        statusEl.className = "api-key-status success";
        await this._loadApiKeys();
      } else {
        statusEl.textContent = `❌ ${result.error || "Failed to delete key"}`;
        statusEl.className = "api-key-status error";
      }
    } catch (err) {
      statusEl.textContent = `❌ Error: ${err.message}`;
      statusEl.className = "api-key-status error";
    }
  }

  // ── 🔌 Provider Configuration ──────────────────────────────────────────

  /**
   * Loads the provider list from the backend and renders it.
   */
  async _loadProviders() {
    const listEl = this.els.providerList;
    if (!listEl) return;

    if (!window.lvzero["providers:list"]) {
      listEl.innerHTML = '<div class="provider-loading">Provider config not available</div>';
      return;
    }

    listEl.innerHTML = '<div class="provider-loading">Loading providers...</div>';

    try {
      const providers = await window.lvzero["providers:list"]();
      if (!providers || providers.length === 0) {
        listEl.innerHTML = '<div class="provider-loading">No providers found</div>';
        return;
      }

      let html = "";
      for (const p of providers) {
        const statusClass = p.configured ? "configured" : "unconfigured";
        const statusText = p.configured ? "✅ Configurado" : "❌ Sin key";
        const modelsText = p.models.length > 0
          ? p.models.slice(0, 5).join(", ") + (p.models.length > 5 ? "..." : "")
          : "Modelo personalizado";

        html += `
          <div class="provider-item ${p.configured ? "configured" : ""}" data-provider="${this._escapeHtml(p.id)}">
            <div class="provider-header">
              <span class="provider-name">${this._escapeHtml(p.name)}</span>
              <span class="provider-status ${statusClass}">${statusText}</span>
            </div>
            <div class="provider-models">${this._escapeHtml(modelsText)}</div>
            <div class="provider-actions">
              <input type="password" class="provider-key-input" placeholder="${p.configured ? "••••••••" : "Pega tu API Key aquí..."}" data-provider="${this._escapeHtml(p.id)}" />
              <button class="provider-btn primary" data-action="verify" data-provider="${this._escapeHtml(p.id)}">Verificar</button>
              <button class="provider-btn" data-action="save" data-provider="${this._escapeHtml(p.id)}">Guardar</button>
              ${p.website ? `<a href="${this._escapeHtml(p.website)}" target="_blank" class="provider-link">🔑 Obtener key</a>` : ""}
            </div>
            ${p.notes ? `<div class="provider-notes">${this._escapeHtml(p.notes)}</div>` : ""}
          </div>
        `;
      }

      listEl.innerHTML = html;

      // Bind verify buttons
      listEl.querySelectorAll('[data-action="verify"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const providerId = btn.dataset.provider;
          const input = listEl.querySelector(`.provider-key-input[data-provider="${providerId}"]`);
          const apiKey = input?.value?.trim() || "";
          const item = listEl.querySelector(`.provider-item[data-provider="${providerId}"]`);
          const statusEl = item?.querySelector(".provider-status");

          if (!apiKey) {
            if (statusEl) {
              statusEl.textContent = "⚠️ Ingresa una key";
              statusEl.className = "provider-status error";
            }
            return;
          }

          if (statusEl) {
            statusEl.textContent = "⏳ Verificando...";
            statusEl.className = "provider-status verifying";
          }

          try {
            const result = await window.lvzero["providers:verify"](providerId, apiKey);
            if (result.success) {
              if (statusEl) {
                statusEl.textContent = "✅ Conectado";
                statusEl.className = "provider-status configured";
              }
              this.addLogEntry("success", `🔌 ${result.message}`);
            } else {
              if (statusEl) {
                statusEl.textContent = `❌ ${result.error}`;
                statusEl.className = "provider-status error";
              }
            }
          } catch (err) {
            if (statusEl) {
              statusEl.textContent = `❌ Error: ${err.message}`;
              statusEl.className = "provider-status error";
            }
          }
        });
      });

      // Bind save buttons
      listEl.querySelectorAll('[data-action="save"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const providerId = btn.dataset.provider;
          const input = listEl.querySelector(`.provider-key-input[data-provider="${providerId}"]`);
          const apiKey = input?.value?.trim() || "";
          const item = listEl.querySelector(`.provider-item[data-provider="${providerId}"]`);
          const statusEl = item?.querySelector(".provider-status");

          if (!apiKey) {
            if (statusEl) {
              statusEl.textContent = "⚠️ Ingresa una key";
              statusEl.className = "provider-status error";
            }
            return;
          }

          try {
            const result = await window.lvzero["providers:saveKey"](providerId, apiKey);
            if (result.success) {
              if (statusEl) {
                statusEl.textContent = "✅ Guardado";
                statusEl.className = "provider-status configured";
              }
              if (item) item.classList.add("configured");
              input.value = "";
              input.placeholder = "••••••••";
              this.addLogEntry("success", `🔌 ${result.message}`);
            } else {
              if (statusEl) {
                statusEl.textContent = `❌ ${result.error}`;
                statusEl.className = "provider-status error";
              }
            }
          } catch (err) {
            if (statusEl) {
              statusEl.textContent = `❌ Error: ${err.message}`;
              statusEl.className = "provider-status error";
            }
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="provider-loading">Error: ${this._escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Bind project wizard UI events (Phase 9).
   * Close button, prev/next navigation, overlay click-to-dismiss.
   */
  _bindWizardUI() {
    // ── Close via ✕ button ──
    if (this.els.wizardClose && this.els.wizardOverlay) {
      this.els.wizardClose.addEventListener("click", () => {
        this._hideNewProjectWizard(true);
      });
    }

    // ── Close by clicking overlay background ──
    if (this.els.wizardOverlay) {
      this.els.wizardOverlay.addEventListener("click", (e) => {
        if (e.target === this.els.wizardOverlay) {
          this._hideNewProjectWizard(true);
        }
      });
    }

    // ── Previous step ──
    if (this.els.wizardBtnPrev) {
      this.els.wizardBtnPrev.addEventListener("click", () => {
        this._prevWizardStep();
      });
    }

    // ── Next step / Create ──
    if (this.els.wizardBtnNext) {
      this.els.wizardBtnNext.addEventListener("click", () => {
        this._nextWizardStep();
      });
    }

    // ── Keyboard: Escape dismisses, Enter advances ──
    document.addEventListener("keydown", (e) => {
      if (!this._wizardState || !this._wizardState.visible) return;
      if (e.key === "Escape") {
        this._hideNewProjectWizard(true);
      } else if (e.key === "Enter" && this._wizardState.step < 4) {
        this._nextWizardStep();
      }
    });

    // ── Diagnose Wizard (Phase 10) ──────────────────────────────────────────

    // Close via ✕ button
    if (this.els.diagnoseClose && this.els.diagnoseOverlay) {
      this.els.diagnoseClose.addEventListener("click", () => {
        this._hideDiagnoseWizard(true);
      });
    }

    // Close by clicking overlay background
    if (this.els.diagnoseOverlay) {
      this.els.diagnoseOverlay.addEventListener("click", (e) => {
        if (e.target === this.els.diagnoseOverlay) {
          this._hideDiagnoseWizard(true);
        }
      });
    }

    // Previous step
    if (this.els.diagnoseBtnPrev) {
      this.els.diagnoseBtnPrev.addEventListener("click", () => {
        this._prevDiagnoseStep();
      });
    }

    // Next step / Complete
    if (this.els.diagnoseBtnNext) {
      this.els.diagnoseBtnNext.addEventListener("click", () => {
        const btn = this.els.diagnoseBtnNext;
        const isComplete = btn.textContent.includes("Complete");
        if (isComplete) {
          this._finishDiagnoseSession();
        } else {
          this._nextDiagnoseStep();
        }
      });
    }

    // Keyboard: Escape dismisses
    document.addEventListener("keydown", (e) => {
      if (!this._diagnoseState || !this._diagnoseState.visible) return;
      if (e.key === "Escape") {
        this._hideDiagnoseWizard(true);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PANEL TOGGLE (View Menu)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Toggle panel visibility. Works with Split.js sizes.
   */
  _togglePanel(panelId, visible) {
    const panelMap = {
      explorer: { el: document.getElementById("panel-explorer"), split: this.splitHoriz, index: 0 },
      chat:      { el: document.getElementById("panel-chat"),      split: this.splitHoriz, index: 2 },
      terminal:  { el: document.getElementById("terminal-container"), split: null,          index: -1 },
      inspector: { el: document.getElementById("inspector-panel"),  split: null,          index: -1 },
    };

    const panel = panelMap[panelId];
    if (!panel || !panel.el) return;

    if (panelId === "explorer" || panelId === "chat") {
      // Horizontal split panels: use Split.js setSizes
      const sizes = panel.split.getSizes();
      const total = sizes[0] + sizes[1] + sizes[2];
      if (visible) {
        // Restore: redistribute sizes proportionally
        if (panelId === "explorer") {
          panel.split.setSizes([18, total * 0.52 / 0.82, total * 0.30 / 0.82]);
        } else {
          panel.split.setSizes([total * 0.18 / 0.70, total * 0.52 / 0.70, 30]);
        }
      } else {
        // Hide: set size to 0
        sizes[panel.index] = 0;
        panel.split.setSizes(sizes);
      }
      panel.el.style.display = visible ? "" : "none";
      setTimeout(() => this.editor?.layout(), 100);
    } else if (panelId === "terminal") {
      // Terminal: use Split.js vertical
      if (visible) {
        this.splitVert.setSizes([70, 30]);
      } else {
        this.splitVert.setSizes([100, 0]);
      }
      panel.el.style.display = visible ? "" : "none";
      setTimeout(() => {
        this.editor?.layout();
        this._fitTerminal();
      }, 100);
    } else if (panelId === "inspector") {
      panel.el.style.display = visible ? "" : "none";
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI EVENT BINDINGS
  // ═══════════════════════════════════════════════════════════════════════════

  _bindViewMenu() {
    const btn = document.getElementById("btn-view-menu");
    const dropdown = document.getElementById("view-dropdown");
    if (!btn || !dropdown) return;

    // Toggle dropdown
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("hidden");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
      dropdown.classList.add("hidden");
    });

    // Handle panel toggle clicks
    dropdown.querySelectorAll(".view-dropdown-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const panelId = item.dataset.panel;
        const check = item.querySelector(".view-check");
        const isVisible = check.textContent === "✓";

        if (isVisible) {
          check.textContent = "";
        } else {
          check.textContent = "✓";
        }

        // Send toggle via IPC (which will send panel:visibility event back)
        window.lvzero["panel:toggle"](panelId);
        // Also trigger locally
        this._togglePanel(panelId, !isVisible);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE PREVIEW (Fase 4)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Toggle the Live Preview panel (70/30 split with Monaco editor).
   * Shows an iframe to the right of the editor for live web preview.
   */
  _togglePreview() {
    this._previewVisible = !this._previewVisible;

    // Toggle panel visibility
    this.els.previewPanel.classList.toggle("hidden", !this._previewVisible);
    this.els.editorMainArea.classList.toggle("has-preview", this._previewVisible);

    if (this._previewVisible) {
      // Load the URL from the address bar into the iframe
      const url = this.els.previewUrl.value.trim();
      this.els.previewIframe.src = url || "about:blank";
      this.els.btnPreview.textContent = "📝 Editor";
      this.addLogEntry("info", `🌐 Preview opened: ${url || "about:blank"}`);
    } else {
      this.els.btnPreview.textContent = "🌐 Preview";
      this.addLogEntry("info", "📝 Preview closed — returning to full editor");
    }

    // Re-layout Monaco editor after split change
    setTimeout(() => this.editor?.layout(), 100);
  }

  /**
   * Auto-preview an HTML file in the preview panel.
   * Reads the file, generates a blob URL, and loads it in the preview iframe.
   * Falls back to opening the file in the editor if preview is not available.
   *
   * @param {string} filePath - Path to the HTML file to preview
   */
  async _autoPreviewFile(filePath) {
    if (!filePath || !filePath.toLowerCase().endsWith('.html')) return;

    try {
      const result = await window.lvzero["file:read"](filePath);
      if (!result || !result.success) return;

      // Revoke previous blob URL to avoid memory leaks
      if (this._previewBlobUrl) {
        URL.revokeObjectURL(this._previewBlobUrl);
      }

      // Create a blob URL from the HTML content
      const blob = new Blob([result.content], { type: 'text/html' });
      this._previewBlobUrl = URL.createObjectURL(blob);

      // Show preview panel
      if (!this._previewVisible) {
        this._togglePreview();
      }

      // Load the blob URL into the iframe
      this.els.previewIframe.src = this._previewBlobUrl;
      this.els.previewUrl.value = filePath; // Show file path instead of URL
      this.addLogEntry("info", `👁️ Auto-preview: ${filePath}`);
    } catch (err) {
      this.addLogEntry("error", `⚠️ Auto-preview failed: ${err.message}`);
    }
  }

  /**
   * Navigate the preview iframe to the URL currently in the address bar.
   */
  _previewNavigate() {
    if (!this._previewVisible) return;
    const url = this.els.previewUrl.value.trim();
    if (!url) return;
    this.els.previewIframe.src = url;
    this.addLogEntry("info", `🌐 Preview navigated to: ${url}`);
  }

  /**
   * Start the dev server for Live Preview.
   * Uses preview_server.js to auto-detect framework and spawn server.
   */
  async _previewStartServer() {
    try {
      this.addLogEntry("info", "🌐 Iniciando servidor de preview...");
      const result = await window.lvzero["preview:start"]();
      if (result.success) {
        this.els.previewUrl.value = result.url;
        this.els.previewFramework.textContent = `📦 ${result.framework}`;
        this.addLogEntry("success", `🌐 Preview server: ${result.url} (${result.framework})`);
        // Auto-open preview
        if (!this._previewVisible) {
          this._togglePreview();
        }
        this.els.previewIframe.src = result.url;
      } else {
        this.addLogEntry("error", `⚠️ Preview server error: ${result.error}`);
      }
    } catch (err) {
      this.addLogEntry("error", `⚠️ Preview server error: ${err.message}`);
    }
  }

  /**
   * Stop the dev server.
   */
  async _previewStopServer() {
    try {
      await window.lvzero["preview:stop"]();
      this.els.previewFramework.textContent = "";
      this.addLogEntry("info", "🌐 Preview server stopped");
    } catch (err) {
      this.addLogEntry("error", `⚠️ Error stopping preview: ${err.message}`);
    }
  }

  /**
   * Publish the current project to Cloudflare Pages (1-click).
   */
  async _publishToCloudflare() {
    try {
      this.addLogEntry("info", "🚀 Publicando en Cloudflare Pages...");

      // First check if Cloudflare is configured
      const setupResult = await window.lvzero["publish:setup"]();
      if (setupResult.needsSetup) {
        this.addLogEntry("warn", "⚠️ Cloudflare no configurado. Sigue estos pasos:");
        for (const step of setupResult.steps || []) {
          this.addLogEntry("info", `  ${step}`);
        }
        return;
      }

      const result = await window.lvzero["publish:deploy"]();
      if (result.success) {
        this.addLogEntry("success", `✅ ${result.message || "¡Publicado!"}`);
        if (result.url) {
          this.addLogEntry("info", `🌐 URL: ${result.url}`);
          // Open in preview
          this.els.previewUrl.value = result.url;
          if (!this._previewVisible) {
            this._togglePreview();
          }
          this.els.previewIframe.src = result.url;
        }
      } else {
        this.addLogEntry("error", `❌ Error al publicar: ${result.error}`);
        if (result.suggestion) {
          this.addLogEntry("info", `💡 Sugerencia: ${result.suggestion}`);
        }
        if (result.needsSetup) {
          this.addLogEntry("warn", "⚠️ Cloudflare no configurado. Usa el comando 'setup' primero.");
        }
      }
    } catch (err) {
      this.addLogEntry("error", `❌ Error al publicar: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🐝 SWARM AGENTS PANEL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Called when the swarm starts — shows the panel with task list.
   */
  _onSwarmStart(data) {
    this._swarmState.active = true;
    this._swarmState.tasks = (data.tasks || []).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description || '',
      progress: 0,
      status: 'queued',
      detail: '⏳ En cola...',
      elapsed: 0,
      dependsOn: t.dependsOn || [],
    }));
    this._swarmState.totalCount = data.tasks?.length || 0;
    this._swarmState.completedCount = 0;

    // Show panel
    if (this.els.swarmPanel) {
      this.els.swarmPanel.classList.remove('hidden');
    }
    this._renderSwarmPanel();
  }

  /**
   * Called when a task reports progress.
   */
  _onSwarmTaskProgress(data) {
    const task = this._swarmState.tasks.find(t => t.id === data.taskId);
    if (task) {
      task.progress = data.progress || 0;
      task.status = data.status || 'running';
      task.detail = data.detail || task.detail;
      this._renderSwarmTasks();
    }
  }

  /**
   * Called when a task completes successfully.
   */
  _onSwarmTaskComplete(data) {
    const task = this._swarmState.tasks.find(t => t.id === data.taskId);
    if (task) {
      task.progress = 100;
      task.status = 'completed';
      task.detail = '✅ Completado';
      this._swarmState.completedCount++;
      this._renderSwarmTasks();
    }
    const duration = data.duration ? ` (${(data.duration / 1000).toFixed(1)}s)` : '';
    this.addLogEntry('success', `🐝 ${data.name} completado${duration}`);
  }

  /**
   * Called when a task fails.
   */
  _onSwarmTaskError(data) {
    const task = this._swarmState.tasks.find(t => t.id === data.taskId);
    if (task) {
      task.status = 'failed';
      task.detail = `❌ ${data.error || 'Error desconocido'}`;
      this._renderSwarmTasks();
    }
    this.addLogEntry('error', `❌ ${data.name}: ${data.error}`);
  }

  /**
   * Called when all swarm tasks are done.
   */
  _onSwarmComplete(data) {
    const success = data.failedTasks === 0;
    const msg = success
      ? `🐝 Swarm completado: ${data.completedTasks}/${data.totalTasks} tareas exitosas`
      : `🐝 Swarm completado: ${data.completedTasks} exitosas, ${data.failedTasks} fallidas`;

    this.addLogEntry(success ? 'success' : 'warn', msg);

    // Show summary in panel for 5 seconds, then hide
    if (this.els.swarmTasks) {
      const summaryClass = success ? 'success' : 'error';
      this.els.swarmTasks.innerHTML = `
        <div class="swarm-summary ${summaryClass}">
          ${success ? '✅' : '⚠️'} ${msg}
        </div>
      `;
    }

    setTimeout(() => {
      if (this.els.swarmPanel) {
        this.els.swarmPanel.classList.add('hidden');
      }
      this._swarmState.active = false;
    }, 5000);
  }

  /**
   * Renders the full swarm panel (header + tasks).
   */
  _renderSwarmPanel() {
    if (this.els.swarmCount) {
      this.els.swarmCount.textContent = this._swarmState.tasks.length;
    }
    this._renderSwarmTasks();
  }

  /**
   * Renders the task list inside the swarm panel.
   */
  _renderSwarmTasks() {
    if (!this.els.swarmTasks) return;

    const activeTasks = this._swarmState.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
    const completedTasks = this._swarmState.tasks.filter(t => t.status === 'completed' || t.status === 'failed');

    // Update count
    if (this.els.swarmCount) {
      this.els.swarmCount.textContent = activeTasks.length;
    }

    // Render active tasks first, then completed
    const allTasks = [...activeTasks, ...completedTasks];

    this.els.swarmTasks.innerHTML = allTasks.map(task => {
      const statusClass = task.status === 'completed' ? 'completed' :
                          task.status === 'failed' ? 'failed' :
                          task.status === 'running' ? 'running' : 'queued';
      const progressStyle = `width: ${Math.max(task.progress || 0, 2)}%`;

      return `
        <div class="swarm-task" data-task-id="${task.id}">
          <div class="swarm-task-header">
            <span class="swarm-task-name">${this._escapeHtml(task.name)}</span>
            <span class="swarm-task-status ${statusClass}">${task.status}</span>
          </div>
          <div class="swarm-progress-bar">
            <div class="swarm-progress-fill ${statusClass}" style="${progressStyle}"></div>
          </div>
          <div class="swarm-task-detail">${this._escapeHtml(task.detail || '')}</div>
          <div class="swarm-task-footer">
            <span class="swarm-task-time">⏱️ ${this._formatElapsed(task.elapsed || 0)}</span>
            ${task.status === 'running' ? `<button class="swarm-cancel-btn" data-task-id="${task.id}">⏹ Cancelar</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Bind cancel buttons
    this.els.swarmTasks.querySelectorAll('.swarm-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const taskId = btn.dataset.taskId;
        if (window.lvzero['swarm:cancelTask']) {
          window.lvzero['swarm:cancelTask'](taskId);
        }
      });
    });
  }

  /**
   * Simple HTML escaping.
   */
  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  /**
   * Formats elapsed milliseconds to a readable string.
   */
  _formatElapsed(ms) {
    if (!ms || ms < 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 AGENT BROWSER PANEL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Show the browser panel and focus the URL input.
   * If a session is active, just shows the panel; otherwise opens a new session.
   */
  async _showBrowserPanel() {
    if (!this.els.browserPanel) return;
    this._browserVisible = true;
    this.els.browserPanel.classList.remove("hidden");
    this.els.editorMainArea.classList.add("has-preview");
    this.els.browserUrl?.focus();
    this.els.browserUrl?.select();
    this.addLogEntry("info", "🌐 Browser panel opened");
    setTimeout(() => this.editor?.layout(), 100);
  }

  /**
   * Hide the browser panel.
   */
  _hideBrowserPanel() {
    if (!this.els.browserPanel) return;
    this._browserVisible = false;
    this.els.browserPanel.classList.add("hidden");
    this.els.editorMainArea.classList.remove("has-preview");
    this.addLogEntry("info", "🌐 Browser panel closed");
    setTimeout(() => this.editor?.layout(), 100);
  }

  /**
   * Navigate the browser panel webview to a URL.
   * Also opens a hidden headless browser session via IPC for automation.
   */
  async _browserNavigate(url) {
    if (!this.els.browserWebview) return;
    const targetUrl = url || this.els.browserUrl?.value.trim() || "about:blank";
    try {
      // Navigate the visible webview
      this.els.browserWebview.src = targetUrl;
      this.els.browserUrl.value = targetUrl;
      this.addLogEntry("info", `🌐 Browser navigating to: ${targetUrl}`);
      // Also open/update headless session for automation
      if (!this._browserSessionId) {
        const result = await window.lvzero["browser:open"](targetUrl, { visible: false });
        if (result && result.success) {
          this._browserSessionId = result.sessionId;
        }
      } else {
        await window.lvzero["browser:navigate"](this._browserSessionId, targetUrl);
      }
    } catch (err) {
      this.addLogEntry("error", `🌐 Browser navigate error: ${err.message}`);
    }
  }

  /**
   * Run a pre-built test command on the current browser page.
   * @param {string} commandName - e.g. "check-links", "check-images", "check-forms", etc.
   */
  async _browserRunTest(commandName) {
    if (!this._browserSessionId) {
      this.addLogEntry("warn", "⚠️ No active browser session — open a page first");
      return;
    }
    try {
      const result = await window.lvzero["browser:run-test"](this._browserSessionId, commandName);
      if (result && result.success) {
        this.addLogEntry("info", `📋 Test "${commandName}" completed:`);
        const lines = (result.output || "").split("\n");
        lines.forEach(line => {
          if (line.trim()) this.addLogEntry("info", `  ${line}`);
        });
      } else {
        this.addLogEntry("error", `❌ Test "${commandName}" failed: ${result?.error || "unknown"}`);
      }
    } catch (err) {
      this.addLogEntry("error", `❌ Test error: ${err.message}`);
    }
  }

  /**
   * Open the browser panel and prompt for a URL to navigate to.
   */
  _triggerBrowserOpen() {
    this._showBrowserPanel();
    // Focus the URL bar and select any existing text
    if (this.els.browserUrl) {
      this.els.browserUrl.focus();
      this.els.browserUrl.select();
    }
  }

  /**
   * Navigate back in the webview.
   */
  async _browserBack() {
    try {
      if (this.els.browserWebview?.canGoBack()) {
        this.els.browserWebview.goBack();
      }
    } catch (err) {
      this.addLogEntry("error", `🌐 Browser back error: ${err.message}`);
    }
  }

  /**
   * Navigate forward in the webview.
   */
  async _browserForward() {
    try {
      if (this.els.browserWebview?.canGoForward()) {
        this.els.browserWebview.goForward();
      }
    } catch (err) {
      this.addLogEntry("error", `🌐 Browser forward error: ${err.message}`);
    }
  }

  /**
   * Reload the current page in the webview.
   */
  async _browserReload() {
    try {
      this.els.browserWebview?.reload();
      this.addLogEntry("info", "🌐 Browser reloaded");
    } catch (err) {
      this.addLogEntry("error", `🌐 Browser reload error: ${err.message}`);
    }
  }

  /**
   * Close the browser panel and cleanup the session.
   */
  async _closeBrowserPanel() {
    this._hideBrowserPanel();
    if (this._browserSessionId) {
      try {
        await window.lvzero["browser:close"](this._browserSessionId);
      } catch (err) {
        // Silently ignore — session may already be closed
      }
      this._browserSessionId = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH GUARD (Fase 5)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if any API key is configured by asking the main process.
   * Shows the auth modal only if NO keys are found.
   * Uses secrets:list (available in main.cjs — the actual entry point).
   */
  async _checkApiKeys() {
    try {
      let hasKey = false;

      // 1. Check SecretStorage (encrypted DB) for saved keys
      if (window.lvzero["secrets:list"]) {
        const result = await window.lvzero["secrets:list"]();
        if (result && result.success && result.services && result.services.length > 0) {
          hasKey = true;
        }
      }

      // 2. Also check providers:list which reads process.env (covers .env file keys)
      if (!hasKey && window.lvzero["providers:list"]) {
        const providers = await window.lvzero["providers:list"]();
        if (providers && providers.length > 0) {
          hasKey = providers.some((p) => p.configured);
        }
      }

      if (!hasKey) {
        this.addLogEntry("info", "🔑 No API keys configured — showing setup");
        this._showAuthModal();
      } else {
        this.addLogEntry("info", "🔑 API key(s) found");
      }
    } catch (err) {
      console.warn("[IDE] Auth check failed:", err.message);
    }
  }

  /**
   * Show the blocking auth modal (full-screen overlay).
   * Called when main process reports no API key is stored.
   */
  _showAuthModal() {
    if (!this.els.authOverlay) return;
    this.els.authOverlay.classList.remove("hidden");
    this.els.authInputKey?.focus();
    this.els.authError?.classList.add("hidden");
    this._updateBadge("initializing", "🔑 API Key required");
    // Initialize provider + model dropdowns (always, even if DOM wasn't cached)
    this._onProviderChange();
  }

  /**
   * Hide the auth modal.
   */
  _hideAuthModal() {
    if (!this.els.authOverlay) return;
    this.els.authOverlay.classList.add("hidden");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚨 CRASH RECOVERY (Batch 3 — Item #1)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows the crash recovery modal when a crash is detected.
   * Fired by the orchestrator when it detects a stuck RooState (>30s).
   * @param {Object} data - Crash state data { task, mode, lastAction, heartbeatAge }
   */
  _showCrashRecovery(data) {
    // Show toast notification
    this._showToast('error', '⚠️ Crash detectado en la sesión anterior', 6000);

    // Show the crash recovery modal
    if (!this.els.crashOverlay) return;
    this.els.crashOverlay.classList.remove("hidden");
  }

  /**
   * Hides the crash recovery modal.
   */
  _hideCrashRecovery() {
    if (!this.els.crashOverlay) return;
    this.els.crashOverlay.classList.add("hidden");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ✅ TASK COMPLETION BANNER (Batch 3 — Item #4)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows a banner notification when a task is completed.
   * Fired by the orchestrator via task_complete event.
   * Auto-dismisses after 8 seconds, or click to dismiss.
   * @param {Object} data - Task completion data { recap, files, duration, toolCalls, iterations }
   */
  _showTaskBanner(data) {
    if (!this.els.taskBanner) return;

    // Build recap text from data
    let recapText = '✅ Tarea completada';
    if (data) {
      const parts = [];
      if (data.recap) parts.push(data.recap);
      if (data.duration) parts.push(`⏱️ ${data.duration}s`);
      if (data.files && data.files > 0) parts.push(`📄 ${data.files} archivo(s)`);
      if (data.toolCalls) parts.push(`🔧 ${data.toolCalls} tool calls`);
      if (parts.length > 0) {
        recapText += ' — ' + parts.join(' · ');
      }
    }

    // Update banner text and show it
    if (this.els.taskBannerText) {
      this.els.taskBannerText.textContent = recapText;
    }
    this.els.taskBanner.classList.remove("hidden");

    // Auto-dismiss after 8 seconds
    if (this._taskBannerTimer) {
      clearTimeout(this._taskBannerTimer);
    }
    this._taskBannerTimer = setTimeout(() => {
      this._hideTaskBanner();
    }, 8000);
  }

  /**
   * Hides the task completion banner.
   */
  _hideTaskBanner() {
    if (!this.els.taskBanner) return;
    this.els.taskBanner.classList.add("hidden");
    if (this._taskBannerTimer) {
      clearTimeout(this._taskBannerTimer);
      this._taskBannerTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📎 FILE ATTACH (Batch 3 — Item #9)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles the attach button click.
   * Triggers the hidden file input, or falls back to the native IPC file dialog.
   */
  _handleAttachClick() {
    if (this.els.hiddenFileInput) {
      // Reset so the change event fires even if same file is selected twice
      this.els.hiddenFileInput.value = "";
      this.els.hiddenFileInput.click();
    } else {
      // Fallback: open native dialog via IPC
      this._openFileDialogViaIPC();
    }
  }

  /**
   * Handles file selection from the hidden file input.
   * Files < 50 KB are read as code blocks and inserted at cursor.
   * Larger files are inserted as @ mentions for reference.
   * @param {Event} event - The change event from the hidden file input
   */
  _handleFileSelected(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const MAX_INLINE_SIZE = 50 * 1024; // 50 KB

    let fileIndex = 0;

    const readNext = () => {
      if (fileIndex >= files.length) return;
      const file = files[fileIndex];
      fileIndex++;

      if (file.size <= MAX_INLINE_SIZE) {
        // Read small files as text and insert as code block
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          const ext = file.name.split('.').pop() || '';
          const codeBlock = `\`\`\`${ext}\n${file.name}\n${content}\n\`\`\``;
          this._insertAtCursor(codeBlock);
          readNext();
        };
        reader.onerror = () => {
          this._insertAtCursor(`@${file.name}`);
          readNext();
        };
        reader.readAsText(file);
      } else {
        // Large files: insert as @ mention
        this._insertAtCursor(`@${file.name}`);
        readNext();
      }
    };

    readNext();
  }

  /**
   * Fallback method to open a native file dialog via IPC.
   * Used when the hidden file input is not available.
   */
  async _openFileDialogViaIPC() {
    try {
      const result = await window.lvzero["dialog:openFile"]();
      if (result && result.filePaths && result.filePaths.length > 0) {
        for (const filePath of result.filePaths) {
          this._insertAtCursor(`@${filePath}`);
        }
      }
    } catch (err) {
      console.warn("[IDE] File dialog via IPC failed:", err.message);
    }
  }

  /**
   * Inserts text at the current cursor position in the chat textarea.
   * @param {string} text - The text to insert
   */
  _insertAtCursor(text) {
    const input = this.els.chatInput;
    if (!input) return;

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const before = input.value.substring(0, start);
    const after = input.value.substring(end);

    input.value = before + text + after;

    // Move cursor to after inserted text
    const newPos = start + text.length;
    input.selectionStart = newPos;
    input.selectionEnd = newPos;

    // Trigger input event so autocomplete / resize handlers fire
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  /**
   * Provider → model mapping for the auth modal dropdowns.
   */
  _getProviderModels() {
    return {
      deepseek: { name: "DeepSeek", models: ["deepseek-v4-flash","deepseek-v4-pro","deepseek-chat","deepseek-reasoner"], envKey: "DEEPSEEK_API_KEY", url: "https://platform.deepseek.com/api_keys", keyPrefix: "sk-" },
      openai: { name: "OpenAI", models: ["gpt-4o","gpt-4o-mini","gpt-4.1","gpt-4.1-mini","o3","o3-mini","o4-mini"], envKey: "OPENAI_API_KEY", url: "https://platform.openai.com/api-keys", keyPrefix: "sk-" },
      anthropic: { name: "Anthropic Claude", models: ["claude-4-opus","claude-4-sonnet","claude-3.5-haiku"], envKey: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com", keyPrefix: "sk-ant-" },
      gemini: { name: "Google Gemini", models: ["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash"], envKey: "GEMINI_API_KEY", url: "https://aistudio.google.com/apikey", keyPrefix: "" },
      glm: { name: "GLM (Zhipu AI)", models: ["glm-5.2","glm-5.2-ultra","glm-5.1","glm-4-plus"], envKey: "GLM_API_KEY", url: "https://bigmodel.cn", keyPrefix: "" },
      qwen: { name: "Qwen (Alibaba Cloud)", models: ["qwen-3-72b","qwen-3-32b","qwen-3-14b","qwen-3-7b","qwen-max","qwen-plus","qwen-turbo"], envKey: "QWEN_API_KEY", url: "https://bailian.console.aliyun.com", keyPrefix: "sk-" },
      xai: { name: "xAI (Grok)", models: ["grok-3","grok-3-mini","grok-3-vision"], envKey: "XAI_API_KEY", url: "https://console.x.ai", keyPrefix: "" },
      groq: { name: "Groq", models: ["llama-4-70b","llama-4-8b","mixtral-8x7b","gemma-4-31b","gemma-4-9b"], envKey: "GROQ_API_KEY", url: "https://console.groq.com/keys", keyPrefix: "gsk_" },
      openrouter: { name: "OpenRouter", models: ["openai/gpt-4o","openai/gpt-4o-mini","anthropic/claude-4-sonnet","google/gemini-2.5-flash","meta-llama/llama-4-70b","deepseek/deepseek-v4-flash","qwen/qwen-3-72b"], envKey: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys", keyPrefix: "sk-or-" },
      together: { name: "Together AI", models: ["meta-llama/llama-4-70b","deepseek-ai/deepseek-v3","mistralai/mistral-large","Qwen/Qwen3-72B"], envKey: "TOGETHER_API_KEY", url: "https://together.ai/api-keys", keyPrefix: "" },
      nvidia: { name: "NVIDIA NIM", models: ["nvidia/nemotron-3-super-120b","meta/llama-4-70b","mistralai/mistral-large"], envKey: "NVIDIA_API_KEY", url: "https://build.nvidia.com", keyPrefix: "nvapi-" },
      fireworks: { name: "Fireworks AI", models: ["accounts/fireworks/models/llama-v4-70b","accounts/fireworks/models/qwen3-72b"], envKey: "FIREWORKS_API_KEY", url: "https://fireworks.ai/api-keys", keyPrefix: "" },
      custom: { name: "Custom URL", models: [], envKey: "CUSTOM_API_KEY", url: "", keyPrefix: "" },
    };
  }

  /**
   * Updates the model dropdown and footer link when provider changes.
   */
  _onProviderChange() {
    const providers = this._getProviderModels();
    // Get fresh references each time (in case DOM wasn't ready during _cacheDom)
    const sel = this.els.authProviderSelect || document.getElementById("auth-provider-select");
    const modelSel = this.els.authModelSelect || document.getElementById("auth-model-select");
    const link = this.els.authFooterLink || document.getElementById("auth-footer-link");
    if (!sel) { console.warn("[Auth] provider select not found"); return; }
    if (!modelSel) { console.warn("[Auth] model select not found"); return; }
    const pid = sel.value;
    const p = providers[pid];
    if (!p) { console.warn("[Auth] unknown provider:", pid); return; }
    // Update models dropdown
    modelSel.innerHTML = "";
    if (p.models.length === 0) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "Custom (escribe en .env)";
      modelSel.appendChild(opt);
    } else {
      for (const m of p.models) {
        const opt = document.createElement("option");
        opt.value = m; opt.textContent = m;
        if (m === p.models[0]) opt.selected = true;
        modelSel.appendChild(opt);
      }
    }
    // Update footer link
    if (link) {
      link.innerHTML = p.url
        ? `¿No tienes una key de ${p.name}? <a href="${p.url}" target="_blank" rel="noopener">Obtén una gratis aquí →</a>`
        : `Configura tu API Key de ${p.name} en su sitio web.`;
    }
    // Update placeholder
    const input = this.els.authInputKey || document.getElementById("auth-input-key");
    if (input) input.placeholder = p.keyPrefix ? `Ej: ${p.keyPrefix}...` : "Pega tu API Key aquí...";
  }

  /**
   * Save the API key via IPC and restart the app logic engine.
   */
  async _saveApiKey() {
    const providers = this._getProviderModels();
    const pid = this.els.authProviderSelect?.value || "deepseek";
    const p = providers[pid] || providers.deepseek;
    const model = this.els.authModelSelect?.value || p.models[0] || "";
    const key = this.els.authInputKey?.value?.trim();

    if (!key) {
      this._showAuthError(`Ingresa una API Key válida de ${p.name}.`);
      return;
    }
    if (p.keyPrefix && !key.startsWith(p.keyPrefix)) {
      this._showAuthError(`La API Key de ${p.name} debe empezar con '${p.keyPrefix}'`);
      return;
    }

    if (this.els.authBtnSave) {
      this.els.authBtnSave.disabled = true;
      this.els.authBtnSave.textContent = "⏳ Verificando...";
    }
    this.els.authError?.classList.add("hidden");

    try {
      // Save provider + model + key
      const result = await window.lvzero["providers:saveKey"](pid, key);
      if (!result || !result.success) {
        this._showAuthError(result?.error || "Error al guardar la API Key.");
        if (this.els.authBtnSave) { this.els.authBtnSave.disabled = false; this.els.authBtnSave.textContent = "✅ Listo, ¡a crear!"; }
        return;
      }
      // Also set the model
      if (model) {
        await window.lvzero["model:setModel"]?.({ provider: pid, model });
      }

      const step1 = document.getElementById("onboarding-step-1");
      const step2 = document.getElementById("onboarding-step-2");
      if (step1) step1.classList.add("hidden");
      if (step2) step2.classList.remove("hidden");

      this.addLogEntry("success", `🔑 ${p.name} configurado correctamente. Modelo: ${model}. ¡Bienvenido a LV-Zero!`);
    } catch (err) {
      this._showAuthError(`Error: ${err.message}`);
      if (this.els.authBtnSave) { this.els.authBtnSave.disabled = false; this.els.authBtnSave.textContent = "✅ Listo, ¡a crear!"; }
    }
  }

  /**
   * Show an error message inside the auth modal.
   */
  // ═══════════════════════════════════════════════════════════════════════════
  // TOAST NOTIFICATIONS (Phase 9.1)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Shows a non-blocking toast notification.
   * @param {'success'|'error'|'info'|'fatal'} type - Toast type
   * @param {string} message - Message to display
   * @param {number} [duration] - Auto-dismiss in ms (0 = manual dismiss). Defaults: success=3000, info=5000, error/manual
   */
  _showToast(type, message, duration) {
    if (!this.els.toastContainer) return;
    if (!message) return;

    // Clear any pending auto-dismiss timer from previous toast
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }

    // Determine defaults
    if (duration === undefined) {
      if (type === 'success') duration = 3000;
      else if (type === 'info') duration = 5000;
      else duration = 0; // error/fatal: manual dismiss
    }

    const iconMap = { success: '✅', error: '❌', info: 'ℹ️', fatal: '🔥' };
    const icon = iconMap[type] || 'ℹ️';

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${this._escapeHtml(message)}</span>
      <button class="toast-close" title="Dismiss">✕</button>
    `;

    // Close button handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this._dismissToast(toast));

    // Add to container
    this.els.toastContainer.appendChild(toast);

    // Auto-dismiss — store timer so _dismissToast can cancel it
    if (duration > 0) {
      this._toastTimer = setTimeout(() => this._dismissToast(toast), duration);
    }
  }

  /**
   * Dismisses a toast element with animation.
   */
  _dismissToast(toast) {
    if (!toast || toast._dismissing) return;
    // Clear the auto-dismiss timer to prevent stale callbacks
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    toast._dismissing = true;
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  /**
   * Shows a yellow warning notification when an Iron Law violation is detected.
   * Non-blocking — just informs the user with a dismissible badge.
   * @param {object} data - Violation data { law, passed, reason, evidence }
   */
  _showIronLawViolation(data) {
    try {
      if (!data || !data.law) return;
      if (!this.els.toastContainer) return;

      const lawNames = { debug: 'Systematic Debugging', verification: 'Verification Gate', review: 'Code Review Gate' };
      const lawName = lawNames[data.law] || data.law;
      const message = data.reason || `Iron Law violation: ${lawName}`;

      // Use toast container but with custom iron-law styling
      const violationEl = document.createElement('div');
      violationEl.className = 'iron-law-violation';
      violationEl.innerHTML = `
        <span class="violation-badge">⚖️</span>
        <span class="violation-text">
          <strong>${this._escapeHtml(lawName)}</strong><br>
          <span>${this._escapeHtml(message)}</span>
        </span>
        <button class="violation-dismiss" title="Dismiss">✕</button>
      `;

      const dismissBtn = violationEl.querySelector('.violation-dismiss');
      dismissBtn.addEventListener('click', () => {
        violationEl.classList.add('removing');
        setTimeout(() => {
          if (violationEl.parentNode) {
            violationEl.parentNode.removeChild(violationEl);
          }
        }, 300);
      });

      this.els.toastContainer.appendChild(violationEl);

      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        if (violationEl.parentNode && !violationEl.classList.contains('removing')) {
          violationEl.classList.add('removing');
          setTimeout(() => {
            if (violationEl.parentNode) {
              violationEl.parentNode.removeChild(violationEl);
            }
          }, 300);
        }
      }, 8000);
    } catch (err) {
      console.warn('[IDE] Error showing iron law violation:', err.message);
    }
  }

  _showAuthError(msg) {
    if (!this.els.authError) return;
    this.els.authError.textContent = msg;
    this.els.authError.classList.remove("hidden");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS HELP (Phase 9.2)
  // ═══════════════════════════════════════════════════════════════════════════

  _toggleShortcuts() {
    if (!this.els.shortcutsOverlay) return;
    const isHidden = this.els.shortcutsOverlay.classList.contains("hidden");
    if (isHidden) {
      this.els.shortcutsOverlay.classList.remove("hidden");
    } else {
      this._hideShortcuts();
    }
  }

  _hideShortcuts() {
    if (!this.els.shortcutsOverlay) return;
    this.els.shortcutsOverlay.classList.add("hidden");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUT HANDLERS (Phase 6)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Open the command palette — focuses the chat input with a "/" prefix.
   */
  _openCommandPalette() {
    if (this.els.chatInput) {
      this.els.chatInput.focus();
      this.els.chatInput.value = "/";
      // Move cursor to end
      const len = this.els.chatInput.value.length;
      this.els.chatInput.setSelectionRange(len, len);
      this._updateCharCounter();
    }
  }

  /**
   * Toggle the MCP servers panel visibility.
   */
  _toggleMCPPanel() {
    const details = this.els.mcpPanel;
    if (details) {
      details.open = !details.open;
    }
  }

  /**
   * Open the MCP registry browser modal.
   */
  _openMCPRegistry() {
    if (this.els.mcpRegistryBtn) {
      this.els.mcpRegistryBtn.click();
    }
  }

  /**
   * Run deep research — sends a "/research" command to the chat.
   */
  _runDeepResearch() {
    if (this.els.chatInput) {
      this.els.chatInput.focus();
      this.els.chatInput.value = "/research ";
      const len = this.els.chatInput.value.length;
      this.els.chatInput.setSelectionRange(len, len);
      this._updateCharCounter();
    }
  }

  /**
   * Focus the explorer panel and its search input.
   */
  _focusExplorerPanel() {
    if (this.els.explorerSearchInput) {
      this.els.explorerSearchInput.focus();
      this.els.explorerSearchInput.select();
    }
  }

  /**
   * Focus the terminal panel and its xterm instance.
   */
  _focusTerminalPanel() {
    if (this.terminal) {
      this.terminal.focus();
    }
  }

  /**
   * Focus the AI chat panel and its input.
   */
  _focusChatPanel() {
    if (this.els.chatInput) {
      this.els.chatInput.focus();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME TOGGLE (Phase 9.3)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load theme from localStorage and apply it.
   */
  _loadTheme() {
    try {
      const stored = localStorage.getItem("lvzero_theme");
      if (stored === "light" || stored === "dark") {
        this._theme = stored;
      }
    } catch (_) {}
    this._applyTheme(this._theme);
  }

  /**
   * Apply the given theme to the UI.
   * @param {'dark'|'light'} theme
   */
  _applyTheme(theme) {
    this._theme = theme;
    const isLight = theme === 'light';

    // Toggle class on body for CSS variable overrides
    document.body.classList.toggle('light-theme', isLight);

    // Update Monaco editor theme if available
    if (this.monaco && this.editor) {
      this.monaco.editor.setTheme(isLight ? 'lvzero-light' : 'lvzero-dark');
    }
    if (this.monaco && this.diffEditor) {
      this.monaco.editor.setTheme(isLight ? 'lvzero-light' : 'lvzero-dark');
    }

    // Update toggle button text/icon
    if (this.els.themeToggleIcon) {
      this.els.themeToggleIcon.textContent = isLight ? '🌙' : '☀️';
    }
    if (this.els.themeToggleText) {
      this.els.themeToggleText.textContent = isLight ? 'Dark Mode' : 'Light Mode';
    }

    // Persist to localStorage
    try {
      localStorage.setItem("lvzero_theme", theme);
    } catch (_) {}

    // Persist to settings store
    if (window.lvzero["settings:set"]) {
      window.lvzero["settings:set"]("theme", theme).catch(() => {});
    }
  }

  /**
   * Toggle between dark and light theme.
   */
  _toggleTheme() {
    const newTheme = this._theme === 'dark' ? 'light' : 'dark';
    this._applyTheme(newTheme);
    this.addLogEntry("info", `🎨 Theme switched to ${newTheme} mode`);
    this._showToast('success', `Theme switched to ${newTheme} mode`, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE EXPLORER SEARCH (Phase 9.4)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filters the file tree items based on the search query.
   * Hides non-matching items and highlights matching ones.
   */
  _filterFileTree() {
    const query = this._fileTreeSearchQuery;
    const items = this.els.fileTree.querySelectorAll('.tree-item');

    if (!query) {
      // Show all items, remove highlights
      items.forEach((el) => {
        el.classList.remove('filtered-out', 'search-match');
      });
      return;
    }

    items.forEach((el) => {
      const name = (el.querySelector('.tree-name')?.textContent || '').toLowerCase();
      const matches = name.includes(query);
      el.classList.toggle('filtered-out', !matches);
      el.classList.toggle('search-match', matches);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE WATCHER — Recarga reactiva de tabs (Fase A)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Called when chokidar detects a file change on disk.
   * If the file is open in an editor tab, reloads its content.
   * Uses debounce to avoid rapid re-reads.
   */
  _reloadChangedFile(filePath) {
    // Normalise to forward slashes for matching
    const normalised = filePath.replace(/\\/g, '/');
    const tab = this.openTabs[normalised];
    if (!tab) return; // File not open in editor — nothing to do

    // Debounce: if a reload was recently scheduled for this file, skip
    if (this._reloadFileDebounce) {
      clearTimeout(this._reloadFileDebounce);
    }
    this._reloadFileDebounce = setTimeout(async () => {
      try {
        const result = await window.lvzero["file:read"](normalised);
        if (!result || !result.success) return;

        const newContent = result.content;
        const currentContent = tab.model.getValue();

        // No real change? Ignore (could be a false-positive watcher event)
        if (newContent === currentContent) return;

        // Check if user has unsaved local changes
        const isDirty = currentContent !== tab.savedContent;
        if (isDirty) {
          // User has local edits — warn but don't overwrite
          this._showToast('info', `⚠️ ${tab.fileName} changed externally (local edits preserved)`, 5000);
          return;
        }

        // Reload the model content
        tab.model.setValue(newContent);
        tab.savedContent = newContent;
        this._renderTabs();

        // ── AUTO-SCROLL: Scroll to end when content grows ─────────────
        // If the file is currently visible in the editor and content was
        // appended (agent writing more code), scroll to reveal new lines.
        if (this.editor && normalised === this.activeTabPath) {
          const lineCount = tab.model.getLineCount();
          // Only auto-scroll if the new content is longer (agent appended lines)
          // and the editor was near the bottom already
          const visibleRange = this.editor.getVisibleRanges()[0];
          if (visibleRange) {
            const lastVisibleLine = visibleRange.endLineNumber;
            const threshold = Math.max(1, Math.floor(lineCount * 0.15)); // last 15%
            if (lastVisibleLine >= lineCount - threshold) {
              this.editor.revealLine(lineCount, 1); // 1 = smooth scroll
              this.editor.setPosition({ lineNumber: lineCount, column: 1 });
            }
          }
        }

        this._showToast('success', `🔄 Reloaded ${tab.fileName} from disk`, 3000);
      } catch (err) {
        console.warn("[IDE] Error reloading changed file:", err.message);
      }
    }, 300); // 300ms debounce
  }

  _bindUIEvents() {
    // ── View menu ──
    this._bindViewMenu();

    // ── Send message on button click ──
    this.els.sendBtn.addEventListener("click", () => {
      this.sendMessage(this.els.chatInput.value);
    });

    // ── Send on Enter (Shift+Enter for newline) ──
    this.els.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage(this.els.chatInput.value);
      }
    });

    // ── Drag & Drop de archivos al chat ──
    this.els.chatInputArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.els.chatInputArea.classList.add("drag-over");
      this.els.dropOverlay?.classList.remove("hidden");
    });
    this.els.chatInputArea.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.els.chatInputArea.classList.remove("drag-over");
      this.els.dropOverlay?.classList.add("hidden");
    });
    this.els.chatInputArea.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.els.chatInputArea.classList.remove("drag-over");
      this.els.dropOverlay?.classList.add("hidden");
      this._handleFileDrop(e);
    });

    // ── Autocomplete on input (commands + @ mentions) ──
    this.els.chatInput.addEventListener("input", () => {
      this._autoResizeInput();
      const val = this.els.chatInput.value;
      if (val.includes("@")) {
        this._showFileAutocomplete(val);
      } else {
        this._showAutocomplete(val);
      }
    });

    // ── Character counter ──
    this.els.chatInput.addEventListener("input", () => this._updateCharCounter());

    // ── Auto-resize textarea ──
    this.els.chatInput.addEventListener("input", () => this._autoResizeInput());

    // ── Parent folder button — navigates up one directory ──
    this.els.btnParentFolder?.addEventListener("click", () => {
      const currentPath = this._project?.path;
      if (currentPath) {
        // Compute parent directory without requiring 'path' module (not available with contextIsolation)
        const normalized = currentPath.replace(/\\/g, "/");
        const lastSlash = normalized.lastIndexOf("/");
        if (lastSlash > 0) {
          const parentPath = normalized.substring(0, lastSlash);
          // IPC handles forward slashes on all platforms
          this._openProject(parentPath);
        }
      }
    });

    // ── Refresh file tree ──
    this.els.refreshTreeBtn.addEventListener("click", () => this._loadFileTree());

    // ── 🗺️ Map button — open project map ──
    this.els.btnMapaProyecto?.addEventListener("click", async () => {
      try {
        const projectInfo = await window.lvzero["project:info"]();
        if (!projectInfo?.path) {
          this._showToast("error", "❌ No hay proyecto abierto para mostrar el mapa", 3000);
          return;
        }
        const projectPath = projectInfo.path;
        // Try to open mapa-del-proyecto/README.md (the map overview)
        const mapReadme = `${projectPath}/mapa-del-proyecto/README.md`;
        this.openFile(mapReadme);
        this.addLogEntry("info", `🗺️ Opening project map: ${mapReadme}`);
      } catch (err) {
        this.addLogEntry("error", `❌ Map button error: ${err.message}`);
      }
    });

    // ── Initialize terminal ──
    this.els.initTerminalBtn.addEventListener("click", () => this.startTerminal());
    this.els.newTerminalBtn.addEventListener("click", () => this.startTerminal());

    // ── Shell selector change ──
    if (this.els.terminalShellSelector) {
      this.els.terminalShellSelector.addEventListener("change", (e) => {
        this._switchTerminalShell(e.target.value);
      });
    }

    // ── Clear conversation (topbar) ──
    this.els.clearConvBtn.addEventListener("click", async () => {
      await window.lvzero["agent:clear"]();
      this.els.chatMessages.innerHTML = `
        <div class="message system">
          <div class="message-avatar">⚡</div>
          <div class="message-content">
            <div class="message-header"><strong>System</strong></div>
            <div class="message-body">Conversation cleared.</div>
          </div>
        </div>
      `;
      this.addLogEntry("info", "🧹 Conversation cleared");
    });

    // ── 🧹 Amnesia — Clear short-term memory (preserves only mode system prompt) ──
    this.els.btnAmnesia.addEventListener("click", async () => {
      try {
        await window.lvzero["chat:clear_context"]();
        // Clear visual chat messages and show amnesia notice
        this.els.chatMessages.innerHTML = `
          <div class="message system">
            <div class="message-avatar">⚡</div>
            <div class="message-content">
              <div class="message-header"><strong>System</strong></div>
              <div class="message-body">🧹 Contexto limpiado. Memoria a corto plazo vaciada.</div>
            </div>
          </div>
        `;
        this.addLogEntry("info", "🧹 Contexto limpiado. Memoria a corto plazo vaciada.");
      } catch (err) {
        this.addLogEntry("error", `❌ Amnesia error: ${err.message}`);
      }
    });

    // ── â¹ Stop agent — interrupts the current agent loop ──
    this.els.stopBtn.addEventListener("click", () => {
      // Immediate visual feedback: show user the click was registered
      this.els.stopBtn.textContent = "⏳";
      this.els.stopBtn.title = "Stopping...";
      this.els.stopBtn.style.opacity = "0.6";
      this.addLogEntry("info", "🛑 Stop requested — aborting agent...");

      // Send stop signal through IPC to orchestrator
      window.lvzero["agent:stop"]().then((result) => {
        if (result && result.success === false) {
          this.addLogEntry("error", `Stop failed: ${result.error || "Unknown error"}`);
          return;
        }
        // IPC succeeded — orchestrator.abortAgent() was called.
        // Safety net: restore button after 3s if orchestrator events don't fire
        setTimeout(() => {
          this.els.stopBtn.textContent = "⏹";
          this.els.stopBtn.title = "⏹ Stop agent";
          this.els.stopBtn.style.opacity = "1";
        }, 3000);
      }).catch(err => {
        console.warn("[IDE] Stop agent error:", err);
        this.addLogEntry("error", `❌ Stop failed: ${err.message}`);
        // Restore button on error
        this.els.stopBtn.textContent = "⏹";
        this.els.stopBtn.title = "⏹ Stop agent";
        this.els.stopBtn.style.opacity = "1";
      });
    });

    // ── Keyboard shortcut: Ctrl+F to search chat ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        // Only open if chat panel is visible
        if (this.els.chatSearchBar) {
          e.preventDefault();
          this._toggleSearch();
        }
      }
      // Escape closes search
      if (e.key === "Escape" && this._searchQuery) {
        this._closeSearch();
      }
    });

    // ── Keyboard shortcut: Ctrl+S to save file ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        this.saveCurrentFile();
      }
    });

    // ── Resize terminal when window resizes ──
    window.addEventListener("resize", () => {
      setTimeout(() => this._fitTerminal(), 100);
    });

    // ── Copy button click handler for code blocks ──
    this.els.chatMessages.addEventListener("click", async (e) => {
      const btn = e.target.closest(".copy-btn");
      if (!btn) return;
      const id = btn.dataset.copyId;
      const codeEl = document.getElementById(id);
      if (!codeEl) return;
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        btn.textContent = "\u2705 Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "\uD83D\uDCCB Copy";
          btn.classList.remove("copied");
        }, 2000);
      } catch (err) {
        btn.textContent = "\u274C Error";
        console.warn("[Copy] Clipboard error:", err.message);
      }
    });

    // ── Diff Review Buttons (Misión 2) ──
    if (this.els.diffBtnAccept) {
      this.els.diffBtnAccept.addEventListener("click", async () => {
        if (!this._pendingDiff) return;
        const { filePath, newContent } = this._pendingDiff;
        try {
          const result = await window.lvzero["file:acceptDiff"](filePath, newContent);
          if (result.success) {
            this._hideDiffEditor(true);
            // Reload the file in the editor tab to show updated content
            if (this.openTabs[filePath]) {
              // Dispose old model and re-read
              const oldTab = this.openTabs[filePath];
              oldTab.model?.dispose();
              delete this.openTabs[filePath];
            }
            this.openFile(filePath);
          } else {
            this.addLogEntry("error", `Failed to accept diff: ${result.error}`);
          }
        } catch (err) {
          this.addLogEntry("error", `Error accepting diff: ${err.message}`);
        }
      });
    }

    if (this.els.diffBtnReject) {
      this.els.diffBtnReject.addEventListener("click", async () => {
        if (!this._pendingDiff) return;
        const { filePath } = this._pendingDiff;
        try {
          const result = await window.lvzero["file:rejectDiff"](filePath);
          if (result.success) {
            this._hideDiffEditor(false);
          } else {
            this.addLogEntry("error", `Failed to reject diff: ${result.error}`);
          }
        } catch (err) {
          this.addLogEntry("error", `Error rejecting diff: ${err.message}`);
        }
      });
    }

    // ── Version Control: Refresh Git Status ──
    if (this.els.btnRefreshVc) {
      this.els.btnRefreshVc.addEventListener("click", () => {
        this._loadGitStatus();
      });
    }

    // ── Version Control: Auto-Commit via AI ──
    if (this.els.btnAutoCommit) {
      this.els.btnAutoCommit.addEventListener("click", async () => {
        const btn = this.els.btnAutoCommit;
        const originalText = btn.textContent;
        btn.textContent = "⏳";
        btn.disabled = true;
        try {
          const result = await window.lvzero["git:autoCommit"]();
          if (result && result.success) {
            this.addLogEntry("info", `✅ Auto-commit: ${result.message}`);
            // Refresh VC panel after commit
            await this._loadGitStatus();
          } else {
            this.addLogEntry("warn", `⚠️ Auto-commit: ${result?.error || "No changes"}`);
          }
        } catch (err) {
          this.addLogEntry("error", `❌ Auto-commit error: ${err.message}`);
        } finally {
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });
    }

    // ── Live Preview: Toggle button (Fase 4) ──
    if (this.els.btnPreview) {
      this.els.btnPreview.addEventListener("click", () => {
        this._togglePreview();
      });
    }

    // ── Live Preview: Start Server button ──
    if (this.els.btnPreviewStartServer) {
      this.els.btnPreviewStartServer.addEventListener("click", async () => {
        await this._previewStartServer();
      });
    }

    // ── Live Preview: Stop Server button ──
    if (this.els.btnPreviewStopServer) {
      this.els.btnPreviewStopServer.addEventListener("click", async () => {
        await this._previewStopServer();
      });
    }

    // ── Live Preview: Reload / Navigate button ──
    if (this.els.btnPreviewReload) {
      this.els.btnPreviewReload.addEventListener("click", () => {
        this._previewNavigate();
      });
    }

    // ── 🚀 Publish to Cloudflare Pages ──
    if (this.els.btnPublish) {
      this.els.btnPublish.addEventListener("click", async () => {
        await this._publishToCloudflare();
      });
    }

    // ── 🐝 Swarm: Toggle panel visibility ──
    if (this.els.btnSwarmToggle) {
      this.els.btnSwarmToggle.addEventListener("click", () => {
        const tasksEl = this.els.swarmTasks;
        if (tasksEl) {
          const isHidden = tasksEl.style.display === "none";
          tasksEl.style.display = isHidden ? "" : "none";
          this.els.btnSwarmToggle.textContent = isHidden ? "−" : "+";
        }
      });
    }

    // ── 🐝 Swarm: Wire event listeners ──
    const _unsubs = this.unsubscribers || [];
    if (window.lvzero?.events?.onSwarmStart) {
      const fn = window.lvzero.events.onSwarmStart((d) => this._onSwarmStart(d));
      if (fn) _unsubs.push(fn);
    }
    if (window.lvzero?.events?.onSwarmTaskProgress) {
      const fn = window.lvzero.events.onSwarmTaskProgress((d) => this._onSwarmTaskProgress(d));
      if (fn) _unsubs.push(fn);
    }
    if (window.lvzero?.events?.onSwarmTaskComplete) {
      const fn = window.lvzero.events.onSwarmTaskComplete((d) => this._onSwarmTaskComplete(d));
      if (fn) _unsubs.push(fn);
    }
    if (window.lvzero?.events?.onSwarmTaskError) {
      const fn = window.lvzero.events.onSwarmTaskError((d) => this._onSwarmTaskError(d));
      if (fn) _unsubs.push(fn);
    }
    if (window.lvzero?.events?.onSwarmComplete) {
      const fn = window.lvzero.events.onSwarmComplete((d) => this._onSwarmComplete(d));
      if (fn) _unsubs.push(fn);
    }

    // ── 📋 Code Review: Review button on toolbar (Phase 5) ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "r") {
        e.preventDefault();
        this._triggerCodeReview();
      }
    });

    // ── Live Preview: Navigate on Enter in URL input ──
    if (this.els.previewUrl) {
      this.els.previewUrl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._previewNavigate();
        }
      });
    }

    // ── Auth Guard: Save API Key button (Fase 5) ──
    if (this.els.authBtnSave) {
      this.els.authBtnSave.addEventListener("click", () => {
        this._saveApiKey();
      });
    }

    // ── Auth: Provider change → update models dropdown ──
    if (this.els.authProviderSelect) {
      this.els.authProviderSelect.addEventListener("change", () => {
        this._onProviderChange();
      });
      // Initialize models on first load
      setTimeout(() => this._onProviderChange(), 100);
    }

    // ── Onboarding: Close button (Step 2) ──
    const onboardingCloseBtn = document.getElementById("onboarding-btn-close");
    if (onboardingCloseBtn) {
      onboardingCloseBtn.addEventListener("click", () => {
        this._hideAuthModal();
        this.addLogEntry("success", "🎉 ¡Bienvenido a lv-zero! Escribe tu idea en el chat para empezar.");
      });
    }

    // ── Keyboard Shortcuts: Close overlay button ──
    if (this.els.btnShortcutsClose) {
      this.els.btnShortcutsClose.addEventListener("click", () => this._hideShortcuts());
    }

    // ── Keyboard Shortcuts: Close on overlay click ──
    if (this.els.shortcutsOverlay) {
      this.els.shortcutsOverlay.addEventListener("click", (e) => {
        if (e.target === this.els.shortcutsOverlay) this._hideShortcuts();
      });
    }

    // ── Theme Toggle button ──
    if (this.els.btnThemeToggle) {
      this.els.btnThemeToggle.addEventListener("click", () => this._toggleTheme());
    }

    // ── Explorer Search: filter tree on input ──
    if (this.els.explorerSearchInput) {
      this.els.explorerSearchInput.addEventListener("input", () => {
        this._fileTreeSearchQuery = this.els.explorerSearchInput.value.trim().toLowerCase();
        this._filterFileTree();
      });
      // Escape clears search
      this.els.explorerSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.els.explorerSearchInput.value = "";
          this._fileTreeSearchQuery = "";
          this._filterFileTree();
          this.els.explorerSearchInput.blur();
        }
      });
    }

    // ── Keyboard shortcut: Ctrl+Shift+/ to open shortcuts help ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "/") {
        e.preventDefault();
        this._toggleShortcuts();
      }
    });

    // ── Keyboard shortcut: Ctrl+1/2/3/4 to switch mode ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const modeMap = { "1": "architect", "2": "code", "3": "ask", "4": "debug" };
        const modeSlug = modeMap[e.key];
        if (modeSlug && this._mode.slug !== modeSlug) {
          e.preventDefault();
          window.lvzero["mode:switch"](modeSlug).catch(() => {});
        }
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+P — Open command palette ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "p") {
        e.preventDefault();
        this._openCommandPalette();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+M — Toggle MCP panel ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "m") {
        e.preventDefault();
        this._toggleMCPPanel();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+K — Open MCP registry browser ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "k") {
        e.preventDefault();
        this._openMCPRegistry();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+R — Run deep research ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "r") {
        e.preventDefault();
        this._runDeepResearch();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+D — Toggle dark/light theme ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        this._toggleTheme();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+E — Focus explorer panel ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "e") {
        e.preventDefault();
        this._focusExplorerPanel();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+T — Focus terminal panel ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "t") {
        e.preventDefault();
        this._focusTerminalPanel();
      }
    });

    // ── Keyboard shortcut: Ctrl+Shift+A — Focus AI chat panel ──
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "a") {
        e.preventDefault();
        this._focusChatPanel();
      }
    });

    // ── Auth Guard: Save on Enter in key input ──
    if (this.els.authInputKey) {
      this.els.authInputKey.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._saveApiKey();
        }
      });
    }

    // ── Chat Search: input handler ──
    if (this.els.chatSearchInput) {
      this.els.chatSearchInput.addEventListener("input", () => {
        this._performSearch();
      });
      this.els.chatSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) {
            this._searchPrev();
          } else {
            this._searchNext();
          }
        }
      });
    }

    // ── Chat Search: prev / next / close buttons ──
    this.els.chatSearchPrev?.addEventListener("click", () => this._searchPrev());
    this.els.chatSearchNext?.addEventListener("click", () => this._searchNext());
    this.els.chatSearchClose?.addEventListener("click", () => this._closeSearch());

    // ── New Session button ──
    this.els.btnNewSession?.addEventListener("click", () => this._newSession());

    // ── Session tab switching (delegated) ──
    this.els.sessionTabs?.addEventListener("click", (e) => {
      const tab = e.target.closest(".session-tab");
      if (!tab) return;
      const sessionId = tab.dataset.sessionId;
      // Close button inside tab
      if (e.target.closest(".session-close")) {
        this._closeSession(sessionId);
        return;
      }
      if (sessionId && sessionId !== this._currentSessionId) {
        this._switchSession(sessionId);
      }
    });

    // ── Auto-approve toggle persistence (Feature 1) ──
    ['autoRead', 'autoWrite', 'autoMode', 'autoExecute', 'autoQuestion', 'autoSubtasks'].forEach(key => {
        if (this.els[key]) {
            this.els[key].addEventListener("change", () => this._saveAutoApprove());
        }
    });

    // ── Mode switch button clicks ──
    this._bindModeUI();

    // ── 🚨 Crash Recovery Buttons (Batch 3 — Item #1) ──
    this.els.crashBtnRestore?.addEventListener("click", async () => {
      try { await window.lvzero["crash:recover"](); }
      catch (err) { console.warn("[IDE] Crash recover error:", err.message); }
      this._hideCrashRecovery();
    });
    this.els.crashBtnNew?.addEventListener("click", async () => {
      try { await window.lvzero["crash:dismiss"](); }
      catch (err) { console.warn("[IDE] Crash dismiss error:", err.message); }
      this._hideCrashRecovery();
    });

    // ── ✅ Task Banner Dismiss (Batch 3 — Item #4) ──
    this.els.taskBannerClose?.addEventListener("click", () => { this._hideTaskBanner(); });

    // ── 📎 File Attach Button (Batch 3 — Item #9) ──
    this.els.attachBtn?.addEventListener("click", () => { this._handleAttachClick(); });
    this.els.hiddenFileInput?.addEventListener("change", (e) => { this._handleFileSelected(e); });

    // ── MCP Registry Browser Button ──
    this.els.mcpRegistryBtn?.addEventListener("click", () => { this._openMCPRegistry(); });

    // ── MCP Registry: Close button ──
    this.els.mcpRegistryClose?.addEventListener("click", () => { this._closeMCPRegistry(); });

    // ── MCP Registry: Close on overlay click ──
    this.els.mcpRegistryOverlay?.addEventListener("click", (e) => {
      if (e.target === this.els.mcpRegistryOverlay) this._closeMCPRegistry();
    });

    // ── MCP Registry: Search filter ──
    this.els.mcpRegistrySearch?.addEventListener("input", () => { this._filterMCPRegistry(); });

    // ── MCP Env Config: Close button ──
    this.els.mcpEnvClose?.addEventListener("click", () => { this._closeMCPEnvConfig(); });

    // ── MCP Env Config: Cancel button ──
    this.els.mcpEnvCancel?.addEventListener("click", () => { this._closeMCPEnvConfig(); });

    // ── MCP Env Config: Activate button ──
    this.els.mcpEnvActivate?.addEventListener("click", () => { this._activateMCPServer(); });

    // ── MCP Add Server Button ──
    this.els.mcpAddBtn?.addEventListener("click", () => { this._toggleMCPForm(); });

    // ── MCP Form: Type selector toggles stdio vs HTTP fields ──
    this.els.mcpFormType?.addEventListener("change", () => { this._toggleMCPFormFields(); });

    // ── MCP Form: Cancel button ──
    this.els.mcpFormCancel?.addEventListener("click", () => { this._hideMCPForm(); });

    // ── MCP Form: Save button ──
    this.els.mcpFormSave?.addEventListener("click", () => { this._saveMCPConfig(); });

    // ── Model Selector: Toggle dropdown ──
    this.els.modelSelector?.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent click from reaching mode buttons
      // Don't toggle if clicking a dropdown option
      if (e.target.closest(".model-dropdown")) return;
      const dd = this.els.modelDropdown;
      if (!dd) return;
      const isHidden = dd.classList.contains("hidden");
      if (isHidden) {
        this._positionModelDropdown();
        dd.classList.remove("hidden");
      } else {
        dd.classList.add("hidden");
      }
    });

    // ── Model Selector: Option click ──
    this.els.modelOptions?.forEach(opt => {
      opt.addEventListener("click", async (e) => {
        e.stopPropagation(); // CRITICAL: prevent event from bubbling to mode buttons
        e.preventDefault();
        const tier = opt.dataset.tier;
        this.els.modelDropdown?.classList.add("hidden");
        try {
          const result = await window.lvzero["model:setModel"](tier);
          if (result && result.success) {
            this._updateModelDisplay(tier, result.model);
            const tierLabel = tier === "auto" ? "Auto" : tier === "free" ? "🆓 Free" : tier === "cheap" ? "⚡ Flash" : tier === "reasoner" ? "🧠 Pro" : tier;
            this.addLogEntry("info", `🧠 Modelo cambiado a: ${tierLabel} (${result.model})`);
            // Update status to reflect new model (does NOT change mode)
            this._updateStatus();
          } else {
            this.addLogEntry("error", `❌ Failed to change model: ${result?.error || "unknown"}`);
          }
        } catch (err) {
          this.addLogEntry("error", `❌ Model change error: ${err.message}`);
        }
      });
    });

    // ── Close model dropdown when clicking outside ──
    document.addEventListener("click", (e) => {
      if (this.els.modelSelector && !this.els.modelSelector.contains(e.target)) {
        this.els.modelDropdown?.classList.add("hidden");
      }
    });

    // ── 🌐 Agent Browser: Navigate on Go button click ──
    if (this.els.browserGo) {
      this.els.browserGo.addEventListener("click", () => {
        this._browserNavigate();
      });
    }

    // ── 🌐 Agent Browser: Navigate on Enter in URL input ──
    if (this.els.browserUrl) {
      this.els.browserUrl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._browserNavigate();
        }
      });
    }

    // ── 🌐 Agent Browser: Back button ──
    if (this.els.browserBack) {
      this.els.browserBack.addEventListener("click", () => {
        this._browserBack();
      });
    }

    // ── 🌐 Agent Browser: Forward button ──
    if (this.els.browserForward) {
      this.els.browserForward.addEventListener("click", () => {
        this._browserForward();
      });
    }

    // ── 🌐 Agent Browser: Reload button ──
    if (this.els.browserReload) {
      this.els.browserReload.addEventListener("click", () => {
        this._browserReload();
      });
    }

    // ── 🌐 Agent Browser: Close button ──
    if (this.els.browserClose) {
      this.els.browserClose.addEventListener("click", () => {
        this._closeBrowserPanel();
      });
    }

    // ── 🌐 Agent Browser: Test Commands ──
    if (this.els.browserTestLinks) {
      this.els.browserTestLinks.addEventListener("click", () => {
        this._browserRunTest("check-links");
      });
    }
    if (this.els.browserTestImages) {
      this.els.browserTestImages.addEventListener("click", () => {
        this._browserRunTest("check-images");
      });
    }
    if (this.els.browserTestConsole) {
      this.els.browserTestConsole.addEventListener("click", () => {
        this._browserRunTest("check-console");
      });
    }

    // ── 🌐 Agent Browser: Webview navigation events ──
    if (this.els.browserWebview) {
      // Update URL bar when page navigates
      this.els.browserWebview.addEventListener("did-navigate", (e) => {
        if (this.els.browserUrl) {
          this.els.browserUrl.value = e.url;
        }
      });
      this.els.browserWebview.addEventListener("did-navigate-in-page", (e) => {
        if (this.els.browserUrl) {
          this.els.browserUrl.value = e.url;
        }
      });
      // Log page title changes
      this.els.browserWebview.addEventListener("page-title-updated", (e) => {
        this.addLogEntry("info", `🌐 Page title: ${e.title}`);
      });
    }
  }

  _updateCharCounter() {
    const el = this.els.charCounter;
    if (!el) return;
    const len = this.els.chatInput.value.length;
    const max = this.els.chatInput.maxLength || 100000;
    el.textContent = `${len}/${max}`;
  }

  _autoResizeInput() {
    const el = this.els.chatInput;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT SEARCH (Ctrl+F)
  // ═══════════════════════════════════════════════════════════════════════════

  _toggleSearch() {
    const bar = this.els.chatSearchBar;
    if (!bar) return;
    if (bar.classList.contains("hidden")) {
      bar.classList.remove("hidden");
      this.els.chatSearchInput.value = this._searchQuery || "";
      this.els.chatSearchInput.focus();
      this.els.chatSearchInput.select();
      if (this._searchQuery) this._performSearch();
    } else {
      this._closeSearch();
    }
  }

  _closeSearch() {
    this._clearSearchHighlights();
    this._searchQuery = "";
    this._searchMatches = [];
    this._searchCurrentIdx = -1;
    if (this.els.chatSearchBar) {
      this.els.chatSearchBar.classList.add("hidden");
    }
    if (this.els.chatSearchCount) {
      this.els.chatSearchCount.textContent = "0/0";
    }
    this.els.chatInput?.focus();
  }

  /**
   * Finds all message body text nodes matching the search query
   * and wraps matches in <mark> elements for highlighting.
   */
  _performSearch() {
    const query = (this.els.chatSearchInput?.value || "").trim();
    this._searchQuery = query;

    // Clear previous highlights
    this._clearSearchHighlights();

    if (!query) {
      if (this.els.chatSearchCount) this.els.chatSearchCount.textContent = "0/0";
      return;
    }

    const messages = this.els.chatMessages.querySelectorAll(".message-body");
    const matches = [];
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");

    messages.forEach((body) => {
      // Walk text nodes only
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        if (regex.test(text)) {
          // Split text node around matches
          const frag = document.createDocumentFragment();
          let lastIdx = 0;
          regex.lastIndex = 0;
          let match;
          while ((match = regex.exec(text)) !== null) {
            // Text before match
            if (match.index > lastIdx) {
              frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
            }
            // The highlighted match
            const mark = document.createElement("mark");
            mark.className = "search-highlight";
            mark.dataset.matchIdx = String(matches.length);
            mark.textContent = match[0];
            frag.appendChild(mark);
            matches.push(mark);
            lastIdx = regex.lastIndex;
          }
          // Remaining text after last match
          if (lastIdx < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
          }
          node.parentNode.replaceChild(frag, node);
        }
      }
    });

    this._searchMatches = matches;

    if (matches.length > 0) {
      this._searchCurrentIdx = 0;
      this._highlightActiveMatch(0);
      if (this.els.chatSearchCount) {
        this.els.chatSearchCount.textContent = `1/${matches.length}`;
      }
    } else {
      this._searchCurrentIdx = -1;
      if (this.els.chatSearchCount) {
        this.els.chatSearchCount.textContent = `0/0`;
      }
    }
  }

  _searchNext() {
    if (this._searchMatches.length === 0) return;
    const next = (this._searchCurrentIdx + 1) % this._searchMatches.length;
    this._searchCurrentIdx = next;
    this._highlightActiveMatch(next);
    if (this.els.chatSearchCount) {
      this.els.chatSearchCount.textContent = `${next + 1}/${this._searchMatches.length}`;
    }
  }

  _searchPrev() {
    if (this._searchMatches.length === 0) return;
    const prev = (this._searchCurrentIdx - 1 + this._searchMatches.length) % this._searchMatches.length;
    this._searchCurrentIdx = prev;
    this._highlightActiveMatch(prev);
    if (this.els.chatSearchCount) {
      this.els.chatSearchCount.textContent = `${prev + 1}/${this._searchMatches.length}`;
    }
  }

  _highlightActiveMatch(idx) {
    // Remove active class from all
    this._searchMatches.forEach((m) => m.classList.remove("active"));
    if (idx >= 0 && idx < this._searchMatches.length) {
      const el = this._searchMatches[idx];
      el.classList.add("active");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  _clearSearchHighlights() {
    // Restore innerHTML of message bodies (removes <mark> wrappers)
    const bodies = this.els.chatMessages.querySelectorAll(".message-body");
    bodies.forEach((body) => {
      if (body.querySelector(".search-highlight")) {
        body.innerHTML = body.innerHTML.replace(/<\/?mark[^>]*>/g, "");
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-SESSION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Carga las sesiones desde localStorage, o crea la sesión default si no existe.
   */
  async _initSessions() {
    let loaded = false;

    // 1. Try loading from SQLite via IPC if a project is open
    if (this._project && this._project.path) {
      try {
        const result = await window.lvzero["session:list"]({ projectPath: this._project.path });
        if (result && result.success && result.sessions && result.sessions.length > 0) {
          const sessionsMap = {};
          let maxCounter = 1;
          for (const s of result.sessions) {
            // Extract chat HTML from metadata JSON
            let metadata = {};
            if (s.metadata) {
              try {
                metadata = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
              } catch { /* ignore parse errors */ }
            }
            sessionsMap[s.id] = {
              id: s.id,
              name: s.name || s.id,
              html: metadata.html || "",
              createdAt: s.created_at ? s.created_at * 1000 : Date.now(),
            };
            // Track highest session counter for naming
            const num = parseInt((s.name || '').replace('Session ', '')) || 0;
            if (num > maxCounter) maxCounter = num;
          }
          this._sessions = sessionsMap;
          this._sessionCounter = maxCounter;
          loaded = true;
        }
      } catch (_) {
        // SQLite unavailable — fall back to localStorage
      }
    }

    // 2. Fallback: load from localStorage
    if (!loaded) {
      try {
        const stored = localStorage.getItem("lvzero_sessions");
        if (stored) {
          const parsed = JSON.parse(stored);
          this._sessions = parsed.sessions || {};
          this._currentSessionId = parsed.current || "default";
          this._sessionCounter = parsed.counter || 1;
        }
      } catch (_) {}
    }

    // Ensure default session exists
    if (!this._sessions["default"]) {
      this._sessions["default"] = {
        id: "default",
        name: "Session 1",
        html: "",
        createdAt: Date.now(),
      };
    }

    // Ensure the current session exists
    if (!this._sessions[this._currentSessionId]) {
      this._currentSessionId = "default";
    }

    this._renderSessionTabs();

    // Restore messages for current session
    const session = this._sessions[this._currentSessionId];
    if (session && session.html) {
      this.els.chatMessages.innerHTML = session.html;
    }
  }

  /**
   * Guarda el HTML actual del chat en la sesión activa.
   */
  _saveCurrentSession() {
    const html = this.els.chatMessages.innerHTML;
    if (this._sessions[this._currentSessionId]) {
      this._sessions[this._currentSessionId].html = html;
    }
    this._persistSessions();
  }

  /**
   * Persiste todas las sesiones en localStorage.
   */
  _persistSessions() {
    // Always persist to localStorage as fallback
    try {
      localStorage.setItem("lvzero_sessions", JSON.stringify({
        sessions: this._sessions,
        current: this._currentSessionId,
        counter: this._sessionCounter,
      }));
    } catch (_) {
      // localStorage quota exceeded — ignore silently
    }

    // Fire-and-forget: also persist to SQLite via IPC
    this._persistSessionsToDB().catch(() => {});
  }

  /**
   * Persist session data to SQLite (async, fire-and-forget).
   * Stores chat HTML inside the metadata JSON field.
   */
  async _persistSessionsToDB() {
    if (!this._project || !this._project.path) return;
    const projectPath = this._project.path;
    try {
      for (const sessionId of Object.keys(this._sessions)) {
        const s = this._sessions[sessionId];
        await window.lvzero["session:save"]({
          projectPath,
          id: s.id,
          name: s.name,
          created_at: Math.floor((s.createdAt || Date.now()) / 1000),
          metadata: { html: s.html || "" },
        });
      }
    } catch (_) {
      // SQLite persistence failed — localStorage fallback still works
    }
  }

  /**
   * Renderiza los tabs de sesiones en el header del chat.
   */
  _renderSessionTabs() {
    const container = this.els.sessionTabs;
    if (!container) return;

    container.innerHTML = "";
    const ids = Object.keys(this._sessions);

    // Sort: default first, then by creation date
    ids.sort((a, b) => {
      if (a === "default") return -1;
      if (b === "default") return 1;
      return (this._sessions[a].createdAt || 0) - (this._sessions[b].createdAt || 0);
    });

    for (const id of ids) {
      const s = this._sessions[id];
      const tab = document.createElement("div");
      tab.className = "session-tab" + (id === this._currentSessionId ? " active" : "");
      tab.dataset.sessionId = id;
      tab.textContent = s.name || id;
      // Close button (only for non-default sessions)
      if (id !== "default" && ids.length > 1) {
        const closeBtn = document.createElement("span");
        closeBtn.className = "session-close";
        closeBtn.textContent = "âœ•";
        closeBtn.title = "Close session";
        tab.appendChild(closeBtn);
      }
      container.appendChild(tab);
    }
  }

  /**
   * Cambia a otra sesión guardando la actual.
   */
  _switchSession(sessionId) {
    const target = this._sessions[sessionId];
    if (!target) return;

    // Save current session
    this._saveCurrentSession();

    // Clear conversation in orchestrator
    window.lvzero["agent:clear"]().catch(() => {});

    // Switch
    this._currentSessionId = sessionId;
    this._persistSessions();
    this._renderSessionTabs();

    // Restore target session messages
    if (target.html) {
      this.els.chatMessages.innerHTML = target.html;
    } else {
      // Fresh session
      this.els.chatMessages.innerHTML = `
        <div class="message system">
          <div class="message-avatar">⚡</div>
          <div class="message-content">
            <div class="message-header"><strong>System</strong></div>
            <div class="message-body">New session started.</div>
          </div>
        </div>
      `;
    }

    this.addLogEntry("info", `📂 Switched to session: ${target.name || sessionId}`);
  }

  /**
   * Crea una nueva sesión en blanco.
   */
  async _newSession() {
    const id = "session_" + Date.now();
    this._sessionCounter++;
    const name = `Session ${this._sessionCounter}`;

    this._sessions[id] = {
      id,
      name,
      html: "",
      createdAt: Date.now(),
    };

    // Save current before switching
    this._saveCurrentSession();

    // Clear orchestrator conversation
    await window.lvzero["agent:clear"]().catch(() => {});

    // Switch to new session
    this._currentSessionId = id;
    this._persistSessions();
    this._renderSessionTabs();

    // Reset chat display
    this.els.chatMessages.innerHTML = `
      <div class="message system">
        <div class="message-avatar">⚡</div>
        <div class="message-content">
          <div class="message-header"><strong>System</strong></div>
          <div class="message-body">${name} started. Ask anything!</div>
        </div>
      </div>
    `;

    // Focus input
    this.els.chatInput?.focus();
    this.addLogEntry("info", `âž• Created ${name}`);
  }

  /**
   * Cierra y elimina una sesión.
   */
  _closeSession(sessionId) {
    if (sessionId === "default") return; // Can't close default
    if (!this._sessions[sessionId]) return;

    delete this._sessions[sessionId];

    // If we deleted the current session, switch to default
    if (this._currentSessionId === sessionId) {
      this._switchSession("default");
    } else {
      this._persistSessions();
      this._renderSessionTabs();
    }

    this.addLogEntry("info", `🗑️ Session deleted: ${sessionId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Trigger a code review for the currently active file.
   * Calls the code-review:review IPC handler and displays results.
   */
  async _triggerCodeReview() {
    try {
      // Get current project path
      const projectInfo = await window.lvzero["project:info"]();
      if (!projectInfo || !projectInfo.path) {
        this._showToast("error", "❌ No project open — cannot run code review", 3000);
        return;
      }

      const projectPath = projectInfo.path;

      // Get current file from active tab
      const activeFilePath = this.activeTabPath;
      if (!activeFilePath || activeFilePath === "__welcome__") {
        // No active file — run review-all instead
        await this._triggerCodeReviewAll(projectPath);
        return;
      }

      this.addLogEntry("info", `📋 Running code review on ${activeFilePath}...`);

      const result = await window.lvzero["code-review:review"](projectPath, activeFilePath);
      if (!result || !result.success) {
        this.addLogEntry("error", `❌ Code review failed: ${result?.error || "unknown error"}`);
        return;
      }

      const review = result.result;
      this._showReviewResult(review);
    } catch (err) {
      this.addLogEntry("error", `❌ Code review error: ${err.message}`);
    }
  }

  /**
   * Trigger a code review for all changed files.
   */
  async _triggerCodeReviewAll(projectPath) {
    try {
      // If no projectPath provided, try to get it
      if (!projectPath) {
        const projectInfo = await window.lvzero["project:info"]();
        if (!projectInfo || !projectInfo.path) {
          this._showToast("error", "❌ No project open — cannot run code review", 3000);
          return;
        }
        projectPath = projectInfo.path;
      }

      this.addLogEntry("info", "📋 Running code review on all changed files...");

      const result = await window.lvzero["code-review:review-all"](projectPath);
      if (!result || !result.success) {
        this.addLogEntry("error", `❌ Code review-all failed: ${result?.error || "unknown error"}`);
        return;
      }

      const results = result.results;
      if (results.length === 0) {
        this.addLogEntry("info", "📋 No changed files to review");
        return;
      }

      this.addLogEntry("info", `📋 Reviewed ${results.length} file(s). Report: ${result.reportPath || "N/A"}`);

      // Show summary of results
      const avgScore = results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length;
      const scoreEmoji = avgScore >= 80 ? "🟢" : avgScore >= 50 ? "🟡" : "🔴";
      this._showToast("info", `📋 Review complete: ${results.length} files — avg score ${scoreEmoji} ${Math.round(avgScore)}/100`, 5000);
    } catch (err) {
      this.addLogEntry("error", `❌ Code review-all error: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FRONTEND-DESIGN AUDITOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Trigger a frontend design audit for the currently active file or project.
   * Calls the frontend:audit-file or frontend:audit-all IPC handler.
   */
  async _triggerFrontendAudit() {
    try {
      // Get current project path
      const projectInfo = await window.lvzero["project:info"]();
      if (!projectInfo || !projectInfo.path) {
        this._showToast("error", "❌ No project open — cannot run frontend audit", 3000);
        return;
      }

      const projectPath = projectInfo.path;

      // Get current file from active tab
      const activeFilePath = this.activeTabPath;
      if (!activeFilePath || activeFilePath === "__welcome__") {
        // No active file — run directory audit instead
        await this._triggerFrontendAuditAll(projectPath);
        return;
      }

      this.addLogEntry("info", `🎨 Running frontend design audit on ${activeFilePath}...`);

      const result = await window.lvzero["frontend:audit-file"](projectPath, activeFilePath);
      if (!result || !result.success) {
        this.addLogEntry("error", `❌ Frontend audit failed: ${result?.error || "unknown error"}`);
        return;
      }

      this._showFrontendAuditResult(result.result);
    } catch (err) {
      this.addLogEntry("error", `❌ Frontend audit error: ${err.message}`);
    }
  }

  /**
   * Trigger a frontend design audit for the entire project directory.
   */
  async _triggerFrontendAuditAll(projectPath) {
    try {
      // If no projectPath provided, try to get it
      if (!projectPath) {
        const projectInfo = await window.lvzero["project:info"]();
        if (!projectInfo || !projectInfo.path) {
          this._showToast("error", "❌ No project open — cannot run frontend audit", 3000);
          return;
        }
        projectPath = projectInfo.path;
      }

      this.addLogEntry("info", "🎨 Running frontend design audit on all project files...");

      const result = await window.lvzero["frontend:audit-all"](projectPath);
      if (!result || !result.success) {
        this.addLogEntry("error", `❌ Frontend audit-all failed: ${result?.error || "unknown error"}`);
        return;
      }

      const { files, summary, suggestions } = result;
      if (!files || files.length === 0) {
        this.addLogEntry("info", "🎨 No frontend files found to audit");
        return;
      }

      // Log summary
      const scoreEmoji = summary.avgScore >= 80 ? "🟢" : summary.avgScore >= 50 ? "🟡" : "🔴";
      this.addLogEntry("info", `🎨 Audit complete: ${summary.totalFiles} files — avg score ${scoreEmoji} ${summary.avgScore}/100 (${summary.criticalCount} critical, ${summary.errorCount} error, ${summary.warningCount} warning)`);

      // Log per-file results
      for (const file of files) {
        const fScoreEmoji = file.score >= 80 ? "🟢" : file.score >= 50 ? "🟡" : "🔴";
        const fileIssueCount = file.issues.length;
        this.addLogEntry("info", `  ${fScoreEmoji} ${file.fileName} (${file.fileType}): ${file.score}/100 — ${fileIssueCount} issue(s)`);
      }

      // Log suggestions
      if (suggestions && suggestions.length > 0) {
        this.addLogEntry("info", "🎨 Suggestions:");
        for (const s of suggestions.slice(0, 5)) {
          this.addLogEntry("info", `  💡 ${s}`);
        }
        if (suggestions.length > 5) {
          this.addLogEntry("info", `  ... and ${suggestions.length - 5} more suggestion(s)`);
        }
      }

      this._showToast(
        summary.avgScore >= 80 ? "success" : summary.avgScore >= 50 ? "info" : "warn",
        `🎨 UI Audit: ${summary.totalFiles} files — ${scoreEmoji} ${summary.avgScore}/100`,
        5000
      );
    } catch (err) {
      this.addLogEntry("error", `❌ Frontend audit-all error: ${err.message}`);
    }
  }

  /**
   * Display a single file's frontend audit result.
   */
  _showFrontendAuditResult(audit) {
    if (!audit) return;

    const score = audit.score || 0;
    const scoreEmoji = score >= 80 ? "🟢" : score >= 50 ? "🟡" : "🔴";
    const issues = audit.issues || [];

    const criticals = issues.filter((i) => i.severity === "critical").length;
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const infos = issues.filter((i) => i.severity === "info").length;

    // Log summary
    this.addLogEntry("info", `🎨 ${audit.fileName}: ${scoreEmoji} Score ${score}/100 (${criticals} critical, ${errors} error, ${warnings} warning, ${infos} info)`);

    // Log details
    for (const issue of issues) {
      const sevIcon = issue.severity === "critical" ? "🔴" : issue.severity === "error" ? "🟠" : issue.severity === "warning" ? "🟡" : "🔵";
      const lineInfo = issue.line > 0 ? `:${issue.line}` : "";
      this.addLogEntry("info", `  ${sevIcon} [${issue.severity}]${lineInfo} ${issue.message}`);
    }

    // Log suggestions
    if (audit.suggestions && audit.suggestions.length > 0) {
      this.addLogEntry("info", `  💡 Suggestions:`);
      for (const s of audit.suggestions) {
        this.addLogEntry("info", `    → ${s}`);
      }
    }

    // Toast with score
    const severityText = criticals > 0 ? `⚠️ ${criticals} critical` : errors > 0 ? `⚠️ ${errors} errors` : warnings > 0 ? `⚠️ ${warnings} warnings` : "✅ Clean";
    this._showToast(
      score >= 80 ? "success" : score >= 50 ? "info" : "warn",
      `🎨 ${audit.fileName}: ${scoreEmoji} ${score}/100 — ${severityText}`,
      5000
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPLOY PIPELINE (Phase 6)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Trigger the deploy pipeline for the current project.
   * Steps: audit → (if pass) offer to run full deploy pipeline.
   */
  async _triggerDeploy() {
    try {
      // Get current project path
      const projectInfo = await window.lvzero["project:info"]();
      if (!projectInfo || !projectInfo.path) {
        this._showToast("error", "❌ No project open — cannot run deploy pipeline", 3000);
        return;
      }

      const projectPath = projectInfo.path;
      this.addLogEntry("info", "🚀 Starting deploy pipeline...");

      // Step 1: Run pre-audit
      this.addLogEntry("info", "🔍 Running pre-deploy audit...");
      const auditResult = await window.lvzero["deploy:audit"](projectPath);

      if (!auditResult || !auditResult.success) {
        this.addLogEntry("error", `❌ Deploy audit failed: ${auditResult?.error || "unknown error"}`);
        return;
      }

      // Show audit results
      const { pass, warnings = [], blocks = [], details } = auditResult;

      if (blocks.length > 0) {
        this.addLogEntry("error", `🚫 Deploy blocked:`);
        for (const block of blocks) {
          this.addLogEntry("error", `  🔴 ${block}`);
        }
        this._showToast("error", "🚫 Deploy blocked by pre-audit checks", 5000);
        return;
      }

      if (warnings.length > 0) {
        this.addLogEntry("info", `⚠️ Audit warnings (${warnings.length}):`);
        for (const w of warnings) {
          this.addLogEntry("warn", `  ⚠️ ${w}`);
        }
      }

      if (pass) {
        this.addLogEntry("info", "✅ Pre-audit passed — project is ready for deploy");
        this._showToast("info", "✅ Pre-audit passed — running full deploy pipeline...", 3000);

        // Run full deploy pipeline
        const deployResult = await window.lvzero["deploy:run"](projectPath, {});

        if (!deployResult || !deployResult.success) {
          this.addLogEntry("error", `❌ Deploy pipeline failed: ${deployResult?.error || "unknown error"}`);
          return;
        }

        // Log each step
        const steps = deployResult.steps || [];
        for (const step of steps) {
          const icon = step.status === "ok" ? "✅" : step.status === "warning" ? "⚠️" : step.status === "skipped" ? "⏭️" : "❌";
          this.addLogEntry("info", `  ${icon} ${step.step}: ${step.status}`);
        }

        // Summary
        this.addLogEntry("info", `🚀 Deploy complete: ${deployResult.status} (${deployResult.duration || "?"}ms)`);
        if (deployResult.releaseId) {
          this.addLogEntry("info", `  📦 Release ID: ${deployResult.releaseId}`);
        }

        const statusEmoji = deployResult.status === "ok" ? "✅" : deployResult.status === "warning" ? "⚠️" : "❌";
        this._showToast(
          deployResult.status === "ok" ? "success" : "warn",
          `🚀 Deploy ${deployResult.status}: ${deployResult.message || ""}`,
          5000
        );
      } else {
        this.addLogEntry("warn", "⚠️ Pre-audit did not pass — deploy not executed");
        this._showToast("warn", "⚠️ Pre-audit failed — check logs for details", 4000);
      }
    } catch (err) {
      this.addLogEntry("error", `❌ Deploy pipeline error: ${err.message}`);
    }
  }

  /**
   * Show a single file's review result in the log and as a toast.
   */
  _showReviewResult(review) {
    if (!review) return;

    const score = review.score || 0;
    const scoreEmoji = score >= 80 ? "🟢" : score >= 50 ? "🟡" : "🔴";
    const allFindings = [
      ...(review.specCompliance || []),
      ...(review.codeQuality || []),
    ];

    const criticals = allFindings.filter((f) => f.severity === "critical").length;
    const errors = allFindings.filter((f) => f.severity === "error").length;
    const warnings = allFindings.filter((f) => f.severity === "warning").length;

    // Log summary
    this.addLogEntry("info", `📋 ${review.fileName}: ${scoreEmoji} Score ${score}/100 (${criticals} critical, ${errors} error, ${warnings} warning)`);

    // Log details
    for (const f of allFindings) {
      const sevIcon = f.severity === "critical" ? "🔴" : f.severity === "error" ? "🟠" : f.severity === "warning" ? "🟡" : "🔵";
      const lineInfo = f.line > 0 ? `:${f.line}` : "";
      this.addLogEntry("info", `  ${sevIcon} [${f.severity}]${lineInfo} ${f.message}`);
    }

    // Toast with score
    const severityText = criticals > 0 ? `⚠️ ${criticals} critical` : errors > 0 ? `⚠️ ${errors} errors` : warnings > 0 ? `⚠️ ${warnings} warnings` : "✅ Clean";
    this._showToast(
      score >= 80 ? "info" : "warn",
      `📋 ${review.fileName}: ${scoreEmoji} ${score}/100 — ${severityText}`,
      5000
    );
  }

  destroy() {
    // Unsubscribe from all events
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];

    // Stop file watcher
    try { window.lvzero["file:watchStop"](); } catch {}

    // Clear debounce timers
    if (this._fsUpdateTimer) clearTimeout(this._fsUpdateTimer);
    if (this._reloadFileDebounce) clearTimeout(this._reloadFileDebounce);

    // Dispose editor
    this.editor?.dispose();

    // Dispose terminal
    this.terminal?.dispose();

    // Destroy split instances
    if (this.splitHoriz) {
      try { this.splitHoriz.destroy(); } catch {}
      this.splitHoriz = null;
    }
    if (this.splitVert) {
      try { this.splitVert.destroy(); } catch {}
      this.splitVert = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── BOOT ────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Wait for DOM and lvzero API, then launch
document.addEventListener("DOMContentLoaded", () => {
  // Ensure lvzero API is available
  if (!window.lvzero) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#1e1e1e;color:#f44747;font-family:sans-serif;flex-direction:column;gap:12px;">
        <h2>â›” IPC Bridge Not Available</h2>
        <p>The lvzero API was not exposed. This app must run inside Electron.</p>
        <p style="color:#969696;font-size:12px;">Make sure the preload script is configured correctly in main.js</p>
      </div>
    `;
    return;
  }

  // Create and initialize IDE
  const ide = new IDEController();
  window.__ide = ide; // expose for debugging

  ide.init().catch((err) => {
    console.error("[IDE] Fatal init error:", err);
    ide.addLogEntry("error", `Fatal: ${err.message}`);
  });
});
