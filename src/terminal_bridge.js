/**
 * lv-zero — Terminal Bridge (Main Process)
 *
 * v1.2 — Shell Selector
 *   + Shell state management (currentShell, currentShellType)
 *   + createPty() accepts optional shellType parameter
 *   + IPC handlers: terminal:switchShell, terminal:shellInfo
 *   + Event: terminal:shellChanged emitted when shell is switched
 *
 * v1.1 — Reactive IPC
 *   + executeInTerminal(): spawn child process, pipe stdout/stderr to xterm.js
 *   + writeToPty(): write raw data to the existing PTY
 *   + onTerminalData(): external callback for shell_executor streaming
 *
 * NOTA: ipcMain se recibe por inyección de dependencias desde main.js
 *       porque en Electron 42+ la importación ESM directa de 'electron'
 *       puede fallar desde módulos secundarios.
 */

import { createRequire } from "module";
import { spawn } from "child_process";
import { toNodePath } from "./shell_utils.js";
const _require = createRequire(import.meta.url);

// Load permissions module (Phase 2) — non-blocking
let permissionsModule = null;
try {
  permissionsModule = _require("./core/permissions.cjs");
} catch (err) {
  console.warn("[TerminalBridge] Permissions module not available:", err.message);
}

// Load timer system — non-blocking
let timerSystem = null;
try {
  timerSystem = _require("./core/timer-system.cjs");
} catch (err) {
  console.warn("[TerminalBridge] Timer system not available:", err.message);
}

let spawnPty;

// Try to load node-pty; if native compilation failed, provide graceful fallback
try {
  const pty = _require("node-pty");
  spawnPty = pty.spawn;
  console.log("[TerminalBridge] node-pty loaded successfully");
} catch (err) {
  console.warn(`[TerminalBridge] node-pty not available: ${err.message}`);
  console.warn("[TerminalBridge] Terminal will use simulated/fallback mode");
  spawnPty = null;
}

// ─── PTY Instance ────────────────────────────────────────────────────────────

let ptyProcess = null;
let ptyWindow = null;
let ptySessionId = 0; // Incremented each createPty() call; used in onExit to ignore stale events

// ─── Shell State ─────────────────────────────────────────────────────────────

let currentShell = process.env.COMSPEC || "cmd.exe";     // full path
let currentShellType = "cmd";                              // "cmd" | "powershell"

// ─── External data callback (for shell_executor streaming) ───────────────────

/** @type {null|((chunk: string) => void)} */
let onExternalData = null;

/**
 * Register a callback that receives every chunk sent to the terminal.
 * Used by main.cjs → orchestrator to stream shell_executor output.
 */
export function setOnTerminalData(cb) {
  onExternalData = cb;
}

// ─── Detect default shell ──────────────────────────────────────────────────

function getDefaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

/**
 * Get the shell path for a given shell type.
 */
function getShellPath(shellType) {
  if (shellType === "powershell") return "powershell.exe";
  return process.env.COMSPEC || "cmd.exe";
}

/**
 * Get current shell type ("cmd" | "powershell").
 */
export function getCurrentShellType() {
  return currentShellType;
}

// ─── Create PTY ──────────────────────────────────────────────────────────────

/**
 * Create (or recreate) a PTY with the specified shell type.
 * @param {Electron.BrowserWindow} win - The main window
 * @param {string} [shellType] - "cmd" or "powershell" (defaults to currentShellType)
 */
