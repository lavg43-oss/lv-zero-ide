/**
 * lv-zero — Project Identity Module
 *
 * Manages .lv-zero/config.json for each project, providing:
 * - DEFAULT_CONFIG schema with all metadata fields
 * - resolveConfig() — reads and merges config with defaults
 * - ensureConfig() — creates config.json if missing
 * - validateConfig() — validates required fields
 * - getDefaultConfig() — returns frozen copy of defaults
 * - getConfigPath() — returns the config file path
 *
 * v1.0 — Phase 1: Project Identity System
 */

const path = require("path");
const fs = require("fs");

const DEFAULT_CONFIG = {
  type: "desktop",        // web | android | ios | backend | desktop | api
  stage: "prototype",     // prototype | mvp | production | maintenance
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
  createdAt: "",
  updatedAt: ""
};

/**
 * Returns the path to the identity config file for a project.
 * @param {string} projectPath
 * @returns {string}
 */
function getConfigPath(projectPath) {
  return path.join(projectPath, ".lv-zero", "config.json");
}

/**
 * Returns a frozen deep copy of DEFAULT_CONFIG.
 * @returns {object}
 */
function getDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Reads and resolves the identity config for a project, merging with defaults.
 * If the config file doesn't exist or is invalid, returns a merged default.
 * @param {string} projectPath
 * @returns {object}
 */
function resolveConfig(projectPath) {
  try {
    const configPath = getConfigPath(projectPath);
    if (!fs.existsSync(configPath)) {
      return getDefaultConfig();
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    // Merge with defaults so missing fields get defaults
    const defaults = getDefaultConfig();
    return deepMerge(defaults, parsed);
  } catch (err) {
    console.warn(`[ProjectIdentity] Could not resolve config for ${projectPath}: ${err.message}`);
    return getDefaultConfig();
  }
}

/**
 * Ensures a config.json exists for the project, creating one with defaults if missing.
 * Does NOT overwrite an existing config.
 * @param {string} projectPath
 * @returns {object} — the loaded or newly created config
 */
function ensureConfig(projectPath) {
  try {
    const configPath = getConfigPath(projectPath);
    if (fs.existsSync(configPath)) {
      return resolveConfig(projectPath);
    }

    // Ensure .lv-zero directory exists
    const lvZeroDir = path.join(projectPath, ".lv-zero");
    if (!fs.existsSync(lvZeroDir)) {
      fs.mkdirSync(lvZeroDir, { recursive: true });
    }

    const now = new Date().toISOString();
    const config = getDefaultConfig();
    config.createdAt = now;
    config.updatedAt = now;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    console.log(`[ProjectIdentity] Created config at ${configPath}`);
    return config;
  } catch (err) {
    console.warn(`[ProjectIdentity] Could not ensure config for ${projectPath}: ${err.message}`);
    return getDefaultConfig();
  }
}

/**
 * Validates a project identity config object.
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["Config must be an object"] };
  }

  const validTypes = ["web", "android", "ios", "backend", "desktop", "api"];
  if (config.type && !validTypes.includes(config.type)) {
    errors.push(`Invalid type "${config.type}". Must be one of: ${validTypes.join(", ")}`);
  }

  const validStages = ["prototype", "mvp", "production", "maintenance"];
  if (config.stage && !validStages.includes(config.stage)) {
    errors.push(`Invalid stage "${config.stage}". Must be one of: ${validStages.join(", ")}`);
  }

  if (config.languages && !Array.isArray(config.languages)) {
    errors.push("languages must be an array");
  }

  if (config.frameworks && !Array.isArray(config.frameworks)) {
    errors.push("frameworks must be an array");
  }

  if (config.automation) {
    if (config.automation.trello && typeof config.automation.trello.enabled !== "undefined") {
      if (config.automation.trello.enabled === true) {
        if (!config.automation.trello.apiKey) errors.push("Trello API key required when enabled");
        if (!config.automation.trello.token) errors.push("Trello token required when enabled");
      }
    }
  }

  if (config.permissions) {
    const permKeys = ["read_file", "write_file", "command"];
    for (const key of permKeys) {
      if (config.permissions[key] && !Array.isArray(config.permissions[key])) {
        errors.push(`permissions.${key} must be an array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Deep-merge two objects. Source values override target values.
 * Arrays are replaced, not concatenated.
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function deepMerge(target, source) {
  const result = JSON.parse(JSON.stringify(target));
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
        result[key] = deepMerge(result[key], source[key]);
      } else {
        result[key] = JSON.parse(JSON.stringify(source[key]));
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfigPath,
  getDefaultConfig,
  resolveConfig,
  ensureConfig,
  validateConfig,
};
