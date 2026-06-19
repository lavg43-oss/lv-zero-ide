/**
 * 🧠 DeepSeek Provider — OpenAI-compatible adapter with reasoning_content support
 *
 * Wraps the OpenAI SDK specifically for DeepSeek's API, which returns
 * `reasoning_content` in stream deltas (non-standard OpenAI extension).
 *
 * v2.1 — Crash-safe: AbortController + stall timeout to prevent extension host freeze.
 *
 * Usage:
 *   import { DeepSeekProvider } from "./providers/deepseek.js";
 *   const provider = new DeepSeekProvider({ apiKey, baseURL, model });
 *   const stream = provider.stream(messages, tools);
 *   for await (const chunk of stream) { ... }
 */

import OpenAI from "openai";

// ─── Timeout Configuration (prevents extension host freeze) ─────────────────
const STALL_TIMEOUT_MS = 120_000;  // 120s for DeepSeek reasoning
const STREAM_TIMEOUT_MS = 300_000; // 5min total

export class DeepSeekProvider {
  /**
   * @param {object} config
   * @param {string} config.apiKey
   * @param {string} [config.baseURL="https://api.deepseek.com/v1"]
   * @param {string} [config.model="deepseek-v4-flash"]
   */
  constructor(config = {}) {
    this.name = "deepseek";
    this.model = config.model || "deepseek-v4-flash";
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || "https://api.deepseek.com/v1",
      // Set a generous default timeout at the HTTP level too
      timeout: STREAM_TIMEOUT_MS,
      maxRetries: 0, // We handle retries at the orchestrator level
    });
    // Lazy-init beta client (for Chat Prefix Completion, FIM, etc.)
    this._betaClient = null;
  }

  /**
   * Get or create the beta API client (base URL: https://api.deepseek.com/beta).
   * Used for Chat Prefix Completion and FIM Completion features.
   * @returns {OpenAI}
   */
  _getBetaClient() {
    if (!this._betaClient) {
      this._betaClient = new OpenAI({
        apiKey: this.client.apiKey,
        baseURL: "https://api.deepseek.com/beta",
        timeout: STREAM_TIMEOUT_MS,
        maxRetries: 0,
      });
    }
    return this._betaClient;
  }

  /**
   * Build request params object from options, forwarding all
   * DeepSeek-specific parameters (extra_body, reasoning_effort,
   * response_format, stop) alongside standard ones.
   * @param {object} options
   * @returns {object}
   */
  _buildRequestParams(options = {}) {
    const params = {};
    // reasoning_effort: "high" | "max" (thinking mode effort control)
    if (options.reasoning_effort) {
      params.reasoning_effort = options.reasoning_effort;
    }
    // extra_body: {thinking: {type: "enabled"}} for thinking mode toggle
    if (options.extra_body) {
      params.extra_body = options.extra_body;
    }
    // response_format: {type: "json_object"} for JSON mode
    if (options.response_format) {
      params.response_format = options.response_format;
    }
    // stop: array of stop tokens
    if (options.stop) {
      params.stop = options.stop;
    }
    return params;
  }

  /**
   * Human-readable label for the provider.
   */
  get label() {
    return `DeepSeek (${this.model})`;
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
    const controller = new AbortController();
    const totalTimer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    try {
      const deepParams = this._buildRequestParams(options);
      const isThinking = options.extra_body?.thinking?.type === "enabled"
        || !!options.reasoning_effort;

      return await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: options.tools?.length > 0 ? options.tools : undefined,
        tool_choice: options.tools?.length > 0 ? "auto" : undefined,
        stream: false,
        max_tokens: parseInt(process.env.MAX_OUTPUT_TOKENS) || 384000,
        signal: controller.signal,
        ...(isThinking ? {} : { temperature: 0.6 }),
        ...deepParams,
      });
    } finally {
      clearTimeout(totalTimer);
    }
  }

  /**
   * Streaming chat completion with crash-safe timeout.
   *
   * Uses AbortController with a two-tier timeout:
   *  - Stall timeout: resets on every chunk → prevents mid-stream freeze
   *  - Total timeout: fixed from start → prevents infinite stream
   *
   * Each yielded chunk has the shape:
   *   { content?: string, reasoning_content?: string, tool_calls?: object, finish_reason?: string }
   *
   * @param {Array<object>} messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools]
   * @returns {AsyncGenerator<object>}
   * @throws {Error} If stream stalls or exceeds total timeout
   */
  async *stream(messages, options = {}) {
    const controller = new AbortController();

    // ── Forward external abort signal (from orchestrator stop button) ──
    // When abortAgent() calls controller.abort(), this listener forwards
    // it to the local controller, cancelling the in-flight HTTP request.
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason || new Error("External abort"));
      } else {
        options.signal.addEventListener("abort", () => {
          controller.abort(options.signal.reason || new Error("External abort"));
        }, { once: true });
      }
    }

    const totalTimer = setTimeout(() => {
      controller.abort(new Error(`Stream total timeout (${STREAM_TIMEOUT_MS / 1000}s) exceeded`));
    }, STREAM_TIMEOUT_MS);

    let stallTimer = setTimeout(() => {
      controller.abort(new Error(`Stream stalled — no data for ${STALL_TIMEOUT_MS / 1000}s`));
    }, STALL_TIMEOUT_MS);

    let chunkCount = 0;

    try {
      const deepParams = this._buildRequestParams(options);
      // Thinking mode disables temperature/top_p — skip to avoid confusion
      const isThinking = options.extra_body?.thinking?.type === "enabled"
        || !!options.reasoning_effort;

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: options.tools?.length > 0 ? options.tools : undefined,
        tool_choice: options.tools?.length > 0 ? "auto" : undefined,
        stream: true,
        max_tokens: parseInt(process.env.MAX_OUTPUT_TOKENS) || 384000,
        signal: controller.signal,
        ...(isThinking ? {} : { temperature: 0.6 }),
        ...deepParams,
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
          // Edge case: some chunks only have finish_reason
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (finishReason) {
            yield { finish_reason: finishReason };
          }
          continue;
        }

        yield {
          content: delta.content || undefined,
          reasoning_content: delta.reasoning_content || undefined,
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

  /**
   * Set the model name at runtime (for model switching).
   * @param {string} modelName
   */
  setModel(modelName) {
    this.model = modelName;
  }

  /**
   * Perform a lightweight health check to verify the provider is responsive.
   * Makes a minimal API call (simple completion) and checks for errors.
   *
   * @returns {Promise<{ healthy: boolean, error?: string, hasBalance?: boolean }>}
   */
  async checkHealth() {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      });

      const healthy = !!response?.choices?.[0];
      return {
        healthy,
        hasBalance: healthy, // If we got a response, we have balance
      };
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      return {
        healthy: false,
        error: err.message,
        hasBalance: !(msg.includes("402") ||
                      msg.includes("insufficient_balance") ||
                      msg.includes("billing")),
      };
    }
  }

  /**
   * Chat Prefix Completion (Beta) — prime the assistant response with a prefix.
   *
   * Uses the beta endpoint (https://api.deepseek.com/beta). The last message
   * in the messages array must have role="assistant" and prefix=true.
   * The model completes the assistant message from that prefix.
   *
   * Useful for forcing specific output formats (e.g., code blocks, JSON)
   * and controlling response style.
   *
   * @param {Array<object>} messages - Full conversation, last message must be
   *   {role: "assistant", content: "```python\n", prefix: true}
   * @param {object} [options]
   * @param {string[]} [options.stop] - Stop tokens (e.g., ["```"])
   * @param {number} [options.max_tokens] - Max output tokens
   * @returns {Promise<{content: string, finish_reason: string}>}
   */
  async prefixComplete(messages, options = {}) {
    const beta = this._getBetaClient();
    const deepParams = this._buildRequestParams(options);
    const isThinking = options.extra_body?.thinking?.type === "enabled"
      || !!options.reasoning_effort;

    const response = await beta.chat.completions.create({
      model: this.model,
      messages,
      stream: false,
      max_tokens: options.max_tokens ?? parseInt(process.env.MAX_OUTPUT_TOKENS) ?? 384000,
      stop: options.stop ?? undefined,
      ...(isThinking ? {} : { temperature: 0.6 }),
      ...deepParams,
    });

    return {
      content: response.choices?.[0]?.message?.content ?? "",
      finish_reason: response.choices?.[0]?.finish_reason ?? "stop",
    };
  }
}

export default DeepSeekProvider;
