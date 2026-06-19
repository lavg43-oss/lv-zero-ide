/**
 * ─── Live Preview Server for lv-zero ───────────────────────────────────────
 *
 * Spawns a local development server for the active project and provides
 * a webview-based Live Preview panel inside the Electron UI.
 *
 * Supports:
 *   - Static HTML sites (via http-server or built-in static server)
 *   - Vite projects (via `npx vite`)
 *   - Node.js/Express projects (via `node server.js`)
 *   - Python projects (via `python -m http.server`)
 *   - Auto-detection of framework and dev command
 *
 * v1.0 — June 2026
 *
 * @module preview_server
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { EventEmitter } from "events";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default port for the preview server */
const DEFAULT_PORT = 4173;

/** Port range to try if default is busy */
const PORT_RANGE = 20;

/** Timeout for server startup detection (ms) */
const STARTUP_TIMEOUT = 15000;

/** Poll interval for checking if server is up (ms) */
const HEALTH_CHECK_INTERVAL = 500;

// ═══════════════════════════════════════════════════════════════════════════════
// Framework Detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} FrameworkConfig
 * @property {string} name - Framework name
 * @property {string} command - Dev command
 * @property {string[]} args - Command arguments
 * @property {number} port - Default port
 * @property {RegExp} readyPattern - Pattern to detect server ready
 */

/**
 * Detects the project framework from its configuration files.
 *
 * @param {string} projectPath - Path to the project root
 * @returns {FrameworkConfig|null} Detected framework config, or null
 */
