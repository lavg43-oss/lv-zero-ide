/**
 * 🎭 Mock LLM Provider — Canned responses for testing / CI
 *
 * Implements the same provider interface as DeepSeekProvider and
 * OpenAICompatibleProvider, but returns configurable fake responses
 * instead of hitting a real API. No API key required.
 *
 * Two operation modes:
 *   1. **Default mode** — Returns a simple "Hello! How can I help you?" response
 *   2. **Custom mode** — Tests inject responses via `setMockResponse()`
 *
 * Usage:
 *   import { MockProvider } from "./providers/mock.js";
 *   const provider = new MockProvider();
 *   provider.isReady(); // true
 *
 *   // Custom tool-call response:
 *   provider.setMockResponse({
 *     type: "tool_calls",
 *     tool_calls: [{ function: { name: "read_file", arguments: '{"path":"test.txt"}' } }]
 *   });
 *
 *   // Custom error simulation:
 *   provider.setMockResponse({ type: "error", error: new Error("API timeout") });
 */

// ─── Default Mock Responses ──────────────────────────────────────────────────

const DEFAULT_STREAM_CHUNKS = [
  { choices: [{ delta: { content: "Hello! How can I help you today?" }, finish_reason: "stop" }] },
];

const DEFAULT_COMPLETE_RESPONSE = {
  id: "mock-cmpl-0000000000000",
  object: "chat.completion",
  created: Date.now(),
  model: "mock-model",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Hello! How can I help you today?",
      },
      finish_reason: "stop",
    },
  ],
};

export class MockProvider {
  /**
   * @param {object} config
   * @param {string} [config.model="mock-model"]
   */
  constructor(config = {}) {
    this.name = "mock";
    this.model = config.model || "mock-model";

    /** @type {object|null} Custom response injected by test */
    this._customResponse = null;

    /** @type {number} Number of times complete() was called */
    this.completeCallCount = 0;
    /** @type {number} Number of times stream() was called */
    this.streamCallCount = 0;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get label() {
    return `Mock (${this.model})`;
  }

  /**
   * Always ready — no API key needed.
   * @returns {true}
   */
  isReady() {
    return true;
  }

  /**
   * Non-streaming chat completion.
   * Returns a fake OpenAI-compatible response.
   * @param {Array<object>} _messages
   * @param {object} [_options]
   * @returns {Promise<object>}
   */
  async complete(_messages, _options = {}) {
    this.completeCallCount++;

    if (this._customResponse?.type === "error") {
      throw this._customResponse.error;
    }

    if (this._customResponse?.type === "complete") {
      return this._customResponse.response;
    }

    return { ...DEFAULT_COMPLETE_RESPONSE, created: Date.now() };
  }

  /**
   * Streaming chat completion.
   * Yields fake chunks that mimic the DeepSeek streaming format.
   * @param {Array<object>} _messages
   * @param {object} [_options]
   * @returns {AsyncGenerator<object>}
   */
  async *stream(_messages, _options = {}) {
    this.streamCallCount++;

    if (this._customResponse?.type === "error") {
      throw this._customResponse.error;
    }

    // Type "tool_calls" or "complete" — yield custom chunks
    if (this._customResponse?.chunks && this._customResponse.chunks.length > 0) {
      for (const chunk of this._customResponse.chunks) {
        yield {
          content: chunk.content || undefined,
          reasoning_content: chunk.reasoning_content || undefined,
          tool_calls: chunk.tool_calls || undefined,
          finish_reason: chunk.finish_reason || undefined,
        };
      }
      return;
    }

    // Default: yield text response chunks
    for (const chunk of DEFAULT_STREAM_CHUNKS) {
      yield {
        content: chunk.choices[0].delta.content || undefined,
        reasoning_content: chunk.choices[0].delta.reasoning_content || undefined,
        tool_calls: chunk.choices[0].delta.tool_calls || undefined,
        finish_reason: chunk.choices[0].finish_reason || undefined,
      };
    }
  }

  /**
   * Get current model name.
   * @returns {string}
   */
  getModel() {
    return this.model;
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────

  /**
   * Configure a custom response for the next call.
   * Automatically cleared after one use.
   *
   * @param {object} spec
   * @param {string} spec.type - "complete" | "tool_calls" | "error"
   * @param {object} [spec.response] - Full fake response (for type="complete")
   * @param {Array<object>} [spec.chunks] - Array of chunk objects (for type="tool_calls")
   * @param {Error} [spec.error] - Error to throw (for type="error")
   */
  setMockResponse(spec) {
    this._customResponse = { ...spec };
  }

  /**
   * Reset to default behavior and clear call counts.
   */
  reset() {
    this._customResponse = null;
    this.completeCallCount = 0;
    this.streamCallCount = 0;
  }

  /**
   * Convenience: set a simple text response for streaming.
   * @param {string} text - The text the mock should "stream"
   * @param {object} [opts]
   * @param {string} [opts.reasoning] - Optional reasoning_content to include
   */
  setTextResponse(text, opts = {}) {
    this._customResponse = {
      type: "complete",
      response: {
        id: "mock-cmpl-custom",
        object: "chat.completion",
        created: Date.now(),
        model: this.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: text,
              ...(opts.reasoning ? { reasoning_content: opts.reasoning } : {}),
            },
            finish_reason: "stop",
          },
        ],
      },
    };

    // Also set stream chunks for the streaming path
    this._customResponse.chunks = text.split(/(?<=\s)/).map((part, i, arr) => ({
      content: part,
      reasoning_content: i === 0 ? (opts.reasoning || undefined) : undefined,
      finish_reason: i === arr.length - 1 ? "stop" : undefined,
    }));
  }

  /**
   * Convenience: set a tool-call response.
   * @param {Array<object>} toolCalls - Array of tool call objects
   */
  setToolCallResponse(toolCalls) {
    this._customResponse = {
      type: "tool_calls",
      chunks: toolCalls.map((tc, index) => ({
        content: undefined,
        tool_calls: [{ index, ...tc }],
        finish_reason: index === toolCalls.length - 1 ? "tool_calls" : undefined,
      })),
    };
  }

  /**
   * Convenience: simulate an API error.
   * @param {string} message - Error message
   */
  setErrorResponse(message) {
    this._customResponse = {
      type: "error",
      error: new Error(message),
    };
  }
}

export default MockProvider;
