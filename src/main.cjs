/**
 * lv-zero — Electron Main Process (CJS)
 *
 * v2.1 — Reactive IPC Broadcast
 *   + shell:output → terminal:data forwarding (Terminal Reactiva)
 *   + File watcher auto-start for fs:update events (Explorador Reactivo)
 *   + Auto-open editor when agent creates/modifies files (Editor Reactivo)
 *   + View menu IPC handlers for panel toggle
 *
 * v2.0 — IDE Edition
 *   Proceso principal de Electron.
 *
 * v2.3 — Electron API Resolution
 *   Uses direct `require("electron")`. This relies on Electron's built-in
 *   module interception. If `browser_init.js` (electron/js2c/browser_init)
 *   from the V8 code cache fails to load, `require("electron")` may resolve
 *   to the npm package (returns string path to electron.exe) instead of the
 *   real Electron API.
 *
 *   Known issue: Electron 42 on Node.js v24 may sometimes fail to load
 *   the browser_init code cache, breaking `require("electron")`.
 *
 * v2.4 — ELECTRON_RUN_AS_NODE Fix
 *   Unsets ELECTRON_RUN_AS_NODE before requiring Electron. When this env var
 *   is set to '1', Electron runs as a plain Node.js process, skipping native
 *   C++ initialization (process.activateUvLoop, _linkedBinding, etc.), causing
 *   require("electron") to return the npm package's string path instead of the
 *   real Electron API object.
 */

// Critical: Unset ELECTRON_RUN_AS_NODE to ensure Electron API resolves properly.
// When set to '1', Electron skips native initialization — process.activateUvLoop
// won't exist, _linkedBinding('electron') fails, and the V8 code cache modules
// (browser_init, node_init, etc.) all crash.
delete process.env.ELECTRON_RUN_AS_NODE;

let app, BrowserWindow, ipcMain, dialog, session, Menu;
let electronModule;
try {
  electronModule = require("electron");
} catch (e) {
  console.warn('[Main] Electron module not found, using mock objects');
}
if (electronModule && typeof electronModule.app !== "undefined") {
  ({ app, BrowserWindow, ipcMain, dialog, session, Menu } = electronModule);
} else {
  // Fallback stubs for non‑Electron environments (e.g., CI or headless tests)
  console.warn('[Main] Electron not available, using mock objects');
  app = {
    // Return a resolved promise so callers can chain .then()
    whenReady: () => Promise.resolve(),
    getPath: () => '.',
    quit: () => {},
    // Minimal event emitter interface used later in the file
    on: (event, handler) => {},
    once: (event, handler) => {},
    addListener: (event, handler) => {},
    removeListener: (event, handler) => {},
  };
  BrowserWindow = class {};
  ipcMain = {
    handle: () => {},
    on: (channel, handler) => {
      // Mock: if handler is called, provide a mock event with .reply()
      const mockEvent = { reply: () => {}, sender: { send: () => {} } };
      handler(mockEvent);
    },
  };
  dialog = {};
  session = {};
  Menu = {};
}
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

// ─── Memory Database (Symphony + NeuralMemory) ─────────────────────────────
let MemoryDatabase;
let memoryBridge;
try {
  const mem = require('./core/memory/database.cjs');
  MemoryDatabase = mem.MemoryDatabase;
} catch (err) {
  console.warn('[Main] Memory database module not available:', err.message);
}

// ─── Symphony Bridge (Memory IPC handlers) ─────────────────────────────────
let registerMemoryIPC;
let SessionManager;
let registerSessionIPC;
try {
  const bridge = require('./core/memory/symphony-bridge.js');
  registerMemoryIPC = bridge.registerMemoryIPC;
} catch (err) {
  console.warn('[Main] Symphony bridge module not available:', err.message);
}
try {
  const sessionMod = require('./core/memory/session-manager.js');
  SessionManager = sessionMod.SessionManager;
  registerSessionIPC = sessionMod.registerSessionIPC;
} catch (err) {
  console.warn('[Main] Session manager module not available:', err.message);
}

// ─── Associative Search (Spreading Activation) ──────────────────────────────
let AssociativeSearch;
let registerAssociativeSearchIPC;
try {
  const asMod = require('./core/memory/associative-search.js');
  AssociativeSearch = asMod.AssociativeSearch;
  registerAssociativeSearchIPC = asMod.registerAssociativeSearchIPC;
} catch (err) {
  console.warn('[Main] Associative search module not available:', err.message);
}

// ─── Preflight Gate (Health/Project/Task Aggregation) ───────────────────────
let PreflightGate;
let registerPreflightGateIPC;
try {
  const pgMod = require('./core/memory/preflight-gate.js');
  PreflightGate = pgMod.PreflightGate;
  registerPreflightGateIPC = pgMod.registerPreflightGateIPC;
} catch (err) {
  console.warn('[Main] Preflight gate module not available:', err.message);
}

// ─── Workflow Triggers ──────────────────────────────────────────────────────
let WorkflowTriggerManager;
let registerWorkflowTriggerIPC;
try {
  const wtMod = require('./core/memory/workflow-triggers.js');
  WorkflowTriggerManager = wtMod.WorkflowTriggerManager;
  registerWorkflowTriggerIPC = wtMod.registerWorkflowTriggerIPC;
} catch (err) {
  console.warn('[Main] Workflow trigger module not available:', err.message);
}

// ─── Project Identity (Phase 1) ─────────────────────────────────────────────
let projectIdentity;
try {
  projectIdentity = require('./core/project-identity.cjs');
} catch (err) {
  console.warn('[Main] Project identity module not available:', err.message);
}

// ─── Permissions Module (Phase 2) ────────────────────────────────────────────
let permissionsModule;
try {
  permissionsModule = require('./core/permissions.cjs');
  console.log('[Main] Permissions module loaded');
} catch (err) {
  console.warn('[Main] Permissions module not available:', err.message);
}

// ─── Iron Laws (Phase 3) ─────────────────────────────────────────────────────
let ironLaws;
let ironLawsEvidence;
try {
  ironLaws = require('./core/iron-laws.cjs');
  console.log('[Main] Iron laws module loaded');
} catch (err) {
  console.warn('[Main] Iron laws module not available:', err.message);
}
try {
  ironLawsEvidence = require('./core/iron-laws-evidence.cjs');
  console.log('[Main] Iron laws evidence module loaded');
} catch (err) {
  console.warn('[Main] Iron laws evidence module not available:', err.message);
}

// ─── Secret Storage (Phase 0.1) ─────────────────────────────────────────────
let SecretStorage;
let secretStorageInstance = null;
try {
  const ss = require('./secret_storage.js');
  SecretStorage = ss.SecretStorage;
  console.log('[Main] Secret storage module loaded');
} catch (err) {
  console.warn('[Main] Secret storage module not available:', err.message);
}

// ─── Settings Store (Phase 6) ────────────────────────────────────────────────
let SettingsStore;
let settingsStoreInstance = null;
try {
  const ss = require('./settings_store.js');
  SettingsStore = ss.SettingsStore;
  console.log('[Main] Settings store module loaded');
} catch (err) {
  console.warn('[Main] Settings store module not available:', err.message);
}

// ─── Diagnose Wizard (Phase 10) ─────────────────────────────────────────────
let diagnoseWizard;
try {
  diagnoseWizard = require('./core/diagnose-wizard.cjs');
  console.log('[Main] Diagnose wizard module loaded');
} catch (err) {
  console.warn('[Main] Diagnose wizard module not available:', err.message);
}

// ─── Grill Me Wizard (Phase 4 – Scope Interview) ────────────────────────────
let grillMeWizard;
try {
  grillMeWizard = require('./core/grill-me-wizard.cjs');
  console.log('[Main] Grill Me wizard module loaded');
} catch (err) {
  console.warn('[Main] Grill Me wizard module not available:', err.message);
}

// ─── Init Pipeline (Phase 4) ─────────────────────────────────────────────────
let initPipeline;
try {
  initPipeline = require('./core/init-pipeline.cjs');
  console.log('[Main] Init pipeline module loaded');
} catch (err) {
  console.warn('[Main] Init pipeline module not available:', err.message);
}

// ─── Code Review Pipeline (Phase 5) ──────────────────────────────────────────
let codeReview;
try {
  codeReview = require('./core/code-review.cjs');
  console.log('[Main] Code review module loaded');
} catch (err) {
  console.warn('[Main] Code review module not available:', err.message);
}

// ─── Frontend-Design Auditor ─────────────────────────────────────────────────
let frontendAuditor;
try {
  frontendAuditor = require('./core/frontend-auditor.cjs');
  console.log('[Main] Frontend auditor module loaded');
} catch (err) {
  console.warn('[Main] Frontend auditor module not available:', err.message);
}

// ─── Deploy Pipeline (Phase 6) ───────────────────────────────────────────────
let deployPipeline;
try {
  deployPipeline = require('./core/deploy-pipeline.cjs');
  console.log('[Main] Deploy pipeline module loaded');
} catch (err) {
  console.warn('[Main] Deploy pipeline module not available:', err.message);
}

// ─── Smart Launcher (Phase 7) ─────────────────────────────────────────────────
let smartLauncher;
try {
  smartLauncher = require('./core/smart-launcher.cjs');
  console.log('[Main] Smart launcher module loaded');
} catch (err) {
  console.warn('[Main] Smart launcher module not available:', err.message);
}

// ─── Timer System (Unified Timer & Timeout Management) ─────────────────────────
let timerSystem;
try {
  timerSystem = require('./core/timer-system.cjs');
  console.log('[Main] Timer system module loaded');
} catch (err) {
  console.warn('[Main] Timer system module not available:', err.message);
}

// ─── Agent Browser (BrowserView/WebView automation) ────────────────────────────
let agentBrowser;
let browserCommands;
try {
  agentBrowser = require('./core/agent-browser.cjs');
  browserCommands = require('./core/agent-browser-commands.cjs');
  console.log('[Main] Agent browser module loaded');
} catch (err) {
  console.warn('[Main] Agent browser module not available:', err.message);
}

// ─── Memory Audit (6-Dimension Quality Audit) ────────────────────────────────
let MemoryAudit;
let registerMemoryAuditIPC;
try {
const maMod = require('./core/memory/memory-audit.js');
MemoryAudit = maMod.MemoryAudit;
registerMemoryAuditIPC = maMod.registerMemoryAuditIPC;
} catch (err) {
console.warn('[Main] Memory audit module not available:', err.message);
}

// ─── Memory Evolution (Pruning + Consolidation) ──────────────────────────────
let MemoryEvolution;
let registerMemoryEvolutionIPC;
try {
const meMod = require('./core/memory/memory-evolution.js');
MemoryEvolution = meMod.MemoryEvolution;
registerMemoryEvolutionIPC = meMod.registerMemoryEvolutionIPC;
} catch (err) {
console.warn('[Main] Memory evolution module not available:', err.message);
}

// ─── File Logger (portable/diagnostics) ─────────────────────────────────────
// Writes ALL console output to a file in userData/logs/.
// Critical for debugging silent crashes in portable mode.
let _logPath = null;
let _logStream = null;

function setupFileLogger() {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    _logPath = path.join(logDir, `lv-zero-${timestamp}.log`);
    _logStream = fs.createWriteStream(_logPath, { flags: "a" });

    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;

    console.log = (...args) => {
      _logStream.write(`[LOG] ${new Date().toISOString()} ${args.join(" ")}\n`);
      origLog.apply(console, args);
    };
    console.error = (...args) => {
      _logStream.write(`[ERR] ${new Date().toISOString()} ${args.join(" ")}\n`);
      origError.apply(console, args);
    };
    console.warn = (...args) => {
      _logStream.write(`[WRN] ${new Date().toISOString()} ${args.join(" ")}\n`);
      origWarn.apply(console, args);
    };

    process.on("uncaughtException", (err) => {
      _logStream.write(`[FATAL] ${new Date().toISOString()} Uncaught: ${err.stack || err.message}\n`);
      _logStream.end();
    });

    process.on("unhandledRejection", (reason) => {
      _logStream.write(`[FATAL] ${new Date().toISOString()} Unhandled Rejection: ${reason}\n`);
    });

    console.log(`[Main] File logger started → ${_logPath}`);
    return _logPath;
  } catch (err) {
    // Can't log to file if logger setup fails, use stderr
    process.stderr.write(`[Main] Failed to setup file logger: ${err.message}\n`);
    return null;
  }
}

// ─── Orchestrator (loaded dynamically) ──────────────────────────────────────
let orchestrator = null;

// ---------------------------------------------------------------------------
// Stub for the agent IPC handler registration. In a full Electron environment
// this would set up ipcMain.handle('agent:send', ...) to forward user input to
// the orchestrator. For headless/testing scenarios we provide a no‑op
// implementation to avoid ReferenceError.
function registerAgentHandler() {
  // The actual handler is defined later in the file (see ipcMain.handle).
  // This stub ensures the call succeeds when the orchestrator is loaded in a
  // non‑Electron context.
}

