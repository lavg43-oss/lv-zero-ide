/**
 * ─── Workspace Manager for lv-zero ─────────────────────────────────────────
 *
 * Multi-folder project workspace support inspired by Antigravity IDE 2.0
 * and Google Gemini's projectResources system.
 *
 * Allows a single "project" to span multiple directories, each with its own
 * .env, PLAN.md, and file access policies.
 *
 * Config file: .lv-zero-workspace.json in the project root directory.
 *
 * Format:
 *   {
 *     "name": "My Project",
 *     "folders": [
 *       { "path": "/absolute/path/to/folder1", "label": "Frontend" },
 *       { "path": "/absolute/path/to/folder2", "label": "Backend" },
 *       { "path": "/absolute/path/to/folder3", "label": "Shared" }
 *     ],
 *     "settings": {
 *       "fileAccessPolicy": "AGENT_SETTING_POLICY_ASK",
 *       "internetPolicy": "AGENT_SETTING_POLICY_ASK",
 *       "autoExecutionPolicy": "CASCADE_COMMANDS_AUTO_EXECUTION_OFF"
 *     },
 *     "permissionGrants": {
 *       "allow": ["command(npx)", "command(npm install)"]
 *     }
 *   }
 *
 * v1.0 — June 2026
 *
 * @module workspace_manager
 */

import fs from "fs";
import path from "path";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Name of the workspace config file */
const WORKSPACE_CONFIG_FILE = ".lv-zero-workspace.json";

/** Default settings applied when creating a new workspace */
const DEFAULT_SETTINGS = {
  fileAccessPolicy: "AGENT_SETTING_POLICY_ASK",
  internetPolicy: "AGENT_SETTING_POLICY_ASK",
  autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_OFF",
  artifactReviewMode: "ARTIFACT_REVIEW_MODE_ALWAYS",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Config
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} WorkspaceFolder
 * @property {string} path - Absolute path to the folder
 * @property {string} [label] - Human-readable label for the folder
 * @property {boolean} [isPrimary] - Whether this is the primary folder (default: first folder)
 * @property {object} [env] - Environment variables specific to this folder
 */

