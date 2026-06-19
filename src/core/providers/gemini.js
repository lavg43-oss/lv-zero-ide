/**
 * 🌐 Gemini Provider — Google Gemini 2.5 Flash & Pro adapter
 *
 * Supports both Gemini 2.5 Flash (fast/cheap) and Gemini 2.5 Pro (powerful)
 * via the Gemini REST API with full streaming support.
 *
 * Streaming: Uses `streamGenerateContent` endpoint with SSE parsing.
 * Tool calls: Supports Gemini function calling via `tools` in request body.
 *
 * Endpoints:
 *   - Streaming:  POST {base}/{model}:streamGenerateContent?key={apiKey}&alt=sse
 *   - Non-stream: POST {base}/{model}:generateContent?key={apiKey}
 *
 * v2.0 — Streaming + Dual model support
 *
 * Usage:
 *   import { GeminiProvider } from "./providers/gemini.js";
 *   const provider = new GeminiProvider({ apiKey: "AIza...", model: "gemini-2.5-flash" });
 *   for await (const chunk of provider.stream(messages)) { ... }
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";
const STALL_TIMEOUT_MS = 60_000;   // 60s stall timeout for streaming
const STREAM_TIMEOUT_MS = 300_000; // 5min total timeout
const REQUEST_TIMEOUT_MS = 30_000; // 30s for non-streaming requests

// ═══════════════════════════════════════════════════════════════════════════════
// GeminiProvider
// ═══════════════════════════════════════════════════════════════════════════════

export class GeminiProvider {
  /**
   * @param {object} config
   * @param {string} config.apiKey          - Google Gemini API key
   * @param {string} [config.model]         - Model name (default: "gemini-2.5-flash")
   * @param {string} [config.providerName]  - Override provider name (default: auto-detected)
   */
  constructor(config = {}) {
    this._apiKey = config.apiKey || null;
    this.model = config.model || DEFAULT_MODEL;

    // Auto-detect provider name from model
    if (config.providerName) {
      this.name = config.providerName;
    } else {
      this.name = this.model.includes("pro")
        ? "gemini-pro"
        : "gemini-flash";
    }
  }

  /**
   * Human-readable label.
   */
  get label() {
    const displayName = this.model.includes("pro") ? "Gemini 2.5 Pro" : "Gemini 2.5 Flash";
    return `${displayName} (${this.model})`;
  }

  /**
   * Check if the provider has valid credentials.
   * @returns {boolean}
   */
  isReady() {
    return !!this._apiKey;
  }

  /**
   * Get current model name.
   * @returns {string}
   */
  getModel() {
    return this.model;
  }

  /**
   * Set the model name at runtime.
   * Also updates the provider name based on model type.
   * @param {string} modelName
   */
  setModel(modelName) {
    this.model = modelName;
    this.name = modelName.includes("pro")
      ? "gemini-pro"
      : "gemini-flash";
  }

  // ─── Message Conversion (OpenAI → Gemini format) ─────────────────────────

  /**
   * Convert OpenAI-format messages to Gemini's `contents` array.
   *
   * OpenAI format:
   *   [{ role: "system", content: "..." }, { role: "user", content: "..." }]
   *
   * Gemini format:
   *   systemInstruction: { parts: [{ text: "..." }] }
   *   contents: [{ role: "user", parts: [{ text: "..." }] }]
   *
   * Gemini requires alternating user/model messages — consecutive messages
   * of the same role are merged.
   *
   * Also handles tool results: messages with role="tool" are converted to
   * Gemini functionResponse parts.
   *
   * @param {Array<object>} messages - OpenAI-format message array
   * @returns {{ systemInstruction: object|null, contents: Array<object> }}
   */
  _convertMessages(messages) {
    let systemInstruction = null;
    const contents = [];

    for (const msg of messages) {
      const role = msg.role;

      // Skip empty content (but keep tool messages with no text content)
      const content = typeof msg.content === "string" ? msg.content : "";
      const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
      const isToolResult = role === "tool";

      // Extract system message as systemInstruction
      if (role === "system") {
        if (!systemInstruction) {
          systemInstruction = { parts: [] };
        }
        // Gemini requires at least 1 part; skip empty system messages
        if (content) {
          systemInstruction.parts.push({ text: content });
        }
        continue;
      }

      // ── Tool Result → functionResponse ──────────────────────────────
      if (isToolResult) {
        const toolCallId = msg.tool_call_id;
        // Find the assistant message that had this tool_call_id to get function name
        // For now, use a generic approach
        const parts = [];
        try {
          const parsed = typeof content === "string" ? JSON.parse(content) : content;
          parts.push({
            functionResponse: {
              name: toolCallId || "unknown_function",
              response: { result: parsed },
            },
          });
        } catch {
          parts.push({
            functionResponse: {
              name: toolCallId || "unknown_function",
              response: { result: content },
            },
          });
        }

        // Gemini: tool results use role "function" and are pushed as a user message
        const last = contents[contents.length - 1];
        if (last && last.role === "user") {
          last.parts.push(...parts);
        } else {
          contents.push({ role: "user", parts });
        }
        continue;
      }

      // ── Assistant Message with Tool Calls → functionCall parts ──────
      if (role === "assistant" && hasToolCalls) {
        const parts = [];
        if (content) {
          parts.push({ text: content });
        }
        for (const tc of msg.tool_calls) {
          if (tc.type === "function") {
            let args;
            try {
              args = typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            } catch {
              args = {};
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
            });
          }
        }

        const last = contents[contents.length - 1];
        if (last && last.role === "model") {
          last.parts.push(...parts);
        } else {
          contents.push({ role: "model", parts });
        }
        continue;
      }

      // ── Regular message ────────────────────────────────────────────
      if (!content) continue;

      const geminiRole = role === "assistant" ? "model" : "user";

      // Merge with previous message if same role (Gemini requirement)
      const last = contents[contents.length - 1];
      if (last && last.role === geminiRole) {
        last.parts.push({ text: content });
      } else {
        contents.push({ role: geminiRole, parts: [{ text: content }] });
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * Convert OpenAI-format tools to Gemini's `tools` array.
   *
   * OpenAI format:
   *   [{ type: "function", function: { name: "...", description: "...", parameters: {...} } }]
   *
   * Gemini format:
   *   [{ functionDeclarations: [{ name: "...", description: "...", parameters: {...} }] }]
   *
   * @param {Array<object>} tools - OpenAI-format tool definitions
   * @returns {Array<object>} Gemini-format tool definitions
   */
  /**
   * Sanitize a JSON Schema to be Gemini API-compliant.
   *
   * Gemini's API is stricter than OpenAI's — it requires:
   *   - `type: "array"` MUST have an `items` field
   *   - DOES NOT support: `additionalProperties`, `patternProperties`,
   *     `anyOf`, `oneOf`, `allOf`, `not`
   *
   * OpenAI allows loose schemas like `{ type: "array", description: "..." }`
   * which Gemini rejects because `items` is missing. This method fixes those.
   */
  _sanitizeSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map((s) => this._sanitizeSchema(s));

    const sanitized = { ...schema };

    // ── Strip keywords NOT supported by Gemini ──
    delete sanitized.additionalProperties;
    delete sanitized.patternProperties;
    delete sanitized.anyOf;
    delete sanitized.oneOf;
    delete sanitized.allOf;
    delete sanitized.not;

    // ── Fix array types: add items if missing ──
    if (sanitized.type === "array" && !sanitized.items) {
      sanitized.items = { type: "string" };
    }

    // ── Fix object types without properties ──
    // Gemini rejects type: "object" without properties, and doesn't support
    // additionalProperties as a workaround. The safest approach is to remove
    // the type constraint entirely so the parameter accepts any value.
    if (sanitized.type === "object" && !sanitized.properties) {
      delete sanitized.type;
    }

    // ── Recursively sanitize nested schemas ──
    if (sanitized.properties) {
      const clean = {};
      for (const [key, val] of Object.entries(sanitized.properties)) {
        clean[key] = this._sanitizeSchema(val);
      }
      sanitized.properties = clean;
    }
    if (sanitized.items) {
      sanitized.items = this._sanitizeSchema(sanitized.items);
    }

    return sanitized;
  }

  _convertTools(tools) {
    if (!tools || tools.length === 0) return undefined;

    const functionDeclarations = [];
    for (const tool of tools) {
      if (tool.type === "function") {
        const rawParams = tool.function.parameters || {};
        functionDeclarations.push({
          name: tool.function.name,
          description: tool.function.description || "",
          parameters: this._sanitizeSchema(rawParams),
        });
      }
    }

    return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
  }

  /**
   * Convert Gemini response back to OpenAI-compatible format.
   * @param {object} geminiResponse - Raw Gemini API response
   * @returns {object} OpenAI-compatible response shape
   */
  _convertResponse(geminiResponse) {
    const candidates = geminiResponse.candidates || [];
    const firstCandidate = candidates[0];
    const parts = firstCandidate?.content?.parts || [];

    // Extract text and function calls from parts
    let content = "";
    const toolCalls = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      }
    }

    const response = {
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
          },
          finish_reason: firstCandidate?.finishReason
            ? this._mapFinishReason(firstCandidate.finishReason)
            : "stop",
        },
      ],
      usage: geminiResponse.usageMetadata
        ? {
            prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
            completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
            total_tokens:
              (geminiResponse.usageMetadata.promptTokenCount || 0) +
              (geminiResponse.usageMetadata.candidatesTokenCount || 0),
          }
        : undefined,
    };

    if (toolCalls.length > 0) {
      response.choices[0].message.tool_calls = toolCalls;
      response.choices[0].finish_reason = "tool_calls";
    }

    return response;
  }

  /**
   * Map Gemini finish reasons to OpenAI finish reasons.
   * @param {string} reason - Gemini finishReason
   * @returns {string} OpenAI-compatible finish_reason
   */
  _mapFinishReason(reason) {
    const map = {
      STOP: "stop",
      MAX_TOKENS: "length",
      SAFETY: "content_filter",
      RECITATION: "content_filter",
      OTHER: "stop",
      FINISH_REASON_UNSPECIFIED: "stop",
    };
    return map[reason] || "stop";
  }

  // ─── Request Body Builder ────────────────────────────────────────────────

  /**
   * Build the request body for Gemini API calls.
   * @param {Array<object>} messages - OpenAI-format messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools] - Tool definitions
   * @param {number} [options.max_tokens] - Max output tokens
   * @param {number} [options.temperature] - Sampling temperature
   * @returns {object} Request body
   */
  _buildRequestBody(messages, options = {}) {
    const { systemInstruction, contents } = this._convertMessages(messages);

    const body = {
      contents,
      ...(systemInstruction && systemInstruction.parts.length > 0
        ? { systemInstruction }
        : {}),
      generationConfig: {
        maxOutputTokens: options.max_tokens || 8192,
        temperature: options.temperature ?? 0.7,
        topP: 0.95,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };

    // Add tools if provided
    const geminiTools = this._convertTools(options.tools);
    if (geminiTools) {
      body.tools = geminiTools;
    }

    return body;
  }

  // ─── API Calls ───────────────────────────────────────────────────────────

  /**
   * Non-streaming chat completion via Gemini REST API.
   *
   * @param {Array<object>} messages - OpenAI-format messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools] - Tool definitions
   * @param {number} [options.max_tokens] - Max output tokens
   * @param {number} [options.temperature] - Sampling temperature
   * @returns {Promise<object>} OpenAI-compatible response shape
   */
  async complete(messages, options = {}) {
    if (!this._apiKey) {
      throw new Error("Gemini API key no configurada. Agrega GEMINI_API_KEY al .env");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const body = this._buildRequestBody(messages, options);

      const url = `${GEMINI_BASE_URL}/${this.model}:generateContent?key=${encodeURIComponent(this._apiKey)}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Gemini API error ${response.status}: ${errorText.substring(0, 200)}`);
      }

      const geminiResponse = await response.json();

      // Check for blocked content
      if (geminiResponse.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked: ${geminiResponse.promptFeedback.blockReason}`);
      }

      return this._convertResponse(geminiResponse);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Streaming chat completion via Gemini REST API.
   *
   * Uses the `streamGenerateContent` endpoint with SSE response format.
   * Parses SSE events line-by-line and yields standardised chunks.
   *
   * Each yielded chunk has the shape:
   *   { content?: string, tool_calls?: Array, finish_reason?: string }
   *
   * @param {Array<object>} messages
   * @param {object} [options]
   * @param {Array<object>} [options.tools] - Tool definitions
   * @param {AbortSignal} [options.signal] - External abort signal
   * @param {number} [options.max_tokens] - Max output tokens
   * @param {number} [options.temperature] - Sampling temperature
   * @returns {AsyncGenerator<object>}
   * @throws {Error} If stream stalls or exceeds total timeout
   */
  async *stream(messages, options = {}) {
    if (!this._apiKey) {
      throw new Error("Gemini API key no configurada. Agrega GEMINI_API_KEY al .env");
    }

    const controller = new AbortController();

    // ── Forward external abort signal ──────────────────────────────────
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason || new Error("External abort"));
      } else {
        options.signal.addEventListener("abort", () => {
          controller.abort(options.signal.reason || new Error("External abort"));
        }, { once: true });
      }
    }

    // ── Timeouts ───────────────────────────────────────────────────────
    const totalTimer = setTimeout(() => {
      controller.abort(new Error(`Gemini stream total timeout (${STREAM_TIMEOUT_MS / 1000}s) exceeded`));
    }, STREAM_TIMEOUT_MS);

    let stallTimer = setTimeout(() => {
      controller.abort(new Error(`Gemini stream stalled — no data for ${STALL_TIMEOUT_MS / 1000}s`));
    }, STALL_TIMEOUT_MS);

    try {
      const body = this._buildRequestBody(messages, options);

      const url = `${GEMINI_BASE_URL}/${this.model}:streamGenerateContent?key=${encodeURIComponent(this._apiKey)}&alt=sse`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        const err = new Error(`Gemini API error ${response.status}: ${errorText.substring(0, 200)}`);
        err.status = response.status;
        throw err;
      }

      // ── Parse SSE stream ─────────────────────────────────────────────
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunkCount++;

        // Reset stall timer on each data chunk
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          controller.abort(new Error(`Gemini stream stalled — no data for ${STALL_TIMEOUT_MS / 1000}s (after ${chunkCount} chunks)`));
        }, STALL_TIMEOUT_MS);

        // Decode and split by lines
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          // SSE lines start with "data: "
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const geminiChunk = JSON.parse(jsonStr);

            // Check for blocked content
            if (geminiChunk.promptFeedback?.blockReason) {
              throw new Error(`Gemini blocked: ${geminiChunk.promptFeedback.blockReason}`);
            }

            const candidate = geminiChunk.candidates?.[0];
            if (!candidate) continue;

            const parts = candidate.content?.parts || [];

            for (const part of parts) {
              if (part.text) {
                yield { content: part.text };
              }
              if (part.functionCall) {
                yield {
                  tool_calls: [{
                    id: `call_${Date.now()}_${chunkCount}`,
                    type: "function",
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {}),
                    },
                  }],
                };
              }
            }

            // Emit finish reason on terminal chunks
            if (candidate.finishReason && candidate.finishReason !== "STOP") {
              yield { finish_reason: this._mapFinishReason(candidate.finishReason) };
            }
          } catch (parseErr) {
            // Skip malformed JSON lines
            if (parseErr.message?.includes("Gemini blocked")) {
              throw parseErr;
            }
          }
        }
      }
    } finally {
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
    }
  }

  /**
   * Lightweight health check — sends a single-token ping.
   * @returns {Promise<{ healthy: boolean, error?: string }>}
   */
  async checkHealth() {
    try {
      await this.complete(
        [{ role: "user", content: "ping" }],
        { max_tokens: 1 }
      );
      return { healthy: true };
    } catch (err) {
      return { healthy: false, error: err.message };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GeminiFlashProvider — backward-compatible alias
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Use GeminiProvider instead. Kept for backward compatibility.
 */
export class GeminiFlashProvider extends GeminiProvider {
  constructor(config = {}) {
    super({
      ...config,
      model: config.model || "gemini-2.5-flash",
      providerName: "gemini-flash",
    });
  }
}

export default GeminiProvider;
