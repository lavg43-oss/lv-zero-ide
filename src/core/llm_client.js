/**
 * LLM Client — Manages multiple LLM providers with fallback and health tracking
 */

import { CircuitBreaker } from "./circuit_breaker.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { GeminiProvider } from "./providers/gemini.js";
import { MockProvider } from "./providers/mock.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";

const PROVIDER_MAP = {
  deepseek: DeepSeekProvider,
  gemini: GeminiProvider,
  "openai-compatible": OpenAICompatibleProvider,
  // NVIDIA provider will be added here
  nvidia: OpenAICompatibleProvider, // Using OpenAI-compatible adapter for NVIDIA
};

export class LLMClient {
  /**
   * @param {object} config
   * @param {import("./orchestrator.js").default} config.emitter
   * @param {string} [config.provider] - Provider name (e.g. "mock" for testing)
   * @param {string} [config.apiKey] - API key for the provider
   * @param {string} [config.model] - Model name override
   * @param {string} [config.baseURL] - Base URL override
   */
  constructor(config = {}) {
    this.emitter = config.emitter;
    this._configProvider = config.provider;
    this._configApiKey = config.apiKey;
    this._configModel = config.model;
    this._providers = new Map();
    this._providerHealth = new Map();
    this._circuitBreakers = new Map();
    this._activeProviderName = null;
    this._currentModel = null;
    this._forcedModel = null; // For manual override via UI
    this.init();
  }

