/**
 * lv-zero — Granular Permission System (Phase 2)
 *
 * Modeled after Antigravity's globalPermissionGrants.
 * Provides glob-based permission checking for file operations,
 * commands, URL access, and MCP tools.
 *
 * Permission resolution order:
 *   1. Project-level config.json permissions (if present)
 *   2. Fallback to GLOBAL_PERMISSIONS (if project has no permissions field)
 *   3. If no config exists at all, GLOBAL_PERMISSIONS only
 *
 * v1.0 — Phase 2: Granular Permission System
 */

const path = require("path");
const fs = require("fs");

// ─── Global Permissions (Antigravity-compatible) ────────────────────────────
const GLOBAL_PERMISSIONS = Object.freeze({
  read_file: [
    "**/*.md", "**/*.json", "**/*.js", "**/*.mjs", "**/*.cjs",
    "**/*.ts", "**/*.css", "**/*.html", "**/*.py", "**/*.ps1",
    "**/*.yaml", "**/*.yml", "**/*.txt", "**/*.csv",
    "**/.*", "**/.*/**", "**/*.env*", "**/.gitignore",
    "**/*.xml", "**/*.sql"
  ],
  write_file: [
    "**/*.md", "**/*.json", "**/*.js", "**/*.mjs", "**/*.cjs",
    "**/*.ts", "**/*.css", "**/*.html", "**/*.py", "**/*.ps1",
    "**/*.yaml", "**/*.yml", "**/*.txt", "**/*.csv",
    "**/.*", "**/.*/**", "**/*.env*", "**/.gitignore",
    "**/*.xml", "**/*.sql"
  ],
  command: [
    "node", "npm", "npx", "python", "pip", "git",
    "dir", "ls", "type", "cat", "echo", "mkdir",
    "powershell", "code", "start", "curl",
    "systeminfo", "tasklist"
  ],
  read_url: [
    "https://**"
  ],
  mcp: []
});

// ─── Glob Matching ───────────────────────────────────────────────────────────

/**
 * Converts a glob pattern to a RegExp.
 * Supports ** (globstar), * (single-segment wildcard), ? (single char).
 *
 * @param {string} pattern - Glob pattern (e.g., "**\/*.md", "src\/**")
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  let escaped = pattern
    // Escape regex special chars except glob wildcards
    .replace(/[.+^${}()|[\]\\]/g, "\\\\$&");

  // Replace ** (globstar) — matches everything across dirs
  // Must handle ** alone, **/, /** etc.
  escaped = escaped
    // Must be done before * to avoid double-matching
    .replace(/\*\*/g, "___GLOBSTAR___");

  // Replace * (single segment wildcard) — matches anything except /
  escaped = escaped.replace(/\*/g, "[^/]*");

  // Replace ? (single char wildcard) — matches any single char except /
  escaped = escaped.replace(/\?/g, "[^/]");

  // Restore ** and convert to proper regex for cross-directory matching
  escaped = escaped.replace(/___GLOBSTAR___/g, ".*");

  return new RegExp(`^${escaped}$`);
}

/**
 * Checks if a file path matches a glob pattern.
 *
 * @param {string} filePath - The actual file path to check (e.g., "src/main.cjs")
 * @param {string} globPattern - The glob pattern to match against (e.g., "src/**")
 * @returns {boolean} true if the path matches the pattern
 */
function matchGlob(filePath, globPattern) {
  try {
    // Normalize path separators to forward slash for cross-platform matching
    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedPattern = globPattern.replace(/\\/g, "/");
    const regex = globToRegex(normalizedPattern);
    return regex.test(normalizedPath);
  } catch (err) {
    console.warn(`[Permissions] Glob match error for "${filePath}" against "${globPattern}": ${err.message}`);
    return false;
  }
}

/**
 * Checks if a target (file path, command name, URL, MCP tool) matches
 * any of the allowed patterns in a permission array.
 *
 * @param {string} target - The target to check
 * @param {string[]} allowedPatterns - Array of glob patterns
 * @returns {boolean} true if target matches any pattern
 */
function isAllowed(target, allowedPatterns) {
  if (!Array.isArray(allowedPatterns) || allowedPatterns.length === 0) {
    return false;
  }
  return allowedPatterns.some(pattern => matchGlob(target, pattern));
}

// ─── Permission Resolution ──────────────────────────────────────────────────