// ─── Bridges (loaded dynamically) ──────────────────────────────────────────
let terminalBridge = null;
let fileBridge = null;

let mainWindow = null;

// ─── Project Management ─────────────────────────────────────────────────────
let currentProjectPath = null;

// ─── Panel visibility state (for View menu) ─────────────────────────────────
const panelState = {
  explorer: true,
  chat: true,
  terminal: true,
  inspector: false,
};

// ─── Pending Diff Reviews (Misión 2) ────────────────────────────────────────
// Map<filePath, { originalContent, newContent }>
const pendingDiffReviews = new Map();

// ─── Initialization ─────────────────────────────────────────────────────────
async function init() {
  console.log('[Main] Initializing application...');

  // Setup file logger
  setupFileLogger();

  // Load orchestrator
  try {
    // Dynamically import the orchestrator (ESM) to avoid require() errors.
    const orchestratorModule = await import('./core/orchestrator.js');
    const Orchestrator = orchestratorModule.default;
    orchestrator = new Orchestrator();
    // Some orchestrator implementations may not expose an async init method.
    if (typeof orchestrator.init === 'function') {
      await orchestrator.init();
    }
  console.log('[Main] Orchestrator loaded');
    // Register the agent IPC handler now that the orchestrator is ready.
    registerAgentHandler();
  } catch (err) {
  console.error('[Main] Failed to load orchestrator:', err);
  }

  // Load bridges
  try {
    const terminalModule = await import('./terminal_bridge.js');
    terminalBridge = terminalModule.default || terminalModule;
    console.log('[Main] Terminal bridge loaded');
  } catch (err) {
    console.error('[Main] Failed to load terminal bridge:', err);
  }

  try {
    const fileModule = await import('./file_bridge.js');
    fileBridge = fileModule.default || fileModule;
    console.log('[Main] File bridge loaded');
  } catch (err) {
    console.error('[Main] Failed to load file bridge:', err);
  }

  // ── Initialize memory database ──────────────────────────────────────────
  if (MemoryDatabase) {
    try {
      MemoryDatabase.getSymphonyInstance();
      console.log('[Main] Symphony database initialized');
    } catch (err) {
      console.warn('[Main] Could not initialize symphony database:', err.message);
    }
  }

  // Create main window
  createWindow();

  // Setup application menu (File > Project Management, View > Toggle Panels)
  setupAppMenu();

  // Setup IPC handlers
  setupIPC();

  // Setup bridge IPC if bridges are loaded
  if (terminalBridge) {
    terminalBridge.setupTerminalIPC(ipcMain, mainWindow);
  }
  if (fileBridge) {
    fileBridge.setupFileIPC(ipcMain, mainWindow);
  }

  // ── Initialize memory IPC handlers ─────────────────────────────────────
  if (registerMemoryIPC) {
    try {
      registerMemoryIPC(ipcMain);
      console.log('[Main] Memory IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register memory IPC:', err.message);
    }
  }

  // ── Initialize session manager and IPC handlers ─────────────────────────
  let sessionManagerInstance = null;
  if (SessionManager && MemoryDatabase) {
    try {
      const symDb = MemoryDatabase.getSymphonyInstance();
      sessionManagerInstance = new SessionManager(symDb, mainWindow || null);
      console.log('[Main] SessionManager initialized');
    } catch (err) {
      console.warn('[Main] Could not initialize SessionManager:', err.message);
    }
  }
  if (registerSessionIPC && sessionManagerInstance) {
    try {
      registerSessionIPC(ipcMain, sessionManagerInstance);
      console.log('[Main] Session IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register session IPC:', err.message);
    }
  }

  // ── Initialize Associative Search IPC handlers ────────────────────────────
  if (AssociativeSearch && registerAssociativeSearchIPC) {
    try {
      const searchEngine = new AssociativeSearch();
      registerAssociativeSearchIPC(ipcMain, searchEngine);
      console.log('[Main] Associative search IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register associative search IPC:', err.message);
    }
  }

  // ── Initialize Preflight Gate IPC handlers ─────────────────────────────────
  if (PreflightGate && registerPreflightGateIPC) {
    try {
      const preflightGate = new PreflightGate(null, sessionManagerInstance, orchestrator);
      registerPreflightGateIPC(ipcMain, preflightGate);
      console.log('[Main] Preflight gate IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register preflight gate IPC:', err.message);
    }
  }

  // ── Initialize Workflow Trigger IPC handlers ──────────────────────────────
  if (WorkflowTriggerManager && registerWorkflowTriggerIPC) {
    try {
      const symDb = MemoryDatabase ? MemoryDatabase.getSymphonyInstance() : null;
      const triggerManager = new WorkflowTriggerManager(symDb, orchestrator);
      triggerManager.initialize().catch(err => {
        console.warn('[Main] Workflow trigger initialization deferred:', err.message);
      });
      registerWorkflowTriggerIPC(ipcMain, triggerManager);
      console.log('[Main] Workflow trigger IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register workflow trigger IPC:', err.message);
    }
  }

  // ── Initialize Memory Audit IPC handlers ───────────────────────────────────
  if (MemoryAudit && registerMemoryAuditIPC) {
    try {
      const audit = new MemoryAudit(MemoryDatabase);
      registerMemoryAuditIPC(ipcMain, audit);
      console.log('[Main] Memory audit IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register memory audit IPC:', err.message);
    }
  }

  // ── Initialize Memory Evolution IPC handlers ───────────────────────────────
  if (MemoryEvolution && registerMemoryEvolutionIPC) {
    try {
      const evolution = new MemoryEvolution(MemoryDatabase);
      registerMemoryEvolutionIPC(ipcMain, evolution);
      console.log('[Main] Memory evolution IPC handlers registered');
    } catch (err) {
      console.warn('[Main] Could not register memory evolution IPC:', err.message);
    }
  }

  // ── Initialize Secret Storage (Phase 0.1) ──────────────────────────────
  if (SecretStorage) {
    try {
      // Determine DB path based on environment
      let dbPath;
      try {
        // Electron mode: use app.getPath('userData')
        dbPath = path.join(app.getPath('userData'), 'lvzero-secrets.db');
      } catch {
        // CLI mode: use .lv-zero-data in current directory
        dbPath = path.join(process.cwd(), '.lv-zero-data', 'secrets.db');
      }

      secretStorageInstance = new SecretStorage(dbPath);
      await secretStorageInstance.init();
      console.log('[Main] Secret storage initialized');
    } catch (err) {
      console.warn('[Main] Could not initialize secret storage:', err.message);
    }
  }

  // ── Initialize Settings Store (Phase 6) ──────────────────────────────
  if (SettingsStore) {
    try {
      // Determine DB path based on environment (same as secret storage)
      let dbPath;
      try {
        dbPath = path.join(app.getPath('userData'), 'lvzero-settings.db');
      } catch {
        dbPath = path.join(process.cwd(), '.lv-zero-data', 'settings.db');
      }

      settingsStoreInstance = new SettingsStore(dbPath);
      settingsStoreInstance.init();
      console.log('[Main] Settings store initialized');
    } catch (err) {
      console.warn('[Main] Could not initialize settings store:', err.message);
    }
  }

  // Connect orchestrator events if available
  if (orchestrator) {
    connectOrchestratorEvents();
  }

  // Connect shell output forwarding
  connectShellOutput();

  // Start file watcher if file bridge is available
  if (fileBridge && fileBridge.startFileWatcher) {
    const APP_ROOT = path.resolve(__dirname, "..");
    fileBridge.startFileWatcher(mainWindow, APP_ROOT);
  }

  // ── Auto-restore last project ──────────────────────────────────────────
  // On startup, if there was a project open when the app last closed,
  // automatically reopen it (like VS Code's "restore window" behavior).
  try {
    const registry = loadProjectRegistry();
    const lastProjectPath = registry.lastProjectPath || registry.currentProjectPath;
    if (lastProjectPath && fs.existsSync(lastProjectPath)) {
      console.log(`[Main] Auto-restoring last project: ${lastProjectPath}`);
      const projectName = path.basename(lastProjectPath);

      // Restore orchestrator project path
      if (orchestrator && orchestrator.setProjectPath) {
        orchestrator.setProjectPath(lastProjectPath).catch(() => {});
      }

      // Restore file bridge
      if (fileBridge && fileBridge.setAllowedBase) {
        fileBridge.setAllowedBase(lastProjectPath);
      }

      // Restart file watcher
      if (fileBridge && fileBridge.stopFileWatcher && fileBridge.startFileWatcher && mainWindow && !mainWindow.isDestroyed()) {
        fileBridge.stopFileWatcher();
        fileBridge.startFileWatcher(mainWindow, lastProjectPath);
      }

      process.chdir(lastProjectPath);
      currentProjectPath = lastProjectPath;

      // Load workspace state to send to renderer
      const workspaceState = loadWorkspaceState(lastProjectPath);

      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("project:changed", {
          name: projectName,
          path: lastProjectPath,
          action: "restored",
          workspaceState: workspaceState || null,
        });
      }

      console.log(`[Main] Last project restored: ${lastProjectPath}`);
    }
  } catch (err) {
    console.warn("[Main] Could not auto-restore last project:", err.message);
  }

  console.log('[Main] Application initialized');
}

