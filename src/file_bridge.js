/**
 * lv-zero — File System Bridge (Main Process)
 *
 * v1.0
 *   Puente entre el sistema de archivos y el renderer vía IPC.
 *   Proporciona operaciones seguras de lectura/escritura/lista para el IDE.
 *
 * NOTA: ipcMain se recibe por inyección de dependencias desde main.js
 *       porque en Electron 42+ la importación ESM directa de 'electron'
 *       puede fallar desde módulos secundarios.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

// Load permissions module (Phase 2) — non-blocking
let permissionsModule = null;
try {
  permissionsModule = _require("./core/permissions.cjs");
} catch (err) {
  console.warn("[FileBridge] Permissions module not available:", err.message);
}

// ─── Config ──────────────────────────────────────────────────────────────────

let ALLOWED_BASE = process.cwd();
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Actualiza dinámicamente la base del sistema de archivos para el explorador.
 * Cuando el usuario abre/crea un proyecto, main.cjs llama a esta función
 * para que el explorador de archivos opere sobre el proyecto activo.
 *
 * @param {string} basePath - Nueva ruta base absoluta
 */
export function setAllowedBase(basePath) {
  if (basePath) {
    ALLOWED_BASE = path.resolve(basePath);
    console.log(`[FileBridge] Allowed base updated to: ${ALLOWED_BASE}`);
  }
}

/**
 * Obtiene la base actual del sistema de archivos.
 * @returns {string} Ruta base actual
 */
export function getAllowedBase() {
  return ALLOWED_BASE;
}

// ─── Security ────────────────────────────────────────────────────────────────

/**
 * Resuelve y valida que una ruta esté dentro del directorio permitido.
 */
function resolveSafePath(inputPath) {
  const resolved = path.resolve(inputPath);
  let real;
  try {
    real = fs.realpathSync(resolved);  // Resolve symlinks to actual path
  } catch {
    // If file doesn't exist yet, check parent dir for symlink traversal
    const parent = path.dirname(resolved);
    const realParent = fs.realpathSync(parent);
    real = path.join(realParent, path.basename(resolved));
  }
  // Allow exact match (root directory itself) or paths within the base
  if (real !== ALLOWED_BASE && !real.startsWith(ALLOWED_BASE + path.sep)) {
    throw new Error("Path traversal denied");
  }
  return real;
}

// ─── File Tree ───────────────────────────────────────────────────────────────

/**
 * Escanea un directorio y construye un árbol para el explorador.
 */
function buildTree(dirPath, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return null;

  let stats, name;
  try {
    stats = fs.statSync(dirPath);
    name = path.basename(dirPath);
  } catch {
    // Can't stat this path (permissions, broken symlink, etc.)
    return null;
  }

  // Skip hidden directories and node_modules
  if (name.startsWith(".") || name === "node_modules") {
    return null;
  }

  if (stats.isFile()) {
    // Skip binary-ish extensions
    const ext = path.extname(name).toLowerCase();
    const binaryExts = [
      ".ico", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg",
      ".woff", ".woff2", ".ttf", ".eot",
      ".exe", ".dll", ".so", ".dylib",
      ".zip", ".tar", ".gz", ".rar",
      ".map",
    ];
    if (binaryExts.includes(ext)) return null;

    return {
      name,
      path: path.relative(ALLOWED_BASE, dirPath).replace(/\\/g, "/"),
      type: "file",
      size: stats.size,
      ext,
    };
  }

  if (stats.isDirectory()) {
    let children;
    try {
      children = fs
        .readdirSync(dirPath)
        .map((child) => buildTree(path.join(dirPath, child), depth + 1, maxDepth))
        .filter(Boolean);
    } catch {
      children = [];
    }

    return {
      name,
      path: path.relative(ALLOWED_BASE, dirPath).replace(/\\/g, "/"),
      type: "directory",
      children,
    };
  }

  return null;
}

// ─── Setup IPC ───────────────────────────────────────────────────────────────

/**
 * Registra los manejadores IPC para operaciones de archivos.
 * @param {object} ipc - El módulo ipcMain de Electron (inyectado)
 */
// ─── File Watcher (Explorador Reactivo) ─────────────────────────────────────

let watcher = null;
let watcherWindow = null;
const WATCH_DELAY = 300; // ms debounce

