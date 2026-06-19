/**
 * lv-zero — Smart Application Launcher
 *
 * Phase 7: Auto-detects project type and provides pre-configured run targets.
 * Non-blocking — all functions wrapped in try/catch.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// ─── Timer System (non-blocking load) ─────────────────────────────────────────

let timerSystem = null;
try {
  timerSystem = require("./timer-system.cjs");
} catch (err) {
  console.warn("[SmartLauncher] Timer system not available:", err.message);
}

// ─── Detection Indicators ─────────────────────────────────────────────────────

const INDICATORS = {
  node: ["package.json"],
  python: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
  docker: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"],
  make: ["Makefile", "makefile"],
  dotnet: ["*.sln", "*.csproj", "*.fsproj"],
  web: ["index.html"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
  ruby: ["Gemfile"],
};

const COMMON_DEV_PORTS = [3000, 4000, 5000, 8080, 5173];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if a glob-like pattern matches any file in the given directory.
 * Supports simple wildcard (*.ext) patterns.
 */
function _hasMatchingFile(dir, pattern) {
  try {
    if (pattern.includes("*")) {
      const ext = pattern.slice(1); // e.g. ".sln"
      const files = fs.readdirSync(dir);
      return files.some((f) => f.endsWith(ext));
    }
    return fs.existsSync(path.join(dir, pattern));
  } catch {
    return false;
  }
}

/**
 * Read a JSON file safely.
 */
function _readJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Write a JSON file safely.
 */
function _writeJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ─── Target Generators ────────────────────────────────────────────────────────

/**
 * Generate run targets for a Node.js project.
 */
function _nodeTargets(projectPath) {
  const targets = [
    { name: "dev", command: "npm run dev", description: "Start dev server" },
    { name: "build", command: "npm run build", description: "Build for production" },
    { name: "start", command: "npm start", description: "Start production server" },
    { name: "test", command: "npm test", description: "Run tests" },
  ];

  // Check package.json scripts for additional common targets
  try {
    const pkgPath = path.join(projectPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts || {};
      // Only keep targets that actually exist in scripts
      return targets.filter((t) => {
        const scriptName = t.command.replace("npm run ", "").replace("npm ", "");
        return scripts[scriptName] !== undefined || scriptName === "start";
      });
    }
  } catch {
    // ignore
  }
  return targets;
}

/**
 * Generate run targets for a Python project.
 */
function _pythonTargets(projectPath) {
  const targets = [
    { name: "run", command: "python main.py", description: "Run main script" },
    { name: "dev", command: "flask run", description: "Start Flask dev server" },
    { name: "test", command: "python -m pytest", description: "Run tests" },
  ];

  // Try to find a main python file
  try {
    const files = fs.readdirSync(projectPath);
    const mainPy = files.find((f) => /^main\.py$|^app\.py$|^server\.py$/.test(f));
    if (mainPy) {
      targets[0].command = `python ${mainPy}`;
    }
  } catch {
    // ignore
  }
  return targets;
}

/**
 * Generate run targets for a Docker project.
 */
function _dockerTargets() {
  return [
    { name: "build", command: "docker compose build", description: "Build Docker images" },
    { name: "up", command: "docker compose up", description: "Start containers" },
    { name: "up-d", command: "docker compose up -d", description: "Start containers (detached)" },
    { name: "down", command: "docker compose down", description: "Stop containers" },
  ];
}

/**
 * Generate run targets for a Make-based project.
 */
function _makeTargets() {
  return [
    { name: "all", command: "make", description: "Run default make target" },
    { name: "build", command: "make build", description: "Build project" },
    { name: "test", command: "make test", description: "Run tests" },
    { name: "clean", command: "make clean", description: "Clean artifacts" },
  ];
}

/**
 * Generate run targets for a .NET project.
 */
function _dotnetTargets() {
  return [
    { name: "build", command: "dotnet build", description: "Build .NET project" },
    { name: "run", command: "dotnet run", description: "Run .NET project" },
    { name: "test", command: "dotnet test", description: "Run .NET tests" },
  ];
}

/**
 * Generate run targets for a web (static) project.
 */
function _webTargets() {
  return [
    { name: "serve", command: "npx serve .", description: "Serve static files" },
    { name: "open", command: "start index.html", description: "Open in browser" },
  ];
}

/**
 * Generate run targets for a generic project.
 */
function _genericTargets() {
  return [
    { name: "build", command: "npm run build", description: "Attempt build" },
    { name: "test", command: "npm test", description: "Attempt tests" },
  ];
}

/**
 * Generate run targets for a Rust project.
 */