function detectFramework(projectPath) {
  const hasFile = (file) => fs.existsSync(path.resolve(projectPath, file));
  const hasDep = (name) => {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(projectPath, "package.json"), "utf-8")
      );
      return (
        (pkg.dependencies && pkg.dependencies[name]) ||
        (pkg.devDependencies && pkg.devDependencies[name])
      );
    } catch {
      return false;
    }
  };

  // ── Vite (React, Vue, Svelte, Solid, etc.) ──────────────────────────
  if (hasDep("vite")) {
    return {
      name: "Vite",
      command: "npx",
      args: ["vite", "--port", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /Local:\s+http:\/\/localhost:\d+/i,
    };
  }

  // ── Next.js ─────────────────────────────────────────────────────────
  if (hasDep("next")) {
    return {
      name: "Next.js",
      command: "npx",
      args: ["next", "dev", "-p", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /ready\s+-\s+started\s+server\s+on\s+http:\/\/localhost:\d+/i,
    };
  }

  // ── Astro ───────────────────────────────────────────────────────────
  if (hasDep("astro")) {
    return {
      name: "Astro",
      command: "npx",
      args: ["astro", "dev", "--port", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /http:\/\/localhost:\d+/i,
    };
  }

  // ── SvelteKit ───────────────────────────────────────────────────────
  if (hasDep("@sveltejs/kit")) {
    return {
      name: "SvelteKit",
      command: "npx",
      args: ["vite", "dev", "--port", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /Local:\s+http:\/\/localhost:\d+/i,
    };
  }

  // ── Nuxt.js ─────────────────────────────────────────────────────────
  if (hasDep("nuxt") || hasDep("nuxt3")) {
    return {
      name: "Nuxt.js",
      command: "npx",
      args: ["nuxt", "dev", "--port", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /http:\/\/localhost:\d+/i,
    };
  }

  // ── Angular ─────────────────────────────────────────────────────────
  if (hasDep("@angular/core")) {
    return {
      name: "Angular",
      command: "npx",
      args: ["ng", "serve", "--port", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /http:\/\/localhost:\d+/i,
    };
  }

  // ── Node.js / Express (look for server.js or app.js) ────────────────
  if (hasFile("server.js") || hasFile("app.js") || hasFile("index.js")) {
    const entryFile = hasFile("server.js") ? "server.js" :
                      hasFile("app.js") ? "app.js" : "index.js";
    return {
      name: "Node.js",
      command: "node",
      args: [entryFile],
      port: 3000, // Common Express default
      readyPattern: /listening|started|running|port/i,
    };
  }

  // ── Python (Flask, Django, or simple HTTP server) ───────────────────
  if (hasFile("requirements.txt") || hasFile("pyproject.toml")) {
    const reqs = hasFile("requirements.txt")
      ? fs.readFileSync(path.resolve(projectPath, "requirements.txt"), "utf-8")
      : "";
    if (reqs.includes("flask") || reqs.includes("django")) {
      return {
        name: "Python Web",
        command: "python",
        args: ["-m", "flask", "run", "--port", String(DEFAULT_PORT)],
        port: DEFAULT_PORT,
        readyPattern: /Running on/i,
      };
    }
    // Fallback: Python HTTP server
    return {
      name: "Python",
      command: "python",
      args: ["-m", "http.server", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /Serving HTTP/i,
    };
  }

  // ── Static HTML (index.html in root) ────────────────────────────────
  if (hasFile("index.html")) {
    return {
      name: "Static HTML",
      command: "npx",
      args: ["serve", projectPath, "--port", String(DEFAULT_PORT), "--no-clipboard"],
      port: DEFAULT_PORT,
      readyPattern: /http:\/\/localhost:\d+/i,
    };
  }

  // ── Unknown — try Vite as default ───────────────────────────────────
  if (hasFile("package.json")) {
    return {
      name: "Unknown (trying Vite)",
      command: "npx",
      args: ["vite", "--port", String(DEFAULT_PORT)],
      port: DEFAULT_PORT,
      readyPattern: /Local:\s+http:\/\/localhost:\d+/i,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Preview Server
// ═══════════════════════════════════════════════════════════════════════════════

export class PreviewServer extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    super();
    this._logger = options.logger || console;
    this._process = null;
    this._port = DEFAULT_PORT;
    this._projectPath = null;
    this._framework = null;
    this._running = false;
    this._url = null;
  }

  // ─── Properties ────────────────────────────────────────────────────────

  /** @returns {boolean} */
  get isRunning() {
    return this._running;
  }

  /** @returns {string|null} */
  get url() {
    return this._url;
  }

  /** @returns {number} */
  get port() {
    return this._port;
  }

  /** @returns {FrameworkConfig|null} */
  get framework() {
    return this._framework;
  }

  // ─── Start ─────────────────────────────────────────────────────────────

  /**
   * Starts the preview server for the given project.
   *
   * @param {string} projectPath - Path to the project root
   * @returns {Promise<{ success: boolean, url?: string, framework?: string, error?: string }>}
   */
  async start(projectPath) {
    // Stop any existing server
    await this.stop();

    const resolvedPath = path.resolve(projectPath);

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: `Project path does not exist: ${resolvedPath}` };
    }

    this._projectPath = resolvedPath;

    // Detect framework
    this._framework = detectFramework(resolvedPath);

    if (!this._framework) {
      return {
        success: false,
        error: "Could not detect project framework. Ensure the project has a package.json or index.html.",
      };
    }

    this._logger.info(`   🌐 Preview: ${this._framework.name} detectado en ${resolvedPath}`);

    // Try to find an available port
    this._port = await this._findAvailablePort(this._framework.port);

    // Adjust args with actual port
    const args = this._framework.args.map((a) =>
      a.includes(String(DEFAULT_PORT)) ? a.replace(String(DEFAULT_PORT), String(this._port)) : a
    );

    return new Promise((resolve) => {
      try {
        this._process = spawn(this._framework.command, args, {
          cwd: resolvedPath,
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
          env: {
            ...process.env,
            PORT: String(this._port),
            HOST: "0.0.0.0",
          },
        });

        let startupOutput = "";
        const startupTimer = setTimeout(() => {
          // Server started but no ready pattern detected — assume it's up
          this._running = true;
          this._url = `http://localhost:${this._port}`;
          this.emit("started", { url: this._url, framework: this._framework.name });
          this._logger.info(`   🌐 Preview: ${this._url} (${this._framework.name})`);
          resolve({
            success: true,
            url: this._url,
            framework: this._framework.name,
          });
        }, STARTUP_TIMEOUT);

        // Watch stdout for ready pattern
        this._process.stdout.on("data", (chunk) => {
          const text = chunk.toString();
          startupOutput += text;

          // Check for ready pattern
          if (this._framework.readyPattern.test(startupOutput)) {
            clearTimeout(startupTimer);
            if (!this._running) {
              this._running = true;
              // Extract actual URL from output if possible
              const urlMatch = startupOutput.match(/http:\/\/localhost:\d+/i);
              this._url = urlMatch ? urlMatch[0] : `http://localhost:${this._port}`;
              this.emit("started", { url: this._url, framework: this._framework.name });
              this._logger.info(`   🌐 Preview: ${this._url} (${this._framework.name})`);
              resolve({
                success: true,
                url: this._url,
                framework: this._framework.name,
              });
            }
          }
        });

        // Watch stderr (some frameworks log to stderr)
        this._process.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          startupOutput += text;

          if (this._framework.readyPattern.test(startupOutput)) {
            clearTimeout(startupTimer);
            if (!this._running) {
              this._running = true;
              const urlMatch = startupOutput.match(/http:\/\/localhost:\d+/i);
              this._url = urlMatch ? urlMatch[0] : `http://localhost:${this._port}`;
              this.emit("started", { url: this._url, framework: this._framework.name });
              this._logger.info(`   🌐 Preview: ${this._url} (${this._framework.name})`);
              resolve({
                success: true,
                url: this._url,
                framework: this._framework.name,
              });
            }
          }
        });

        // Handle process error
        this._process.on("error", (err) => {
          clearTimeout(startupTimer);
          this._running = false;
          this._logger.warn(`   ⚠️ Preview error: ${err.message}`);
          resolve({ success: false, error: err.message });
        });

        // Handle process exit
        this._process.on("exit", (code) => {
          if (this._running) {
            this._running = false;
            this._url = null;
            this.emit("stopped", { code });
            this._logger.info(`   🌐 Preview stopped (exit code: ${code})`);
          }
        });

      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  // ─── Stop ──────────────────────────────────────────────────────────────

  /**
   * Stops the preview server.
   * @returns {Promise<{ success: boolean }>}
   */
  async stop() {
    if (this._process) {
      return new Promise((resolve) => {
        const killTimer = setTimeout(() => {
          // Force kill after 3 seconds
          if (this._process && !this._process.killed) {
            try { this._process.kill("SIGKILL"); } catch {}
          }
          this._process = null;
          this._running = false;
          this._url = null;
          resolve({ success: true });
        }, 3000);

        try {
          this._process.on("exit", () => {
            clearTimeout(killTimer);
            this._process = null;
            this._running = false;
            this._url = null;
            resolve({ success: true });
          });
          this._process.kill("SIGTERM");
        } catch {
          clearTimeout(killTimer);
          this._process = null;
          this._running = false;
          this._url = null;
          resolve({ success: true });
        }
      });
    }
    return { success: true };
  }

  // ─── Restart ───────────────────────────────────────────────────────────

  /**
   * Restarts the preview server (useful after code changes).
   * @param {string} [projectPath] - Optional new project path
   * @returns {Promise<object>}
   */
  async restart(projectPath) {
    await this.stop();
    return await this.start(projectPath || this._projectPath);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Finds an available port starting from the preferred port.
   * @param {number} preferredPort
   * @returns {Promise<number>}
   */
  async _findAvailablePort(preferredPort) {
    const net = await import("net");
    return new Promise((resolve) => {
      const tryPort = (port, attempt) => {
        if (attempt > PORT_RANGE) {
          resolve(preferredPort); // Give up, use preferred
          return;
        }
        const server = net.createServer();
        server.on("error", () => {
          // Port in use, try next
          tryPort(port + 1, attempt + 1);
        });
        server.listen(port, "127.0.0.1", () => {
          server.close(() => resolve(port));
        });
      };
      tryPort(preferredPort, 0);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {PreviewServer|null} */
let _defaultInstance = null;

/**
 * Gets or creates the default PreviewServer instance.
 * @param {object} [options]
 * @returns {PreviewServer}
 */
export function getPreviewServer(options = {}) {
  if (!_defaultInstance) {
    _defaultInstance = new PreviewServer(options);
  }
  return _defaultInstance;
}