/** Start watching a directory recursively for changes */
export async function startFileWatcher(mainWindow, watchPath = process.cwd()) {
  stopFileWatcher();
  watcherWindow = mainWindow;

  try {
    const { default: chokidar } = await import("chokidar");

    // chokidar.watch is cross-platform reliable (unlike fs.watch on Windows)
    watcher = chokidar.watch(watchPath, {
      ignored: /(^|[/\\])node_modules[/\\]|(^|[/\\])\.[^/\\]|\.lv-zero/,
      persistent: true,
      ignoreInitial: true,
      depth: 10,
    });

    watcher
      .on("add", (filePath) => {
        if (watcherWindow && !watcherWindow.isDestroyed()) {
          watcherWindow.webContents.send("fs:update", {
            type: "add",
            path: filePath,
            timestamp: Date.now(),
          });
        }
      })
      .on("change", (filePath) => {
        if (watcherWindow && !watcherWindow.isDestroyed()) {
          watcherWindow.webContents.send("fs:update", {
            type: "change",
            path: filePath,
            timestamp: Date.now(),
          });
        }
      })
      .on("unlink", (filePath) => {
        if (watcherWindow && !watcherWindow.isDestroyed()) {
          watcherWindow.webContents.send("fs:update", {
            type: "unlink",
            path: filePath,
            timestamp: Date.now(),
          });
        }
      })
      .on("addDir", (filePath) => {
        if (watcherWindow && !watcherWindow.isDestroyed()) {
          watcherWindow.webContents.send("fs:update", {
            type: "addDir",
            path: filePath,
            timestamp: Date.now(),
          });
        }
      })
      .on("unlinkDir", (filePath) => {
        if (watcherWindow && !watcherWindow.isDestroyed()) {
          watcherWindow.webContents.send("fs:update", {
            type: "unlinkDir",
            path: filePath,
            timestamp: Date.now(),
          });
        }
      })
      .on("error", (err) => {
        console.error("[FileBridge] File watcher error:", err.message);
        // Only retry on transient errors, not permission errors
        if (err.code === "EPERM" || err.code === "EACCES") {
          // Permission errors are expected for system folders — don't retry
          return;
        }
        // Retry on transient errors (network, etc.)
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            startFileWatcher(mainWindow, watchPath);
          }
        }, 5000);
      });

    console.log(`[FileBridge] File watcher started with chokidar on ${watchPath}`);
    return true;
  } catch (err) {
    console.warn(`[FileBridge] File watcher failed: ${err.message}`);
    return false;
  }
}

export function stopFileWatcher() {
  if (watcher) {
    try { watcher.close(); } catch { /* ignore */ }
    watcher = null;
    watcherWindow = null;
  }
}