/**
 * Gets the effective permissions for a project.
 * Merges global permissions with project-level overrides.
 * Project-level permissions REPLACE the global ones for the same type
 * (i.e., if project has "read_file", that's used instead of global).
 * If project has NO permissions field, returns GLOBAL only.
 *
 * @param {string} projectPath - Path to the project directory
 * @returns {object} { read_file: string[], write_file: string[], command: string[], read_url: string[], mcp: string[] }
 */
function getEffectivePermissions(projectPath) {
  try {
    const configPath = path.join(projectPath, ".lv-zero", "config.json");
    if (!fs.existsSync(configPath)) {
      // No project config — use GLOBAL only
      return { ...GLOBAL_PERMISSIONS };
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);

    if (!config.permissions || typeof config.permissions !== "object") {
      // Project exists but has no permissions field — use GLOBAL only
      return { ...GLOBAL_PERMISSIONS };
    }

    // Merge: for each permission type, use project value if present, else global
    const merged = {};
    const types = ["read_file", "write_file", "command", "read_url", "mcp"];
    for (const type of types) {
      if (Array.isArray(config.permissions[type]) && config.permissions[type].length > 0) {
        merged[type] = [...config.permissions[type]];
      } else {
        merged[type] = GLOBAL_PERMISSIONS[type] ? [...GLOBAL_PERMISSIONS[type]] : [];
      }
    }

    return merged;
  } catch (err) {
    console.warn(`[Permissions] Could not resolve permissions for ${projectPath}: ${err.message}`);
    return { ...GLOBAL_PERMISSIONS };
  }
}

/**
 * Gets project-level permissions from config.json (without global fallback).
 * Returns null if no project config or no permissions field.
 *
 * @param {string} projectPath
 * @returns {object|null}
 */
function getProjectPermissions(projectPath) {
  try {
    const configPath = path.join(projectPath, ".lv-zero", "config.json");
    if (!fs.existsSync(configPath)) return null;

    const raw = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(raw);
    return config.permissions || null;
  } catch {
    return null;
  }
}

// ─── Permission Checking ────────────────────────────────────────────────────

/**
 * Checks if a specific action is permitted for a target.
 *
 * @param {string} projectPath - Path to the project directory
 * @param {string} permissionType - "read_file" | "write_file" | "command" | "read_url" | "mcp"
 * @param {string} target - The file path, command name, URL, or MCP tool name
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkPermission(projectPath, permissionType, target) {
  try {
    const validTypes = ["read_file", "write_file", "command", "read_url", "mcp"];
    if (!validTypes.includes(permissionType)) {
      return { allowed: false, reason: `Unknown permission type: ${permissionType}` };
    }

    if (!target || typeof target !== "string") {
      return { allowed: false, reason: `Invalid target for ${permissionType}` };
    }

    // Get effective permissions (global + project override)
    const effective = getEffectivePermissions(projectPath);
    const patterns = effective[permissionType];

    if (!Array.isArray(patterns) || patterns.length === 0) {
      return { allowed: false, reason: `No ${permissionType} patterns configured` };
    }

    const matched = isAllowed(target, patterns);

    if (matched) {
      return { allowed: true, reason: `${permissionType} permitted for "${target}"` };
    }

    // Check if project has custom permissions that are more restrictive
    const projectPerms = getProjectPermissions(projectPath);
    if (projectPerms && Array.isArray(projectPerms[permissionType])) {
      return {
        allowed: false,
        reason: `Project permissions deny ${permissionType} for "${target}". Allowed patterns: ${projectPerms[permissionType].join(", ")}`
      };
    }

    return {
      allowed: false,
      reason: `Global permissions deny ${permissionType} for "${target}". Allowed patterns: ${patterns.join(", ")}`
    };
  } catch (err) {
    console.warn(`[Permissions] Check failed for ${permissionType} "${target}": ${err.message}`);
    // Non-blocking: if check fails, allow (better than crashing the app)
    return { allowed: true, reason: `Permission check bypassed due to error: ${err.message}` };
  }
}

/**
 * Extracts the command name from a full command string.
 * e.g., "npm install" → "npm", "git status" → "git"
 *
 * @param {string} command - Full command string
 * @returns {string} Command name (first token)
 */
function extractCommandName(command) {
  if (!command || typeof command !== "string") return "";
  return command.trim().split(/\s+/)[0] || "";
}

module.exports = {
  GLOBAL_PERMISSIONS,
  matchGlob,
  globToRegex,
  checkPermission,
  getEffectivePermissions,
  getProjectPermissions,
  extractCommandName,
  isAllowed
};
