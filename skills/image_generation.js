/**
 * image_generation — Advanced Image Generation Skill (Phase 7)
 *
 * Multi-provider image generation supporting OpenAI DALL-E, Replicate,
 * and local Stable Diffusion via MCP. Provider auto-detection tries
 * providers in order: local → OpenAI → Replicate.
 *
 * API keys are retrieved from SecretStorage (Phase 0.1) or fall back
 * to environment variables for backward compatibility.
 *
 * Generated images are saved locally with timestamp-based filenames
 * and both the remote URL and local path are returned.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

// ─── Directory Setup ─────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SAVE_DIR = path.join(PROJECT_ROOT, "generated-images");

// ─── Supported Sizes ─────────────────────────────────────────────────────────

const VALID_SIZES = [
  "256x256",
  "512x512",
  "1024x1024",
  "1792x1024",
  "1024x1792",
];

// ─── Provider Configuration ──────────────────────────────────────────────────

const PROVIDERS = {
  local: {
    name: "Local (MCP)",
    priority: 1,
    enabled: () => {
      // Check if a local MCP image gen server is available
      // via the global MCP config manager
      try {
        const mgr = global.__mcpConfigManager;
        if (!mgr) return false;
        const config = mgr.readConfig();
        return config.some(
          (s) =>
            s.name?.toLowerCase().includes("image") ||
            s.name?.toLowerCase().includes("stable-diffusion") ||
            s.name?.toLowerCase().includes("sd")
        );
      } catch {
        return false;
      }
    },
  },
  openai: {
    name: "OpenAI DALL-E",
    priority: 2,
    enabled: async () => {
      // Check via SecretStorage first, then env var
      try {
        const { SecretStorage } = await import(
          `file://${path.resolve(PROJECT_ROOT, "src", "secret_storage.js").replace(/\\/g, "/")}?t=${Date.now()}`
        );
        const storage = new SecretStorage(
          path.join(PROJECT_ROOT, ".lv-zero", "secrets.db")
        );
        const result = await storage.getKey("openai");
        if (result.success) return true;
      } catch {
        // Fallback to env var
      }
      return !!(
        process.env.OPENAI_API_KEY ||
        process.env.OPENAI_KEY
      );
    },
  },
  replicate: {
    name: "Replicate",
    priority: 3,
    enabled: async () => {
      // Check via SecretStorage first, then env var
      try {
        const { SecretStorage } = await import(
          `file://${path.resolve(PROJECT_ROOT, "src", "secret_storage.js").replace(/\\/g, "/")}?t=${Date.now()}`
        );
        const storage = new SecretStorage(
          path.join(PROJECT_ROOT, ".lv-zero", "secrets.db")
        );
        const result = await storage.getKey("replicate");
        if (result.success) return true;
      } catch {
        // Fallback to env var
      }
      return !!(
        process.env.REPLICATE_API_TOKEN ||
        process.env.REPLICATE_API_KEY
      );
    },
  },
};

// ─── API Key Retrieval ───────────────────────────────────────────────────────

/**
 * Retrieve an API key for a given service.
 * Tries SecretStorage first, then falls back to environment variables.
 *
 * @param {string} service - Service name (e.g., "openai", "replicate")
 * @param {string[]} envVars - Environment variable names to check as fallback
 * @returns {Promise<string|null>} The API key or null if not found
 */
async function getApiKey(service, envVars) {
  try {
    const { SecretStorage } = await import(
      `file://${path.resolve(PROJECT_ROOT, "src", "secret_storage.js").replace(/\\/g, "/")}?t=${Date.now()}`
    );
    const storage = new SecretStorage(
      path.join(PROJECT_ROOT, ".lv-zero", "secrets.db")
    );
    const result = await storage.getKey(service);
    if (result.success && result.key) {
      return result.key;
    }
  } catch {
    // Fallback to env vars
  }

  for (const envVar of envVars) {
    if (process.env[envVar]) {
      return process.env[envVar];
    }
  }

  return null;
}

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

/**
 * Generate images using OpenAI DALL-E 3 / DALL-E 2.
 *
 * @param {string} prompt - Text description of the image
 * @param {string} size - Image size (e.g., "1024x1024")
 * @param {number} count - Number of images (1-4)
 * @returns {Promise<{urls: string[], provider: string}>}
 */
