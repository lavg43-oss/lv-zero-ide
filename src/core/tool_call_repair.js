/**
 * tool_call_repair.js — Reasonix-inspired Tool-Call Repair Pipeline
 *
 * v1.0
 *   Implements the four-pass repair system from esengine/reasonix:
 *
 *   1. **flatten** — Schemas with >10 leaf params or depth >2 are auto-detected
 *      and presented in dot-notation form. dispatch() re-nests args before calling fn.
 *
 *   2. **scavenge** — Regex + JSON parser sweeps reasoning_content for tool calls
 *      the model forgot to emit in tool_calls.
 *
 *   3. **truncation** — Detect unbalanced JSON and repair by closing braces
 *      or requesting a continuation completion.
 *
 *   4. **storm** — Identical (tool, args) tuple within a sliding window →
 *      suppress the call, inject a reflection turn.
 *
 * Empirical DeepSeek failure modes addressed:
 *   - Tool-call JSON emitted inside <think>, missing from final message
 *   - Arguments dropped when schema has >10 params or deeply nested objects
 *   - Same tool called repeatedly with identical args (call-storm)
 *   - Truncated JSON due to max_tokens hit mid-structure
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEMA_FLATTEN_THRESHOLD = 10; // leaf params
const SCHEMA_FLATTEN_DEPTH = 2; // max nesting depth before flattening
const STORM_WINDOW_SIZE = 5; // sliding window for dedup
const MAX_REPAIR_DEPTH = 10; // max recursion for JSON repair

// ─── Pass 1: Schema Flattening ───────────────────────────────────────────────

/**
 * Analyze a tool schema for complexity.
 * Returns { needsFlattening, leafCount, maxDepth }.
 *
 * @param {object} schema - JSON Schema for tool parameters
 * @returns {{ needsFlattening: boolean, leafCount: number, maxDepth: number }}
 */
export function analyzeSchema(schema) {
  if (!schema || !schema.properties) {
    return { needsFlattening: false, leafCount: 0, maxDepth: 0 };
  }

  let leafCount = 0;
  let maxDepth = 0;

  function walk(obj, depth) {
    if (!obj || typeof obj !== "object") return;
    if (depth > maxDepth) maxDepth = depth;

    if (obj.properties) {
      for (const key of Object.keys(obj.properties)) {
        const prop = obj.properties[key];
        if (prop.type === "object" || prop.properties) {
          walk(prop, depth + 1);
        } else if (
          prop.type === "string" ||
          prop.type === "number" ||
          prop.type === "integer" ||
          prop.type === "boolean"
        ) {
          leafCount++;
        } else if (prop.oneOf || prop.anyOf) {
          // Complex type, count as leaf
          leafCount++;
        } else if (prop.type === "array") {
          if (prop.items && (prop.items.type === "object" || prop.items.properties)) {
            walk(prop.items, depth + 1);
          } else {
            leafCount++;
          }
        } else {
          leafCount++;
        }
      }
    }
  }

  walk(schema, 0);

  const needsFlattening = leafCount > SCHEMA_FLATTEN_THRESHOLD || maxDepth > SCHEMA_FLATTEN_DEPTH;
  return { needsFlattening, leafCount, maxDepth };
}

/**
 * Flatten a schema's parameters to dot-notation.
 * E.g., { "db": { "host": "..." } } → { "db.host": "..." }
 *
 * @param {object} schema - Original JSON Schema
 * @returns {object} Flattened schema with dot-notation properties
 */
export function flattenSchema(schema) {
  if (!schema || !schema.properties) return schema;

  const flatProps = {};

  function flatten(obj, prefix = "") {
    if (!obj || typeof obj !== "object") return;
    if (obj.properties) {
      for (const key of Object.keys(obj.properties)) {
        const prop = obj.properties[key];
        const flatKey = prefix ? `${prefix}.${key}` : key;

        if (prop.type === "object" || prop.properties) {
          flatten(prop, flatKey);
        } else if (prop.type === "array" && prop.items && (prop.items.type === "object" || prop.items.properties)) {
          flatten(prop.items, `${flatKey}[]`);
        } else {
          flatProps[flatKey] = { ...prop };
          // Add the original path as metadata for re-nesting
          flatProps[flatKey]._originalPath = flatKey;
        }
      }
    }
  }

  flatten(schema);

  return {
    type: "object",
    properties: flatProps,
    _flattened: true,
    _originalSchema: schema,
  };
}