function createPty(win, shellType = currentShellType) {
  if (ptyProcess) {
    killPty();
  }

  ptyWindow = win;

  if (!spawnPty) {
    // Fallback: simulate a terminal that reports unavailability
    console.warn("[TerminalBridge] PTY not available — sending fallback message");
    if (ptyWindow && !ptyWindow.isDestroyed()) {
      ptyWindow.webContents.send(
        "terminal:data",
        "lv-zero terminal bridge: node-pty native module is not available.\r\n"
      );
      ptyWindow.webContents.send(
        "terminal:data",
        "To enable the real terminal, install Visual Studio Build Tools with:\r\n"
      );
      ptyWindow.webContents.send(
        "terminal:data",
        "  - 'MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs'\r\n"
      );
      ptyWindow.webContents.send(
        "terminal:data",
        "  - 'Windows 10/11 SDK'\r\n"
      );
      ptyWindow.webContents.send(
        "terminal:data",
        "Then run: npm run postinstall\r\n\n"
      );
      ptyWindow.webContents.send("terminal:exit", { exitCode: 1, signal: null });
    }
    return { pid: null, shell: null, fallback: true };
  }

  // Resolve shell path based on requested type
  const shellPath = getShellPath(shellType);
  currentShell = shellPath;
  currentShellType = shellType;

  // Notify main.cjs to sync __LV_ACTIVE_SHELL env var for shell_executor auto-detect
  if (typeof process !== "undefined" && process.emit) {
    process.emit("shell:changed", shellType);
  }

  const cols = Math.min(process.stdout.columns || 120, 160);
  const rows = Math.min(process.stdout.rows || 30, 50);

  // Capture current session ID so onExit can ignore stale events from old PTYs
  const sessionId = ++ptySessionId;

  ptyProcess = spawnPty(shellPath, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.cwd(),
    env: { ...process.env, TERM: "xterm-256color" },
  });

  ptyProcess.onData((data) => {
    if (ptyWindow && !ptyWindow.isDestroyed()) {
      ptyWindow.webContents.send("terminal:data", data);
    }
    // Also forward to external callback if registered
    if (onExternalData) {
      onExternalData(data);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    // Ignore stale exit events from old PTY sessions (e.g. during shell switch)
    if (sessionId !== ptySessionId) return;

    if (ptyWindow && !ptyWindow.isDestroyed()) {
      ptyWindow.webContents.send("terminal:exit", { exitCode, signal });
    }
    ptyProcess = null;
    ptyWindow = null;
  });

  return { pid: ptyProcess.pid, shell: shellType };
}

// ─── Kill PTY ────────────────────────────────────────────────────────────────

function killPty() {
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }
    ptyProcess = null;
    ptyWindow = null;
  }
}

// ─── Write raw data to the existing PTY ──────────────────────────────────────

/**
 * Write data directly to the running PTY.
 * Used by the orchestrator to echo agent commands into the user's terminal.
 */
export function writeToPty(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
    return true;
  }
  return false;
}

// ─── Execute a command in a visible child process (stream to xterm.js) ───────

/**
 * Spawn a shell command and pipe its stdout/stderr to the terminal window.
 *
 * @param {string} command   The command to execute
 * @param {object} [options]
 * @param {string} [options.cwd]       Working directory
 * @param {string} [options.shellType] "cmd" or "powershell"
 * @param {number} [options.timeout]   Max milliseconds (0 = no timeout)
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number|null}>}
 */
export function executeInTerminal(command, options = {}) {
  return new Promise((resolve) => {
    const {
      cwd = process.cwd(),
      shellType = "cmd",
      timeout = 0,
    } = options;

    // ── Normalize backslashes to forward slashes ──────────────────────────
    // Forward slashes work in both CMD and PowerShell via Node.js child_process
    // and avoid quoting issues entirely
    const normalizedCommand = toNodePath(command);

    const shellPath = shellType === "powershell" ? "powershell.exe" : "cmd.exe";
    const shellArgs = shellType === "powershell"
      ? ["-NoProfile", "-Command", normalizedCommand]
      : ["/C", normalizedCommand];

    const child = spawn(shellPath, shellArgs, {
      cwd,
      windowsHide: false,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const sendToTerminal = (chunk) => {
      if (ptyWindow && !ptyWindow.isDestroyed()) {
        ptyWindow.webContents.send("terminal:data", chunk);
      }
    };

    // Send the command itself as a prompt echo
    sendToTerminal(`\r\n$ ${command}\r\n`);

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      sendToTerminal(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      sendToTerminal(text);
    });

    // Timeout guard
    let timer = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill();
        sendToTerminal(`\r\n⚠ Command timed out after ${timeout}ms\r\n`);
        resolve({ stdout, stderr, exitCode: null, timedOut: true });
      }, timeout);
    }

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      sendToTerminal(`\r\n❖ Exit code: ${exitCode}\r\n`);
      resolve({ stdout, stderr, exitCode, timedOut: false });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      sendToTerminal(`\r\n✖ Failed to spawn: ${err.message}\r\n`);
      resolve({ stdout, stderr, exitCode: -1, error: err.message });
    });
  });
}