async function generateWithOpenAI(prompt, size, count) {
  const apiKey = await getApiKey("openai", [
    "OPENAI_API_KEY",
    "OPENAI_KEY",
  ]);

  if (!apiKey) {
    throw new Error(
      "OpenAI API key not found. Configure via SecretStorage or set OPENAI_API_KEY in .env"
    );
  }

  // Dynamically import the OpenAI SDK
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey });

  // DALL-E 3 only supports n=1, so for count > 1 we make multiple calls
  if (count > 1) {
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(
        openai.images.generate({
          model: "dall-e-3",
          prompt,
          n: 1,
          size,
        })
      );
    }
    const responses = await Promise.all(promises);
    const urls = responses.flatMap((r) =>
      r.data.map((img) => img.url)
    );
    return { urls, provider: "openai" };
  }

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: count,
    size,
  });

  const urls = response.data.map((img) => img.url);
  return { urls, provider: "openai" };
}

// ─── Replicate Provider ──────────────────────────────────────────────────────

/**
 * Generate images using Replicate's Stable Diffusion models.
 *
 * Uses the Replicate API directly via fetch. Default model is
 * stability-ai/stable-diffusion-3.5-large.
 *
 * @param {string} prompt - Text description of the image
 * @param {number} count - Number of images (1-4)
 * @returns {Promise<{urls: string[], provider: string}>}
 */
async function generateWithReplicate(prompt, count) {
  const apiToken = await getApiKey("replicate", [
    "REPLICATE_API_TOKEN",
    "REPLICATE_API_KEY",
  ]);

  if (!apiToken) {
    throw new Error(
      "Replicate API token not found. Configure via SecretStorage or set REPLICATE_API_TOKEN in .env"
    );
  }

  const model =
    process.env.REPLICATE_MODEL ||
    "stability-ai/stable-diffusion-3.5-large";

  const urls = [];

  for (let i = 0; i < count; i++) {
    // Start a prediction
    const createResponse = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
        },
        body: JSON.stringify({
          version: model.includes(":")
            ? model
            : `${model}:latest`,
          input: {
            prompt,
            num_outputs: 1,
            aspect_ratio: "1:1",
            output_format: "png",
          },
        }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(
        `Replicate API error (${createResponse.status}): ${errorText}`
      );
    }

    const prediction = await createResponse.json();

    // If the prediction completed synchronously, grab the output
    if (
      prediction.status === "succeeded" &&
      prediction.output
    ) {
      const outputUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      if (outputUrl) urls.push(outputUrl);
    } else if (prediction.status === "processing" || prediction.status === "starting") {
      // Poll for completion
      const pollUrl = prediction.urls?.get;
      if (pollUrl) {
        const result = await pollPrediction(pollUrl, apiToken);
        if (result) urls.push(result);
      }
    }
  }

  if (urls.length === 0) {
    throw new Error("Replicate returned no image URLs");
  }

  return { urls, provider: "replicate" };
}

/**
 * Poll a Replicate prediction until it completes.
 *
 * @param {string} pollUrl - URL to poll for prediction status
 * @param {string} apiToken - Replicate API token
 * @returns {Promise<string|null>} The output image URL or null
 */
async function pollPrediction(pollUrl, apiToken) {
  const maxAttempts = 30;
  const delayMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const response = await fetch(pollUrl, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      console.warn(
        `   ↳ [Replicate] Poll attempt ${attempt + 1} failed: ${response.status}`
      );
      continue;
    }

    const prediction = await response.json();

    if (prediction.status === "succeeded") {
      const outputUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      return outputUrl || null;
    }

    if (
      prediction.status === "failed" ||
      prediction.status === "canceled"
    ) {
      throw new Error(
        `Replicate prediction ${prediction.status}: ${prediction.error || "Unknown error"}`
      );
    }
  }

  throw new Error(
    "Replicate prediction timed out after 60 seconds"
  );
}

// ─── Local Provider (MCP) ────────────────────────────────────────────────────

