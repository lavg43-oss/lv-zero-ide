/**
 * ─── Provider Registry for lv-zero ───────────────────────────────────────
 *
 * Central catalog of all known LLM providers.
 * Each entry contains the provider's metadata, default configuration,
 * and supported models.
 *
 * Users can configure any provider from the UI without editing .env files.
 * API keys are stored securely via SecretStorage.
 *
 * v1.0 — June 2026
 *
 * @module provider_registry
 */

/**
 * @typedef {object} ProviderEntry
 * @property {string} id - Unique provider ID
 * @property {string} name - Human-readable name
 * @property {"openai-compatible"|"anthropic"|"gemini"|"deepseek"} type - Provider type/adapter
 * @property {string} baseURL - Default API base URL
 * @property {string[]} models - Known model names
 * @property {string} website - Where to get an API key
 * @property {string} [docs] - API documentation URL
 * @property {string} defaultModel - Default model to use
 * @property {string} envKey - Environment variable name for the API key
 * @property {boolean} supportsStreaming - Whether streaming is supported
 * @property {boolean} supportsReasoning - Whether reasoning_content is supported
 * @property {string} [notes] - Additional notes for the user
 */

/** @type {ProviderEntry[]} */
export const PROVIDER_REGISTRY = [
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    models: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
    website: "https://platform.deepseek.com/api_keys",
    docs: "https://api-docs.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    envKey: "DEEPSEEK_API_KEY",
    supportsStreaming: true,
    supportsReasoning: true,
    notes: "Modelo principal de lv-zero. Soporta razonamiento profundo (reasoning_content).",
  },
  {
    id: "glm",
    name: "GLM (Zhipu AI)",
    type: "openai-compatible",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      "glm-5.2",
      "glm-5.2-ultra",
      "glm-5.1",
      "glm-4-plus",
      "glm-4v-plus",
    ],
    website: "https://bigmodel.cn",
    docs: "https://open.bigmodel.cn/dev/api",
    defaultModel: "glm-5.2",
    envKey: "GLM_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "GLM 5.2 es el modelo más reciente de Zhipu AI. API compatible con OpenAI.",
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o3",
      "o3-mini",
      "o4-mini",
    ],
    website: "https://platform.openai.com/api-keys",
    docs: "https://platform.openai.com/docs",
    defaultModel: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "Modelos GPT-4o y o3 de OpenAI.",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    type: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    models: [
      "claude-4-opus",
      "claude-4-sonnet",
      "claude-3.5-haiku",
      "claude-3-opus",
    ],
    website: "https://console.anthropic.com",
    docs: "https://docs.anthropic.com",
    defaultModel: "claude-4-sonnet",
    envKey: "ANTHROPIC_API_KEY",
    supportsStreaming: true,
    supportsReasoning: true,
    notes: "Claude 4 Opus es el modelo más potente de Anthropic.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    type: "gemini",
    baseURL: "https://generativelanguage.googleapis.com",
    models: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
    ],
    website: "https://aistudio.google.com/apikey",
    docs: "https://ai.google.dev/docs",
    defaultModel: "gemini-2.5-flash",
    envKey: "GEMINI_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "Gemini 2.5 Flash es rápido y gratuito. Pro es más potente.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "openai/o3-mini",
      "anthropic/claude-4-sonnet",
      "anthropic/claude-3.5-haiku",
      "google/gemini-2.5-flash",
      "meta-llama/llama-4-70b",
      "deepseek/deepseek-v4-flash",
      "mistralai/mistral-large",
      "qwen/qwen-3-72b",
    ],
    website: "https://openrouter.ai/keys",
    docs: "https://openrouter.ai/docs",
    defaultModel: "openai/gpt-4o",
    envKey: "OPENROUTER_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "OpenRouter da acceso a 300+ modelos con una sola API Key. Incluye modelos gratuitos.",
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba Cloud)",
    type: "openai-compatible",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: [
      "qwen-3-72b",
      "qwen-3-32b",
      "qwen-3-14b",
      "qwen-3-7b",
      "qwen-max",
      "qwen-plus",
      "qwen-turbo",
    ],
    website: "https://bailian.console.aliyun.com",
    docs: "https://help.aliyun.com/document_detail/2712195.html",
    defaultModel: "qwen-3-72b",
    envKey: "QWEN_API_KEY",
    supportsStreaming: true,
    supportsReasoning: true,
    notes: "Qwen 3 es la familia de modelos más potente de Alibaba. Soporta razonamiento.",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    type: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    models: [
      "grok-3",
      "grok-3-mini",
      "grok-3-vision",
    ],
    website: "https://console.x.ai",
    docs: "https://docs.x.ai",
    defaultModel: "grok-3",
    envKey: "XAI_API_KEY",
    supportsStreaming: true,
    supportsReasoning: true,
    notes: "Grok 3 de xAI (Elon Musk). Modelo con razonamiento profundo.",
  },
  {
    id: "groq",
    name: "Groq",
    type: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    models: [
      "llama-4-70b",
      "llama-4-8b",
      "mixtral-8x7b",
      "gemma-4-31b",
      "gemma-4-9b",
    ],
    website: "https://console.groq.com/keys",
    docs: "https://console.groq.com/docs",
    defaultModel: "llama-4-70b",
    envKey: "GROQ_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "Groq ofrece inferencia ultrarrápida con LPU. Modelos open-source.",
  },
  {
    id: "together",
    name: "Together AI",
    type: "openai-compatible",
    baseURL: "https://api.together.xyz/v1",
    models: [
      "meta-llama/llama-4-70b",
      "deepseek-ai/deepseek-v3",
      "mistralai/mistral-large",
      "Qwen/Qwen3-72B",
    ],
    website: "https://together.ai/api-keys",
    docs: "https://docs.together.ai",
    defaultModel: "meta-llama/llama-4-70b",
    envKey: "TOGETHER_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "Together AI ofrece modelos open-source en la nube.",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    type: "openai-compatible",
    baseURL: "https://integrate.api.nvidia.com/v1",
    models: [
      "nvidia/nemotron-3-super-120b",
      "meta/llama-4-70b",
      "mistralai/mistral-large",
    ],
    website: "https://build.nvidia.com",
    docs: "https://build.nvidia.com/docs",
    defaultModel: "nvidia/nemotron-3-super-120b",
    envKey: "NVIDIA_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "NVIDIA NIM ofrece modelos optimizados para GPUs NVIDIA.",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    type: "openai-compatible",
    baseURL: "https://api.fireworks.ai/inference/v1",
    models: [
      "accounts/fireworks/models/llama-v4-70b",
      "accounts/fireworks/models/qwen3-72b",
      "accounts/fireworks/models/mixtral-8x7b",
    ],
    website: "https://fireworks.ai/api-keys",
    docs: "https://docs.fireworks.ai",
    defaultModel: "accounts/fireworks/models/llama-v4-70b",
    envKey: "FIREWORKS_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "Fireworks AI ofrece inferencia rápida de modelos open-source.",
  },
  {
    id: "custom",
    name: "Custom URL",
    type: "openai-compatible",
    baseURL: "",
    models: [],
    website: "",
    docs: "",
    defaultModel: "",
    envKey: "CUSTOM_API_KEY",
    supportsStreaming: true,
    supportsReasoning: false,
    notes: "Para cualquier API compatible con OpenAI (Ollama, LM Studio, vLLM, etc.).",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Registry Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gets all providers in the registry.
 * @returns {ProviderEntry[]}
 */
export function getAllProviders() {
  return PROVIDER_REGISTRY;
}

/**
 * Gets a provider by ID.
 * @param {string} id
 * @returns {ProviderEntry|null}
 */
export function getProviderById(id) {
  return PROVIDER_REGISTRY.find((p) => p.id === id) || null;
}

/**
 * Gets all provider IDs.
 * @returns {string[]}
 */
export function getAllProviderIds() {
  return PROVIDER_REGISTRY.map((p) => p.id);
}

/**
 * Gets providers by type.
 * @param {string} type
 * @returns {ProviderEntry[]}
 */
export function getProvidersByType(type) {
  return PROVIDER_REGISTRY.filter((p) => p.type === type);
}

/**
 * Checks if a provider has been configured (has API key in env or storage).
 * @param {string} providerId
 * @returns {boolean}
 */
export function isProviderConfigured(providerId) {
  const provider = getProviderById(providerId);
  if (!provider) return false;
  return !!process.env[provider.envKey];
}