// ─── Setup IPC ───────────────────────────────────────────────────────────────

export function setupTerminalIPC(ipc, mainWindow) {
  ptyWindow = mainWindow;

  ipc.handle("terminal:create", () => {
    const info = createPty(mainWindow);
    return info;
  });

  ipc.handle("terminal:write", (_event, data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
      return { success: true };
    }
    return { success: false, error: "No active terminal" };
  });

  ipc.handle("terminal:resize", (_event, cols, rows) => {
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
      return { success: true };
    }
    return { success: false, error: "No active terminal" };
  });

  ipc.handle("terminal:kill", () => {
    killPty();
    return { success: true };
  });

  // ── Execute a command visibly in the terminal ──────────────────────────
  ipc.handle("terminal:execCommand", async (_event, command, options) => {
    // Permission check (Phase 2) — non-blocking: if module unavailable, proceed
    if (permissionsModule && permissionsModule.checkPermission && permissionsModule.extractCommandName) {
      const cmdName = permissionsModule.extractCommandName(command);
      if (cmdName) {
        const projectPath = process.cwd();
        const permResult = permissionsModule.checkPermission(projectPath, "command", cmdName);
        if (!permResult.allowed) {
          console.warn(`[TerminalBridge] Permission denied: command "${cmdName}" — ${permResult.reason}`);
          return { success: false, error: `Permission denied: ${permResult.reason}`, exitCode: 1 };
        }
      }
    }

    // Inject timeout from timer system if options don't already specify one
    const mergedOptions = { ...options };
    if (timerSystem && (!mergedOptions.timeout || mergedOptions.timeout <= 0)) {
      mergedOptions.timeout = timerSystem.getCommandTimeout(command);
    }

    const result = await executeInTerminal(command, mergedOptions);

    // If timed out, log a warning
    if (result.timedOut) {
      console.warn(`[TerminalBridge] Command timed out: "${command.substring(0, 80)}..."`);
    }

    return result;
  });

  // ── Switch the active shell (kill PTY + recreate with new shell) ──────
  ipc.handle("terminal:switchShell", (_event, shellType) => {
    if (shellType !== "cmd" && shellType !== "powershell") {
      return { success: false, error: `Invalid shell: ${shellType}` };
    }
    if (shellType === currentShellType) {
      return { success: true, shell: currentShellType, unchanged: true };
    }
    createPty(mainWindow, shellType);
    // Notify renderer of shell change
    if (ptyWindow && !ptyWindow.isDestroyed()) {
      ptyWindow.webContents.send("terminal:shellChanged", {
        shell: shellType,
        path: currentShell,
      });
    }
    return { success: true, shell: shellType };
  });

  // ── Get current shell info ────────────────────────────────────────────
  ipc.handle("terminal:shellInfo", () => ({
    shell: currentShellType,
    path: currentShell,
    pid: ptyProcess?.pid || null,
    active: ptyProcess !== null,
  }));
}

export function updateTerminalWindow(mainWindow) {
  ptyWindow = mainWindow;
}

export function shutdownTerminal() {
  killPty();
}

export default {
  setupTerminalIPC,
  updateTerminalWindow,
  shutdownTerminal,
  executeInTerminal,
  writeToPty,
  setOnTerminalData,
  getCurrentShellType,
};
