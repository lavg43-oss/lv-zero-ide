/**
 * cache_first_loop.js — Reasonix-inspired Cache-First Loop Engine
 *
 * v1.1 — 413 Guard: hard byte-size limit on API request body
 *   Implements the three-region context partitioning from esengine/reasonix:
 *   ImmutablePrefix, AppendOnlyLog, VolatileScratch.
 *
 *   DeepSeek bills cached input at ~10% of the miss rate, but only when the
 *   *exact* byte prefix matches. Most agent loops rewrite/reorder messages
 *   each turn, achieving <20% cache hits. This module partitions context into
 *   immutable (cacheable) and mutable (miss) regions.
 */

// ─── ImmutablePrefix ───────────────────────────────────────────────────────

export class ImmutablePrefix {
  constructor() {
    this._messages = [];
    this._hash = '';
    this._estimatedTokens = 0;
    this._frozen = false;
  }

  get hash() { return this._hash; }
  get estimatedTokens() { return this._estimatedTokens; }
  /** @returns {Array<object>} */
  get messages() { return this._messages; }

  set(messages) {
    this._messages = [...messages];
    const json = JSON.stringify(this._messages);
    this._hash = this._sha256(json);
    this._estimatedTokens = Math.ceil(json.length / 4);
  }

  /**
   * Build a frozen prefix from a system prompt string + optional tools.
   * @param {string} systemPrompt
   * @param {Array<object>} [tools]
   */
  build(systemPrompt, tools = []) {
    if (this._frozen) {
      throw new Error("ImmutablePrefix already frozen");
    }
    const messages = [{ role: "system", content: systemPrompt }];
    if (tools.length > 0) {
      const toolNames = tools.map(t => t.function?.name || t.name).filter(Boolean);
      if (toolNames.length > 0) {
        messages.push({
          role: "system",
          content: `[TOOL MANIFEST]\nAvailable tools: ${toolNames.join(", ")}`,
        });
      }
    }
    this.set(messages);
    this._frozen = true;
  }

  /**
   * Rebuild (thaw, rebuild, re-freeze).
   * @param {string} systemPrompt
   * @param {Array<object>} [tools]
   */
  rebuild(systemPrompt, tools = []) {
    this._frozen = false;
    this.build(systemPrompt, tools);
  }

  getMessages() { return [...this._messages]; }

  /** @returns {string} */
  _computeHash() { return this._sha256(JSON.stringify(this._messages)); }