export function setupFileIPC(ipc, mainWindow) {
  // ── Read file ──────────────────────────────────────────────────────────

  ipc.handle("file:read", async (_event, filePath) => {
    try {
      const safePath = resolveSafePath(filePath);

      // Permission check (Phase 2) — non-blocking: if module unavailable, proceed
      if (permissionsModule && permissionsModule.checkPermission) {
        const permResult = permissionsModule.checkPermission(ALLOWED_BASE, "read_file", filePath);
        if (!permResult.allowed) {
          console.warn(`[FileBridge] Permission denied: read_file "${filePath}" — ${permResult.reason}`);
          return { success: false, error: `Permission denied: ${permResult.reason}` };
        }
      }

      const stats = fs.statSync(safePath);

      if (!stats.isFile()) {
        return { success: false, error: "Not a file" };
      }

      if (stats.size > MAX_FILE_SIZE) {
        return { success: false, error: "File too large (>5MB)" };
      }

      const content = fs.readFileSync(safePath, "utf-8");
      return { success: true, content, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Write file ─────────────────────────────────────────────────────────

  ipc.handle("file:write", async (_event, filePath, content) => {
    try {
      const safePath = resolveSafePath(filePath);

      // Permission check (Phase 2) — non-blocking: if module unavailable, proceed
      if (permissionsModule && permissionsModule.checkPermission) {
        const permResult = permissionsModule.checkPermission(ALLOWED_BASE, "write_file", filePath);
        if (!permResult.allowed) {
          console.warn(`[FileBridge] Permission denied: write_file "${filePath}" — ${permResult.reason}`);
          return { success: false, error: `Permission denied: ${permResult.reason}` };
        }
      }

      // Ensure directory exists
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(safePath, content, "utf-8");

      // ── EDITOR REACTIVO: Notify renderer to auto-open/refresh the file ──
      // This enables the live editor to show files as they are created/modified
      // by the agent, with syntax highlighting and real-time updates.
      if (mainWindow && !mainWindow.isDestroyed()) {
        const wasCreated = !fs.existsSync(safePath);
        mainWindow.webContents.send("editor:openFile", {
          filePath,
          action: wasCreated ? "create" : "modify",
        });
      }

      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── List directory ─────────────────────────────────────────────────────

  ipc.handle("file:list", async (_event, dirPath) => {
    try {
      const safePath = resolveSafePath(dirPath || ".");
      const entries = fs.readdirSync(safePath, { withFileTypes: true });

      const items = entries
        .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
        .map((entry) => {
          const fullPath = path.join(safePath, entry.name);
          let stats;
          try {
            stats = fs.statSync(fullPath);
          } catch {
            stats = { size: 0, mtime: new Date(0) };
          }

          return {
            name: entry.name,
            path: path.relative(ALLOWED_BASE, fullPath).replace(/\\/g, "/"),
            type: entry.isDirectory() ? "directory" : "file",
            size: stats.size,
            modified: stats.mtime?.toISOString(),
          };
        });

      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { success: true, items };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Get directory tree (for explorer panel) ────────────────────────────

  ipc.handle("file:tree", async (_event, dirPath, maxDepth) => {
    try {
      const safePath = resolveSafePath(dirPath || ".");
      const tree = buildTree(safePath, 0, maxDepth ?? 4);
      return { success: true, tree };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Create file ────────────────────────────────────────────────────────

  ipc.handle("file:create", async (_event, filePath, content) => {
    try {
      const safePath = resolveSafePath(filePath);
      const dir = path.dirname(safePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(safePath)) {
        return { success: false, error: "File already exists" };
      }

      fs.writeFileSync(safePath, content || "", "utf-8");
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Create directory ───────────────────────────────────────────────────

  ipc.handle("file:mkdir", async (_event, dirPath) => {
    try {
      const safePath = resolveSafePath(dirPath);

      if (fs.existsSync(safePath)) {
        return { success: false, error: "Directory already exists" };
      }

      fs.mkdirSync(safePath, { recursive: true });
      return { success: true, path: dirPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Delete file/directory ──────────────────────────────────────────────

  ipc.handle("file:delete", async (_event, targetPath) => {
    try {
      const safePath = resolveSafePath(targetPath);

      if (!fs.existsSync(safePath)) {
        return { success: false, error: "Path does not exist" };
      }

      const stats = fs.statSync(safePath);
      if (stats.isDirectory()) {
        fs.rmSync(safePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(safePath);
      }

      return { success: true, path: targetPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Rename / Move ──────────────────────────────────────────────────────

  ipc.handle("file:rename", async (_event, oldPath, newPath) => {
    try {
      const safeOld = resolveSafePath(oldPath);
      const safeNew = resolveSafePath(newPath);

      if (!fs.existsSync(safeOld)) {
        return { success: false, error: "Source does not exist" };
      }

      const dir = path.dirname(safeNew);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.renameSync(safeOld, safeNew);
      return { success: true, oldPath, newPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── File info ──────────────────────────────────────────────────────────

  ipc.handle("file:info", async (_event, targetPath) => {
    try {
      const safePath = resolveSafePath(targetPath);
      const stats = fs.statSync(safePath);

      return {
        success: true,
        info: {
          name: path.basename(safePath),
          path: targetPath,
          type: stats.isDirectory() ? "directory" : "file",
          size: stats.size,
          created: stats.birthtime?.toISOString(),
          modified: stats.mtime?.toISOString(),
          accessed: stats.atime?.toISOString(),
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── File Watcher control ────────────────────────────────────────────────
  ipc.handle("file:watchStart", async () => {
    // Use current allowed base if set, otherwise fall back to app root
    const watchTarget = ALLOWED_BASE || process.cwd();
    const success = await startFileWatcher(mainWindow, watchTarget);
    return { success };
  });

  ipc.handle("file:watchStop", () => {
    stopFileWatcher();
    return { success: true };
  });
}

export default {
  setupFileIPC,
  startFileWatcher,
  stopFileWatcher,
  setAllowedBase,
  getAllowedBase,
};