  /** Initialize all configured providers */
  init() {
    // ── Initialize Mock provider (for testing/CI) ──────────────────────────
    // When LLM_PROVIDER=mock is set, register MockProvider which requires
    // no API key and returns pre-configured fake responses.
    if (this._configProvider === "mock") {
      this._initProvider("mock", MockProvider, {
        apiKey: this._configApiKey || "mock-key",
        model: this._configModel || "mock-model",
      });
    }

    // ── Initialize DeepSeek provider (if configured) ────────────────────────
    if (process.env.DEEPSEEK_API_KEY) {
      this._initProvider("deepseek", DeepSeekProvider, {
        apiKey: process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      });
    }

    // ── Initialize OpenAI-compatible provider (if configured) ───────────────
    if (process.env.LLM_API_KEY) {
      this._initProvider("openai-compatible", OpenAICompatibleProvider, {
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL || undefined,
        model: process.env.LLM_MODEL || "gpt-4o",
      });
    }

    // ── Initialize OpenRouter free provider (if configured) ─────────────────
    // Uses OpenAI-compatible adapter. The "free" provider name maps to the
    // "free" tier in _resolveTierToProvider(). Model is set via env var
    // OPENROUTER_MODEL_FREE (default: google/gemma-4-31b-it:free).
    // Secondary model OPENROUTER_MODEL_FREE_SECONDARY (default: openai/gpt-oss-120b:free)
    // is used as fallback if primary fails.
    // This is used for orchestrator and ask modes (simple/coordination tasks).
    if (process.env.OPENROUTER_API_KEY) {
      this._initProvider("free", OpenAICompatibleProvider, {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        model: process.env.OPENROUTER_MODEL_FREE || "google/gemma-4-31b-it:free",
      });
    }

    // ── Initialize Gemini Flash provider (if configured) ────────────────────
    if (process.env.GEMINI_API_KEY) {
      const geminiFlash = new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp",
      });
      this._initProvider("gemini-flash", GeminiProvider, {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_FLASH_MODEL || "gemini-2.0-flash-exp",
      });
    }

    // ── Initialize Gemini Pro provider (if configured) ──────────────────────
    if (process.env.GEMINI_API_KEY) {
      const geminiPro = new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_PRO_MODEL || "gemini-2.0-pro-exp-02-05",
      });
      this._initProvider("gemini-pro", GeminiProvider, {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_PRO_MODEL || "gemini-2.0-pro-exp-02-05",
      });
    }

    // ── Initialize NVIDIA provider (if configured) ─────────────────────────
    if (process.env.NVIDIA_API_KEY) {
      this._initProvider("nvidia", OpenAICompatibleProvider, {
        apiKey: process.env.NVIDIA_API_KEY,
        baseURL: "https://integrate.api.nvidia.com/v1",
        model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b",
      });
    }

    // Set initial active provider to the first healthy one
    for (const [name, health] of this._providerHealth) {
      if (health.isHealthy) {
        this.switchProvider(name);
        break;
      }
    }
  }

  /** Initialize a single provider and wrap it in a circuit breaker */
  _initProvider(name, ProviderClass, config) {
    const rawProvider = new ProviderClass(config);
    const cb = new CircuitBreaker(rawProvider, {
      failureThreshold: 5,
      timeout: 30000, // 30s
      resetTimeout: 60000, // 60s
    });
    this._providers.set(name, cb);
    this._providerHealth.set(name, { isHealthy: true, failureCount: 0, lastError: null });
    this._circuitBreakers.set(name, cb);
  }

  /**
   * Subscribe to circuit breaker state changes across all providers.
   * The callback receives (eventName, data) where eventName is one of:
   *   "circuit_open", "circuit_half_open", "circuit_closed"
   * @param {function} cb
   */
  connectCircuitBreakerEvents(cb) {
    for (const [name, circuitBreaker] of this._circuitBreakers) {
      circuitBreaker.setEmitter((eventName, data) => {
        cb(eventName, { ...data, provider: name });
      });
    }
  }

  /** Switch active provider by name */
  switchProvider(providerName) {
    if (!this._providers.has(providerName)) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    const provider = this._providers.get(providerName);
    if (!this._isProviderHealthy(providerName)) {
      throw new Error(`Provider ${providerName} is unhealthy`);
    }
    // If the circuit breaker has an emitter attached, notify it about the switch
    const cb = this._circuitBreakers.get(providerName);
    if (cb && cb.getState) {
      const state = cb.getState();
      if (state === "CLOSED") {
        // Circuit is healthy — nothing special to emit
      }
    }
    this._activeProviderName = providerName;
    this._currentModel = provider.getModel();
    this.emitter.emit("provider:switched", { provider: providerName, model: this._currentModel });
    return providerName;
  }

  /** Get the current active provider */
  getActiveProvider() {
    return this._providers.get(this._activeProviderName);
  }

  /** Get the current active model name */
  getCurrentModel() {
    return this._currentModel;
  }

  /** Set a forced model override (via UI) */
  setModel(modelName) {
    this._forcedModel = modelName;
    // 1. Try exact match — switch to provider whose model matches exactly
    for (const [name, provider] of this._providers) {
      if (this._isProviderHealthy(name) && provider.getModel() === modelName) {
        this.switchProvider(name);
        return;
      }
    }
    // 2. Try partial match — e.g., "gemini" in "gemini-2.0-flash"
    for (const [name, provider] of this._providers) {
      if (this._isProviderHealthy(name) && provider.getModel().includes(modelName)) {
        this.switchProvider(name);
        return;
      }
    }
    // 3. Fallback: try ALL providers to find one whose raw provider supports
    //    setModel() for this model name. This handles the case where a
    //    provider (e.g., DeepSeek) supports multiple models (deepseek-v4-flash,
    //    deepseek-v4-pro) but was initialized with only one of them.
    //
    //    NOTE: this._providers stores CircuitBreaker wrappers, not raw providers.
    //    CircuitBreaker does NOT have setModel(), so we must unwrap via
    //    cb.getWrappedProvider() to reach the raw provider's setModel().
    for (const [name, cb] of this._circuitBreakers) {
      const provider = cb.getWrappedProvider();
      if (provider && typeof provider.setModel === "function") {
        try {
          provider.setModel(modelName);
          // Switch to this provider
          this._activeProviderName = name;
          this._currentModel = modelName;
          this._forcedModel = modelName;
          this.emitter.emit("provider:switched", { provider: name, model: modelName });
          return;
        } catch (_err) {
          // This provider's setModel() rejected the model (e.g., wrong format).
          // Continue to try the next provider in the loop.
          continue;
        }
      }
    }
    throw new Error(`No healthy provider found for model: ${modelName}`);
  }

  /** Check if the LLM client is ready (at least one healthy provider) */
  isReady() {
    for (const [name, health] of this._providerHealth) {
      if (health.isHealthy) return true;
    }
    return false;
  }

  /** Get name of the currently active provider */
  getProviderName() {
    return this._activeProviderName;
  }

  /**
   * Get health status for all registered providers.
   * Returns an object mapping provider names to { healthy, degraded, failureCount, lastError }.
   */
  getProviderHealth() {
    const health = {};
    for (const [name, h] of this._providerHealth) {
      const cb = this._circuitBreakers.get(name);
      const circuitState = cb ? cb.getState() : "CLOSED";
      health[name] = {
        healthy: h.isHealthy,
        degraded: !h.isHealthy || h.failureCount >= 3 || circuitState === "OPEN",
        failureCount: h.failureCount,
        consecutiveFailures: h.failureCount,
        lastError: h.lastError ? (h.lastError.message || String(h.lastError)) : null,
        circuitState,
      };
    }
    return health;
  }

  /** Get label of the active provider */
  getLabel() {
    const provider = this.getActiveProvider();
    return provider ? provider.label : "No active provider";
  }

  /** Non-streaming completion */
  async complete(messages, options = {}) {
    // Safety net: ensure active provider matches current model if forced
    if (this._forcedModel) {
      const modelImpliesGemini = this._forcedModel.includes("gemini");
      const isGeminiProvider =
        this._activeProviderName === "gemini-flash" || this._activeProviderName === "gemini-pro";
      if (modelImpliesGemini && !isGeminiProvider) {
        // Switch to Gemini provider
        try {
          this.switchProvider("gemini-flash");
        } catch (e) {
          try {
            this.switchProvider("gemini-pro");
          } catch (e2) {
            // If both fail, continue with current provider
          }
        }
      }
    }

    const provider = this.getActiveProvider();
    if (!provider) throw new Error("No active provider");
    try {
      const result = await provider.complete(messages, options);
      this._recordProviderSuccess(this._activeProviderName);
      return result;
    } catch (error) {
      this._recordProviderFailure(this._activeProviderName, error);
      throw error;
    }
  }

  /** Streaming completion */
  async *stream(messages, options = {}) {
    // Safety net: ensure active provider matches current model if forced
    if (this._forcedModel) {
      const modelImpliesGemini = this._forcedModel.includes("gemini");
      const isGeminiProvider =
        this._activeProviderName === "gemini-flash" || this._activeProviderName === "gemini-pro";
      if (modelImpliesGemini && !isGeminiProvider) {
        // Switch to Gemini provider
        try {
          this.switchProvider("gemini-flash");
        } catch (e) {
          try {
            this.switchProvider("gemini-pro");
          } catch (e2) {
            // If both fail, continue with current provider
          }
        }
      }
    }

    const provider = this.getActiveProvider();
    if (!provider) throw new Error("No active provider");
    try {
      const stream = provider.stream(messages, options);
      for await (const chunk of stream) {
        yield chunk;
      }
      this._recordProviderSuccess(this._activeProviderName);
    } catch (error) {
      this._recordProviderFailure(this._activeProviderName, error);
      throw error;
    }
  }

  /** Get raw provider instance by name (for testing) */
  getRawProvider(providerName) {
    // Default to the active provider when called without arguments
    const name = providerName || this._activeProviderName;
    if (!name) throw new Error("No active provider");
    const cb = this._providers.get(name);
    if (!cb) throw new Error(`Unknown provider: ${name}`);
    // Access the wrapped provider via CircuitBreaker's public API
    return cb.getWrappedProvider();
  }

  /** Check if circuit breaker allows request */
  isCircuitAllowed() {
    const cb = this._circuitBreakers.get(this._activeProviderName);
    return cb ? cb.isAllowed() : true;
  }

  /** Get circuit breaker stats */
  getCircuitBreakerStats() {
    const stats = {};
    for (const [name, cb] of this._circuitBreakers) {
      stats[name] = cb.getStats();
    }
    return stats;
  }

  /** Reset circuit breaker for a provider */
  resetCircuitBreaker(providerName) {
    const cb = this._circuitBreakers.get(providerName);
    if (cb) cb.reset();
  }

  /** Get all circuit breaker stats */
  getAllCircuitBreakerStats() {
    return this.getCircuitBreakerStats();
  }

  /** Record provider success and reset failure count */
  _recordProviderSuccess(providerName) {
    const health = this._providerHealth.get(providerName);
    if (health) {
      health.failureCount = 0;
      health.lastError = null;
      if (!health.isHealthy) {
        health.isHealthy = true;
        this.emitter.emit("provider:recovered", { provider: providerName });
      }
    }
  }

  /** Record provider failure and update health */
  _recordProviderFailure(providerName, error) {
    const health = this._providerHealth.get(providerName);
    if (health) {
      health.failureCount++;
      health.lastError = error;
      if (health.failureCount >= 5) {
        health.isHealthy = false;
        this.emitter.emit("provider:failed", { provider: providerName, error });
      }
    }
  }

  /** Check if provider is healthy */
  _isProviderHealthy(providerName) {
    const health = this._providerHealth.get(providerName);
    return health ? health.isHealthy : false;
  }

  /** Reset provider health (for recovery) */
  resetProviderHealth(providerName) {
    const health = this._providerHealth.get(providerName);
    if (health) {
      health.isHealthy = true;
      health.failureCount = 0;
      health.lastError = null;
      this.emitter.emit("provider:reset", { provider: providerName });
    }
  }
}