function _rustTargets() {
  return [
    { name: "build", command: "cargo build", description: "Build Rust project" },
    { name: "run", command: "cargo run", description: "Run Rust project" },
    { name: "test", command: "cargo test", description: "Run Rust tests" },
  ];
}

/**
 * Generate run targets for a Go project.
 */
function _goTargets() {
  return [
    { name: "build", command: "go build", description: "Build Go project" },
    { name: "run", command: "go run .", description: "Run Go project" },
    { name: "test", command: "go test ./...", description: "Run Go tests" },
  ];
}

/**
 * Generate run targets for a Ruby project.
 */
function _rubyTargets() {
  return [
    { name: "server", command: "rails server", description: "Start Rails server" },
    { name: "test", command: "bundle exec rake test", description: "Run tests" },
    { name: "console", command: "rails console", description: "Open Rails console" },
  ];
}

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Detect the project environment based on file indicators.
 *
 * @param {string} projectPath - Absolute path to the project directory.
 * @returns {{ type: string, label: string, targets: Array<{name:string,command:string,description:string}>, config: object }}
 */
function detectEnvironment(projectPath) {
  try {
    if (!projectPath || !fs.existsSync(projectPath)) {
      return { type: "unknown", label: "Unknown", targets: _genericTargets(), config: {} };
    }

    // Check each environment type
    for (const [type, indicators] of Object.entries(INDICATORS)) {
      const found = indicators.some((pattern) => _hasMatchingFile(projectPath, pattern));
      if (found) {
        let targets;
        let label;
        switch (type) {
          case "node":
            targets = _nodeTargets(projectPath);
            label = "Node.js";
            break;
          case "python":
            targets = _pythonTargets(projectPath);
            label = "Python";
            break;
          case "docker":
            targets = _dockerTargets();
            label = "Docker";
            break;
          case "make":
            targets = _makeTargets();
            label = "Make";
            break;
          case "dotnet":
            targets = _dotnetTargets();
            label = ".NET";
            break;
          case "web":
            targets = _webTargets();
            label = "Web (Static)";
            break;
          case "rust":
            targets = _rustTargets();
            label = "Rust";
            break;
          case "go":
            targets = _goTargets();
            label = "Go";
            break;
          case "ruby":
            targets = _rubyTargets();
            label = "Ruby";
            break;
          default:
            targets = _genericTargets();
            label = "Generic";
        }

        // Try to load custom config
        const config = _loadRunConfig(projectPath);

        return { type, label, targets, config };
      }
    }

    // Fallback: check if there's any recognizable structure
    return { type: "generic", label: "Generic", targets: _genericTargets(), config: {} };
  } catch (err) {
    console.warn(`[SmartLauncher] detectEnvironment error: ${err.message}`);
    return { type: "unknown", label: "Unknown", targets: [], config: {} };
  }
}

/**
 * Run pre-checks before executing a target command.
 *
 * @param {string} projectPath - Absolute path to the project directory.
 * @param {object} target - The target object { name, command, description }.
 * @returns {{ warnings: string[], errors: string[] }}
 */
function preRunCheck(projectPath, target) {
  const warnings = [];
  const errors = [];

  try {
    if (!projectPath || !target) {
      return { warnings, errors };
    }

    // 1. Check port conflicts (common dev ports)
    for (const port of COMMON_DEV_PORTS) {
      try {
        const result = execSync(
          process.platform === "win32"
            ? `netstat -ano | findstr :${port}`
            : `lsof -i :${port} || ss -tlnp | grep :${port}`,
          { encoding: "utf-8", stdio: "pipe", timeout: 3000 }
        );
        if (result && result.trim()) {
          warnings.push(`Port ${port} may be in use`);
        }
      } catch {
        // Port check command failed or port is free — not an error
      }
    }

    // 2. Check required env vars from .env.example
    try {
      const envExamplePath = path.join(projectPath, ".env.example");
      if (fs.existsSync(envExamplePath)) {
        const envExample = fs.readFileSync(envExamplePath, "utf-8");
        const requiredVars = envExample
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
          .map((l) => l.split("=")[0].trim());

        const envPath = path.join(projectPath, ".env");
        let envVars = [];
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, "utf-8");
          envVars = envContent
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"))
            .map((l) => l.split("=")[0].trim());
        }

        const missing = requiredVars.filter((v) => !envVars.includes(v));
        if (missing.length > 0) {
          warnings.push(`Missing env vars: ${missing.join(", ")}`);
        }
      }
    } catch {
      // ignore
    }

    // 3. Check dependencies installed
    try {
      if (fs.existsSync(path.join(projectPath, "package.json"))) {
        if (!fs.existsSync(path.join(projectPath, "node_modules"))) {
          errors.push("Dependencies not installed (node_modules missing). Run npm install first.");
        }
      }
      if (fs.existsSync(path.join(projectPath, "requirements.txt"))) {
        // Check for Python venv
        const venvPaths = [".venv", "venv", ".env"];
        const hasVenv = venvPaths.some((v) => fs.existsSync(path.join(projectPath, v)));
        if (!hasVenv) {
          warnings.push("No virtual environment detected. Consider creating one.");
        }
      }
    } catch {
      // ignore
    }

    // 4. Check git status (uncommitted changes warning)
    try {
      const gitDir = path.join(projectPath, ".git");
      if (fs.existsSync(gitDir)) {
        const status = execSync("git status --porcelain", {
          cwd: projectPath,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 3000,
        });
        if (status && status.trim()) {
          const changedFiles = status.trim().split("\n").length;
          warnings.push(`${changedFiles} uncommitted file(s) — consider committing before running.`);
        }
      }
    } catch {
      // ignore
    }
  } catch (err) {
    console.warn(`[SmartLauncher] preRunCheck error: ${err.message}`);
  }

  return { warnings, errors };
}

