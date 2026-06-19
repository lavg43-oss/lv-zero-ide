/**
 * lv-zero — Trello Bridge (Phase 8: External Integrations)
 *
 * Trello API client for project-to-card synchronization.
 * 1 Project = 1 Trello Card.
 *
 * Uses Node.js built-in https module. No external dependencies.
 * Requires TRELLO_API_KEY and TRELLO_TOKEN environment variables.
 *
 * Project config must have automation.trello.listId in .lv-zero/config.json.
 *
 * Modeled after Antigravity's trello-sync skill.
 * All functions return { ok: bool, data/error }.
 * All wrapped in try/catch for graceful degradation.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

// ─── Constants ───────────────────────────────────────────────────────────────

const TRELLO_API_BASE = "https://api.trello.com/1";

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Get Trello API credentials from environment variables.
 * @returns {{ ok: boolean, key?: string, token?: string, error?: string }}
 */
function _getCredentials() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;

  if (!key) {
    return { ok: false, error: "TRELLO_API_KEY environment variable not set" };
  }
  if (!token) {
    return { ok: false, error: "TRELLO_TOKEN environment variable not set" };
  }

  return { ok: true, key, token };
}

/**
 * Build URL with Trello auth query parameters.
 * @param {string} endpoint - API path (e.g., "/1/cards")
 * @param {object} [params] - Additional query parameters
 * @returns {string}
 */
function _buildUrl(endpoint, params = {}) {
  const creds = _getCredentials();
  if (!creds.ok) return null;

  const url = new URL(`${TRELLO_API_BASE}${endpoint}`);
  url.searchParams.set("key", creds.key);
  url.searchParams.set("token", creds.token);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  return url.toString();
}

/**
 * Make an HTTP(S) request to the Trello API.
 * @param {string} method - HTTP method
 * @param {string} urlStr - Full URL
 * @param {object} [body] - Request body object
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
function _request(method, urlStr, body = null) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(urlStr);
      const lib = parsedUrl.protocol === "https:" ? https : http;
      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        method,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 15000,
      };

      if (bodyStr) {
        options.headers["Content-Length"] = Buffer.byteLength(bodyStr, "utf8");
      }

      const req = lib.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ ok: true, data: parsed });
            } else {
              const errMsg = parsed
                ? parsed.message || parsed.error || JSON.stringify(parsed)
                : `HTTP ${res.statusCode}`;
              resolve({ ok: false, error: errMsg });
            }
          } catch (parseErr) {
            resolve({ ok: false, error: `Failed to parse response: ${parseErr.message}` });
          }
        });
      });

      req.on("error", (err) => {
        resolve({ ok: false, error: `Request failed: ${err.message}` });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "Request timed out after 15s" });
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    } catch (err) {
      resolve({ ok: false, error: `Request setup failed: ${err.message}` });
    }
  });
}

/**
 * Read the .lv-zero/config.json for a project and extract Trello config.
 * @param {string} projectPath - Path to the project
 * @returns {{ ok: boolean, config?: { listId: string, cardId?: string }, error?: string }}
 */
function getConfig(projectPath) {
  try {
    if (!projectPath) {
      return { ok: false, error: "Project path is required" };
    }

    const configPath = path.join(projectPath, ".lv-zero", "config.json");
    if (!fs.existsSync(configPath)) {
      return { ok: false, error: `Config file not found: ${configPath}` };
    }

    const raw = fs.readFileSync(configPath, "utf8");
    let config;
    try {
      config = JSON.parse(raw);
    } catch (parseErr) {
      return { ok: false, error: `Failed to parse config.json: ${parseErr.message}` };
    }

    const trelloConfig = config.automation && config.automation.trello;
    if (!trelloConfig) {
      return { ok: false, error: "No automation.trello configuration found in config.json" };
    }

    if (!trelloConfig.listId) {
      return { ok: false, error: "automation.trello.listId is not set in config.json" };
    }

    return {
      ok: true,
      config: {
        listId: trelloConfig.listId,
        cardId: trelloConfig.cardId || null,
      },
    };
  } catch (err) {
    return { ok: false, error: `Failed to read Trello config: ${err.message}` };
  }
}

