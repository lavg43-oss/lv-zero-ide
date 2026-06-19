/**
 * lv-zero — Electron Main Process
 *
 * v2.0 — IDE Edition
 *   Proceso principal de Electron.
 *   Gestiona la ventana, el menú y el puente IPC con el Orchestrator + Bridges.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
import path from "path";
import { fileURLToPath } from "url";
import Orchestrator from "./core/orchestrator.js";
import { setupTerminalIPC, shutdownTerminal } from "./terminal_bridge.js";
import { setupFileIPC } from "./file_bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Orchestrator Instance ──────────────────────────────────────────────────
const orchestrator = new Orchestrator();
let mainWindow = null;

// ─── Window Creation ────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    title: "lv-zero — Autonomous System Architect",
    backgroundColor: "#1e1e1e",
    show: false,
    icon: path.resolve(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the UI
  mainWindow.loadFile(path.resolve(__dirname, "..", "ui", "index.html"));

  // Show window when ready (avoids white flash)
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // DevTools in development
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

/**
 * Configura todos los manejadores IPC entre el renderer y el orchestrator.
 */
function setupIPC() {
  // ── Agent Control ──────────────────────────────────────────────────────

  ipcMain.handle("agent:send", async (_event, userInput) => {
    const response = await orchestrator.agentLoop(userInput);
    return response;
  });

  ipcMain.handle("agent:status", () => {
    return orchestrator.getStatus();
  });

  ipcMain.handle("agent:clear", () => {
    orchestrator.clearConversation();
    return { success: true };
  });

  ipcMain.handle("agent:stop", () => {
    orchestrator.abortAgent();
    return { success: true };
  });

  // ── Skills ─────────────────────────────────────────────────────────────

  ipcMain.handle("skills:list", () => {
    return orchestrator.getSkills();
  });

  ipcMain.handle("skills:reload", async () => {
    const count = await orchestrator.reloadAllSkills();
    return { count, skills: orchestrator.getSkills() };
  });

  // ── Session / State ────────────────────────────────────────────────────

  ipcMain.handle("session:status", () => {
    return orchestrator.getStatus();
  });

  ipcMain.handle("session:plan", (_event, content) => {
    orchestrator.updatePlan(content);
    return { success: true };
  });

  // ── Config ─────────────────────────────────────────────────────────────

  ipcMain.handle("config:get", () => {
    return orchestrator.getConfig();
  });

  // ── Dialog ─────────────────────────────────────────────────────────────

  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "openDirectory"],
    });
    return result;
  });

  // ── Workflows ──────────────────────────────────────────────────────────

  ipcMain.handle("workflows:list", () => {
    return orchestrator.getWorkflows();
  });

  ipcMain.handle("workflows:help", () => {
    return orchestrator.getWorkflowHelp();
  });

  ipcMain.handle("workflows:active", () => {
    return orchestrator.getActiveWorkflow();
  });
  // ── 🧠 Model Override (from UI model selector) ──────────────────────────

  ipcMain.handle("model:setModel", async (_event, tier) => {
    return orchestrator.overrideModel(tier);
  });

  ipcMain.handle("model:getAvailable", () => {
    const status = orchestrator.getStatus();
    return {
      currentTier: status.currentTier || null,
      currentModel: status.model || null,
      currentProvider: status.currentProvider || null,
    };
  });

  // ── 📂 Workspace Management (multi-folder projects) ────────────────────

  ipcMain.handle("workspace:status", () => {
    const ws = orchestrator.workspaceManager;
    if (!ws || !ws.isOpen) {
      return { isOpen: false, folders: [] };
    }
    return {
      isOpen: true,
      name: ws.name,
      rootPath: ws.rootPath,
      folders: ws.listFolders(),
      primaryFolder: ws.primaryFolder,
    };
  });

  ipcMain.handle("workspace:addFolder", async (_event, folderPath, label) => {
    const ws = orchestrator.workspaceManager;
    if (!ws) return { success: false, error: "Workspace manager not available" };
    const result = ws.addFolder(folderPath, label);
    if (result.success) {
      // Re-analyze project structure with new folder
      await orchestrator.setProjectPath(orchestrator.projectPath);
    }
    return result;
  });

  ipcMain.handle("workspace:removeFolder", async (_event, folderPath) => {
    const ws = orchestrator.workspaceManager;
    if (!ws) return { success: false, error: "Workspace manager not available" };
    const result = ws.removeFolder(folderPath);
    if (result.success) {
      await orchestrator.setProjectPath(orchestrator.projectPath);
    }
    return result;
  });

  ipcMain.handle("workspace:create", async (_event, options) => {
    const ws = orchestrator.workspaceManager;
    if (!ws) return { success: false, error: "Workspace manager not available" };
    const result = ws.create(options);
    if (result.success) {
      const primaryFolder = ws.primaryFolder;
      await orchestrator.setProjectPath(primaryFolder ? primaryFolder.path : options.rootPath);
    }
    return result;
  });

  ipcMain.handle("workspace:close", async () => {
    const ws = orchestrator.workspaceManager;
    if (ws) {
      ws.close();
      await orchestrator.setProjectPath(null);
    }
    return { success: true };
  });

  // ── 🌐 Live Preview ────────────────────────────────────────────────────

  ipcMain.handle("preview:start", async (_event, projectPath) => {
    const { getPreviewServer } = await import("./preview_server.js");
    const server = getPreviewServer({ logger: console });
    return await server.start(projectPath || orchestrator.projectPath);
  });

  ipcMain.handle("preview:stop", async () => {
    const { getPreviewServer } = await import("./preview_server.js");
    const server = getPreviewServer({ logger: console });
    return await server.stop();
  });

  ipcMain.handle("preview:status", async () => {
    const { getPreviewServer } = await import("./preview_server.js");
    const server = getPreviewServer({ logger: console });
    return {
      running: server.isRunning,
      url: server.url,
      port: server.port,
      framework: server.framework?.name || null,
    };
  });

  ipcMain.handle("preview:restart", async (_event, projectPath) => {
    const { getPreviewServer } = await import("./preview_server.js");
    const server = getPreviewServer({ logger: console });
    return await server.restart(projectPath || orchestrator.projectPath);
  });

  // ── 🚀 Cloudflare Pages Publish ────────────────────────────────────────

  ipcMain.handle("publish:deploy", async (_event, projectPath) => {
    const { default: cloudflarePublish } = await import(
      `file://${path.resolve(__dirname, "..", "skills", "cloudflare_publish.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    return await cloudflarePublish.handler({
      action: "deploy",
      projectPath: projectPath || orchestrator.projectPath,
    });
  });

  ipcMain.handle("publish:status", async (_event, projectPath) => {
    const { default: cloudflarePublish } = await import(
      `file://${path.resolve(__dirname, "..", "skills", "cloudflare_publish.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    return await cloudflarePublish.handler({
      action: "status",
      projectPath: projectPath || orchestrator.projectPath,
    });
  });

  ipcMain.handle("publish:setup", async () => {
    const { default: cloudflarePublish } = await import(
      `file://${path.resolve(__dirname, "..", "skills", "cloudflare_publish.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    return await cloudflarePublish.handler({ action: "setup" });
  });

  // ── 🎙️ Discovery Phase ────────────────────────────────────────────────

  ipcMain.handle("discovery:start", async () => {
    const { DiscoveryAgent } = await import(
      `file://${path.resolve(__dirname, "..", "src", "workflows", "discovery", "discovery_agent.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    const agent = new DiscoveryAgent({ logger: console });
    global.__discoveryAgent = agent;
    return agent.start();
  });

  ipcMain.handle("discovery:answer", async (_event, questionId, value) => {
    const agent = global.__discoveryAgent;
    if (!agent) {
      return { error: "No hay entrevista activa. Inicia con discovery:start" };
    }
    const result = agent.answer(questionId, value);
    if (result.completed) {
      global.__discoveryAgent = null;
      // Generate PRD and inject into orchestrator context
      const prd = agent.generatePRD();
      // Inject PRD into orchestrator messages as system context
      orchestrator.messages.push({
        role: "system",
        content: `📋 **PRD generado por Discovery Agent:**\n\n${prd}\n\n---\nUsa este PRD como plan para el Sprint Pipeline.`
      });
      orchestrator._pendingDiscovery = false;
      // Resume agent loop with PRD context
      setImmediate(() => {
        orchestrator.agentLoop("Continúa con el plan según el PRD. Ejecuta el Sprint Pipeline: Think → Plan → Build → Review → Test → Ship.");
      });
      return { completed: true, summary: result.summary, prd };
    }
    return result;
  });

  ipcMain.handle("discovery:needsDiscovery", async (_event, userInput) => {
    const { DiscoveryAgent } = await import(
      `file://${path.resolve(__dirname, "..", "src", "workflows", "discovery", "discovery_agent.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    return { needsDiscovery: DiscoveryAgent.needsDiscovery(userInput) };
  });

  // ── 🗺️ Graph Renderer ───────────────────────────────────────────────────

  ipcMain.handle("graph:build", async (_event, projectPath) => {
    const { getGraphRenderer } = await import(
      `file://${path.resolve(__dirname, "..", "src", "graph_renderer.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    const renderer = getGraphRenderer();
    return await renderer.build(projectPath || orchestrator.projectPath || process.cwd());
  });

  ipcMain.handle("graph:addFile", async (_event, filePath) => {
    const { getGraphRenderer } = await import(
      `file://${path.resolve(__dirname, "..", "src", "graph_renderer.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    const renderer = getGraphRenderer();
    renderer.addFile(filePath);
    return renderer.getGraphData();
  });

  ipcMain.handle("graph:removeFile", async (_event, filePath) => {
    const { getGraphRenderer } = await import(
      `file://${path.resolve(__dirname, "..", "src", "graph_renderer.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    const renderer = getGraphRenderer();
    renderer.removeFile(filePath);
    return renderer.getGraphData();
  });

  ipcMain.handle("graph:getData", async () => {
    const { getGraphRenderer } = await import(
      `file://${path.resolve(__dirname, "..", "src", "graph_renderer.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    const renderer = getGraphRenderer();
    return renderer.getGraphData();
  });
}

// ─── Orchestrator Events → IPC Forwarding ──────────────────────────────────

/**
 * Conecta los eventos del Orchestrator al renderer vía IPC.
 */
function connectOrchestratorEvents() {
  orchestrator.on("log", (msg) => {
    mainWindow?.webContents.send("orchestrator:log", msg);
  });

  orchestrator.on("warn", (msg) => {
    mainWindow?.webContents.send("orchestrator:log", `⚠️ ${msg}`);
  });

  orchestrator.on("workspace_loaded", (data) => {
    mainWindow?.webContents.send("orchestrator:workspace_loaded", data);
  });

  orchestrator.on("thought", (thought) => {
    mainWindow?.webContents.send("orchestrator:thought", thought);
  });

  orchestrator.on("step", (data) => {
    mainWindow?.webContents.send("orchestrator:step", data);
  });

  orchestrator.on("summary", (data) => {
    mainWindow?.webContents.send("orchestrator:summary", data);
  });

  orchestrator.on("tool_call", (data) => {
    mainWindow?.webContents.send("orchestrator:tool_call", data);
  });

  orchestrator.on("tool_result", (data) => {
    mainWindow?.webContents.send("orchestrator:tool_result", data);
  });

  orchestrator.on("response", (content) => {
    mainWindow?.webContents.send("orchestrator:response", content);
  });

  orchestrator.on("error", (data) => {
    mainWindow?.webContents.send("orchestrator:error", data);
  });

  orchestrator.on("skills_loaded", (data) => {
    mainWindow?.webContents.send("orchestrator:skills_loaded", data);
  });

  orchestrator.on("ready", (data) => {
    mainWindow?.webContents.send("orchestrator:ready", data);
  });

  orchestrator.on("workflow_start", (data) => {
    mainWindow?.webContents.send("orchestrator:workflow_start", data);
  });

  orchestrator.on("workflow_suggest", (data) => {
    mainWindow?.webContents.send("orchestrator:workflow_suggest", data);
  });

  orchestrator.on("workflow_end", (data) => {
    mainWindow?.webContents.send("orchestrator:workflow_end", data);
  });

  orchestrator.on("activity", (data) => {
    mainWindow?.webContents.send("orchestrator:activity", data);
  });

  orchestrator.on("task_complete", (data) => {
    mainWindow?.webContents.send("orchestrator:task_complete", data);
  });
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // CSP: only set for non-file:// URLs (Electron 42+)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith("file://")) {
      return callback({ responseHeaders: details.responseHeaders });
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';",
        ],
      },
    });
  });

  // Initialize orchestrator
  try {
    await orchestrator.init({ autoSave: true });
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    app.quit();
    return;
  }

  // Create window
  createWindow();

  // Setup all IPC bridges
  setupIPC();
  setupTerminalIPC(ipcMain, mainWindow);
  setupFileIPC(ipcMain);
  connectOrchestratorEvents();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      setupTerminalIPC(ipcMain, mainWindow); // re-attach terminal to new window
    }
  });
});

app.on("window-all-closed", async () => {
  await orchestrator.shutdown();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  shutdownTerminal();
  await orchestrator.shutdown();
});