/**
 * Generate images using a local MCP image generation server.
 *
 * Looks for an MCP server with "image" or "stable-diffusion" in its name
 * and calls its image generation tool.
 *
 * @param {string} prompt - Text description of the image
 * @returns {Promise<{urls: string[], provider: string}>}
 */
async function generateWithLocal(prompt) {
  const mgr = global.__mcpConfigManager;

  if (!mgr) {
    throw new Error("MCP Config Manager not available");
  }

  // Find an image-capable MCP server
  const config = mgr.readConfig();
  const imageServer = config.find(
    (s) =>
      s.name?.toLowerCase().includes("image") ||
      s.name?.toLowerCase().includes("stable-diffusion") ||
      s.name?.toLowerCase().includes("sd")
  );

  if (!imageServer) {
    throw new Error(
      "No local MCP image generation server found in configuration"
    );
  }

  // Try to call the MCP server's image generation tool
  // The tool name varies by server; try common names
  const toolNames = [
    "generate_image",
    "text_to_image",
    "txt2img",
    "image_gen",
    "generate",
  ];

  let lastError = null;

  for (const toolName of toolNames) {
    try {
      const result = await mgr.callTool(imageServer.name, toolName, {
        prompt,
        // Additional parameters that various servers might accept
        negative_prompt: "",
        width: 1024,
        height: 1024,
        num_inference_steps: 20,
        guidance_scale: 7.5,
      });

      if (result) {
        // Parse the result — could be a URL, base64 image, or file path
        const urls = extractImageUrls(result, imageServer.name);
        if (urls.length > 0) {
          return { urls, provider: "local" };
        }
      }
    } catch (err) {
      lastError = err.message;
      console.warn(
        `   ↳ [Local MCP] Tool "${toolName}" failed: ${err.message}`
      );
    }
  }

  throw new Error(
    `Local MCP image generation failed. Tried tools: ${toolNames.join(", ")}. Last error: ${lastError}`
  );
}

/**
 * Extract image URLs from an MCP tool result.
 *
 * Handles various return formats:
 * - Direct URL string
 * - Array of URLs
 * - Object with `url`, `image`, `data`, or `output` properties
 * - Base64-encoded image data
 *
 * @param {*} result - The raw result from the MCP tool call
 * @param {string} serverName - Name of the MCP server (for logging)
 * @returns {string[]} Array of image URLs or data URIs
 */
function extractImageUrls(result, serverName) {
  const urls = [];

  if (!result) return urls;

  // If result is a string, it might be a URL or base64 data
  if (typeof result === "string") {
    if (
      result.startsWith("http://") ||
      result.startsWith("https://") ||
      result.startsWith("data:image")
    ) {
      urls.push(result);
    }
    return urls;
  }

  // If result is an array, check each element
  if (Array.isArray(result)) {
    for (const item of result) {
      if (typeof item === "string") {
        if (
          item.startsWith("http://") ||
          item.startsWith("https://") ||
          item.startsWith("data:image")
        ) {
          urls.push(item);
        }
      } else if (item && typeof item === "object") {
        const extracted = extractFromObject(item);
        if (extracted) urls.push(extracted);
      }
    }
    return urls;
  }

  // If result is an object, look for common properties
  if (typeof result === "object") {
    const extracted = extractFromObject(result);
    if (extracted) urls.push(extracted);

    // Also check for nested content
    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (typeof item === "string") {
          if (
            item.startsWith("http://") ||
            item.startsWith("https://") ||
            item.startsWith("data:image")
          ) {
            urls.push(item);
          }
        } else if (item?.url) {
          urls.push(item.url);
        } else if (item?.data) {
          urls.push(item.data);
        } else if (item?.image) {
          urls.push(item.image);
        }
      }
    }
  }

  console.log(
    `   ↳ [Local MCP] Extracted ${urls.length} image URL(s) from ${serverName}`
  );

  return urls;
}

/**
 * Extract an image URL from an object by checking common property names.
 *
 * @param {object} obj - The object to extract from
 * @returns {string|null} The extracted URL or null
 */