// ─── Window Management ──────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      webviewTag: true,
    },
    icon: path.join(__dirname, '..', 'LOGOLVZERO.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  // Open devtools in development
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Application Menu (with File → Project Management) ──────────────────────

function setupAppMenu() {
  if (!Menu || !Menu.buildFromTemplate) return;
  const template = [
    {
      label: "File",
      submenu: [
        { label: "New Project...", accelerator: "CmdOrCtrl+Shift+N", click: () => { mainWindow?.webContents.send("project:menuAction", { action: "new" }); } },
        { label: "Open Project...", accelerator: "CmdOrCtrl+Shift+O", click: () => { mainWindow?.webContents.send("project:menuAction", { action: "open" }); } },
        { label: "Close Project", accelerator: "CmdOrCtrl+Shift+W", click: () => { mainWindow?.webContents.send("project:menuAction", { action: "close" }); } },
        { type: "separator" },
        { label: "Duplicate Project...", click: () => { mainWindow?.webContents.send("project:menuAction", { action: "duplicate" }); } },
        { label: "Export Project as ZIP...", click: () => { mainWindow?.webContents.send("project:menuAction", { action: "export" }); } },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Explorer Panel", accelerator: "CmdOrCtrl+B", click: () => { mainWindow?.webContents.send("view:toggle-explorer"); } },
        { label: "Toggle Chat Panel", accelerator: "CmdOrCtrl+J", click: () => { mainWindow?.webContents.send("view:toggle-chat"); } },
        { label: "Toggle Terminal Panel", accelerator: "CmdOrCtrl+`", click: () => { mainWindow?.webContents.send("view:toggle-terminal"); } },
        { type: "separator" },
        { role: "toggleDevTools" },
        { role: "reload" },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── Project Registry Helpers ───────────────────────────────────────────────

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function getProjectsFilePath() {
  return path.join(app.getPath("userData"), "projects.json");
}

function loadProjectRegistry() {
  try {
    const filePath = getProjectsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.recentProjects)) {
        return data;
      }
    }
  } catch (err) {
    console.warn("[Main] Could not load project registry:", err.message);
  }
  return { recentProjects: [], currentProjectPath: null };
}

function saveProjectRegistry(registry) {
  try {
    const filePath = getProjectsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(registry, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Main] Could not save project registry:", err.message);
  }
}

function addRecentProject(projectPath) {
  const registry = loadProjectRegistry();
  // Remove existing entry with same path (dedupe)
  registry.recentProjects = registry.recentProjects.filter((p) => p.path !== projectPath);
  // Add to front with workspaceId (like VS Code's workspaceStorage hash)
  registry.recentProjects.unshift({
    name: path.basename(projectPath),
    path: projectPath,
    workspaceId: getWorkspaceId(projectPath),
    lastOpened: new Date().toISOString(),
  });
  // Cap at 20
  if (registry.recentProjects.length > 20) {
    registry.recentProjects = registry.recentProjects.slice(0, 20);
  }
  registry.currentProjectPath = projectPath;
  registry.lastProjectPath = projectPath; // Track for auto-restore
  currentProjectPath = projectPath;
  saveProjectRegistry(registry);
  return registry;
}

function removeRecentProject(projectPath) {
  const registry = loadProjectRegistry();
  registry.recentProjects = registry.recentProjects.filter((p) => p.path !== projectPath);
  if (registry.currentProjectPath === projectPath) {
    registry.currentProjectPath = null;
    currentProjectPath = null;
  }
  saveProjectRegistry(registry);
}

// ─── Workspace State (per-project persistence, inspired by VS Code's workspaceStorage) ───

/**
 * Generate a deterministic workspace ID from a project path.
 * Uses MD5 hash of the lowercased path (same as VS Code's approach).
 */
function getWorkspaceId(projectPath) {
  return crypto.createHash("md5").update(projectPath.toLowerCase()).digest("hex");
}

/**
 * Get the workspace storage directory for a given project path.
 * Creates the directory if it doesn't exist.
 */
function getWorkspaceDir(projectPath) {
  const workspaceId = getWorkspaceId(projectPath);
  const dir = path.join(app.getPath("userData"), "workspaceStorage", workspaceId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Load per-project workspace state from disk.
 * Returns default state if no saved state exists.
 */
function loadWorkspaceState(projectPath) {
  try {
    const workspaceId = getWorkspaceId(projectPath);
    const stateFile = path.join(app.getPath("userData"), "workspaceStorage", workspaceId, "state.json");
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, "utf-8");
      const state = JSON.parse(raw);
      return state;
    }
  } catch (err) {
    console.warn(`[Main] Could not load workspace state for ${projectPath}:`, err.message);
  }
  return null;
}

/**
 * Save per-project workspace state to disk.
 */
function saveWorkspaceState(projectPath, state) {
  try {
    const dir = getWorkspaceDir(projectPath);
    const stateFile = path.join(dir, "state.json");
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
    console.log(`[Main] Workspace state saved for ${path.basename(projectPath)}`);
  } catch (err) {
    console.warn(`[Main] Could not save workspace state for ${projectPath}:`, err.message);
  }
}

/**
 * Save the workspace.json mapping (hash → folder path), same pattern as VS Code.
 */
function saveWorkspaceMapping(projectPath) {
  try {
    const dir = getWorkspaceDir(projectPath);
    const mappingFile = path.join(dir, "workspace.json");
    const folderUri = "file:///" + projectPath.replace(/\\/g, "/").replace(/^\/?/, "");
    fs.writeFileSync(mappingFile, JSON.stringify({ folder: folderUri }, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[Main] Could not save workspace mapping:`, err.message);
  }
}

/**
 * Get the default workspace state structure.
 */
function getDefaultWorkspaceState(projectPath) {
  return {
    version: 1,
    projectPath: projectPath,
    lastOpened: new Date().toISOString(),
    openTabs: [],
    activeTab: null,
    panelLayout: {
      explorer: true,
      chat: true,
      terminal: false,
      sidebarWidth: 300,
    },
    windowState: null,
    lastActiveMode: null,
    lastActiveFile: null,
  };
}

// ─── Centralized IPC Error Handler (Phase 6) ────────────────────────────────
/**
 * Wraps an IPC handler with centralized error handling.
 * Catches any thrown errors and returns a standardized error response
 * instead of crashing the renderer process.
 *
 * @param {Function} handler - Async handler function (event, ...args) => Promise<any>
 * @returns {Function} Wrapped handler
 */
function wrapIPCHandler(handler) {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      console.error(`[IPC Error] ${err.code || 'UNKNOWN'}: ${err.message}`);
      return { success: false, error: err.message, code: err.code || 'UNKNOWN' };
    }
  };
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────
function setupIPC() {
  // View menu handlers
  ipcMain.on('view:toggle-explorer', () => {
    panelState.explorer = !panelState.explorer;
    if (mainWindow) {
      mainWindow.webContents.send('view:explorer-toggled', panelState.explorer);
    }
  });

  ipcMain.on('view:toggle-chat', () => {
    panelState.chat = !panelState.chat;
    if (mainWindow) {
      mainWindow.webContents.send('view:chat-toggled', panelState.chat);
    }
  });

  ipcMain.on('view:toggle-terminal', () => {
    panelState.terminal = !panelState.terminal;
    if (mainWindow) {
      mainWindow.webContents.send('view:terminal-toggled', panelState.terminal);
    }
  });

  ipcMain.on('view:toggle-inspector', () => {
    panelState.inspector = !panelState.inspector;
    if (mainWindow) {
      mainWindow.webContents.send('view:inspector-toggled', panelState.inspector);
    }
  });

  // ── Panel toggle (used by UI) ────────────────────────────────────────
  ipcMain.handle('panel:toggle', wrapIPCHandler(async (_event, panelId) => {
    if (panelState[panelId] === undefined) {
      return { success: false, error: 'Invalid panel ID' };
    }
    panelState[panelId] = !panelState[panelId];
    // Notify renderer of new visibility state
    mainWindow?.webContents.send('panel:visibility', { panelId, visible: panelState[panelId] });
    return { success: true, panelId, visible: panelState[panelId] };
  }));

  // ── Dialog: Open Directory (Phase 9 — Project Wizard) ──
  ipcMain.handle("dialog:openDirectory", wrapIPCHandler(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Project Directory",
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { cancelled: true };
    }
    return { cancelled: false, path: result.filePaths[0] };
  }));

  // ── Dialog: Open File ──
  ipcMain.handle("dialog:openFile", wrapIPCHandler(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Select File",
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { cancelled: true };
    }
    return { cancelled: false, path: result.filePaths[0] };
  }));

  // Orchestrator communication
  ipcMain.on('orchestrator:execute-workflow', async (event, workflowId, inputs) => {
    if (!orchestrator) {
      event.reply('orchestrator:workflow-result', {
        success: false,
        error: 'Orchestrator not available',
      });
      return;
    }

    try {
      const result = await orchestrator.executeWorkflow(workflowId, inputs);
      event.reply('orchestrator:workflow-result', {
        success: true,
        result,
      });
    } catch (err) {
      event.reply('orchestrator:workflow-result', {
        success: false,
        error: err.message,
      });
    }
  });

  ipcMain.on('orchestrator:list-workflows', async (event) => {
    if (!orchestrator) {
      event.reply('orchestrator:workflows-list', {
        success: false,
        error: 'Orchestrator not available',
      });
      return;
    }

    try {
      const workflows = await orchestrator.listWorkflows();
      event.reply('orchestrator:workflows-list', {
        success: true,
        workflows,
      });
    } catch (err) {
      event.reply('orchestrator:workflows-list', {
        success: false,
        error: err.message,
      });
    }
  });

  // File operations are now handled by file_bridge.setupFileIPC

  // Diff review system (Misión 2)
  ipcMain.handle('diff:create-review', wrapIPCHandler(async (event, filePath, originalContent, newContent) => {
    pendingDiffReviews.set(filePath, { originalContent, newContent });
    return { success: true, reviewId: filePath };
  }));

  ipcMain.handle('diff:get-review', wrapIPCHandler(async (event, filePath) => {
    const review = pendingDiffReviews.get(filePath);
    if (!review) {
      return { success: false, error: 'Review not found' };
    }
    return { success: true, ...review };
  }));

  ipcMain.handle('diff:apply-review', wrapIPCHandler(async (event, filePath) => {
    const review = pendingDiffReviews.get(filePath);
    if (!review) {
      return { success: false, error: 'Review not found' };
    }

    await fs.promises.writeFile(filePath, review.newContent, 'utf8');
    pendingDiffReviews.delete(filePath);
    return { success: true };
  }));

  ipcMain.handle('diff:discard-review', wrapIPCHandler(async (event, filePath) => {
    pendingDiffReviews.delete(filePath);
    return { success: true };
  }));

  // ── Config: Auto-Approve ───────────────────────────────────────────────
  ipcMain.handle('config:setAutoApprove', wrapIPCHandler(async (event, settings) => {
    // Store config and forward to orchestrator/settings
    if (orchestrator && orchestrator.setAutoApprove) {
      await orchestrator.setAutoApprove(settings);
    }
    return { success: true };
  }));

  // ── Project Management ─────────────────────────────────────────────────

  /**
   * Shared helper: creates project directory structure, registers workspace.
   */
  async function _createProjectAt(projectPath, projectName) {
    // Create directory if it doesn't exist
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    // Init .lv-zero folder inside project
    const lvZeroDir = path.join(projectPath, ".lv-zero");
    if (!fs.existsSync(lvZeroDir)) {
      fs.mkdirSync(lvZeroDir, { recursive: true });
      fs.writeFileSync(path.join(lvZeroDir, ".gitkeep"), "");
    }

    // Init mapa-del-proyecto folder inside project
    const mapDir = path.join(projectPath, "mapa-del-proyecto");
    if (!fs.existsSync(mapDir)) {
      fs.mkdirSync(mapDir, { recursive: true });
      fs.writeFileSync(
        path.join(mapDir, "README.md"),
        `# 🗺️ Mapa del Proyecto: ${projectName}\n\n` +
        `Generado automáticamente por lv-zero.\n\n` +
        `Este directorio contiene metadatos del proyecto y enlaces simbólicos\n` +
        `a la salida de graphify (graphify-out/).\n\n` +
        `## Contenido\n\n` +
        `- \`graph.json\` → Enlace al último grafo de proyecto generado\n` +
        `- \`structure.md\` → Resumen de estructura del proyecto\n` +
        `- \`callflow.html\` → Diagrama de flujo de llamadas\n` +
        `\n---\n*Creado: ${new Date().toISOString()}*\n`
      );
    }

    addRecentProject(projectPath);
    saveWorkspaceMapping(projectPath);
    process.chdir(projectPath);
    console.log(`[Main] Project created: ${projectPath}`);

    // Ensure project identity config is created
    try {
      if (projectIdentity && projectIdentity.ensureConfig) {
        projectIdentity.ensureConfig(projectPath);
        console.log(`[Main] Project identity ensured for: ${projectPath}`);
      }
    } catch (identityErr) {
      console.warn('[Main] Could not create project identity:', identityErr.message);
    }

    // Sync orchestrator to the new project
    if (orchestrator && orchestrator.setProjectPath) {
      await orchestrator.setProjectPath(projectPath);
    }

    // Sync file bridge (explorer panel) to the new project
    if (fileBridge && fileBridge.setAllowedBase) {
      fileBridge.setAllowedBase(projectPath);
    }

    // Restart file watcher to watch the new project
    if (fileBridge && fileBridge.stopFileWatcher && fileBridge.startFileWatcher && mainWindow && !mainWindow.isDestroyed()) {
      fileBridge.stopFileWatcher();
      fileBridge.startFileWatcher(mainWindow, projectPath);
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("project:changed", {
        name: projectName,
        path: projectPath,
        action: "created",
      });
    }

    return { success: true, name: projectName, path: projectPath };
  }

  /**
   * Create a new project — opens native save dialog for location + name.
   * If options.path and options.name are provided (e.g. from wizard), skip dialog.
   * Creates .lv-zero/ and mapa-del-proyecto/ inside the project folder.
   */
  ipcMain.handle("project:new", wrapIPCHandler(async (_event, options = {}) => {
    // If wizard provided path+name, use them directly (skip dialog)
    if (options.path && options.name) {
      const projectPath = path.join(options.path, options.name);
      return await _createProjectAt(projectPath, options.name);
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Create new project — navigate to location, type project name",
      defaultPath: path.join(os.homedir(), "my-project"),
      buttonLabel: "Create Project",
      properties: [],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    let projectPath = result.filePath;

    // Strip file extension if the user accidentally added one
    if (!fs.existsSync(projectPath)) {
      const ext = path.extname(projectPath);
      if (ext) {
        const withoutExt = projectPath.slice(0, -ext.length);
        if (fs.existsSync(path.dirname(withoutExt))) {
          projectPath = withoutExt;
        }
      }
    }

    const projectName = path.basename(projectPath);
    return await _createProjectAt(projectPath, projectName);
  }));

  /**
   * Open an existing project folder.
   */
  ipcMain.handle("project:open", wrapIPCHandler(async (_event, { path: projectPath } = {}) => {
    let targetPath = projectPath;

    if (!targetPath) {
      // Show folder picker dialog
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Open Project",
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      targetPath = result.filePaths[0];
    }

    if (!fs.existsSync(targetPath)) {
      return { success: false, error: `Directory not found: ${targetPath}` };
    }

    const projectName = path.basename(targetPath);

    // Save current workspace state before switching
    if (currentProjectPath) {
      const currentState = loadWorkspaceState(currentProjectPath);
      if (currentState) {
        currentState.lastOpened = new Date().toISOString();
        saveWorkspaceState(currentProjectPath, currentState);
      }
    }

    addRecentProject(targetPath);
    saveWorkspaceMapping(targetPath);
    process.chdir(targetPath);
    console.log(`[Main] Project opened: ${targetPath}`);

    // Sync orchestrator to the opened project
    if (orchestrator && orchestrator.setProjectPath) {
      await orchestrator.setProjectPath(targetPath);
    }

    // Sync file bridge (explorer panel) to the opened project
    if (fileBridge && fileBridge.setAllowedBase) {
      fileBridge.setAllowedBase(targetPath);
    }

    // Restart file watcher to watch the opened project
    if (fileBridge && fileBridge.stopFileWatcher && fileBridge.startFileWatcher && mainWindow && !mainWindow.isDestroyed()) {
      fileBridge.stopFileWatcher();
      fileBridge.startFileWatcher(mainWindow, targetPath);
    }

    // Load project identity
    let identity = null;
    try {
      if (projectIdentity && projectIdentity.resolveConfig) {
        identity = projectIdentity.resolveConfig(targetPath);
      }
    } catch (identityErr) {
      console.warn('[Main] Could not load project identity:', identityErr.message);
    }

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("project:changed", {
        name: projectName,
        path: targetPath,
        action: "opened",
        identity,
      });
    }

    return { success: true, name: projectName, path: targetPath, identity };
  }));

  /**
   * Close the current project and reset to lv-zero root.
   */
  ipcMain.handle("project:close", wrapIPCHandler(async () => {
    if (currentProjectPath) {
      console.log(`[Main] Closing project: ${currentProjectPath}`);

      // Save workspace state before closing
      const currentState = loadWorkspaceState(currentProjectPath);
      if (currentState) {
        currentState.lastOpened = new Date().toISOString();
        saveWorkspaceState(currentProjectPath, currentState);
      }

      // Reset orchestrator to lv-zero root
      if (orchestrator && orchestrator.setProjectPath) {
        await orchestrator.setProjectPath(null);
      }

      // Reset file bridge (explorer panel) to lv-zero root
      if (fileBridge && fileBridge.setAllowedBase) {
        fileBridge.setAllowedBase(path.resolve(__dirname, ".."));
      }

      // Restart file watcher to watch lv-zero root
      if (fileBridge && fileBridge.stopFileWatcher && mainWindow && !mainWindow.isDestroyed()) {
        fileBridge.stopFileWatcher();
        fileBridge.startFileWatcher(mainWindow, path.resolve(__dirname, ".."));
      }

      removeRecentProject(currentProjectPath);
      // Reset CWD to app root
      process.chdir(path.resolve(__dirname, ".."));
      currentProjectPath = null;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("project:changed", {
        name: null,
        path: null,
        action: "closed",
      });
    }

    return { success: true };
  }));

  /**
   * Duplicate the current project.
   */
  ipcMain.handle("project:duplicate", wrapIPCHandler(async () => {
    if (!currentProjectPath) {
      return { success: false, error: "No project is currently open" };
    }

    const parentDir = path.dirname(currentProjectPath);
    const sourceName = path.basename(currentProjectPath);
    const newName = `Copy of ${sourceName}`;

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Duplicate Project — Choose destination",
      defaultPath: path.join(parentDir, newName),
      properties: ["createDirectory"],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const destPath = result.filePath;

    if (fs.existsSync(destPath)) {
      return { success: false, error: `Destination already exists: ${destPath}` };
    }

    // Recursive copy
    fs.cpSync(currentProjectPath, destPath, { recursive: true });
    console.log(`[Main] Project duplicated: ${currentProjectPath} → ${destPath}`);

    return { success: true, name: path.basename(destPath), path: destPath };
  }));

  /**
   * Export the current project as a ZIP file.
   */
  ipcMain.handle("project:export", wrapIPCHandler(async () => {
    if (!currentProjectPath) {
      return { success: false, error: "No project is currently open" };
    }

    const projectName = path.basename(currentProjectPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export Project as ZIP",
      defaultPath: `${projectName}.zip`,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const outputPath = result.filePath;

    // Try using archiver if available
    try {
      const { createWriteStream } = await import("fs");
      const { default: archiver } = await import("archiver");
      const archive = archiver("zip", { zlib: { level: 9 } });
      const output = createWriteStream(outputPath);
      archive.pipe(output);
      archive.directory(currentProjectPath, path.basename(currentProjectPath));
      await archive.finalize();
      console.log(`[Main] Project exported: ${outputPath}`);
      return { success: true, outputPath };
    } catch (archiverErr) {
      return { success: false, error: `Export failed: ${archiverErr.message}. Install archiver: npm install archiver` };
    }
  }));

  // ── Project Identity (Phase 1) ─────────────────────────────────────────

  /**
   * Get the project identity config for a given project path.
   * Returns merged config with defaults if file is missing or invalid.
   */
  ipcMain.handle("project:identity", async (_event, projectPath) => {
    try {
      if (!projectIdentity || !projectIdentity.resolveConfig) {
        return { success: false, error: "Project identity module not available" };
      }
      if (!projectPath) {
        projectPath = currentProjectPath;
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided and no project is open" };
      }
      const config = projectIdentity.resolveConfig(projectPath);
      return { success: true, config };
    } catch (err) {
      console.error("[Main] Error resolving project identity:", err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Update specific fields of the project identity config.
   * Merges the provided updates into the existing config and saves.
   */
  ipcMain.handle("project:identity-update", async (_event, projectPath, updates) => {
    try {
      if (!projectIdentity || !projectIdentity.resolveConfig || !projectIdentity.getConfigPath) {
        return { success: false, error: "Project identity module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }

      // Read existing config
      const config = projectIdentity.resolveConfig(targetPath);
      if (!config || typeof config !== "object") {
        return { success: false, error: "Could not read existing config" };
      }

      // Merge updates
      Object.assign(config, updates);
      config.updatedAt = new Date().toISOString();

      // Write back
      const configPath = projectIdentity.getConfigPath(targetPath);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      console.log(`[Main] Project identity updated: ${targetPath}`);

      return { success: true, config };
    } catch (err) {
      console.error("[Main] Error updating project identity:", err.message);
      return { success: false, error: err.message };
    }
  });

  /**
   * Create a full project identity config from scratch.
   * Used when creating a new project — writes the provided config object.
   */
  ipcMain.handle("project:identity-create", async (_event, projectPath, config) => {
    try {
      if (!projectIdentity || !projectIdentity.getConfigPath || !projectIdentity.getDefaultConfig) {
        return { success: false, error: "Project identity module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }

      const now = new Date().toISOString();
      const defaults = projectIdentity.getDefaultConfig();
      const merged = Object.assign(defaults, config || {});
      merged.createdAt = merged.createdAt || now;
      merged.updatedAt = now;

      // Ensure .lv-zero directory exists
      const lvZeroDir = require("path").join(projectPath, ".lv-zero");
      if (!fs.existsSync(lvZeroDir)) {
        fs.mkdirSync(lvZeroDir, { recursive: true });
      }

      const configPath = projectIdentity.getConfigPath(projectPath);
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8");
      console.log(`[Main] Project identity created: ${projectPath}`);

      return { success: true, config: merged };
    } catch (err) {
      console.error("[Main] Error creating project identity:", err.message);
      return { success: false, error: err.message };
    }
  });

  // ── Permissions (Phase 2) ────────────────────────────────────────────────

  /**
   * Check if a specific action is permitted.
   * Used by the renderer to verify permissions before operations.
   * Non-blocking: if permissions module is unavailable, returns allowed=true.
   */
  ipcMain.handle("permissions:check", async (_event, projectPath, permissionType, target) => {
    try {
      if (!permissionsModule || !permissionsModule.checkPermission) {
        return { allowed: true, reason: "Permissions module not available" };
      }
      if (!projectPath) {
        projectPath = currentProjectPath;
      }
      if (!projectPath) {
        return { allowed: true, reason: "No project path, permissions bypassed" };
      }
      const result = permissionsModule.checkPermission(projectPath, permissionType, target);
      return result;
    } catch (err) {
      console.warn(`[Main] permissions:check error: ${err.message}`);
      return { allowed: true, reason: `Permission check bypassed: ${err.message}` };
    }
  });

  /**
   * Get effective permissions list for the current project.
   */
  ipcMain.handle("permissions:list", async (_event, projectPath) => {
    try {
      if (!permissionsModule || !permissionsModule.getEffectivePermissions) {
        return { success: true, permissions: null, note: "Permissions module not available" };
      }
      if (!projectPath) {
        projectPath = currentProjectPath;
      }
      if (!projectPath) {
        return { success: true, permissions: null, note: "No project path" };
      }
      const perms = permissionsModule.getEffectivePermissions(projectPath);
      return { success: true, permissions: perms };
    } catch (err) {
      console.warn(`[Main] permissions:list error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── Iron Laws (Phase 3) ───────────────────────────────────────────────────

  /**
   * Run all iron law gates against the given context.
   * Non-blocking advisory — returns results but does not prevent operations.
   */
  ipcMain.handle("iron-laws:check", async (_event, projectPath, context) => {
    try {
      if (!ironLaws || !ironLaws.runAllGates) {
        return { gates: [], allPassed: true, violations: [], note: "Iron laws module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      const result = ironLaws.runAllGates(targetPath, context || {});
      return result;
    } catch (err) {
      console.warn(`[Main] iron-laws:check error: ${err.message}`);
      return { gates: [], allPassed: true, violations: [], error: err.message };
    }
  });

  /**
   * Save evidence for a task.
   */
  ipcMain.handle("iron-laws:evidence-save", async (_event, projectPath, taskId, evidence) => {
    try {
      if (!ironLawsEvidence || !ironLawsEvidence.saveEvidence) {
        return { success: false, error: "Iron laws evidence module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      ironLawsEvidence.saveEvidence(targetPath, taskId, evidence);
      return { success: true };
    } catch (err) {
      console.warn(`[Main] iron-laws:evidence-save error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get evidence for a task.
   */
  ipcMain.handle("iron-laws:evidence-get", async (_event, projectPath, taskId) => {
    try {
      if (!ironLawsEvidence || !ironLawsEvidence.getEvidence) {
        return { success: false, error: "Iron laws evidence module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      const evidence = ironLawsEvidence.getEvidence(targetPath, taskId);
      return { success: true, evidence };
    } catch (err) {
      console.warn(`[Main] iron-laws:evidence-get error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get evidence summary for a project.
   */
  ipcMain.handle("iron-laws:evidence-summary", async (_event, projectPath) => {
    try {
      if (!ironLawsEvidence || !ironLawsEvidence.getEvidenceSummary) {
        return { success: false, error: "Iron laws evidence module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      const summary = ironLawsEvidence.getEvidenceSummary(targetPath);
      return { success: true, summary };
    } catch (err) {
      console.warn(`[Main] iron-laws:evidence-summary error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── Diagnose Wizard (Phase 10) ─────────────────────────────────────────

  /**
   * Create a new debug session.
   */
  ipcMain.handle("diagnose:create-session", async (_event, projectPath) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.createSession) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      const result = diagnoseWizard.createSession(targetPath);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:create-session error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get a debug session by ID.
   */
  ipcMain.handle("diagnose:get-session", async (_event, projectPath, sessionId) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.getSession) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath || !sessionId) {
        return { success: false, error: "Project path and session ID are required" };
      }
      const result = diagnoseWizard.getSession(targetPath, sessionId);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:get-session error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * List all debug sessions for a project.
   */
  ipcMain.handle("diagnose:list-sessions", async (_event, projectPath) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.listSessions) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      const result = diagnoseWizard.listSessions(targetPath);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:list-sessions error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Update a debug session.
   */
  ipcMain.handle("diagnose:update-session", async (_event, projectPath, sessionId, updates) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.updateSession) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath || !sessionId || !updates) {
        return { success: false, error: "Project path, session ID, and updates are required" };
      }
      const result = diagnoseWizard.updateSession(targetPath, sessionId, updates);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:update-session error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Advance a session to the next step.
   */
  ipcMain.handle("diagnose:advance-step", async (_event, projectPath, sessionId, stepData) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.advanceStep) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath || !sessionId) {
        return { success: false, error: "Project path and session ID are required" };
      }
      const result = diagnoseWizard.advanceStep(targetPath, sessionId, stepData || {});
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:advance-step error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get current step information for a session.
   */
  ipcMain.handle("diagnose:get-current-step", async (_event, projectPath, sessionId) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.getCurrentStep) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath || !sessionId) {
        return { success: false, error: "Project path and session ID are required" };
      }
      const result = diagnoseWizard.getCurrentStep(targetPath, sessionId);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:get-current-step error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Complete/finalize a debug session.
   */
  ipcMain.handle("diagnose:complete-session", async (_event, projectPath, sessionId, evidenceOpts) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.completeSession) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath || !sessionId) {
        return { success: false, error: "Project path and session ID are required" };
      }
      const result = diagnoseWizard.completeSession(targetPath, sessionId, evidenceOpts || null);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:complete-session error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Delete a debug session.
   */
  ipcMain.handle("diagnose:delete-session", async (_event, projectPath, sessionId) => {
    try {
      if (!diagnoseWizard || !diagnoseWizard.deleteSession) {
        return { success: false, error: "Diagnose wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath || !sessionId) {
        return { success: false, error: "Project path and session ID are required" };
      }
      const result = diagnoseWizard.deleteSession(targetPath, sessionId);
      return result;
    } catch (err) {
      console.warn(`[Main] diagnose:delete-session error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── Grill Me Wizard (Phase 4 – Scope Interview) ────────────────────────

  /**
   * Create a new scoping session in the project.
   */
  ipcMain.handle("grill-me:create-session", async (_event, projectPath) => {
    try {
      if (!grillMeWizard || !grillMeWizard.createSession) {
        return { success: false, error: "Grill Me wizard module not available" };
      }
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      const result = grillMeWizard.createSession(targetPath);
      return result;
    } catch (err) {
      console.warn(`[Main] grill-me:create-session error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Submit an answer for the current question and advance to next.
   */
  ipcMain.handle("grill-me:submit-answer", async (_event, sessionId, questionId, answer) => {
    try {
      if (!grillMeWizard || !grillMeWizard.submitAnswer) {
        return { success: false, error: "Grill Me wizard module not available" };
      }
      if (!sessionId || !questionId || answer === undefined) {
        return { success: false, error: "Session ID, question ID, and answer are required" };
      }
      const result = grillMeWizard.submitAnswer(sessionId, questionId, answer);
      return result;
    } catch (err) {
      console.warn(`[Main] grill-me:submit-answer error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Skip the current question (answer becomes null).
   */
  ipcMain.handle("grill-me:skip-question", async (_event, sessionId, questionId) => {
    try {
      if (!grillMeWizard || !grillMeWizard.skipQuestion) {
        return { success: false, error: "Grill Me wizard module not available" };
      }
      if (!sessionId || !questionId) {
        return { success: false, error: "Session ID and question ID are required" };
      }
      const result = grillMeWizard.skipQuestion(sessionId, questionId);
      return result;
    } catch (err) {
      console.warn(`[Main] grill-me:skip-question error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get the full state of a scoping session (questions, answers, progress).
   */
  ipcMain.handle("grill-me:get-session-state", async (_event, sessionId) => {
    try {
      if (!grillMeWizard || !grillMeWizard.getSessionState) {
        return { success: false, error: "Grill Me wizard module not available" };
      }
      if (!sessionId) {
        return { success: false, error: "Session ID is required" };
      }
      const result = grillMeWizard.getSessionState(sessionId);
      return result;
    } catch (err) {
      console.warn(`[Main] grill-me:get-session-state error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Generate spec files from a completed scoping session.
   * Creates the project, runs the scoped init pipeline, and returns results.
   */
  ipcMain.handle("grill-me:generate-specs", async (_event, sessionId, projectPath, identity) => {
    try {
      if (!grillMeWizard || !grillMeWizard.generateScopeContext) {
        return { success: false, error: "Grill Me wizard module not available" };
      }
      if (!sessionId || !projectPath) {
        return { success: false, error: "Session ID and project path are required" };
      }
      // Load session and generate scope context
      const session = grillMeWizard.loadSession(sessionId);
      if (!session || !session.completed) {
        return { success: false, error: "Scoping session is not completed yet" };
      }
      const scopeContext = grillMeWizard.generateScopeContext(session);
      // Run the scoped init pipeline
      if (!initPipeline || !initPipeline.runInitPipelineWithScope) {
        return { success: false, error: "Init pipeline module not available" };
      }
      const result = initPipeline.runInitPipelineWithScope(projectPath, identity || {}, scopeContext.scopingAnswers);
      return { success: true, scopeContext, ...result };
    } catch (err) {
      console.warn(`[Main] grill-me:generate-specs error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── Init Pipeline (Phase 4) ────────────────────────────────────────────

  /**
   * Run the init pipeline for a project: environment check → context →
   * skeleton → spec generation → handover. Non-blocking — failures don't
   * block project creation.
   */
  ipcMain.handle("init-pipeline:run", async (_event, projectPath) => {
    try {
      if (!initPipeline || !initPipeline.runInitPipeline) {
        return { success: false, error: "Init pipeline module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      // Load project identity
      let identity = null;
      try {
        if (projectIdentity && projectIdentity.resolveConfig) {
          identity = projectIdentity.resolveConfig(projectPath);
        }
      } catch (identityErr) {
        console.warn('[Main] Could not load identity for init pipeline:', identityErr.message);
        identity = {};
      }
      const result = initPipeline.runInitPipeline(projectPath, identity);
      return { success: true, ...result };
    } catch (err) {
      console.warn(`[Main] init-pipeline:run error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Read a spec file (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, TECH-SPEC.md).
   * Returns content or null if file doesn't exist.
   */
  ipcMain.handle("spec:read", async (_event, projectPath, specType) => {
    try {
      if (!initPipeline || !initPipeline.runInitPipeline) {
        return { success: false, error: "Init pipeline module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const specGenerator = require('./core/spec-generator.cjs');
      const content = specGenerator.readSpecFile(projectPath, specType);
      return { success: true, content, found: content !== null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get current project info.
   */
  ipcMain.handle("project:current", wrapIPCHandler(() => {
    if (currentProjectPath) {
      return {
        isOpen: true,
        name: path.basename(currentProjectPath),
        path: currentProjectPath,
      };
    }
    return { isOpen: false };
  }));

  /**
   * List recent projects.
   */
  ipcMain.handle("project:listRecent", wrapIPCHandler(() => {
    const registry = loadProjectRegistry();
    return { projects: registry.recentProjects || [] };
  }));

  /**
   * Get detailed project info including orchestrator state.
   */
  ipcMain.handle("project:info", wrapIPCHandler(() => {
    if (orchestrator && orchestrator.getProjectInfo) {
      return orchestrator.getProjectInfo();
    }
    // Fallback if orchestrator not ready
    if (currentProjectPath) {
      return {
        isOpen: true,
        name: path.basename(currentProjectPath),
        path: currentProjectPath,
        planFile: path.resolve(currentProjectPath, "PLAN.md"),
      };
    }
    return { isOpen: false, name: null, path: null, planFile: null };
  }));

  // ── Workspace State ────────────────────────────────────────────────────

  /**
   * Get the saved workspace state for the current (or specified) project.
   * This includes open tabs, panel layout, last active file, etc.
   */
  ipcMain.handle("workspace:getState", (_event, { path: projectPath } = {}) => {
    try {
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project is open" };
      }
      const state = loadWorkspaceState(targetPath);
      if (state) {
        return { success: true, state };
      }
      // Return default state if none saved
      return { success: true, state: getDefaultWorkspaceState(targetPath) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Save workspace state for the current (or specified) project.
   * The renderer calls this when tabs change, layout changes, etc.
   */
  ipcMain.handle("workspace:saveState", async (_event, { state, path: projectPath } = {}) => {
    try {
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project is open" };
      }
      if (!state || typeof state !== "object") {
        return { success: false, error: "Invalid state object" };
      }
      saveWorkspaceState(targetPath, state);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * Get the workspace ID (hash) for a given project path.
   */
  ipcMain.handle("workspace:id", (_event, { path: projectPath } = {}) => {
    try {
      const targetPath = projectPath || currentProjectPath;
      if (!targetPath) {
        return { success: false, error: "No project path provided" };
      }
      return { success: true, workspaceId: getWorkspaceId(targetPath) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Status ─────────────────────────────────────────────────────────
  ipcMain.handle('mcp:status', async () => {
    try {
      if (orchestrator && orchestrator.getMCPStatus) {
        const status = await orchestrator.getMCPStatus();
        return { success: true, ...status };
      }
      // Try loading MCP manager directly
      try {
        const { MCPConfigManager } = require('./mcp_config_manager.js');
        const manager = new MCPConfigManager();
        const servers = await manager.listServers();
        return { success: true, servers };
      } catch {
        return { success: true, servers: [], message: 'MCP manager not available' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Providers: List all known providers ─────────────────────────────────
  // Inline provider registry (mirrors src/core/provider_registry.js for CJS compat)
  const PROVIDER_REGISTRY = [
    { id: "deepseek", name: "DeepSeek", type: "deepseek", baseURL: "https://api.deepseek.com/v1", models: ["deepseek-v4-flash","deepseek-v4-pro","deepseek-chat","deepseek-reasoner"], website: "https://platform.deepseek.com/api_keys", defaultModel: "deepseek-v4-flash", envKey: "DEEPSEEK_API_KEY", supportsStreaming: true, supportsReasoning: true, notes: "Modelo principal de lv-zero. Soporta razonamiento profundo (reasoning_content)." },
    { id: "glm", name: "GLM (Zhipu AI)", type: "openai-compatible", baseURL: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-5.2","glm-5.2-ultra","glm-5.1","glm-4-plus","glm-4v-plus"], website: "https://bigmodel.cn", defaultModel: "glm-5.2", envKey: "GLM_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "GLM 5.2 es el modelo más reciente de Zhipu AI. API compatible con OpenAI." },
    { id: "openai", name: "OpenAI", type: "openai-compatible", baseURL: "https://api.openai.com/v1", models: ["gpt-4o","gpt-4o-mini","gpt-4.1","gpt-4.1-mini","gpt-4.1-nano","o3","o3-mini","o4-mini"], website: "https://platform.openai.com/api-keys", defaultModel: "gpt-4o", envKey: "OPENAI_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Modelos GPT-4o y o3 de OpenAI." },
    { id: "anthropic", name: "Anthropic Claude", type: "anthropic", baseURL: "https://api.anthropic.com/v1", models: ["claude-4-opus","claude-4-sonnet","claude-3.5-haiku"], website: "https://console.anthropic.com", defaultModel: "claude-4-sonnet", envKey: "ANTHROPIC_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Claude 4 Sonnet es el modelo recomendado de Anthropic." },
    { id: "gemini", name: "Google Gemini", type: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-2.5-flash","gemini-2.5-pro","gemini-2.0-flash"], website: "https://aistudio.google.com/apikey", defaultModel: "gemini-2.5-flash", envKey: "GEMINI_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Gemini 2.5 Flash es rápido y gratuito." },
    { id: "qwen", name: "Qwen (Alibaba Cloud)", type: "openai-compatible", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-3-72b","qwen-3-32b","qwen-3-14b","qwen-3-7b","qwen-max","qwen-plus","qwen-turbo"], website: "https://bailian.console.aliyun.com", defaultModel: "qwen-3-72b", envKey: "QWEN_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Qwen 3 es la serie más reciente de Alibaba Cloud." },
    { id: "xai", name: "xAI (Grok)", type: "openai-compatible", baseURL: "https://api.x.ai/v1", models: ["grok-3","grok-3-mini","grok-3-vision"], website: "https://console.x.ai", defaultModel: "grok-3", envKey: "XAI_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Grok 3 de xAI (Elon Musk)." },
    { id: "groq", name: "Groq", type: "openai-compatible", baseURL: "https://api.groq.com/openai/v1", models: ["llama-4-70b","llama-4-8b","mixtral-8x7b","gemma-4-31b","gemma-4-9b"], website: "https://console.groq.com/keys", defaultModel: "llama-4-70b", envKey: "GROQ_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Groq ofrece inferencia ultrarrápida con LPU." },
    { id: "openrouter", name: "OpenRouter", type: "openai-compatible", baseURL: "https://openrouter.ai/api/v1", models: ["openai/gpt-4o","openai/gpt-4o-mini","anthropic/claude-4-sonnet","google/gemini-2.5-flash","meta-llama/llama-4-70b","deepseek/deepseek-v4-flash","qwen/qwen-3-72b"], website: "https://openrouter.ai/keys", defaultModel: "openai/gpt-4o", envKey: "OPENROUTER_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "OpenRouter unifica múltiples proveedores en una sola API." },
    { id: "together", name: "Together AI", type: "openai-compatible", baseURL: "https://api.together.xyz/v1", models: ["meta-llama/llama-4-70b","deepseek-ai/deepseek-v3","mistralai/mistral-large","Qwen/Qwen3-72B"], website: "https://together.ai/api-keys", defaultModel: "meta-llama/llama-4-70b", envKey: "TOGETHER_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Together AI ofrece modelos open-source en la nube." },
    { id: "nvidia", name: "NVIDIA NIM", type: "openai-compatible", baseURL: "https://integrate.api.nvidia.com/v1", models: ["nvidia/nemotron-3-super-120b","meta/llama-4-70b","mistralai/mistral-large"], website: "https://build.nvidia.com", defaultModel: "nvidia/nemotron-3-super-120b", envKey: "NVIDIA_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "NVIDIA NIM ofrece modelos optimizados en GPUs NVIDIA." },
    { id: "fireworks", name: "Fireworks AI", type: "openai-compatible", baseURL: "https://api.fireworks.ai/inference/v1", models: ["accounts/fireworks/models/llama-v4-70b","accounts/fireworks/models/qwen3-72b"], website: "https://fireworks.ai/api-keys", defaultModel: "accounts/fireworks/models/llama-v4-70b", envKey: "FIREWORKS_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Fireworks AI ofrece inferencia rápida de modelos open-source." },
    { id: "custom", name: "Custom URL", type: "openai-compatible", baseURL: "", models: [], website: "", defaultModel: "", envKey: "CUSTOM_API_KEY", supportsStreaming: true, supportsReasoning: false, notes: "Proveedor personalizado compatible con OpenAI API." },
  ];

  ipcMain.handle("providers:list", async () => {
    return PROVIDER_REGISTRY.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      baseURL: p.baseURL,
      models: p.models,
      website: p.website,
      defaultModel: p.defaultModel,
      envKey: p.envKey,
      notes: p.notes,
      configured: !!process.env[p.envKey],
      supportsStreaming: p.supportsStreaming,
      supportsReasoning: p.supportsReasoning,
    }));
  });

  ipcMain.handle("providers:verify", async (_event, providerId, apiKey, baseURL) => {
    try {
      const provider = PROVIDER_REGISTRY.find((p) => p.id === providerId);
      if (!provider) return { success: false, error: `Provider "${providerId}" not found` };

      const testURL = baseURL || provider.baseURL;
      const testModel = provider.defaultModel;

      // Try a simple models list request to verify the API key works
      const response = await fetch(`${testURL.replace(/\/+$/, "")}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          message: `✅ Conectado a ${provider.name}`,
          models: data?.data?.map((m) => m.id || m.name) || [],
        };
      } else if (response.status === 401) {
        return { success: false, error: "API Key inválida. Verifica que la key sea correcta." };
      } else {
        // Some providers don't support /models endpoint — try a simple chat completion
        try {
          const chatResponse = await fetch(`${testURL.replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: testModel,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
            }),
          });

          if (chatResponse.ok) {
            return { success: true, message: `✅ Conectado a ${provider.name}`, models: [testModel] };
          }

          const errData = await chatResponse.json().catch(() => ({}));
          return {
            success: false,
            error: errData?.error?.message || `HTTP ${chatResponse.status}: ${chatResponse.statusText}`,
          };
        } catch (chatErr) {
          return { success: false, error: `Error de conexión: ${chatErr.message}` };
        }
      }
    } catch (err) {
      return { success: false, error: `Error de conexión: ${err.message}` };
    }
  });

  // ── Providers: Save API Key (multi-provider) ───────────────────────────
  // Maps provider IDs to their envKey for process.env injection.
  // This is a lightweight inline map (not importing the ESM provider_registry).
  const PROVIDER_ENV_KEYS = {
    deepseek: "DEEPSEEK_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    glm: "GLM_API_KEY",
    qwen: "QWEN_API_KEY",
    xai: "XAI_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    together: "TOGETHER_API_KEY",
    nvidia: "NVIDIA_API_KEY",
    fireworks: "FIREWORKS_API_KEY",
    custom: "CUSTOM_API_KEY",
  };
  const PROVIDER_NAMES = {
    deepseek: "DeepSeek",
    openai: "OpenAI",
    anthropic: "Anthropic Claude",
    gemini: "Google Gemini",
    glm: "GLM (Zhipu AI)",
    qwen: "Qwen (Alibaba Cloud)",
    xai: "xAI (Grok)",
    groq: "Groq",
    openrouter: "OpenRouter",
    together: "Together AI",
    nvidia: "NVIDIA NIM",
    fireworks: "Fireworks AI",
    custom: "Custom URL",
  };

  ipcMain.handle("providers:saveKey", async (_event, providerId, apiKey) => {
    try {
      const envKey = PROVIDER_ENV_KEYS[providerId];
      const providerName = PROVIDER_NAMES[providerId] || providerId;

      if (!envKey) {
        return { success: false, error: `Provider "${providerId}" not found` };
      }

      // Save to process.env for current session
      process.env[envKey] = apiKey;

      // Also save to secret storage for persistence
      if (secretStorageInstance) {
        const result = await secretStorageInstance.saveKey(providerId, apiKey);
        if (!result.success) {
          console.warn(`[Main] SecretStorage saveKey failed for ${providerId}:`, result.error);
        }
      }

      // Also save to .env file as fallback
      try {
        const envPath = path.resolve(__dirname, "..", "..", ".env");
        let content = "";
        if (fs.existsSync(envPath)) {
          content = fs.readFileSync(envPath, "utf-8");
        }

        const keyLine = `${envKey}=${apiKey}`;
        const regex = new RegExp(`^${envKey}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, keyLine);
        } else {
          content += (content.endsWith("\n") ? "" : "\n") + keyLine + "\n";
        }

        fs.writeFileSync(envPath, content, "utf-8");
      } catch (envErr) {
        console.warn(`[Main] Could not save ${envKey} to .env:`, envErr.message);
      }

      // Reload environment and reinitialize the client
      if (orchestrator && orchestrator.loadEnv) {
        orchestrator.loadEnv();
      }
      if (orchestrator && orchestrator.initClient) {
        await orchestrator.initClient();
      }

      return { success: true, message: `✅ API Key guardada para ${providerName}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Auth: Save API Key ────────────────────────────────────────────────
  ipcMain.handle("auth:saveKey", async (_event, apiKey) => {
    try {
      // Try SecretStorage first (encrypted)
      if (secretStorageInstance) {
        const result = await secretStorageInstance.saveKey("deepseek", apiKey);
        if (result.success) {
          // Also update the environment variable for the current session
          process.env.DEEPSEEK_API_KEY = apiKey;
          if (orchestrator && orchestrator.loadEnv) {
            orchestrator.loadEnv();
          }
          if (orchestrator && orchestrator.initClient) {
            await orchestrator.initClient();
          }
          return { success: true, storage: "encrypted" };
        }
        // Fall through to .env fallback if saveKey failed
        console.warn('[Main] SecretStorage saveKey failed, falling back to .env:', result.error);
      }

      // Fallback: save to .env file
      const envPath = path.resolve(__dirname, "..", "..", ".env");
      let content = "";
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, "utf-8");
      }

      // Update or append DEEPSEEK_API_KEY
      const keyLine = `DEEPSEEK_API_KEY=${apiKey}`;
      const regex = /^DEEPSEEK_API_KEY=.*$/m;
      if (regex.test(content)) {
        content = content.replace(regex, keyLine);
      } else {
        content += (content.endsWith("\n") ? "" : "\n") + keyLine + "\n";
      }

      fs.writeFileSync(envPath, content, "utf-8");

      // Reload environment and reinitialize the client
      if (orchestrator && orchestrator.loadEnv) {
        orchestrator.loadEnv();
      }
      if (orchestrator && orchestrator.initClient) {
        await orchestrator.initClient();
      }

      return { success: true, storage: "env" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Secrets: IPC Handlers (Phase 0.1) ─────────────────────────────────
  ipcMain.handle("secrets:saveKey", async (_event, service, key) => {
    try {
      if (!secretStorageInstance) {
        return { success: false, error: "Secret storage not available" };
      }
      return await secretStorageInstance.saveKey(service, key);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("secrets:getKey", async (_event, service) => {
    try {
      if (!secretStorageInstance) {
        return { success: false, error: "Secret storage not available" };
      }
      return await secretStorageInstance.getKey(service);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("secrets:list", async () => {
    try {
      if (!secretStorageInstance) {
        return { success: false, error: "Secret storage not available" };
      }
      return await secretStorageInstance.listServices();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("secrets:deleteKey", async (_event, service) => {
    try {
      if (!secretStorageInstance) {
        return { success: false, error: "Secret storage not available" };
      }
      return await secretStorageInstance.deleteKey(service);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("secrets:hasKey", async (_event, service) => {
    try {
      if (!secretStorageInstance) {
        return { success: false, hasKey: false, error: "Secret storage not available" };
      }
      return await secretStorageInstance.hasKey(service);
    } catch (err) {
      return { success: false, hasKey: false, error: err.message };
    }
  });

  // ── MCP Server Management ─────────────────────────────────────────────
  ipcMain.handle("mcp:saveEnabled", async (_event, serverIds) => {
    try {
      const envPath = path.resolve(__dirname, "..", "..", ".env");
      let content = "";
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, "utf-8");
      }

      const line = `MCP_ENABLED_SERVERS=${serverIds}`;
      const regex = /^MCP_ENABLED_SERVERS=.*$/m;
      if (regex.test(content)) {
        content = content.replace(regex, line);
      } else {
        content += (content.endsWith("\n") ? "" : "\n") + line + "\n";
      }

      fs.writeFileSync(envPath, content, "utf-8");

      // Reload env so the orchestrator picks up the change
      if (orchestrator && orchestrator.loadEnv) {
        orchestrator.loadEnv();
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("mcp:getEnabled", wrapIPCHandler(() => {
    return { enabled: process.env.MCP_ENABLED_SERVERS || "" };
  }));

  ipcMain.handle("mcp:listRegistry", async () => {
    try {
      const { MCP_REGISTRY } = require("./mcp_registry.js");
      return { success: true, registry: MCP_REGISTRY };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Config Save ──────────────────────────────────────────────────
  ipcMain.handle("mcp:configSave", async (_event, config) => {
    try {
      // Validate required fields
      if (!config || !config.name) {
        return { success: false, error: "Server name is required" };
      }

      // Save to mcp_servers.json
      const configPath = path.resolve(__dirname, "..", "mcp_servers.json");
      let servers = {};
      try {
        if (fs.existsSync(configPath)) {
          const raw = fs.readFileSync(configPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (parsed.mcpServers) {
            servers = parsed.mcpServers;
          }
        }
      } catch (_) {
        servers = {};
      }

      // Add/update the server config
      servers[config.name] = {
        type: config.type || "stdio",
        command: config.command,
        args: config.args || [],
        url: config.url,
        env: config.env || {},
        autoConnect: config.autoConnect !== false,
      };

      const output = { mcpServers: servers };
      fs.writeFileSync(configPath, JSON.stringify(output, null, 2), "utf-8");

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Health Status ─────────────────────────────────────────────────
  ipcMain.handle('mcp:healthStatus', async () => {
    try {
      const { MCPConfigManager } = require('./mcp_config_manager.js');
      const manager = new MCPConfigManager();
      const status = manager.getStatus();
      return { success: true, ...status };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Get Tools ────────────────────────────────────────────────────
  ipcMain.handle('mcp:getTools', async (_event, serverId) => {
    try {
      const { MCPConfigManager } = require('./mcp_config_manager.js');
      const manager = new MCPConfigManager();
      const result = await manager.getTools(serverId);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Disable Tool ─────────────────────────────────────────────────
  ipcMain.handle('mcp:disableTool', async (_event, serverId, toolName) => {
    try {
      const { MCPConfigManager } = require('./mcp_config_manager.js');
      const manager = new MCPConfigManager();
      const result = await manager.disableTool(serverId, toolName);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Enable Tool ──────────────────────────────────────────────────
  ipcMain.handle('mcp:enableTool', async (_event, serverId, toolName) => {
    try {
      const { MCPConfigManager } = require('./mcp_config_manager.js');
      const manager = new MCPConfigManager();
      const result = await manager.enableTool(serverId, toolName);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Get Disabled Tools ───────────────────────────────────────────
  ipcMain.handle('mcp:getDisabledTools', async (_event, serverId) => {
    try {
      const { MCPConfigManager } = require('./mcp_config_manager.js');
      const manager = new MCPConfigManager();
      const disabled = manager.getDisabledTools(serverId);
      return { success: true, disabled };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── MCP Reconnect ────────────────────────────────────────────────────
  ipcMain.handle("mcp:reconnect", async (_event, serverName) => {
    try {
      const { MCPConfigManager } = require('./mcp_config_manager.js');
      const manager = new MCPConfigManager();
      const result = await manager.reconnect(serverName);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Crash Recovery ──────────────────────────────────────────────────
  ipcMain.handle("crash:getState", async () => {
    try {
      if (orchestrator && orchestrator.getCrashState) {
        const state = await orchestrator.getCrashState();
        return { success: true, state };
      }
      return { success: true, state: null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("crash:recover", async () => {
    try {
      if (orchestrator && orchestrator.recoverFromCrash) {
        const result = await orchestrator.recoverFromCrash();
        return { success: true, result };
      }
      return { success: false, error: "Crash recovery not available" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("crash:dismiss", async () => {
    try {
      if (orchestrator && orchestrator.dismissCrash) {
        await orchestrator.dismissCrash();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Skill: Run Repo Mapper ──────────────────────────────────────────
  ipcMain.handle("skill:runRepoMapper", async (_event, directory) => {
    try {
      const { default: runRepoMapper } = await import('./skills/repo_mapper.js');
      const result = await runRepoMapper(directory);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Settings Store IPC (Phase 6) ─────────────────────────────────────
  ipcMain.handle("settings:get", wrapIPCHandler(async (_event, key) => {
    if (!settingsStoreInstance) {
      return { success: false, error: "Settings store not available" };
    }
    const value = settingsStoreInstance.get(key);
    return { success: true, value };
  }));

  ipcMain.handle("settings:set", wrapIPCHandler(async (_event, key, value) => {
    if (!settingsStoreInstance) {
      return { success: false, error: "Settings store not available" };
    }
    settingsStoreInstance.set(key, value);
    return { success: true };
  }));

  ipcMain.handle("settings:getAll", wrapIPCHandler(async () => {
    if (!settingsStoreInstance) {
      return { success: false, error: "Settings store not available" };
    }
    const all = settingsStoreInstance.getAll();
    return { success: true, settings: all };
  }));

  ipcMain.handle("settings:delete", wrapIPCHandler(async (_event, key) => {
    if (!settingsStoreInstance) {
      return { success: false, error: "Settings store not available" };
    }
    const deleted = settingsStoreInstance.delete(key);
    return { success: deleted };
  }));

  // ── Config ────────────────────────────────────────────────────────────
  ipcMain.handle("config:get", wrapIPCHandler(() => {
    if (orchestrator && orchestrator.getConfig) {
      return orchestrator.getConfig();
    }
    return {};
  }));

  // ── File Watcher control ──────────────────────────────────────────────
  // NOTE: file:watchStart and file:watchStop handlers are registered by
  // fileBridge.setupFileIPC() — we skip them here to avoid the Electron
  // "Attempted to register a second handler" error. If fileBridge is not
  // loaded, these operations return a fallback response.
  // (Handlers removed to avoid duplicate registration with file_bridge.js)
  // ── Agent Status ───────────────────────────────────────────────────────
  ipcMain.handle('agent:status', async () => {
    try {
      if (orchestrator && orchestrator.getStatus) {
        const status = await orchestrator.getStatus();
        return { success: true, ...status };
      }
      return {
        success: true,
        status: 'idle',
        mode: 'default',
        message: 'Orchestrator not fully initialized',
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 🔄 Mode Suggestion Approval ──────────────────────────────────────
  ipcMain.handle("agent:accept_mode_suggestion", async () => {
    try {
      if (!orchestrator || !orchestrator.acceptModeSuggestion) {
        return { success: false, error: "Orchestrator not ready" };
      }
      return await orchestrator.acceptModeSuggestion();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("agent:deny_mode_suggestion", async () => {
    try {
      if (!orchestrator || !orchestrator.denyModeSuggestion) {
        return { success: false, error: "Orchestrator not ready" };
      }
      return await orchestrator.denyModeSuggestion();
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 🛑 Stop/Abort agent ──────────────────────────────────────────────
  ipcMain.handle("agent:stop", async () => {
    try {
      if (!orchestrator || !orchestrator.abortAgent) {
        return { success: false, error: "Orchestrator not ready" };
      }
      orchestrator.abortAgent();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── ❓ Follow-Up Question ─────────────────────────────────────────────
  ipcMain.handle("agent:answer_followup", async (_event, answer) => {
    try {
      if (!orchestrator || !orchestrator.answerFollowupQuestion) {
        return { success: false, error: "Orchestrator not ready" };
      }
      await orchestrator.answerFollowupQuestion(answer);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 🧹 Clear conversation ────────────────────────────────────────────
  ipcMain.handle("agent:clear", async () => {
    try {
      if (!orchestrator || !orchestrator.clearConversation) {
        return { success: false, error: "Orchestrator not ready" };
      }
      orchestrator.clearConversation();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 🧹 Amnesia — Clear short-term memory (preserves only mode system prompt) ──
  ipcMain.handle("chat:clear_context", async () => {
    try {
      if (!orchestrator || !orchestrator.clearMemory) {
        return { success: false, error: "Orchestrator not ready or clearMemory unavailable" };
      }
      orchestrator.clearMemory();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 🔄 Manual Mode Switch (from UI mode buttons) ─────────────────────
  ipcMain.handle("mode:switch", async (_event, modeSlug) => {
    try {
      if (!orchestrator || !orchestrator.switchMode) {
        return { success: false, error: "Orchestrator not ready" };
      }
      return await orchestrator.switchMode(modeSlug, "manual");
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 🧠 Model Override (from UI model selector) ───────────────────────
  ipcMain.handle("model:setModel", async (_event, tier) => {
    try {
      if (!orchestrator || !orchestrator.overrideModel) {
        return { success: false, error: "Orchestrator not ready" };
      }
      return orchestrator.overrideModel(tier);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("model:getAvailable", async () => {
    try {
      if (!orchestrator || !orchestrator.getStatus) {
        return { success: false, error: "Orchestrator not ready" };
      }
      const status = orchestrator.getStatus();
      return {
        success: true,
        currentTier: status.currentTier || null,
        currentModel: status.model || null,
        currentProvider: status.currentProvider || null,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Skills ───────────────────────────────────────────────────────────
  ipcMain.handle("skills:list", wrapIPCHandler(() => {
    if (!orchestrator || !orchestrator.getSkills) {
      return { success: false, error: "Orchestrator not ready" };
    }
    return { success: true, skills: orchestrator.getSkills() };
  }));

  ipcMain.handle("skills:reload", async () => {
    try {
      if (!orchestrator || !orchestrator.reloadAllSkills) {
        return { success: false, error: "Orchestrator not ready" };
      }
      const count = await orchestrator.reloadAllSkills();
      return { success: true, count, skills: orchestrator.getSkills() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 📋 Code Review (Phase 5) ──────────────────────────────────────────────
  ipcMain.handle("code-review:review", async (_event, projectPath, filePath) => {
    try {
      if (!codeReview || !codeReview.reviewFile) {
        return { success: false, error: "Code review module not available" };
      }
      const result = codeReview.reviewFile(filePath, projectPath);
      // Auto-save report
      let reportPath = null;
      try {
        reportPath = codeReview.saveReport(result, projectPath);
      } catch {}
      return { success: true, result, reportPath };
    } catch (err) {
      console.warn(`[Main] code-review:review error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("code-review:review-all", async (_event, projectPath) => {
    try {
      if (!codeReview || !codeReview.reviewAllChanged) {
        return { success: false, error: "Code review module not available" };
      }
      const results = codeReview.reviewAllChanged(projectPath);
      // Auto-save combined report
      let reportPath = null;
      try {
        reportPath = codeReview.saveReport(results, projectPath);
      } catch {}
      return { success: true, results, reportPath };
    } catch (err) {
      console.warn(`[Main] code-review:review-all error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("code-review:reports", async (_event, projectPath) => {
    try {
      if (!codeReview || !codeReview.getReports) {
        return { success: false, error: "Code review module not available" };
      }
      const reports = codeReview.getReports(projectPath);
      return { success: true, reports };
    } catch (err) {
      console.warn(`[Main] code-review:reports error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── 🎨 Frontend-Design Auditor ───────────────────────────────────────────────
  ipcMain.handle("frontend:audit-file", async (_event, projectPath, filePath) => {
    try {
      if (!frontendAuditor || !frontendAuditor.auditFile) {
        return { success: false, error: "Frontend auditor module not available" };
      }
      if (!filePath) {
        return { success: false, error: "No file path provided" };
      }
      const result = frontendAuditor.auditFile(filePath, projectPath);
      return { success: true, result };
    } catch (err) {
      console.warn(`[Main] frontend:audit-file error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("frontend:audit-directory", async (_event, projectPath) => {
    try {
      if (!frontendAuditor || !frontendAuditor.auditDirectory) {
        return { success: false, error: "Frontend auditor module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const results = frontendAuditor.auditDirectory(projectPath);
      return { success: true, ...results };
    } catch (err) {
      console.warn(`[Main] frontend:audit-directory error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("frontend:audit-all", async (_event, projectPath) => {
    try {
      if (!frontendAuditor || !frontendAuditor.auditDirectory) {
        return { success: false, error: "Frontend auditor module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const results = frontendAuditor.auditDirectory(projectPath);
      return { success: true, ...results };
    } catch (err) {
      console.warn(`[Main] frontend:audit-all error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── 📦 Deploy Pipeline (Phase 6) ─────────────────────────────────────────
  
  /**
   * Run the full deploy pipeline: pre-audit → build → smoke test → release → rollback prep.
   */
  ipcMain.handle("deploy:run", async (_event, projectPath, options = {}) => {
    try {
      if (!deployPipeline || !deployPipeline.runDeployPipeline) {
        return { success: false, error: "Deploy pipeline module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const result = deployPipeline.runDeployPipeline(projectPath, options);
      return { success: true, ...result };
    } catch (err) {
      console.warn(`[Main] deploy:run error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Run only the pre-audit step of the deploy pipeline.
   */
  ipcMain.handle("deploy:audit", async (_event, projectPath) => {
    try {
      if (!deployPipeline || !deployPipeline.preAudit) {
        return { success: false, error: "Deploy pipeline module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const auditResult = deployPipeline.preAudit(projectPath);
      return { success: true, ...auditResult };
    } catch (err) {
      console.warn(`[Main] deploy:audit error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * List all releases for a project from .lv-zero/releases/.
   */
  ipcMain.handle("deploy:releases", async (_event, projectPath) => {
    try {
      if (!deployPipeline || !deployPipeline.listReleases) {
        return { success: false, error: "Deploy pipeline module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const releases = deployPipeline.listReleases(projectPath);
      return { success: true, releases };
    } catch (err) {
      console.warn(`[Main] deploy:releases error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── 🚀 Smart Launcher (Phase 7) ──────────────────────────────────────────

  /**
   * Detect project environment and return run targets.
   */
  ipcMain.handle("launcher:detect", async (_event, projectPath) => {
    try {
      if (!smartLauncher || !smartLauncher.detectEnvironment) {
        return { success: false, error: "Smart launcher module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const env = smartLauncher.detectEnvironment(projectPath);
      return { success: true, ...env };
    } catch (err) {
      console.warn(`[Main] launcher:detect error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Run pre-checks before executing a target command.
   */
  ipcMain.handle("launcher:precheck", async (_event, projectPath, target) => {
    try {
      if (!smartLauncher || !smartLauncher.preRunCheck) {
        return { success: false, error: "Smart launcher module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      const result = smartLauncher.preRunCheck(projectPath, target);
      return { success: true, ...result };
    } catch (err) {
      console.warn(`[Main] launcher:precheck error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  /**
   * Get or save run configuration.
   * If config is provided, saves it. Otherwise returns current config.
   */
  ipcMain.handle("launcher:config", async (_event, projectPath, config) => {
    try {
      if (!smartLauncher) {
        return { success: false, error: "Smart launcher module not available" };
      }
      if (!projectPath) {
        return { success: false, error: "No project path provided" };
      }
      if (config !== undefined && config !== null) {
        // Save config
        const saved = smartLauncher.saveRunConfig(projectPath, config);
        return { success: saved };
      }
      // Get config
      const result = smartLauncher.getRunConfig(projectPath);
      return { success: true, ...result };
    } catch (err) {
      console.warn(`[Main] launcher:config error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ── ⏱ Timer System (Unified Timer & Timeout) ───────────────────────────────

  /**
   * Get the full TIMEOUTS configuration object (read-only presets).
   */
  ipcMain.handle("timer:config", wrapIPCHandler(() => {
    if (!timerSystem) {
      return { success: false, error: "Timer system not available" };
    }
    return { success: true, presets: timerSystem.getPresets() };
  }));

  /**
   * Get the appropriate timeout for a given command or preset name.
   * @param {string} commandOrPreset - Command string or preset name (e.g. "build", "deploy", "npm run build")
   * @returns {Object} { success, timeout, preset }
   */
  ipcMain.handle("timer:get-timeout", wrapIPCHandler((_event, commandOrPreset) => {
    if (!timerSystem) {
      return { success: false, error: "Timer system not available", timeout: 60000 };
    }

    // Check if it's a preset name first
    const presetValue = timerSystem.getTimeout(commandOrPreset);
    if (presetValue) {
      return {
        success: true,
        timeout: presetValue,
        preset: commandOrPreset,
        source: "preset",
      };
    }

    // Otherwise treat as a command string
    const timeout = timerSystem.getCommandTimeout(commandOrPreset);
    const type = timerSystem.detectCommandType(commandOrPreset);
    return {
      success: true,
      timeout,
      preset: type,
      source: "command",
    };
  }));

  // ── 🔌 Supabase Integration (Phase 8) ──────────────────────────────────────

  /**
   * Query a Supabase table.
   */
  ipcMain.handle("supabase:query", async (_event, projectPath, table, options) => {
    try {
      const bridge = require('./integrations/supabase/supabase-bridge.cjs');
      const clientResult = bridge.getSupabaseClient();
      if (!clientResult.ok) return clientResult;
      return await clientResult.client.query(table, options);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Insert rows into a Supabase table.
   */
  ipcMain.handle("supabase:insert", async (_event, projectPath, table, rows) => {
    try {
      const bridge = require('./integrations/supabase/supabase-bridge.cjs');
      const clientResult = bridge.getSupabaseClient();
      if (!clientResult.ok) return clientResult;
      return await clientResult.client.insert(table, rows);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Execute raw SQL via Supabase pg_query RPC.
   */
  ipcMain.handle("supabase:sql", async (_event, projectPath, sqlQuery) => {
    try {
      const bridge = require('./integrations/supabase/supabase-bridge.cjs');
      const clientResult = bridge.getSupabaseClient();
      if (!clientResult.ok) return clientResult;
      return await clientResult.client.sql(sqlQuery);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Fetch Supabase database schema.
   */
  ipcMain.handle("supabase:schema", async (_event, projectPath) => {
    try {
      const bridge = require('./integrations/supabase/supabase-bridge.cjs');
      const clientResult = bridge.getSupabaseClient();
      if (!clientResult.ok) return clientResult;
      return await clientResult.client.schema();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── ☁️ Cloudflare Integration (Phase 8) ─────────────────────────────────────

  /**
   * Generate a Cloudflare Service Worker script.
   */
  ipcMain.handle("cloudflare:generate-worker", async (_event, projectPath, options) => {
    try {
      const bridge = require('./integrations/cloudflare/cloudflare-bridge.cjs');
      return bridge.generateServiceWorker(options || {});
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Generate a wrangler.toml configuration file.
   */
  ipcMain.handle("cloudflare:generate-wrangler", async (_event, projectPath, options) => {
    try {
      const bridge = require('./integrations/cloudflare/cloudflare-bridge.cjs');
      return bridge.generateWranglerConfig(options || {});
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── 🔧 Node-RED Integration (Phase 8) ────────────────────────────────────

  /**
   * Get all Node-RED flows from a flows file.
   */
  ipcMain.handle("nodered:flows", async (_event, flowsFilePath) => {
    try {
      const bridge = require('./integrations/nodered/nodered-bridge.cjs');
      return bridge.getFlows(flowsFilePath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Get a single Node-RED flow by ID.
   */
  ipcMain.handle("nodered:flow", async (_event, flowId, flowsFilePath) => {
    try {
      const bridge = require('./integrations/nodered/nodered-bridge.cjs');
      return bridge.getFlow(flowId, flowsFilePath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── 📋 Trello Integration (Phase 8) ────────────────────────────────────────

  /**
   * Get Trello config from project's .lv-zero/config.json.
   */
  ipcMain.handle("trello:config", async (_event, projectPath) => {
    try {
      const bridge = require('./integrations/trello/trello-bridge.cjs');
      return bridge.getConfig(projectPath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Create a new Trello card for the project.
   */
  ipcMain.handle("trello:create-card", async (_event, projectPath, name, desc) => {
    try {
      const bridge = require('./integrations/trello/trello-bridge.cjs');
      return await bridge.createCard(projectPath, name, desc);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Add a comment to the linked Trello card.
   */
  ipcMain.handle("trello:add-comment", async (_event, projectPath, comment) => {
    try {
      const bridge = require('./integrations/trello/trello-bridge.cjs');
      return await bridge.addComment(projectPath, comment);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── 🌐 Agent Browser IPC Handlers ──────────────────────────────────────────
  let browserHandlers;
  try {
    if (agentBrowser && agentBrowser.createHandlers) {
      browserHandlers = agentBrowser.createHandlers();
    }
  } catch (err) {
    console.warn('[Main] Could not create browser handlers:', err.message);
  }

  if (browserHandlers) {
    // Register all browser handlers from agent-browser.cjs
    ipcMain.handle("browser:open", browserHandlers["browser:open"]);
    ipcMain.handle("browser:navigate", browserHandlers["browser:navigate"]);
    ipcMain.handle("browser:execute-script", browserHandlers["browser:execute-script"]);
    ipcMain.handle("browser:get-content", browserHandlers["browser:get-content"]);
    ipcMain.handle("browser:screenshot", browserHandlers["browser:screenshot"]);
    ipcMain.handle("browser:click", browserHandlers["browser:click"]);
    ipcMain.handle("browser:fill", browserHandlers["browser:fill"]);
    ipcMain.handle("browser:get-text", browserHandlers["browser:get-text"]);
    ipcMain.handle("browser:wait-for", browserHandlers["browser:wait-for"]);
    ipcMain.handle("browser:logs", browserHandlers["browser:logs"]);
    ipcMain.handle("browser:close", browserHandlers["browser:close"]);
    ipcMain.handle("browser:list-sessions", browserHandlers["browser:list-sessions"]);

    // browser:test-command — returns pre-built test script code
    ipcMain.handle("browser:test-command", async (_event, name) => {
      try {
        if (!browserCommands || !browserCommands.getTestCommand) {
          return { success: false, error: "Browser commands module not available" };
        }
        return browserCommands.getTestCommand(name);
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    // browser:run-test — opens session, runs test, returns results
    ipcMain.handle("browser:run-test", async (_event, sessionId, commandName) => {
      try {
        if (!browserCommands || !browserCommands.getTestCommand) {
          return { success: false, error: "Browser commands module not available" };
        }
        const cmd = browserCommands.getTestCommand(commandName);
        if (!cmd.success) {
          return cmd;
        }
        if (!agentBrowser || !agentBrowser.executeScript) {
          return { success: false, error: "Agent browser module not available" };
        }
        return await agentBrowser.executeScript(sessionId, cmd.code);
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    console.log('[Main] Browser IPC handlers registered');
  } else {
    console.warn('[Main] Browser IPC handlers not available (agentBrowser module missing)');
  }
}

// ── Git Integration ────────────────────────────────────────────────────

/**
 * Get Git status — modified, staged, untracked files.
 */
ipcMain.handle("git:status", () => {
  try {
    const cwd = process.cwd();
    // Check if it's a git repo
    try {
      require("child_process").execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
    } catch {
      return { success: false, error: "Not a git repository", isRepo: false };
    }

    const execSync = require("child_process").execSync;

    // Git status --porcelain
    const statusOut = execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: "pipe" });
    // Git diff --stat for a summary
    const diffStatOut = execSync("git diff --stat", { cwd, encoding: "utf-8", stdio: "pipe" });

    const files = [];
    const lines = statusOut.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const xy = line.substring(0, 2);
      const filePath = line.substring(3).trim();
      let status = "modified";
      if (xy.includes("?")) status = "untracked";
      else if (xy.includes("A")) status = "added";
      else if (xy.includes("D")) status = "deleted";
      else if (xy.includes("R")) status = "renamed";
      else if (xy.includes("C")) status = "copied";
      else if (xy.includes("M")) status = "modified";
      files.push({ filePath, status, raw: xy.trim() });
    }

    // Get current branch
    let branch = "unknown";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
    } catch {}

    return {
      success: true,
      isRepo: true,
      branch,
      files,
      diffStat: diffStatOut.trim(),
    };
  } catch (err) {
    return { success: false, error: err.message, isRepo: false };
  }
});

/**
 * Get Git diff for a specific file.
 */
ipcMain.handle("git:diff", (_event, filePath) => {
  try {
    const cwd = process.cwd();
    const execSync = require("child_process").execSync;
    const diffOut = execSync(`git diff "${filePath}"`, { cwd, encoding: "utf-8", stdio: "pipe" });
    return { success: true, diff: diffOut };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Orchestrator Event Connection ──────────────────────────────────────────
function connectOrchestratorEvents() {
  if (!orchestrator) return;

  // Forward orchestrator logs to main process
  orchestrator.on('log', (msg) => {
    console.log(`[Orchestrator] ${msg}`);
    mainWindow?.webContents.send('orchestrator:log', msg);
  });

  orchestrator.on('warn', (msg) => {
    console.warn(`[Orchestrator] ${msg}`);
    mainWindow?.webContents.send('orchestrator:log', `⚠️ ${msg}`);
  });

  // Forward orchestrator events to renderer
  orchestrator.on('thought', (thought) => {
    mainWindow?.webContents.send('orchestrator:thought', thought);
  });

  orchestrator.on('step', (data) => {
    mainWindow?.webContents.send('orchestrator:step', data);
  });

  orchestrator.on('summary', (data) => {
    mainWindow?.webContents.send('orchestrator:summary', data);
  });

  orchestrator.on('tool_call', (data) => {
    mainWindow?.webContents.send('orchestrator:tool_call', data);
  });

  orchestrator.on('tool_result', (data) => {
    mainWindow?.webContents.send('orchestrator:tool_result', data);
  });

  orchestrator.on('response', (content) => {
    mainWindow?.webContents.send('orchestrator:response', content);
  });

  orchestrator.on('error', (data) => {
    mainWindow?.webContents.send('orchestrator:error', data);
  });

  orchestrator.on('skills_loaded', (data) => {
    mainWindow?.webContents.send('orchestrator:skills_loaded', data);
  });

  orchestrator.on('ready', (data) => {
    mainWindow?.webContents.send('orchestrator:ready', data);
  });

  // ── Mode Switching ──────────────────────────────────────────────────────
  orchestrator.on('mode_changed', (data) => {
    mainWindow?.webContents.send('orchestrator:mode_changed', data);
  });

  orchestrator.on('mode_suggestion', (data) => {
    mainWindow?.webContents.send('orchestrator:mode_suggestion', data);
  });

  orchestrator.on('workflow_start', (data) => {
    mainWindow?.webContents.send('orchestrator:workflow_start', data);
  });

  orchestrator.on('workflow_suggest', (data) => {
    mainWindow?.webContents.send('orchestrator:workflow_suggest', data);
  });

  orchestrator.on('workflow_step', (data) => {
    mainWindow?.webContents.send('orchestrator:workflow_step', data);
  });

  orchestrator.on('workflow_end', (data) => {
    mainWindow?.webContents.send('orchestrator:workflow_end', data);
  });

  // ── Real-Time Reasoning (DeepSeek streaming) ──────────────────────────
  orchestrator.on('reasoning', (data) => {
    mainWindow?.webContents.send('orchestrator:reasoning', data);
  });

  // ── Content Streaming (token-by-token like ChatGPT) ───────────────────
  orchestrator.on('content_chunk', (data) => {
    mainWindow?.webContents.send('orchestrator:content_chunk', data);
  });

  orchestrator.on('project_changed', (data) => {
    mainWindow?.webContents.send('orchestrator:project_changed', data);
  });

  // ── 🚨 Crash Recovery ────────────────────────────────────────────────────
  orchestrator.on('crash_detected', (data) => {
    mainWindow?.webContents.send('orchestrator:crash_detected', data);
  });

  // ── Tool Execution Progress ──────────────────────────────────────────────
  orchestrator.on('tool_progress', (data) => {
    mainWindow?.webContents.send('orchestrator:tool_progress', data);
  });

  // ── Follow-Up Question (ask_question) ────────────────────────────────────
  orchestrator.on('ask_question', (data) => {
    mainWindow?.webContents.send('orchestrator:ask_question', data);
  });

  // ── Task Completion Banner ──────────────────────────────────────────────
  orchestrator.on('task_complete', async (data) => {
    mainWindow?.webContents.send('orchestrator:task_complete', data);

    // ── Iron Law 2: Verification Gate check on task completion ──────────
    try {
      if (ironLaws && ironLaws.checkVerificationGate && currentProjectPath) {
        const taskId = (data && (data.taskId || data.id)) || 'unknown';
        const gateResult = ironLaws.checkVerificationGate(currentProjectPath, {
          isCompletingTask: true,
          taskId: taskId,
          hasVerification: false, // Default: no verification evidence
        });
        if (!gateResult.passed && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("iron-laws:violation", gateResult);
          console.warn(`[Main] IRON LAW VIOLATION (task_complete): ${gateResult.reason}`);
        }
      }
    } catch (ironErr) {
      console.warn('[Main] Iron law gate check on task_complete failed:', ironErr.message);
    }
  });
}

// ─── Shell Output Forwarding (Terminal Reactiva) ────────────────────────────
function connectShellOutput() {
  // Forward shell output to terminal bridge
  ipcMain.on('shell:output', (event, data) => {
    if (terminalBridge && mainWindow) {
      terminalBridge.forwardShellOutput(mainWindow, data);
    }
  });
}

// ─── Application Event Handlers ─────────────────────────────────────────────
app.whenReady().then(init);

// ─── Agent IPC Handler ───────────────────────────────────────────────────────
// Register the "agent:send" channel to forward user input to the orchestrator.
ipcMain.handle("agent:send", async (_event, userInput) => {
  try {
    if (typeof userInput !== "string") {
      throw new Error("Invalid userInput type");
    }
    // Lazy‑load the orchestrator if it hasn't been initialized yet.
    if (!orchestrator) {
      try {
        // Dynamically import the orchestrator (ESM) to avoid require() errors.
        const orchestratorModule = await import('./core/orchestrator.js');
        const Orchestrator = orchestratorModule.default;
        orchestrator = new Orchestrator();
        await orchestrator.init();
        console.log('[Main] Orchestrator lazily loaded for agent:send');
      } catch (loadErr) {
        console.error('[Main] Failed to lazily load orchestrator:', loadErr);
        throw loadErr;
      }
    }
    const response = await orchestrator.agentLoop(userInput);
    return response;
  } catch (err) {
    console.error("agent:send handler error:", err);
    throw err;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