/**
 * Re-nest dot-notation args back into nested objects before calling the function.
 * E.g., { "db.host": "localhost" } → { db: { host: "localhost" } }
 *
 * @param {object} flatArgs - Dot-notation arguments
 * @returns {object} Nested arguments
 */
export function nestArguments(flatArgs) {
  if (!flatArgs || typeof flatArgs !== "object") return flatArgs;

  const result = {};

  for (const [key, value] of Object.entries(flatArgs)) {
    const parts = key.split(".");
    let current = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // Handle array notation (e.g., "items[]")
      if (part.endsWith("[]")) {
        const arrayKey = part.slice(0, -2);
        if (i === parts.length - 1) {
          // Last part — value goes here
          if (!current[arrayKey]) current[arrayKey] = [];
          current[arrayKey].push(value);
        } else {
          // More nesting — need an object inside the array
          if (!current[arrayKey]) current[arrayKey] = [{}];
          if (!current[arrayKey][current[arrayKey].length - 1]) {
            current[arrayKey][current[arrayKey].length - 1] = {};
          }
          current = current[arrayKey][current[arrayKey].length - 1];
        }
        continue;
      }

      if (i === parts.length - 1) {
        current[part] = value;
      } else {
        if (!current[part] || typeof current[part] !== "object") {
          current[part] = {};
        }
        current = current[part];
      }
    }
  }

  return result;
}

// ─── Pass 2: Scavenge — Sweep reasoning_content for orphaned tool calls ─────

/**
 * Regex patterns to find tool call JSON in reasoning content.
 * Matches: {"name":"tool_name","arguments":{...}} or similar patterns
 */
