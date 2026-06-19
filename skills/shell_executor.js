/**
 * shell_executor — Terminal automation for lv-zero
 *
 * Permite al agente ejecutar comandos en terminal Windows/PowerShell.
 * Incluye protecciones básicas contra comandos destructivos.
 *
 * v1.1 — Reactive Streaming
 *   + streamToTerminal: cuando es true, usa spawn() en lugar de execSync()
 *     y envía cada chunk de stdout/stderr al terminal de Electron vía IPC.
 *   + Comunicación con main process mediante process.emit (evento 'shell:output')
 *
 * v1.0 — Poder absoluto con guardarraíles mínimos
 */
import path from "path";
import { execSync, spawn } from "child_process";
import { quotePath } from "../src/shell_utils.js";

// ═════════════════════════════════════════════════════════════════════════
// 8.2 — Shell Execution Security (Allowlist, Timeout, Output Limit)
// ═════════════════════════════════════════════════════════════════════════

// ─── Blacklist: comandos que requieren confirmación explícita ────────────────
const DESTRUCTIVE_PATTERNS = [
  /^rm\s+-rf/i,
  /^del\s+\/f/i,
  /^format/i,
  /^diskpart/i,
  /^fdisk/i,
  /^dd\s+if/i,
  /^shutdown/i,
  /^reg\s+delete/i,
  /^sc\s+delete/i,
];

function isDestructive(command) {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(command.trim()));
}

// ─── Allowlist (configurable via env) ───────────────────────────────────────
// LLM_SHELL_ALLOWLIST can contain comma-separated base commands, e.g.:
//   npm,node,git,python,pip,dir,ls,cd,type,cat,echo,mkdir,copy,del
// If set to "*", all commands are allowed (current behavior).
// If empty/null/undefined, all commands are allowed by default.
const ALLOWLIST_ENV = process.env.LLM_SHELL_ALLOWLIST || "*";
const ALLOWLIST = ALLOWLIST_ENV === "*"
  ? null  // null = all allowed
  : ALLOWLIST_ENV.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

/**
 * Checks if a command is in the allowlist (by base command).
 * @param {string} command - Full command string
 * @returns {boolean}
 */
function isAllowed(command) {
  if (ALLOWLIST === null) return true; // All commands allowed
  const baseCmd = command.trim().split(/\s+/)[0].toLowerCase();
  // Remove path prefixes (e.g. "npx.cmd" → "npx", "C:\npm\npm.exe" → "npm")
  const cleanCmd = path.parse(baseCmd).name;
  return ALLOWLIST.includes(cleanCmd);
}

// ─── Output size limit ──────────────────────────────────────────────────────
// LLM_SHELL_OUTPUT_LIMIT: max bytes of output to return (default 10KB)
const OUTPUT_LIMIT = parseInt(process.env.LLM_SHELL_OUTPUT_LIMIT, 10) || 10 * 1024;

/**
 * Truncates output to conserve tokens — keeps first 20 + last 50 lines.
 * If output has ≤100 lines, returns it unchanged.
 * If >100 lines, returns head (20) + marker + tail (50), discarding middle.
 * This preserves the command's start and end while saving ~70% of tokens.
 *
 * @param {string} output - The full command output
 * @returns {string} Truncated output with line-based smart compression
 */
function truncateOutput(output) {
  if (!output) return output;

  const MAX_TOTAL_LINES = 100;
  const HEAD_LINES = 20;
  const TAIL_LINES = 50;

  const lines = output.split(/\r?\n/);

  if (lines.length <= MAX_TOTAL_LINES) return output;

  const head = lines.slice(0, HEAD_LINES).join('\n');
  const tail = lines.slice(-TAIL_LINES).join('\n');
  const skipped = lines.length - HEAD_LINES - TAIL_LINES;

  return `${head}\n\n... [${skipped} LÍNEAS TRUNCADAS — ${lines.length} total, ${HEAD_LINES} inicio + ${TAIL_LINES} final mostradas] ...\n\n${tail}`;
}