/**
 * Get run configuration from `.lv-zero/run-config.json`, falling back to defaults.
 *
 * @param {string} projectPath - Absolute path to the project directory.
 * @returns {object} The run configuration object.
 */
function getRunConfig(projectPath) {
  try {
    const config = _loadRunConfig(projectPath);
    if (config && config.targets) {
      return config;
    }
    // Create default config from detected environment
    const env = detectEnvironment(projectPath);
    return {
      projectType: env.type,
      targets: env.targets,
      customTargets: [],
    };
  } catch (err) {
    console.warn(`[SmartLauncher] getRunConfig error: ${err.message}`);
    return { projectType: "unknown", targets: [], customTargets: [] };
  }
}

/**
 * Save run configuration to `.lv-zero/run-config.json`.
 *
 * @param {string} projectPath - Absolute path to the project directory.
 * @param {object} config - The run configuration object to save.
 * @returns {boolean} Whether the save succeeded.
 */
function saveRunConfig(projectPath, config) {
  try {
    if (!projectPath || !config) return false;
    const configPath = path.join(projectPath, ".lv-zero", "run-config.json");
    return _writeJson(configPath, config);
  } catch (err) {
    console.warn(`[SmartLauncher] saveRunConfig error: ${err.message}`);
    return false;
  }
}

/**
 * Generate a full command string for a target, applying any custom config overrides.
 *
 * @param {string} projectPath - Absolute path to the project directory.
 * @param {object|string} targetOrCustom - Target object {name,command} or custom command string.
 * @returns {string} The full command string to execute.
 */
/**
 * Map a launcher target name to a timeout preset.
 * Returns the timeout in milliseconds for the given target.
 *
 * @param {string} targetName - Name of the launcher target (e.g. "dev", "build", "test")
 * @returns {number} Timeout in milliseconds
 */
function getTargetTimeout(targetName) {
  try {
    if (!timerSystem) return 0; // no timer module = no enforced timeout

    const name = (targetName || "").toLowerCase().trim();
    switch (name) {
      case "build":
      case "build:prod":
        return timerSystem.getTimeout("build");
      case "deploy":
      case "release":
        return timerSystem.getTimeout("deploy");
      case "test":
      case "test:unit":
      case "test:e2e":
      case "test:integration":
        return timerSystem.getTimeout("test");
      case "start":
      case "dev":
      case "serve":
        return timerSystem.getTimeout("default");
      case "lint":
      case "format":
      case "typecheck":
        return timerSystem.getTimeout("short");
      default:
        return timerSystem.getTimeout("default");
    }
  } catch {
    return 0;
  }
}

function generateRunCommand(projectPath, targetOrCustom) {
  try {
    if (typeof targetOrCustom === "string") {
      return targetOrCustom;
    }

    if (targetOrCustom && targetOrCustom.command) {
      // Check if config has overrides for this target
      const config = _loadRunConfig(projectPath);
      if (config && config.targets) {
        const override = config.targets.find((t) => t.name === targetOrCustom.name);
        if (override && override.command) {
          return override.command;
        }
      }
      return targetOrCustom.command;
    }

    return "";
  } catch (err) {
    console.warn(`[SmartLauncher] generateRunCommand error: ${err.message}`);
    return targetOrCustom?.command || "";
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Load run config from `.lv-zero/run-config.json`.
 */
function _loadRunConfig(projectPath) {
  try {
    const configPath = path.join(projectPath, ".lv-zero", "run-config.json");
    return _readJson(configPath);
  } catch {
    return null;
  }
}

module.exports = {
  detectEnvironment,
  preRunCheck,
  getRunConfig,
  saveRunConfig,
  generateRunCommand,
  getTargetTimeout,
};