function extractFromObject(obj) {
  for (const key of ["url", "image", "data", "output", "result", "src"]) {
    const val = obj[key];
    if (typeof val === "string") {
      if (
        val.startsWith("http://") ||
        val.startsWith("https://") ||
        val.startsWith("data:image")
      ) {
        return val;
      }
    }
  }
  return null;
}

// ─── Image Saving ────────────────────────────────────────────────────────────

/**
 * Download an image from a URL and save it to the local filesystem.
 *
 * Supports both HTTP(S) URLs and data URIs.
 *
 * @param {string} imageUrl - URL or data URI of the image
 * @param {string} saveDir - Directory to save the image in
 * @param {number} index - Index number for the filename
 * @returns {Promise<string>} Local file path of the saved image
 */
async function downloadAndSaveImage(imageUrl, saveDir, index) {
  // Ensure save directory exists
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  // Generate a unique filename
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  const ext = imageUrl.startsWith("data:image")
    ? extractMimeType(imageUrl)
    : path.extname(new URL(imageUrl).pathname) || ".png";
  const filename = `lvzero_${timestamp}_${index}_${random}${ext}`;
  const filePath = path.join(saveDir, filename);

  if (imageUrl.startsWith("data:")) {
    // Handle data URI
    const matches = imageUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("Invalid data URI format");
    }
    const buffer = Buffer.from(matches[2], "base64");
    fs.writeFileSync(filePath, buffer);
    console.log(`   ↳ [ImageGen] Saved data URI image to ${filePath}`);
  } else {
    // Download from URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download image (${response.status}): ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
    console.log(`   ↳ [ImageGen] Downloaded image to ${filePath}`);
  }

  return filePath;
}

/**
 * Extract the file extension from a data URI MIME type.
 *
 * @param {string} dataUri - The data URI
 * @returns {string} File extension including the dot
 */
function extractMimeType(dataUri) {
  const match = dataUri.match(/^data:image\/([a-zA-Z]+);/);
  if (!match) return ".png";
  const mime = match[1].toLowerCase();
  const extMap = {
    png: ".png",
    jpeg: ".jpg",
    jpg: ".jpg",
    gif: ".gif",
    webp: ".webp",
    bmp: ".bmp",
    svg: ".svg+xml",
  };
  return extMap[mime] || ".png";
}

// ─── Provider Detection ──────────────────────────────────────────────────────

/**
 * Detect which providers are available.
 *
 * Tries providers in priority order: local → OpenAI → Replicate.
 * Returns an array of available provider IDs.
 *
 * @returns {Promise<string[]>} Array of available provider IDs
 */
async function detectAvailableProviders() {
  const available = [];

  // Local MCP — synchronous check
  if (PROVIDERS.local.enabled()) {
    available.push("local");
  }

  // OpenAI — async check
  try {
    const openaiEnabled = await PROVIDERS.openai.enabled();
    if (openaiEnabled) available.push("openai");
  } catch {
    // Not available
  }

  // Replicate — async check
  try {
    const replicateEnabled = await PROVIDERS.replicate.enabled();
    if (replicateEnabled) available.push("replicate");
  } catch {
    // Not available
  }

  return available;
}

// ─── Skill Definition ────────────────────────────────────────────────────────

