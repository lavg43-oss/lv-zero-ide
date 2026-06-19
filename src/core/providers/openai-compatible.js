/**
 * 🔌 OpenAI-Compatible Provider — Generic adapter for any OpenAI-compatible API
 *
 * Covers providers like OpenAI, OpenRouter, Groq, Together AI, etc.
 * Does NOT include reasoning_content (DeepSeek-specific extension).
 *
 * v2.2 — Crash-safe: AbortController + stall timeout to prevent extension host freeze.
 *
 * Usage:
 *   import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
 *   const provider = new OpenAICompatibleProvider({ apiKey, baseURL, model });
 *   const stream = provider.stream(messages, tools);
 *   for await (const chunk of stream) { ... }
 */

import OpenAI from "openai";

// ─── Timeout Configuration (prevents extension host freeze) ─────────────────
const STALL_TIMEOUT_MS = 30_000;   // 30s without a single chunk → abort
const STREAM_TIMEOUT_MS = 180_000; // 3min total stream duration → abort

export class OpenAICompatibleProvider {
  /**
   * @param {object} config
   * @param {string} config.apiKey
   * @param {string} [config.baseURL]
   * @param {string} [config.model="gpt-4o"]
   */
  constructor(config = {}) {
    this.name = "openai-compatible";
    this.model = config.model || "gpt-4o";
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
    });
  }

  /**
   * Human-readable label for the provider.
   */
  get label() {
    return `OpenAI-compatible (${this.model})`;
  }

  /**
   * Check if the client has valid credentials.
   * @returns {boolean}
   */
  isReady() {
    return !!this.client?.apiKey;
  }

  /**
   * Non-streaming chat completion.
   * @param {Array<object>} messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools]
   * @returns {Promise<object>} Standard OpenAI response shape
   */
  async complete(messages, options = {}) {
    return this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: options.tools?.length > 0 ? options.tools : undefined,
      tool_choice: options.tools?.length > 0 ? "auto" : undefined,
      stream: false,
    });
  }

  /**
   * Streaming chat completion with crash-safe timeout.
   *
   * Uses AbortController with a two-tier timeout:
   *  - Stall timeout: resets on every chunk → prevents mid-stream freeze
   *  - Total timeout: fixed from start → prevents infinite stream
   *
   * Each yielded chunk has the shape:
   *   { content?: string, tool_calls?: object, finish_reason?: string }
   * (No reasoning_content — this is a standard OpenAI-compatible API)
   *
   * @param {Array<object>} messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools]
   * @returns {AsyncGenerator<object>}
   * @throws {Error} If stream stalls or exceeds total timeout
   */
  async *stream(messages, options = {}) {
    const controller = new AbortController();
    const totalTimer = setTimeout(() => {
      controller.abort(new Error(`Stream total timeout (${STREAM_TIMEOUT_MS / 1000}s) exceeded`));
    }, STREAM_TIMEOUT_MS);

    let stallTimer = setTimeout(() => {
      controller.abort(new Error(`Stream stalled — no data for ${STALL_TIMEOUT_MS / 1000}s`));
    }, STALL_TIMEOUT_MS);

    let chunkCount = 0;

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: options.tools?.length > 0 ? options.tools : undefined,
        tool_choice: options.tools?.length > 0 ? "auto" : undefined,
        stream: true,
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        chunkCount++;

        // ── Reset stall timer on each chunk ──────────────────────────
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          controller.abort(new Error(`Stream stalled — no data for ${STALL_TIMEOUT_MS / 1000}s (after ${chunkCount} chunks)`));
        }, STALL_TIMEOUT_MS);

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (finishReason) {
            yield { finish_reason: finishReason };
          }
          continue;
        }

        yield {
          content: delta.content || undefined,
          tool_calls: delta.tool_calls || undefined,
          finish_reason: chunk.choices?.[0]?.finish_reason || undefined,
        };
      }
    } finally {
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
    }
  }

  /**
   * Get current model name.
   * @returns {string}
   */
  getModel() {
    return this.model;
  }
}

export default OpenAICompatibleProvider;