/**
 * Create a new Trello card in the configured list.
 * After creation, saves the card ID back to config.json.
 * @param {string} projectPath - Path to the project
 * @param {string} name - Card title
 * @param {string} [desc] - Card description
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function createCard(projectPath, name, desc) {
  try {
    if (!projectPath) {
      return { ok: false, error: "Project path is required" };
    }
    if (!name) {
      return { ok: false, error: "Card name is required" };
    }

    const configResult = getConfig(projectPath);
    if (!configResult.ok) {
      return configResult;
    }

    const { listId } = configResult.config;

    // Check if card already exists
    if (configResult.config.cardId) {
      return { ok: false, error: `Card already exists (ID: ${configResult.config.cardId}). Use updateCardDescription or addComment instead.` };
    }

    const urlStr = _buildUrl("/cards", {
      idList: listId,
      name,
      desc: desc || "",
    });

    if (!urlStr) {
      const creds = _getCredentials();
      return creds;
    }

    const result = await _request("POST", urlStr);

    if (result.ok && result.data && result.data.id) {
      // Save the card ID back to config
      try {
        const configPath = path.join(projectPath, ".lv-zero", "config.json");
        const raw = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(raw);
        if (!config.automation) config.automation = {};
        if (!config.automation.trello) config.automation.trello = {};
        config.automation.trello.cardId = result.data.id;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      } catch (saveErr) {
        console.warn(`[TrelloBridge] Could not save cardId to config: ${saveErr.message}`);
      }
    }

    return result;
  } catch (err) {
    return { ok: false, error: `Failed to create card: ${err.message}` };
  }
}

/**
 * Update the description of the linked Trello card.
 * @param {string} projectPath - Path to the project
 * @param {string} desc - New description content
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function updateCardDescription(projectPath, desc) {
  try {
    if (!projectPath) {
      return { ok: false, error: "Project path is required" };
    }

    const configResult = getConfig(projectPath);
    if (!configResult.ok) {
      return configResult;
    }

    const { cardId } = configResult.config;
    if (!cardId) {
      return { ok: false, error: "No card linked to this project. Use createCard first." };
    }

    const urlStr = _buildUrl(`/cards/${cardId}`, {
      desc: desc || "",
    });

    if (!urlStr) {
      const creds = _getCredentials();
      return creds;
    }

    return await _request("PUT", urlStr, { desc: desc || "" });
  } catch (err) {
    return { ok: false, error: `Failed to update card description: ${err.message}` };
  }
}

/**
 * Add a comment to the linked Trello card.
 * @param {string} projectPath - Path to the project
 * @param {string} comment - Comment text
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function addComment(projectPath, comment) {
  try {
    if (!projectPath) {
      return { ok: false, error: "Project path is required" };
    }
    if (!comment) {
      return { ok: false, error: "Comment text is required" };
    }

    const configResult = getConfig(projectPath);
    if (!configResult.ok) {
      return configResult;
    }

    const { cardId } = configResult.config;
    if (!cardId) {
      return { ok: false, error: "No card linked to this project. Use createCard first." };
    }

    const urlStr = _buildUrl(`/cards/${cardId}/actions/comments`, {
      text: comment,
    });

    if (!urlStr) {
      const creds = _getCredentials();
      return creds;
    }

    return await _request("POST", urlStr, { text: comment });
  } catch (err) {
    return { ok: false, error: `Failed to add comment: ${err.message}` };
  }
}

/**
 * Add a checklist item to the linked Trello card.
 * @param {string} projectPath - Path to the project
 * @param {string} item - Checklist item text
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function addChecklistItem(projectPath, item) {
  try {
    if (!projectPath) {
      return { ok: false, error: "Project path is required" };
    }
    if (!item) {
      return { ok: false, error: "Checklist item text is required" };
    }

    const configResult = getConfig(projectPath);
    if (!configResult.ok) {
      return configResult;
    }

    const { cardId } = configResult.config;
    if (!cardId) {
      return { ok: false, error: "No card linked to this project. Use createCard first." };
    }

    // Check if the card already has a checklist, or create one
    const checklistsUrl = _buildUrl(`/cards/${cardId}/checklists`);
    if (!checklistsUrl) {
      const creds = _getCredentials();
      return creds;
    }

    const checklistsResult = await _request("GET", checklistsUrl);
    if (!checklistsResult.ok) {
      return checklistsResult;
    }

    let checklistId;
    if (checklistsResult.data && checklistsResult.data.length > 0) {
      checklistId = checklistsResult.data[0].id;
    } else {
      // Create a new checklist
      const createChecklistUrl = _buildUrl(`/cards/${cardId}/checklists`, { name: "Checklist" });
      if (!createChecklistUrl) {
        return _getCredentials();
      }
      const newChecklist = await _request("POST", createChecklistUrl, { name: "Checklist" });
      if (!newChecklist.ok) {
        return newChecklist;
      }
      checklistId = newChecklist.data.id;
    }

    // Add item to checklist
    const addItemUrl = _buildUrl(`/checklists/${checklistId}/checkItems`, { name: item });
    if (!addItemUrl) {
      return _getCredentials();
    }

    return await _request("POST", addItemUrl, { name: item });
  } catch (err) {
    return { ok: false, error: `Failed to add checklist item: ${err.message}` };
  }
}

module.exports = {
  getConfig,
  createCard,
  updateCardDescription,
  addComment,
  addChecklistItem,
};