/**
 * @typedef {object} WorkspaceConfig
 * @property {string} name - Workspace name
 * @property {string} [id] - Unique workspace ID (auto-generated if not provided)
 * @property {WorkspaceFolder[]} folders - Array of folders in the workspace
 * @property {object} [settings] - Workspace-wide settings
 * @property {object} [permissionGrants] - Permission grants for the workspace
 * @property {object} [permissionGrants.allow] - Array of allowed permissions
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Manager
// ═══════════════════════════════════════════════════════════════════════════════

export class WorkspaceManager {
  /**
   * @param {object} [options]
   * @param {object} [options.logger] - Logger instance (console-like)
   */
  constructor(options = {}) {
    /** @type {WorkspaceConfig|null} */
    this._config = null;

    /** @type {string|null} Root directory of the workspace (where .lv-zero-workspace.json lives) */
    this._rootPath = null;

    /** @type {object} */
    this._logger = options.logger || console;
  }

  // ─── Properties ──────────────────────────────────────────────────────────

  /** @returns {WorkspaceConfig|null} */
  get config() {
    return this._config;
  }

  /** @returns {string|null} */
  get rootPath() {
    return this._rootPath;
  }

  /** @returns {string|null} */
  get name() {
    return this._config?.name || null;
  }

  /** @returns {WorkspaceFolder[]} */
  get folders() {
    return this._config?.folders || [];
  }

  /** @returns {WorkspaceFolder|null} */
  get primaryFolder() {
    if (!this._config?.folders?.length) return null;
    return this._config.folders.find((f) => f.isPrimary) || this._config.folders[0];
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._config !== null;
  }

  /** @returns {string[]} All folder paths in the workspace */
  get folderPaths() {
    return this.folders.map((f) => f.path);
  }

  // ─── Discovery ───────────────────────────────────────────────────────────

  /**
   * Discovers the workspace config file by walking up from a given directory.
   * Looks for .lv-zero-workspace.json in the directory and its parents.
   *
   * @param {string} startDir - Directory to start searching from
   * @returns {string|null} Path to the workspace config file, or null
   */
  discoverConfig(startDir) {
    let current = path.resolve(startDir);

    // Walk up max 5 levels to avoid infinite loops
    for (let i = 0; i < 5; i++) {
      const configPath = path.join(current, WORKSPACE_CONFIG_FILE);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
      const parent = path.dirname(current);
      if (parent === current) break; // Reached root
      current = parent;
    }

    return null;
  }

  /**
   * Discovers workspace config from a project path.
   * First checks if the path itself contains .lv-zero-workspace.json,
   * then walks up.
   *
   * @param {string} projectPath - Project directory to check
   * @returns {string|null}
   */
  discoverFromProject(projectPath) {
    if (!projectPath) return null;

    // Direct check
    const directPath = path.resolve(projectPath, WORKSPACE_CONFIG_FILE);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    // Walk up
    return this.discoverConfig(projectPath);
  }

  // ─── Loading ─────────────────────────────────────────────────────────────

  /**
   * Loads a workspace from a config file path.
   *
   * @param {string} configPath - Path to .lv-zero-workspace.json
   * @returns {{ success: boolean, config?: WorkspaceConfig, error?: string }}
   */
  load(configPath) {
    try {
      const resolvedPath = path.resolve(configPath);

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `Workspace config not found: ${resolvedPath}` };
      }

      const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));

      // Validate structure
      if (!raw.name) {
        return { success: false, error: "Workspace config must have a 'name' field" };
      }
      if (!raw.folders || !Array.isArray(raw.folders) || raw.folders.length === 0) {
        return { success: false, error: "Workspace config must have at least one folder in 'folders' array" };
      }

      // Normalize folder paths (resolve relative paths against config file location)
      const configDir = path.dirname(resolvedPath);
      const normalizedFolders = raw.folders.map((folder, index) => {
        const normalized = {
          ...folder,
          path: path.resolve(configDir, folder.path),
          isPrimary: folder.isPrimary || index === 0,
        };
        return normalized;
      });

      // Generate ID if not provided
      const config = {
        id: raw.id || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: raw.name,
        folders: normalizedFolders,
        settings: { ...DEFAULT_SETTINGS, ...raw.settings },
        permissionGrants: raw.permissionGrants || { allow: [] },
      };

      this._config = config;
      this._rootPath = configDir;

      this._logger.info(`   📂 Workspace cargado: ${config.name} (${config.folders.length} carpetas)`);
      for (const folder of config.folders) {
        const label = folder.label ? ` [${folder.label}]` : "";
        const exists = fs.existsSync(folder.path) ? "✅" : "⚠️";
        this._logger.info(`     ${exists} ${folder.path}${label}`);
      }

      return { success: true, config };
    } catch (err) {
      return { success: false, error: `Error loading workspace: ${err.message}` };
    }
  }

  /**
   * Loads a workspace by discovering the config from a project path.
   *
   * @param {string} projectPath - Project directory to discover from
   * @returns {{ success: boolean, config?: WorkspaceConfig, error?: string }}
   */
  loadFromProject(projectPath) {
    const configPath = this.discoverFromProject(projectPath);
    if (!configPath) {
      return { success: false, error: `No workspace config found for: ${projectPath}` };
    }
    return this.load(configPath);
  }

  // ─── Creation ────────────────────────────────────────────────────────────

  /**
   * Creates a new workspace config file.
   *
   * @param {object} options
   * @param {string} options.name - Workspace name
   * @param {string} options.rootPath - Directory where .lv-zero-workspace.json will be created
   * @param {WorkspaceFolder[]} options.folders - Array of folders
   * @param {object} [options.settings] - Workspace settings
   * @param {object} [options.permissionGrants] - Permission grants
   * @returns {{ success: boolean, config?: WorkspaceConfig, error?: string }}
   */
  create(options) {
    const { name, rootPath, folders, settings, permissionGrants } = options;

    if (!name) return { success: false, error: "Workspace name is required" };
    if (!rootPath) return { success: false, error: "Root path is required" };
    if (!folders || !Array.isArray(folders) || folders.length === 0) {
      return { success: false, error: "At least one folder is required" };
    }

    const resolvedRoot = path.resolve(rootPath);

    // Ensure root directory exists
    if (!fs.existsSync(resolvedRoot)) {
      try {
        fs.mkdirSync(resolvedRoot, { recursive: true });
      } catch (err) {
        return { success: false, error: `Cannot create root directory: ${err.message}` };
      }
    }

    // Normalize folder paths
    const normalizedFolders = folders.map((folder, index) => ({
      ...folder,
      path: path.resolve(folder.path),
      isPrimary: folder.isPrimary || index === 0,
    }));

    const config = {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      folders: normalizedFolders,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      permissionGrants: permissionGrants || { allow: [] },
    };

    const configPath = path.join(resolvedRoot, WORKSPACE_CONFIG_FILE);

    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      this._config = config;
      this._rootPath = resolvedRoot;
      this._logger.info(`   📝 Workspace creado: ${configPath}`);
      return { success: true, config };
    } catch (err) {
      return { success: false, error: `Error creating workspace: ${err.message}` };
    }
  }

  // ─── Folder Management ───────────────────────────────────────────────────

  /**
   * Adds a folder to the workspace and persists the config.
   *
   * @param {string} folderPath - Absolute path to the folder
   * @param {string} [label] - Optional label
   * @returns {{ success: boolean, error?: string }}
   */
  addFolder(folderPath, label) {
    if (!this._config) {
      return { success: false, error: "No workspace loaded" };
    }

    const resolvedPath = path.resolve(folderPath);

    // Check for duplicates
    if (this._config.folders.some((f) => f.path === resolvedPath)) {
      return { success: false, error: `Folder already in workspace: ${resolvedPath}` };
    }

    this._config.folders.push({
      path: resolvedPath,
      label: label || null,
      isPrimary: this._config.folders.length === 0,
    });

    return this._persist();
  }

  /**
   * Removes a folder from the workspace.
   *
   * @param {string} folderPath - Path to remove
   * @returns {{ success: boolean, error?: string }}
   */
  removeFolder(folderPath) {
    if (!this._config) {
      return { success: false, error: "No workspace loaded" };
    }

    const resolvedPath = path.resolve(folderPath);
    const idx = this._config.folders.findIndex((f) => f.path === resolvedPath);

    if (idx === -1) {
      return { success: false, error: `Folder not found in workspace: ${resolvedPath}` };
    }

    this._config.folders.splice(idx, 1);

    // If we removed the primary, set the first remaining as primary
    if (this._config.folders.length > 0 && !this._config.folders.some((f) => f.isPrimary)) {
      this._config.folders[0].isPrimary = true;
    }

    return this._persist();
  }

  /**
   * Lists all folders in the workspace with their status.
   *
   * @returns {Array<{ path: string, label: string|null, isPrimary: boolean, exists: boolean }>}
   */
  listFolders() {
    if (!this._config) return [];
    return this._config.folders.map((f) => ({
      path: f.path,
      label: f.label || null,
      isPrimary: !!f.isPrimary,
      exists: fs.existsSync(f.path),
    }));
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  /**
   * Persists the current config to disk.
   * @returns {{ success: boolean, error?: string }}
   */
  _persist() {
    if (!this._rootPath || !this._config) {
      return { success: false, error: "No workspace loaded" };
    }

    const configPath = path.join(this._rootPath, WORKSPACE_CONFIG_FILE);

    try {
      fs.writeFileSync(configPath, JSON.stringify(this._config, null, 2), "utf-8");
      return { success: true };
    } catch (err) {
      return { success: false, error: `Error persisting workspace: ${err.message}` };
    }
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  /**
   * Checks if a given path is within any of the workspace folders.
   *
   * @param {string} filePath - Path to check
   * @returns {boolean}
   */
  isPathInWorkspace(filePath) {
    if (!this._config) return false;
    const resolved = path.resolve(filePath);
    return this._config.folders.some((f) => {
      const folderPath = f.path.endsWith(path.sep) ? f.path : f.path + path.sep;
      return resolved.startsWith(folderPath) || resolved === f.path;
    });
  }

  /**
   * Finds which workspace folder a path belongs to.
   *
   * @param {string} filePath - Path to check
   * @returns {WorkspaceFolder|null}
   */
  findFolderForPath(filePath) {
    if (!this._config) return null;
    const resolved = path.resolve(filePath);
    // Sort by path length (deepest first) to match most specific folder
    const sorted = [...this._config.folders].sort((a, b) => b.path.length - a.path.length);
    for (const folder of sorted) {
      const folderPath = folder.path.endsWith(path.sep) ? folder.path : folder.path + path.sep;
      if (resolved.startsWith(folderPath) || resolved === folder.path) {
        return folder;
      }
    }
    return null;
  }

  /**
   * Generates a summary of the workspace structure for system prompt injection.
   *
   * @returns {string}
   */
  generateContextSummary() {
    if (!this._config) return "";

    const lines = [
      `📁 WORKSPACE: ${this._config.name}`,
      `📂 Carpetas (${this._config.folders.length}):`,
    ];

    for (const folder of this.folders) {
      const label = folder.label ? ` [${folder.label}]` : "";
      const primary = folder.isPrimary ? " ★ (principal)" : "";
      const exists = fs.existsSync(folder.path) ? "✅" : "⚠️";
      lines.push(`   ${exists} ${folder.path}${label}${primary}`);
    }

    return lines.join("\n");
  }

  /**
   * Closes the workspace and clears state.
   */
  close() {
    this._config = null;
    this._rootPath = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton instance
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {WorkspaceManager|null} */
let _defaultInstance = null;

/**
 * Gets or creates the default WorkspaceManager instance.
 * @param {object} [options]
 * @returns {WorkspaceManager}
 */
export function getWorkspaceManager(options = {}) {
  if (!_defaultInstance) {
    _defaultInstance = new WorkspaceManager(options);
  }
  return _defaultInstance;
}

/**
 * Resets the default instance (useful for testing).
 */
export function resetWorkspaceManager() {
  _defaultInstance = null;
}