export default {
  name: "image_generation",
  description:
    "Generate images using AI models. Supports multiple backends: " +
    "OpenAI DALL-E, Replicate (Stable Diffusion), and local Stable Diffusion " +
    "via MCP. Provider auto-detection tries in order: local → OpenAI → Replicate. " +
    "Images are saved locally and both the remote URL and local path are returned. " +
    "API keys are retrieved from SecretStorage (Phase 0.1) or environment variables.",

  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Text description of the image to generate. Be as detailed as possible " +
          "for best results. Include style, lighting, composition, and mood.",
      },
      size: {
        type: "string",
        enum: VALID_SIZES,
        description:
          "Image size (default: 1024x1024). Supported: 256x256, 512x512, " +
          "1024x1024, 1792x1024, 1024x1792.",
      },
      count: {
        type: "number",
        description:
          "Number of images to generate (default: 1, max: 4). " +
          "Note: DALL-E 3 generates images sequentially when count > 1.",
        minimum: 1,
        maximum: 4,
      },
      provider: {
        type: "string",
        enum: ["auto", "openai", "replicate", "local"],
        description:
          "Provider to use. 'auto' (default) tries available providers " +
          "in order: local MCP → OpenAI DALL-E → Replicate Stable Diffusion.",
      },
      saveTo: {
        type: "string",
        description:
          "Directory to save the generated images (default: ./generated-images/). " +
          "Can be absolute or relative to the project root.",
      },
    },
    required: ["prompt"],
  },

  handler: async ({
    prompt,
    size = "1024x1024",
    count = 1,
    provider = "auto",
    saveTo,
  }) => {
    const imageCount = Math.min(Math.max(1, count), 4);
    const imageSize = VALID_SIZES.includes(size) ? size : "1024x1024";
    const saveDir = saveTo
      ? path.resolve(PROJECT_ROOT, saveTo)
      : DEFAULT_SAVE_DIR;

    console.log(
      `   ↳ [ImageGen] Generating ${imageCount} image(s) at ${imageSize} using provider: ${provider}`
    );
    console.log(`   ↳ [ImageGen] Prompt: "${prompt.substring(0, 100)}..."`);

    // ── Determine which provider(s) to try ──
    let providersToTry;

    if (provider === "auto") {
      const available = await detectAvailableProviders();
      if (available.length === 0) {
        return {
          success: false,
          error:
            "No image generation providers available. " +
            "Configure at least one: OpenAI (OPENAI_API_KEY), " +
            "Replicate (REPLICATE_API_TOKEN), or a local MCP image server.",
          images: [],
          provider: null,
          prompt,
        };
      }
      providersToTry = available;
      console.log(
        `   ↳ [ImageGen] Auto-detected providers: ${providersToTry.join(", ")}`
      );
    } else {
      providersToTry = [provider];
    }

    // ── Try providers in order ──
    let lastError = null;
    let result = null;

    for (const prov of providersToTry) {
      try {
        console.log(`   ↳ [ImageGen] Trying ${PROVIDERS[prov]?.name || prov}...`);

        switch (prov) {
          case "openai":
            result = await generateWithOpenAI(prompt, imageSize, imageCount);
            break;
          case "replicate":
            result = await generateWithReplicate(prompt, imageCount);
            break;
          case "local":
            result = await generateWithLocal(prompt);
            break;
          default:
            throw new Error(`Unknown provider: ${prov}`);
        }

        if (result && result.urls && result.urls.length > 0) {
          console.log(
            `   ↳ [ImageGen] ${result.provider} returned ${result.urls.length} image(s)`
          );
          break;
        }
      } catch (err) {
        console.warn(
          `   ↳ [ImageGen] ${prov} failed: ${err.message}. Trying next provider...`
        );
        lastError = err.message;
        result = null;
      }
    }

    // ── All providers failed ──
    if (!result || !result.urls || result.urls.length === 0) {
      return {
        success: false,
        error: `All providers failed. Last error: ${lastError}`,
        images: [],
        provider: null,
        prompt,
        size: imageSize,
        count: imageCount,
        timestamp: new Date().toISOString(),
      };
    }

    // ── Save images locally ──
    const images = [];

    for (let i = 0; i < result.urls.length; i++) {
      try {
        const localPath = await downloadAndSaveImage(
          result.urls[i],
          saveDir,
          i + 1
        );
        images.push({
          url: result.urls[i],
          localPath,
          size: imageSize,
          provider: result.provider,
        });
      } catch (err) {
        console.warn(
          `   ↳ [ImageGen] Failed to save image ${i + 1}: ${err.message}`
        );
        // Still include the URL even if local save failed
        images.push({
          url: result.urls[i],
          localPath: null,
          size: imageSize,
          provider: result.provider,
          saveError: err.message,
        });
      }
    }

    console.log(
      `   ↳ [ImageGen] Successfully saved ${images.filter((img) => img.localPath).length}/${images.length} image(s) to ${saveDir}`
    );

    return {
      success: true,
      images,
      provider: result.provider,
      prompt,
      size: imageSize,
      count: images.length,
      saveDirectory: saveDir,
      timestamp: new Date().toISOString(),
    };
  },
};
