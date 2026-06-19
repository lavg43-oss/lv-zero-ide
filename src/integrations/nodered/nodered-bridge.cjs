/**
 * lv-zero — Node-RED Bridge (Phase 8: External Integrations)
 *
 * Reads and parses Node-RED flow files.
 * Uses only Node.js built-in modules (fs, path).
 *
 * Modeled after Antigravity's Node-RED MCP tools.
 * All functions return { ok: bool, data/error }.
 * All wrapped in try/catch for graceful degradation.
 */

const fs = require("fs");
const path = require("path");

// ─── Default paths ───────────────────────────────────────────────────────────

/**
 * Get the default Node-RED flows file path.
 * On Windows: %USERPROFILE%/.node-red/flows.json
 * On Linux/Mac: ~/.node-red/flows.json
 * @returns {string}
 */
function _getDefaultFlowsPath() {
  const home = process.env.USERPROFILE || process.env.HOME || "~";
  return path.join(home, ".node-red", "flows.json");
}

/**
 * Resolve the flows file path. If not provided, uses the default location.
 * @param {string} [flowsFilePath] - Optional custom path
 * @returns {string}
 */
function _resolveFlowsPath(flowsFilePath) {
  return flowsFilePath || _getDefaultFlowsPath();
}

/**
 * Read a Node-RED flows JSON file and return all flows.
 * @param {string} [flowsFilePath] - Path to flows.json (uses default if omitted)
 * @returns {{ ok: boolean, data?: object[], error?: string }}
 */
function getFlows(flowsFilePath) {
  try {
    const resolvedPath = _resolveFlowsPath(flowsFilePath);

    if (!fs.existsSync(resolvedPath)) {
      return { ok: false, error: `Node-RED flows file not found: ${resolvedPath}` };
    }

    const raw = fs.readFileSync(resolvedPath, "utf8");
    let flows;

    try {
      flows = JSON.parse(raw);
    } catch (parseErr) {
      return { ok: false, error: `Failed to parse flows file: ${parseErr.message}` };
    }

    // Node-RED flows can be a flat array or have a top-level structure
    if (!Array.isArray(flows)) {
      // Some Node-RED versions wrap flows in { flows: [...], credentials: {...} }
      if (flows.flows && Array.isArray(flows.flows)) {
        flows = flows.flows;
      } else {
        return { ok: false, error: "Unexpected flows format: expected an array or { flows: [...] }" };
      }
    }

    return { ok: true, data: flows };
  } catch (err) {
    return { ok: false, error: `Failed to read Node-RED flows: ${err.message}` };
  }
}

/**
 * Find a single flow by its ID.
 * @param {string} flowId - The flow/node ID to find
 * @param {string} [flowsFilePath] - Path to flows.json (uses default if omitted)
 * @returns {{ ok: boolean, data?: object, error?: string }}
 */
function getFlow(flowId, flowsFilePath) {
  try {
    if (!flowId) {
      return { ok: false, error: "Flow ID is required" };
    }

    const result = getFlows(flowsFilePath);
    if (!result.ok) {
      return result;
    }

    const flows = result.data;
    const flow = flows.find((f) => f.id === flowId);

    if (!flow) {
      return { ok: false, error: `Flow with ID "${flowId}" not found` };
    }

    return { ok: true, data: flow };
  } catch (err) {
    return { ok: false, error: `Failed to get flow: ${err.message}` };
  }
}

/**
 * List all flows with a summary (id, label, type, node count).
 * @param {string} [flowsFilePath] - Path to flows.json (uses default if omitted)
 * @returns {{ ok: boolean, data?: Array<{id: string, label: string, type: string, nodes: number}>, error?: string }}
 */
function listFlows(flowsFilePath) {
  try {
    const result = getFlows(flowsFilePath);
    if (!result.ok) {
      return result;
    }

    const flows = result.data;
    const summary = flows.map((f) => {
      // Count child nodes (nodes that have this flow as their 'z' parent)
      const nodeTypes = ["tab", "subflow", "group"];
      const type = f.type || "unknown";

      return {
        id: f.id,
        label: f.label || f.name || f.id,
        type: type,
        nodes: type === "tab" ? flows.filter((n) => n.z === f.id).length : 0,
      };
    });

    return { ok: true, data: summary };
  } catch (err) {
    return { ok: false, error: `Failed to list flows: ${err.message}` };
  }
}

module.exports = {
  getFlows,
  getFlow,
  listFlows,
};