  _sha256(str) {
    // Lightweight hash for change detection (not cryptographically required)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

// ─── AppendOnlyLog ─────────────────────────────────────────────────────────

export class AppendOnlyLog {
  constructor() {
    /** @type {Array<object>} */
    this.entries = [];
    /** @type {number} */
    this.totalAppended = 0;
    /** @type {number} */
    this._trimmedCount = 0;
  }

  get length() { return this.entries.length; }
  get trimmedCount() { return this._trimmedCount; }

  /**
   * Append an entry to the log.
   * @param {object} entry - Message object { role, content, ... }
   */
  append(entry) {
    this.entries.push({ ...entry });
    this.totalAppended++;
  }

  /**
   * Serialize log entries to plain array.
   * Strips internal tracking fields.
   * @returns {Array<object>}
   */
  toJSON() {
    return this.entries.map(e => {
      const { _logIndex, ...rest } = e;
      return rest;
    });
  }

  /**
   * Restore entries from a plain array.
   * @param {Array<object>} entries
   */
  fromJSON(entries) {
    this.entries = entries.map((e, i) => ({ ...e, _logIndex: i }));
    this._trimmedCount = 0;
  }

  /**
   * Reset to empty.
   */
  reset() {
    this.entries = [];
    this._trimmedCount = 0;
  }

  /**
   * Remove and return the last entry.
   * @returns {object|null}
   */
  pop() {
    return this.entries.pop() || null;
  }

  /**
   * Shift (remove from front) the first entry.
   * @returns {object|null}
   */
  shift() {
    return this.entries.shift() || null;
  }

  /**
   * Get all log entries as a plain array.
   * @returns {Array<object>}
   */
  getAll() {
    return [...this.entries];
  }

  get length() { return this.entries.length; }
}

// ─── VolatileScratch ───────────────────────────────────────────────────────

export class VolatileScratch {
  constructor() {
    this._entries = [];
    this._store = new Map();
  }

  add(entry) { this._entries.push(entry); }
  getEntries() { return [...this._entries]; }
  clear() { this._entries = []; this._store.clear(); }
  reset() { this.clear(); }

  /** Store a value by key */
  set(key, value) {
    if (value === undefined) {
      this._store.delete(key);
    } else {
      this._store.set(key, value);
    }
  }

  /** Retrieve a value by key */
  get(key) {
    return this._store.get(key);
  }
}

// ─── LogWrapper (for trimFront) ─────────────────────────────────────────────

/**
 * Thin wrapper that provides length/shift for trimFront.
 */
class LogWrapper {
  constructor(log) {
    this._log = log;
  }
  get entries() { return this._log.entries; }
  set entries(v) { this._log.entries = v; }
  get length() { return this._log.entries.length; }
  shift() { return this.shift(); }
}

// ─── CacheFirstLoop ────────────────────────────────────────────────────────

export class CacheFirstLoop {
  constructor() {
    this.prefix = new ImmutablePrefix();
    this.log = new AppendOnlyLog();
    this.scratch = new VolatileScratch();
    this._stats = {
      builds: 0,
      totalCacheableTokens: 0,
    };
    this._trimmedCount = 0;
  }

  /**
   * Set the immutable prefix (system prompt + initial context).
   * @param {Array<object>} messages
   */
  setPrefix(messages) {
    this.prefix.set(messages);
  }

  /**
   * Initialize the prefix from the system prompt (string) + tool definitions.
   * Backward-compatible with orchestrator v4.0.x.
   * @param {string} systemPrompt - System prompt text
   * @param {Array<object>} tools  - Tool definitions
   */
  init(systemPrompt, tools) {
    const prefixMessages = [{ role: "system", content: systemPrompt }];
    // Append minimal tool context to keep prefix cacheable
    if (tools && tools.length > 0) {
      const toolNames = tools.map(t => t.function?.name || t.name).filter(Boolean);
      if (toolNames.length > 0) {
        // Don't bloat the prefix with full tool schemas — just names for stability
        prefixMessages.push({
          role: "system",
          content: `[TOOL MANIFEST]\nAvailable tools: ${toolNames.join(", ")}`,
        });
      }
    }
    this.prefix.set(prefixMessages);
    this._stats.builds++;
    this._stats.totalCacheableTokens = this.prefix.estimatedTokens;
    return this;
  }

  /**
   * Rebuild the prefix from session-restored data.
   * @param {string} systemPromptContent - System prompt text
   * @param {Array<object>} tools         - Tool definitions
   */
  rebuildPrefix(systemPromptContent, tools) {
    this.init(systemPromptContent, tools);
  }

  /**
   * Add assistant message + tool calls to the log.
   */
  addAssistantMessage(content, toolCalls = null, reasoningContent = null) {
    const hasToolCalls = toolCalls && toolCalls.length > 0;
    // When there are no tool calls and content is null/empty, use "" instead of null
    // to avoid API rejection (DeepSeek requires content or tool_calls on assistant messages)
    const normalizedContent = hasToolCalls && !content ? null : (content || "");
    const msg = { role: "assistant", content: normalizedContent };
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    if (hasToolCalls) {
      msg.tool_calls = toolCalls;
    }
    this.log.append(msg);
  }

  /**
   * Add a tool result message to the log.
   */
  addToolResult(toolCallId, result) {
    this.log.append({
      role: "tool",
      tool_call_id: toolCallId,
      content: typeof result === "string" ? result : JSON.stringify(result),
    });
  }

  /**
   * Add a user message to the log.
   */
  addUserMessage(content) {
    this.log.append({ role: "user", content });
  }

  /**
   * Add a system message to the log.
   * @param {object} msg - The system message object ({ role: "system", content: "..." })
   */
  addSystemMessage(msg) {
    if (msg && msg.role === "system") {
      this.log.append(msg);
    }
  }

  /**
   * Remove the last user message from the log.
   */
  popLastUserMessage() {
    while (this.log.entries.length > 0) {
      const last = this.log.entries[this.log.entries.length - 1];
      if (last.role === "user") {
        this.log.entries.pop();
        break;
      }
      this.log.entries.pop();
    }
  }

  /**
   * Pop (remove) the last entry from the log.
   * @returns {object|null}
   */
  popLogEntry() {
    return this.log.entries.pop() || null;
  }

  /**
   * Trim oldest entries to stay within a token budget.
   */
  trimFront(maxTokens, minKeep = 20, tokenEstimateFn = null) {
    const estimate = tokenEstimateFn || ((e) => Math.ceil(JSON.stringify(e).length / 4));
    const before = this.log.entries.length;

    // ── Phase 1: trim from front to fit budget ──
    while (this.log.entries.length > minKeep) {
      const total = this.log.entries.reduce((s, e) => s + estimate(e), 0);
      if (total <= maxTokens) break;
      this.log.entries.shift();
      this._trimmedCount++;
    }

    // ── Phase 2: clean up orphaned tool results ──
    const cleaned = [];
    const pendingToolCallIds = new Set();
    for (const entry of this.log.entries) {
      if (entry.role === "assistant" && entry.tool_calls && Array.isArray(entry.tool_calls)) {
        for (const tc of entry.tool_calls) {
          pendingToolCallIds.add(tc.id);
        }
        cleaned.push(entry);
      } else if (entry.role === "tool" && entry.tool_call_id) {
        if (pendingToolCallIds.has(entry.tool_call_id)) {
          pendingToolCallIds.delete(entry.tool_call_id);
          cleaned.push(entry);
        } else {
          this._trimmedCount++;
        }
      } else {
        cleaned.push(entry);
      }
    }
    this.log.entries = cleaned;

    return { removed: before - this.log.entries.length, kept: this.log.entries.length };
  }

  /**
   * Serialize to plain array.
   */
  toJSON() {
    return this.log.toJSON();
  }

  /**
   * Build the complete messages array for the API call.
   *
   * 🔥 413 GUARD (v1.1): nginx/openresty proxies reject HTTP bodies >1MB.
   * Aggressively trim the log until JSON body fits within 800KB.
   */
  buildMessages() {
    this._stats.builds++;
    const prefixMsgs = this.prefix.getMessages();
    let logMsgs = this.log.toJSON();

    // Estimate cacheable tokens
    const cacheableStr = JSON.stringify(prefixMsgs) + JSON.stringify(logMsgs.slice(0, -4));
    this._stats.totalCacheableTokens = Math.ceil(cacheableStr.length / 4);

    // 🔥 413 BODY LIMIT GUARD
    // nginx default client_max_body_size is 1MB. Stay safely under.
    const MAX_BODY_BYTES = 800 * 1024; // 800KB
    let trimmed = 0;

    while (logMsgs.length > 4) {
      const bodyBytes = Buffer.byteLength(
        JSON.stringify([...prefixMsgs, ...logMsgs]),
        'utf-8'
      );
      if (bodyBytes <= MAX_BODY_BYTES) break;
      logMsgs.shift();
      trimmed++;
    }

    if (trimmed > 0) {
      this._trimmedCount += trimmed;
      // Clean orphaned tool results after shifting
      const cleaned = [];
      const pendingIds = new Set();
      for (const entry of logMsgs) {
        if (entry.role === "assistant" && entry.tool_calls) {
          for (const tc of entry.tool_calls) pendingIds.add(tc.id);
          cleaned.push(entry);
        } else if (entry.role === "tool" && entry.tool_call_id) {
          if (pendingIds.has(entry.tool_call_id)) {
            pendingIds.delete(entry.tool_call_id);
            cleaned.push(entry);
          }
        } else {
          cleaned.push(entry);
        }
      }
      logMsgs = cleaned;
    }

    // NOTE: reasoning_content MUST be preserved for DeepSeek thinking mode.
    return [...prefixMsgs, ...logMsgs];
  }

  /**
   * Trim log to manage context window.
   */
  trimLog(maxTokens = 1000000, minKeep = 50) {
    return this.trimFront(maxTokens, minKeep);
  }

  /**
   * Reset scratch for a new turn.
   */
  newTurn() {
    this.scratch.reset();
  }

  /**
   * Get cache-hit statistics.
   */
  getStats() {
    return {
      ...this._stats,
      prefixHash: this.prefix.hash,
      prefixTokens: this.prefix.estimatedTokens,
      logLength: this.log.length,
      totalAppended: this.log.totalAppended,
    };
  }

  /**
   * Serialize entire loop state.
   */
  toJSON() {
    return {
      prefixHash: this.prefix.hash,
      log: this.log.toJSON(),
      stats: this._stats,
    };
  }

  /**
   * Restore loop state from JSON.
   */
  fromJSON(data) {
    if (data.log) this.log.fromJSON(data.log);
    if (data.stats) this._stats = { ...this._stats, ...data.stats };
  }

  /**
   * Clear all state (for new session).
   */
  clear() {
    this.prefix = new ImmutablePrefix();
    this.log = new AppendOnlyLog();
    this.scratch = new VolatileScratch();
    this._stats = { builds: 0, totalCacheableTokens: 0 };
  }

  /**
   * Get total trimmed count.
   */
  get trimmedCount() { return this._trimmedCount; }
}
