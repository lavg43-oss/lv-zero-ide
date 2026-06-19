/**
 * Memory Type System — Priority scoring, TTL resolution, and type definitions.
 *
 * Defines the 8 memory types used by the NeuralMemory architecture:
 *   FACT, DECISION, ERROR, INSTRUCTION, WORKFLOW, PREFERENCE, CONTEXT
 *
 * Each type has:
 *   - defaultTTL:  null = never expires, number = seconds
 *   - basePriority: 0.0–1.0 baseline importance
 *
 * Priority scoring adjusts basePriority dynamically based on:
 *   - Recency (last accessed within 1h / 24h)
 *   - Access frequency
 *   - Source (user-sourced gets a boost)
 *
 * @module core/memory/memory-types
 */

const MEMORY_TYPES = {
  FACT:        { type: 'fact',        defaultTTL: null,     basePriority: 0.3, description: 'Verifiable information about code, config, or project' },
  DECISION:    { type: 'decision',    defaultTTL: 604800,   basePriority: 0.6, description: 'Architectural or design decisions' },
  ERROR:       { type: 'error',       defaultTTL: 86400,    basePriority: 0.7, description: 'Errors encountered and resolutions' },
  INSTRUCTION: { type: 'instruction', defaultTTL: null,     basePriority: 0.5, description: 'User-provided instructions or preferences' },
  WORKFLOW:    { type: 'workflow',    defaultTTL: null,     basePriority: 0.4, description: 'Workflow definitions and execution patterns' },
  PREFERENCE:  { type: 'preference',  defaultTTL: 2592000,  basePriority: 0.2, description: 'User UI/config preferences' },
  CONTEXT:     { type: 'context',     defaultTTL: 3600,     basePriority: 0.8, description: 'Ephemeral session context' },
};

/**
 * All valid type strings.
 * @type {string[]}
 */
const VALID_TYPES = Object.values(MEMORY_TYPES).map(t => t.type);

/**
 * Calculate dynamic priority for a memory entry.
 *
 * Adjusts basePriority based on:
 *  - Recency: +0.2 if accessed in last hour, +0.1 if in last 24h
 *  - Frequency: +0.05 per 10 accesses, capped at +0.2
 *  - Source: +0.1 if user-sourced
 *
 * @param {string} type — one of the MEMORY_TYPES keys
 * @param {object} stats
 * @param {number} [stats.accessCount=0]
 * @param {number} [stats.lastAccessedAt] — epoch ms
 * @param {string} [stats.source]
 * @returns {number} priority in range 0.0–1.0
 */
function calculatePriority(type, { accessCount = 0, lastAccessedAt, source } = {}) {
  const key = type.toUpperCase();
  const config = MEMORY_TYPES[key];
  if (!config) return 0.5;

  let priority = config.basePriority;

  // Recency bonus
  if (lastAccessedAt) {
    const hoursSinceAccess = (Date.now() - lastAccessedAt) / 3600000;
    if (hoursSinceAccess < 1) {
      priority += 0.2;
    } else if (hoursSinceAccess < 24) {
      priority += 0.1;
    }
  }

  // Frequency bonus: +0.05 per 10 accesses, cap at +0.2
  priority += Math.min(0.2, (accessCount || 0) / 10 * 0.05);

  // Source boost: user-sourced memories are more important
  if (source === 'user') priority += 0.1;

  return Math.max(0, Math.min(1, priority));
}

/**
 * Resolve the TTL (time-to-live) for a memory entry.
 *
 * Rules:
 *  - If customTTL is 0, the memory never expires (returns null).
 *  - If customTTL is provided (non-null, non-zero), use it.
 *  - Otherwise use the type's defaultTTL.
 *  - If neither customTTL nor defaultTTL is set, returns null (never expires).
 *
 * @param {string} type — one of the MEMORY_TYPES keys
 * @param {number|null|undefined} [customTTL] — custom TTL in seconds
 * @returns {number|null} expiry timestamp (epoch ms) or null if never expires
 */
function resolveTTL(type, customTTL) {
  if (customTTL !== undefined && customTTL !== null) {
    return customTTL === 0 ? null : Date.now() + customTTL * 1000;
  }
  const key = type.toUpperCase();
  const config = MEMORY_TYPES[key];
  if (!config || config.defaultTTL === null) return null;
  return Date.now() + config.defaultTTL * 1000;
}

/**
 * Validate a memory type string.
 * @param {string} type
 * @returns {boolean}
 */
function isValidType(type) {
  return VALID_TYPES.includes(type);
}

/**
 * Get the configuration for a memory type.
 * @param {string} type
 * @returns {object|undefined}
 */
function getTypeConfig(type) {
  const key = type.toUpperCase();
  return MEMORY_TYPES[key];
}

module.exports = {
  MEMORY_TYPES,
  VALID_TYPES,
  calculatePriority,
  resolveTTL,
  isValidType,
  getTypeConfig,
};