/**
 * Execute a command using spawn() and stream output to the terminal.
 * Emits 'shell:output' events on process for main.cjs to forward via IPC.
 */
function executeStreaming(command, shellPath, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const shellArgs = shellPath === "powershell.exe"
      ? ["-NoProfile", "-Command", command]
      : ["/C", command];

    const child = spawn(shellPath, shellArgs, {
      cwd: cwd || undefined,
      windowsHide: false,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    // Emit each chunk so main.cjs can forward to terminal:data
    const emitChunk = (chunk, stream = "stdout") => {
      process.emit("shell:output", { chunk, stream, command });
    };

    // Write command header to terminal
    emitChunk(`\r\n$ ${command}\r\n`);

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      emitChunk(text, "stdout");
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      emitChunk(text, "stderr");
    });

    // Timeout guard
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill();
        emitChunk(`\r\n⚠ Timeout after ${timeoutMs}ms\r\n`);
        resolve({
          success: false,
          command,
          exitCode: null,
          stdout,
          stderr,
          error: `Timeout after ${timeoutMs}ms`,
          timedOut: true,
        });
      }, timeoutMs);
    }

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      emitChunk(`\r\n❖ Exit code: ${exitCode}\r\n`);

      // ── Auto-Healing (Fase 4): emit error event if command failed ──────
      if (exitCode !== 0) {
        process.emit("shell:error", {
          command,
          exitCode,
          stderr: stderr || null,
          stdout: stdout || null,
        });
      }

      resolve({
        success: exitCode === 0,
        command,
        exitCode,
        stdout: stdout || "(sin salida)",
        stderr: stderr || null,
      });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      emitChunk(`\r\n✖ Error: ${err.message}\r\n`);
      resolve({
        success: false,
        command,
        exitCode: -1,
        stdout,
        stderr: err.message,
        error: err.message,
      });
    });
  });
}

/**
 * Detect the appropriate shell based on command content.
 * Uses patterns specific to PowerShell vs CMD.
 */
function detectShell(command) {
  const trimmed = command.trim();

  // PowerShell-specific patterns
  const psPatterns = [
    /^\s*dir\s+-/i,            // dir -recurse (PS style) vs plain dir (CMD)
    /^\s*ls\s+-/i,             // ls -Force (not valid in CMD)
    /^\s*get-/i,               // Get-Process, Get-Service, etc.
    /^\s*gcm\b/i,              // gcm = Get-Command
    /^\s*select\b/i,           // Select-Object
    /^\s*where\b/i,            // Where-Object
    /^\s*foreach\b/i,          // ForEach-Object
    /^\s*foreach-object\b/i,
    /[|]\s*select\b/i,         // pipeline to Select-Object
    /[|]\s*where\b/i,          // pipeline to Where-Object
    /[|]\s*foreach\b/i,
    /\$\w+/,                   // $variable (PowerShell)
  ];

  // CMD-specific patterns
  const cmdPatterns = [
    /^\s*type\s/i,
    /^\s*dir\s*$/i,
    /^\s*copy\s/i,
    /^\s*ren\s/i,
    /^\s*cls\s*$/i,
    /^\s*set\s/i,
  ];

  for (const p of psPatterns) {
    if (p.test(trimmed)) return "powershell";
  }
  for (const p of cmdPatterns) {
    if (p.test(trimmed)) return "cmd";
  }

  // Default: try to use active terminal shell (synced by main.cjs via env)
  if (process.env.__LV_ACTIVE_SHELL === "powershell") {
    return "powershell";
  }

  return "cmd"; // fallback
}