const TOOL_CALL_PATTERNS = [
  // Standard tool call pattern
  /\{\s*["'](?:name|function)["']\s*:\s*["']([^"']+)["'][^}]*["'](?:arguments|params)["']\s*:\s*(\{[\s\S]*?\})\s*\}/g,
  // Tool use pattern
  /\{\s*["']tool["']\s*:\s*["']([^"']+)["'][^}]*["'](?:input|args)["']\s*:\s*(\{[\s\S]*?\})\s*\}/g,
];

/**
 * Attempt to parse a JSON string, returning null on failure.
 * @param {string} str
 * @returns {object|null}
 */
function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Scavenge tool calls from reasoning content.
 * DeepSeek sometimes emits tool call JSON inside <think> tags or reasoning_content
 * and forgets to include it in the actual tool_calls array.
 *
 * @param {string} reasoningContent - The reasoning_content field from API response
 * @returns {Array<{ name: string, args: object }>} Recovered tool calls
 */
export function scavengeToolCalls(reasoningContent) {
  if (!reasoningContent || typeof reasoningContent !== "string") return [];

  const recovered = [];

  for (const pattern of TOOL_CALL_PATTERNS) {
    let match;
    // Reset lastIndex for each pattern
    pattern.lastIndex = 0;

    while ((match = pattern.exec(reasoningContent)) !== null) {
      try {
        const name = match[1];
        let argsStr = match[2];

        // Try direct parse
        let args = tryParseJSON(argsStr);

        // If that fails, try to fix common issues
        if (!args) {
          // Fix single quotes
          argsStr = argsStr.replace(/'/g, '"');
          // Fix trailing commas
          argsStr = argsStr.replace(/,(\s*[}\]])/g, "$1");
          // Fix unquoted keys
          argsStr = argsStr.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
          args = tryParseJSON(argsStr);
        }

        if (args) {
          recovered.push({ name, args });
        }
      } catch {
        // Skip malformed matches
      }
    }
  }

  return recovered;
}

/**
 * Strip hallucinated markdown tool call wrappers from content.
 * DeepSeek sometimes wraps tool calls in ```json or ``` blocks.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripHallucinatedToolMarkup(content) {
  if (!content) return content;

  let cleaned = content;

  // Remove ```json ... ``` blocks that contain tool calls
  cleaned = cleaned.replace(/```(?:json)?\s*\n?(\{[^]*?"(?:name|function|tool)"[^]*?\})\s*\n?```/g, (_match, json) => {
    try {
      JSON.parse(json);
      return ""; // Remove it — it's a hallucinated tool call
    } catch {
      return _match; // Keep it — not valid JSON
    }
  });

  return cleaned.trim();
}

// ─── Pass 3: Truncation Repair ───────────────────────────────────────────────

/**
 * Detect if a string contains unbalanced JSON (truncated mid-structure).
 * Returns the type of truncation detected.
 *
 * @param {string} str
 * @returns {{ truncated: boolean, type: string|null, openBraces: number, openBrackets: number }}
 */
export function detectTruncatedJson(str) {
  if (!str) return { truncated: false, type: null, openBraces: 0, openBrackets: 0, inString: false };

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  let lastSignificant = null;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      openBraces++;
      lastSignificant = "{";
    } else if (ch === "}") {
      openBraces--;
      lastSignificant = "}";
    } else if (ch === "[") {
      openBrackets++;
      lastSignificant = "[";
    } else if (ch === "]") {
      openBrackets--;
      lastSignificant = "]";
    }
  }

  // 🔥 KEY: truncated can happen mid-string (LLM hit max_tokens inside a JSON string value).
  // Even if braces are balanced, an unclosed string means the JSON is truncated.
  const truncated = openBraces > 0 || openBrackets > 0 || inString;

  let type = null;
  if (truncated) {
    if (openBraces > 0 && openBrackets > 0) type = "object_and_array";
    else if (openBraces > 0) type = "object";
    else if (openBrackets > 0) type = "array";
    else if (inString) type = "mid_string";
  }

  return { truncated, type, openBraces, openBrackets, inString };
}

/**
 * Repair truncated JSON by closing open braces/brackets.
 * Attempts to produce valid JSON.
 *
 * @param {string} str - Potentially truncated JSON string
 * @returns {{ repaired: string, wasTruncated: boolean, closedBraces: number, closedBrackets: number }}
 */
export function repairTruncatedJson(str) {
  if (!str) return { repaired: str || "", wasTruncated: false, closedBraces: 0, closedBrackets: 0, closedString: false };

  const detection = detectTruncatedJson(str);
  if (!detection.truncated) {
    return { repaired: str, wasTruncated: false, closedBraces: 0, closedBrackets: 0, closedString: false, valid: true };
  }

  let repaired = str;
  let closedString = false;

  // 🔥 FIX: If truncation happened mid-string (LLM hit max_tokens inside a JSON string value),
  // close the string FIRST before closing braces. Otherwise appending "}" creates invalid JSON
  // like "content":"<html>test} which is unparseable.
  if (detection.inString) {
    // Close the unclosed JSON string value
    repaired += '"';
    closedString = true;
  }

  // Close open brackets first (inner-most first)
  for (let i = 0; i < detection.openBrackets; i++) {
    repaired += "]";
  }

  // Close open braces
  for (let i = 0; i < detection.openBraces; i++) {
    repaired += "}";
  }

  // Verify repair produces valid JSON
  const parsed = tryParseJSON(repaired);

  return {
    repaired,
    wasTruncated: true,
    closedBraces: detection.openBraces,
    closedBrackets: detection.openBrackets,
    closedString,
    valid: parsed !== null,
  };
}

/**
 * Repair a tool call arguments string that may be truncated.
 * Handles DeepSeek hitting max_tokens mid-JSON.
 *
 * @param {string} argsStr - The arguments JSON string
 * @returns {{ args: object|null, repaired: boolean, original: string }}
 */
export function repairToolCallArgs(argsStr) {
  if (!argsStr) return { args: null, repaired: false, original: argsStr };

  // Try direct parse first
  let parsed = tryParseJSON(argsStr);
  if (parsed) return { args: parsed, repaired: false, original: argsStr };

  // Try repair
  const repair = repairTruncatedJson(argsStr);
  if (repair.valid) {
    return { args: tryParseJSON(repair.repaired), repaired: true, original: argsStr };
  }

  // Try multiple repair strategies
  const strategies = [
    // Add closing brace
    () => tryParseJSON(argsStr + "}"),
    // Add closing bracket + brace
    () => tryParseJSON(argsStr + "]}"),
    // Add closing brace + brace
    () => tryParseJSON(argsStr + "}}"),
    // Wrap in quotes if it's a simple value
    () => tryParseJSON(JSON.stringify(argsStr.trim())),
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return { args: result, repaired: true, original: argsStr };
  }

  return { args: null, repaired: false, original: argsStr };
}

// ─── Pass 4: Storm Detection ─────────────────────────────────────────────────

/**
 * StormBreaker detects and suppresses repeated identical tool calls.
 *
 * When DeepSeek enters a loop calling the same tool with the same args,
 * we detect it and inject a reflection turn instead.
 */
export class StormBreaker {
  /**
   * @param {number} windowSize - Sliding window size for dedup
   */
  constructor(windowSize = STORM_WINDOW_SIZE) {
    /** @type {Array<{ name: string, argsHash: string, ts: number }>} */
    this._history = [];
    this._windowSize = windowSize;
    /** @type {number} */
    this._suppressedCount = 0;
  }

  /**
   * Compute a hash for tool arguments for comparison.
   * @param {object} args
   * @returns {string}
   */
  _hashArgs(args) {
    if (!args) return "null";
    // Sort keys for deterministic comparison
    const sorted = Object.keys(args)
      .sort()
      .reduce((acc, key) => {
        acc[key] = args[key];
        return acc;
      }, {});
    return JSON.stringify(sorted);
  }

  /**
   * Check if a tool call is a storm (duplicate within window).
   * Returns true if this call should be suppressed.
   *
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @returns {{ isStorm: boolean, matchCount: number }}
   */
  check(name, args) {
    const argsHash = this._hashArgs(args);
    const now = Date.now();

    // Count recent matches
    const matches = this._history.filter(
      (h) => h.name === name && h.argsHash === argsHash && now - h.ts < 30000 // 30s window
    );

    const matchCount = matches.length;
    const isStorm = matchCount >= 2; // 3rd identical call = storm

    // Record this call
    this._history.push({ name, argsHash, ts: now });

    // Trim old history
    if (this._history.length > this._windowSize * 2) {
      this._history = this._history.slice(-this._windowSize);
    }

    if (isStorm) {
      this._suppressedCount++;
    }

    return { isStorm, matchCount };
  }

  /**
   * Get suppression stats.
   * @returns {{ suppressedCount: number, historySize: number }}
   */
  getStats() {
    return {
      suppressedCount: this._suppressedCount,
      historySize: this._history.length,
    };
  }

  /**
   * Reset the storm breaker.
   */
  reset() {
    this._history = [];
    this._suppressedCount = 0;
  }
}

// ─── Main Repair Pipeline ────────────────────────────────────────────────────

/**
 * Full ToolCallRepair middleware that runs all four passes on API responses.
 */
export class ToolCallRepair {
  constructor() {
    /** @type {StormBreaker} */
    this.stormBreaker = new StormBreaker();
    /** @type {object} */
    this._stats = {
      scavenged: 0,
      truncated: 0,
      suppressed: 0,
      flattened: 0,
    };
  }

  /**
   * Run the full repair pipeline on a parsed assistant response.
   *
   * @param {object} response - The parsed API response chunk
   * @param {Array<object>} toolSchemas - The registered tool schemas
   * @returns {object} Repaired response
   */
  repair(response, toolSchemas = []) {
    if (!response) return response;

    const repaired = { ...response };

    // ── Pass 2: Scavenge — check reasoning_content for orphaned tool calls ──
    const reasoning = response.reasoning_content || response.reasoning || "";
    if (reasoning) {
      const recovered = scavengeToolCalls(reasoning);
      if (recovered.length > 0) {
        this._stats.scavenged += recovered.length;
        // Merge recovered tool calls into response
        const existing = repaired.tool_calls || [];
        const merged = [...existing];
        for (const rc of recovered) {
          // Avoid duplicates
          const isDuplicate = existing.some(
            (ec) =>
              (ec.function?.name === rc.name || ec.name === rc.name) &&
              JSON.stringify(ec.function?.arguments || ec.args) === JSON.stringify(rc.args)
          );
          if (!isDuplicate) {
            const tcIndex = existing.length + merged.length;
            merged.push({
              id: `call_repair_${tcIndex}`,
              type: "function",
              function: {
                name: rc.name,
                arguments: JSON.stringify(rc.args),
              },
            });
          }
        }
        repaired.tool_calls = merged;
      }

      // Strip hallucinated markup from content
      if (repaired.content) {
        repaired.content = stripHallucinatedToolMarkup(repaired.content);
      }
    }

    // ── Pass 3: Truncation — repair tool call arguments ─────────────────────
    if (repaired.tool_calls && Array.isArray(repaired.tool_calls)) {
      for (let i = 0; i < repaired.tool_calls.length; i++) {
        const tc = repaired.tool_calls[i];
        const argsStr = tc.function?.arguments;

        if (argsStr && typeof argsStr === "string") {
          // Check if truncated
          const { truncated } = detectTruncatedJson(argsStr);
          if (truncated) {
            this._stats.truncated++;
            const repair = repairToolCallArgs(argsStr);
            if (repair.args) {
              tc.function.arguments = JSON.stringify(repair.args);
            }
          }
        }
      }
    }

    // ── Pass 4: Storm detection ────────────────────────────────────────────
    if (repaired.tool_calls && Array.isArray(repaired.tool_calls)) {
      const filtered = [];
      for (const tc of repaired.tool_calls) {
        const name = tc.function?.name;
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          args = {};
        }

        const { isStorm } = this.stormBreaker.check(name, args);
        if (isStorm) {
          this._stats.suppressed++;
          // Don't add to filtered — suppress this call
        } else {
          filtered.push(tc);
        }
      }
      repaired.tool_calls = filtered;
    }

    return repaired;
  }

  /**
   * Register a tool schema (checks if flattening is needed).
   * Returns the effective schema (flattened or original).
   *
   * @param {object} toolDef - Tool definition with function schema
   * @returns {object} Tool definition with possibly flattened schema
   */
  registerTool(toolDef) {
    const schema = toolDef.function?.parameters || toolDef.parameters;
    if (!schema) return toolDef;

    const analysis = analyzeSchema(schema);
    if (analysis.needsFlattening) {
      this._stats.flattened++;
      const flattened = flattenSchema(schema);
      if (toolDef.function) {
        return {
          ...toolDef,
          function: {
            ...toolDef.function,
            parameters: flattened,
          },
        };
      }
      return { ...toolDef, parameters: flattened };
    }

    return toolDef;
  }

  /**
   * Get repair statistics.
   * @returns {object}
   */
  getStats() {
    return {
      ...this._stats,
      stormBreaker: this.stormBreaker.getStats(),
    };
  }

  /**
   * Reset all state.
   */
  reset() {
    this.stormBreaker.reset();
    this._stats = {
      scavenged: 0,
      truncated: 0,
      suppressed: 0,
      flattened: 0,
    };
  }
}

// ─── Default Export ──────────────────────────────────────────────────────────

export default {
  analyzeSchema,
  flattenSchema,
  nestArguments,
  scavengeToolCalls,
  stripHallucinatedToolMarkup,
  detectTruncatedJson,
  repairTruncatedJson,
  repairToolCallArgs,
  StormBreaker,
  ToolCallRepair,
};