export default {
  name: "shell_executor",
  description:
    "Ejecuta comandos en la terminal del sistema (cmd.exe o PowerShell). " +
    "Úsalo para instalar dependencias (npm install, pip install), " +
    "correr scripts (node script.js, python script.py), " +
    "explorar directorios (dir, ls), leer archivos (type, cat), " +
    "o cualquier tarea de línea de comandos. " +
    "Comandos destructivos (rm -rf, format, del /f) requieren confirmación explícita.",

  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Comando a ejecutar en la terminal. Ej: 'npm install axios' o 'node src/index.js'",
      },
      shell: {
        type: "string",
        enum: ["cmd", "powershell", "auto"],
        description:
          'Shell a usar: "cmd" para cmd.exe, "powershell" para PowerShell, "auto" para detectar automáticamente según el comando. Por defecto: "auto".',
        default: "auto",
      },
      cwd: {
        type: "string",
        description:
          "Directorio de trabajo para ejecutar el comando. Por defecto: el directorio del proyecto.",
      },
      timeout: {
        type: "number",
        description:
          "Timeout en milisegundos. Por defecto: 30000 (30s). Máximo: 120000 (2min).",
        default: 30000,
      },
      confirm: {
        type: "boolean",
        description:
          "Confirmación explícita para comandos destructivos (rm -rf, format, etc). Por defecto: false.",
        default: false,
      },
      streamToTerminal: {
        type: "boolean",
        description:
          "[Reactivo] Si es true, el comando se ejecuta con spawn() y su salida se transmite en vivo al panel Terminal de Electron. Por defecto: true.",
        default: true,
      },
    },
    required: ["command"],
  },

  handler: async ({ command, shell = "auto", cwd, timeout = 30000, confirm = false, streamToTerminal = true }) => {
    // ── Validation ────────────────────────────────────────────────────────
    if (!command || command.trim().length === 0) {
      return {
        success: false,
        error: "El comando no puede estar vacío.",
      };
    }

    // ── 8.2 — Allowlist check ────────────────────────────────────────────
    if (!isAllowed(command)) {
      return {
        success: false,
        error:
          `Comando no permitido: "${command.split(/\s+/)[0]}". ` +
          `Configura LLM_SHELL_ALLOWLIST en .env para permitir este comando. ` +
          `Ej: LLM_SHELL_ALLOWLIST=npm,node,git,python,pip,dir,ls,type,cat,echo`,
        requiresUserInput: false,
      };
    }

    // ── Destructive command guard ─────────────────────────────────────────
    if (isDestructive(command) && !confirm) {
      return {
        success: false,
        error:
          `Comando potencialmente destructivo detectado: "${command}". ` +
          `Si estás seguro, establece confirm: true en los argumentos.`,
        requiresUserInput: true,
      };
    }

    // ── Timeout cap ───────────────────────────────────────────────────────
    const safeTimeout = Math.min(Math.max(1000, timeout), 120000);

    // ── Shell selection (with auto-detect) ────────────────────────────────
    const resolvedShell = shell === "auto" ? detectShell(command) : shell;
    const shellPath = resolvedShell === "powershell" ? "powershell.exe" : "cmd.exe";

    // ── Path quoting — wrap paths with spaces in shell-appropriate quotes ──
    const quotedCommand = quotePath(command, resolvedShell);

    // ── Streaming mode (REACTIVE) ─────────────────────────────────────────
    if (streamToTerminal) {
      return await executeStreaming(quotedCommand, shellPath, cwd, safeTimeout);
    }

    // ── Silent mode (legacy execSync) ─────────────────────────────────────
    try {
      const output = execSync(quotedCommand, {
        cwd: cwd || undefined,
        shell: shellPath,
        timeout: safeTimeout,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
        windowsHide: true,
      });

      return {
        success: true,
        command,
        shell,
        exitCode: 0,
        stdout: truncateOutput(output || "(sin salida)"),
        stderr: null,
        duration: `${safeTimeout}ms timeout`,
      };
    } catch (err) {
      return {
        success: false,
        command,
        shell,
        exitCode: err.status ?? -1,
        stdout: truncateOutput(err.stdout || ""),
        stderr: truncateOutput(err.stderr || err.message),
        error: `Código de salida: ${err.status ?? "N/A"}. ${err.stderr || err.message}`,
      };
    }
  },
};
