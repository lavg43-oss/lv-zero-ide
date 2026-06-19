/**
 * model_manager — Hardware Scanner & Model Manager Skill
 *
 * Phase 1: Model Management (Cookbook)
 *
 * Detects system GPU/VRAM/CPU/RAM capabilities, recommends compatible AI models
 * from Ollama, Hugging Face, and LM Studio catalogs, downloads GGUF files or
 * triggers ollama pull, and serves models via local inference endpoints.
 *
 * Auto-configures LOCAL_API_URL and LOCAL_MODEL in .env when serving.
 */
import os from "os";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ─── Cache ───────────────────────────────────────────────────────────────────
let hardwareCache = null;
let recommendationsCache = null;
let activeServer = null; // { url, pid, model, startTime }

// ─── Skill Definition ────────────────────────────────────────────────────────
export default {
  name: "model_manager",
  description:
    "Hardware scanner and model manager. " +
    "Detects GPU/VRAM, recommends compatible AI models, " +
    "downloads and serves them locally. " +
    "Actions: scan (detect hardware), recommend (get model suggestions), " +
    "download (pull a model), serve (start local inference), " +
    "stop (stop server), status (check running server).",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["scan", "recommend", "download", "serve", "stop", "status"],
        description:
          "Action to perform: scan hardware, recommend models, " +
          "download a model, serve a model, stop the server, or check status.",
      },
      modelId: {
        type: "string",
        description:
          "Model ID for download/serve actions. " +
          "E.g., 'llama3.2:3b', 'mistral:7b', or a GGUF URL.",
      },
    },
    required: ["action"],
  },

  handler: async ({ action, modelId }) => {
    switch (action) {
      case "scan":
        return await scanHardware();
      case "recommend": {
        const hardware = hardwareCache || (await scanHardware());
        return await getRecommendedModels(hardware);
      }
      case "download":
        if (!modelId) {
          return { success: false, error: "modelId is required for download" };
        }
        return await downloadModel(modelId);
      case "serve":
        if (!modelId) {
          return { success: false, error: "modelId is required for serve" };
        }
        return await serveModel(modelId);
      case "stop":
        return await stopModel();
      case "status":
        return await getModelStatus();
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};

// ─── Hardware Detection ──────────────────────────────────────────────────────

/**
 * Scan system hardware and return detailed capabilities.
 * @returns {Promise<Object>} Hardware specification object
 */
async function scanHardware() {
  const platform = os.platform();
  const cpuCores = os.cpus().length;
  const cpuModel = os.cpus()[0]?.model || "unknown";
  const cpuArch = os.arch();

  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const totalRamGB = roundTo(totalRamBytes / (1024 ** 3), 1);
  const freeRamGB = roundTo(freeRamBytes / (1024 ** 3), 1);

  const gpu = await detectGPU(platform);
  const hasOllama = await checkOllama();
  const hasDocker = await checkDocker();

  const result = {
    platform,
    cpu: {
      cores: cpuCores,
      model: cpuModel,
      architecture: cpuArch,
    },
    ram: {
      total: totalRamGB,
      free: freeRamGB,
      unit: "GB",
    },
    gpu,
    hasOllama,
    hasDocker,
  };

  hardwareCache = result;
  return { success: true, hardware: result };
}

/**
 * Detect GPU capabilities using platform-specific commands.
 * @param {string} platform - 'win32', 'darwin', or 'linux'
 * @returns {Promise<Object>} GPU information
 */
async function detectGPU(platform) {
  // ── Apple Silicon ──────────────────────────────────────────────────────
  if (platform === "darwin" && process.arch === "arm64") {
    try {
      const brand = execSync("sysctl -n machdep.cpu.brand_string", {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      // Apple Silicon has unified memory; estimate available VRAM
      const totalMemGB = roundTo(os.totalmem() / (1024 ** 3), 1);
      const vramEstimate = roundTo(totalMemGB * 0.7, 1); // ~70% usable for model

      return {
        available: true,
        vendor: "apple",
        name: brand || "Apple Silicon",
        vram: vramEstimate,
        cudaCores: 0,
        computeCapability: "",
      };
    } catch {
      return {
        available: true,
        vendor: "apple",
        name: "Apple Silicon",
        vram: roundTo(os.totalmem() / (1024 ** 3) * 0.7, 1),
        cudaCores: 0,
        computeCapability: "",
      };
    }
  }

  // ── NVIDIA GPU (Windows & Linux) ──────────────────────────────────────
  try {
    const nvidiaOut = execSync(
      'nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv,noheader',
      { encoding: "utf-8", timeout: 10000 }
    ).trim();

    if (nvidiaOut) {
      const lines = nvidiaOut.split("\n").filter(Boolean);
      if (lines.length > 0) {
        const parts = lines[0].split(",").map((s) => s.trim());
        const name = parts[0] || "NVIDIA GPU";
        const memTotal = parseFloat(parts[1]) || 0; // MiB
        const vramGB = roundTo(memTotal / 1024, 1);
        const computeCap = parts[2] || "";

        // Estimate CUDA cores from GPU name
        const cudaCores = estimateCudaCores(name);

        return {
          available: true,
          vendor: "nvidia",
          name,
          vram: vramGB,
          cudaCores,
          computeCapability: computeCap,
        };
      }
    }
  } catch {
    // nvidia-smi not available — continue to next check
  }

  // ── AMD GPU (Linux via rocm-smi, Windows via DirectX) ─────────────────
  try {
    if (platform === "linux") {
      const rocmOut = execSync("rocm-smi --showproductinfo", {
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      if (rocmOut) {
        const nameMatch = rocmOut.match(/Name:\s*(.+)/);
        const vramMatch = rocmOut.match(/(?:VRAM|Memory)\s*(?:Size|):\s*(\d+)\s*GB/i);
        return {
          available: true,
          vendor: "amd",
          name: nameMatch ? nameMatch[1].trim() : "AMD GPU",
          vram: vramMatch ? parseFloat(vramMatch[1]) : 8,
          cudaCores: 0,
          computeCapability: "",
        };
      }
    }
  } catch {
    // rocm-smi not available
  }

  // ── No dedicated GPU detected ─────────────────────────────────────────
  return {
    available: false,
    vendor: "none",
    name: "No compatible GPU detected",
    vram: 0,
    cudaCores: 0,
    computeCapability: "",
  };
}

/**
 * Check if Ollama is running by querying its API.
 * @returns {Promise<boolean>}
 */
async function checkOllama() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Docker is installed.
 * @returns {Promise<boolean>}
 */
async function checkDocker() {
  try {
    execSync("docker --version", { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Model Recommendations ───────────────────────────────────────────────────

const MODEL_CATALOG = [
  // ── Ollama Models ──────────────────────────────────────────────────────
  {
    id: "llama3.2:1b",
    name: "Llama 3.2 (1B, Q4)",
    provider: "ollama",
    size: "0.7GB",
    quantization: "Q4_K_M",
    vramRequired: 1,
    ramRequired: 2,
    description: "Smallest Llama 3.2 — runs on any system with 2GB RAM",
    pullCommand: "ollama pull llama3.2:1b",
    url: "https://ollama.com/library/llama3.2:1b",
  },
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 (3B, Q4)",
    provider: "ollama",
    size: "2.1GB",
    quantization: "Q4_K_M",
    vramRequired: 2,
    ramRequired: 4,
    description: "Best balance of speed and quality for most systems",
    pullCommand: "ollama pull llama3.2:3b",
    url: "https://ollama.com/library/llama3.2:3b",
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 (8B, Q4)",
    provider: "ollama",
    size: "4.9GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "Strong general-purpose model for mid-range GPUs",
    pullCommand: "ollama pull llama3.1:8b",
    url: "https://ollama.com/library/llama3.1:8b",
  },
  {
    id: "mistral:7b",
    name: "Mistral (7B, Q4)",
    provider: "ollama",
    size: "4.1GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "Fast and efficient 7B model, great for coding",
    pullCommand: "ollama pull mistral:7b",
    url: "https://ollama.com/library/mistral:7b",
  },
  {
    id: "codellama:7b",
    name: "Code Llama (7B, Q4)",
    provider: "ollama",
    size: "4.1GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "Specialized for code generation and understanding",
    pullCommand: "ollama pull codellama:7b",
    url: "https://ollama.com/library/codellama:7b",
  },
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 (7B, Q4)",
    provider: "ollama",
    size: "4.3GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "Strong multilingual model with 32K context",
    pullCommand: "ollama pull qwen2.5:7b",
    url: "https://ollama.com/library/qwen2.5:7b",
  },
  {
    id: "phi3:3.8b",
    name: "Phi-3 (3.8B, Q4)",
    provider: "ollama",
    size: "2.3GB",
    quantization: "Q4_K_M",
    vramRequired: 3,
    ramRequired: 4,
    description: "Microsoft's efficient small model, good for CPU inference",
    pullCommand: "ollama pull phi3:3.8b",
    url: "https://ollama.com/library/phi3:3.8b",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 (9B, Q4)",
    provider: "ollama",
    size: "5.5GB",
    quantization: "Q4_K_M",
    vramRequired: 8,
    ramRequired: 10,
    description: "Google's Gemma 2 — strong reasoning for its size",
    pullCommand: "ollama pull gemma2:9b",
    url: "https://ollama.com/library/gemma2:9b",
  },
  {
    id: "llama3.1:70b",
    name: "Llama 3.1 (70B, Q4)",
    provider: "ollama",
    size: "42GB",
    quantization: "Q4_K_M",
    vramRequired: 40,
    ramRequired: 48,
    description: "High-end 70B model for powerful multi-GPU setups",
    pullCommand: "ollama pull llama3.1:70b",
    url: "https://ollama.com/library/llama3.1:70b",
  },
  {
    id: "deepseek-r1:7b",
    name: "DeepSeek R1 (7B, Q4)",
    provider: "ollama",
    size: "4.2GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "DeepSeek's reasoning model — strong at math and logic",
    pullCommand: "ollama pull deepseek-r1:7b",
    url: "https://ollama.com/library/deepseek-r1:7b",
  },
  {
    id: "deepseek-r1:14b",
    name: "DeepSeek R1 (14B, Q4)",
    provider: "ollama",
    size: "8.5GB",
    quantization: "Q4_K_M",
    vramRequired: 10,
    ramRequired: 12,
    description: "Larger DeepSeek reasoning model for better accuracy",
    pullCommand: "ollama pull deepseek-r1:14b",
    url: "https://ollama.com/library/deepseek-r1:14b",
  },
  {
    id: "nomic-embed-text",
    name: "Nomic Embed Text (137M)",
    provider: "ollama",
    size: "0.3GB",
    quantization: "F16",
    vramRequired: 0.5,
    ramRequired: 1,
    description: "Lightweight embedding model for RAG pipelines",
    pullCommand: "ollama pull nomic-embed-text",
    url: "https://ollama.com/library/nomic-embed-text",
  },

  // ── Hugging Face GGUF Models ───────────────────────────────────────────
  {
    id: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF",
    name: "Llama 3.1 (8B, Q4_K_M) — GGUF",
    provider: "huggingface",
    size: "4.9GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "GGUF format for llama.cpp — Meta Llama 3.1 8B Instruct",
    pullCommand: "",
    url: "https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF",
  },
  {
    id: "MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF",
    name: "Mistral 7B v0.3 (Q4) — GGUF",
    provider: "huggingface",
    size: "4.1GB",
    quantization: "Q4_K_M",
    vramRequired: 6,
    ramRequired: 8,
    description: "GGUF format — Mistral 7B Instruct v0.3",
    pullCommand: "",
    url: "https://huggingface.co/MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF",
  },
  {
    id: "QuantFactory/Meta-Llama-3.2-3B-Instruct-GGUF",
    name: "Llama 3.2 (3B, Q4) — GGUF",
    provider: "huggingface",
    size: "2.1GB",
    quantization: "Q4_K_M",
    vramRequired: 2,
    ramRequired: 4,
    description: "GGUF format — Llama 3.2 3B Instruct",
    pullCommand: "",
    url: "https://huggingface.co/QuantFactory/Meta-Llama-3.2-3B-Instruct-GGUF",
  },
  {
    id: "microsoft/Phi-3-mini-4k-instruct-gguf",
    name: "Phi-3 Mini (3.8B, Q4) — GGUF",
    provider: "huggingface",
    size: "2.3GB",
    quantization: "Q4_K_M",
    vramRequired: 3,
    ramRequired: 4,
    description: "GGUF format — Microsoft Phi-3 Mini 4K Instruct",
    pullCommand: "",
    url: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf",
  },
];

/**
 * Get recommended models based on hardware capabilities.
 * Filters by available VRAM/RAM and scores by fit.
 * @param {Object} hardware - Hardware specification from scanHardware()
 * @returns {Promise<Object>} Recommended models array
 */
async function getRecommendedModels(hardware) {
  if (!hardware) {
    return { success: false, error: "No hardware data. Run scan first." };
  }

  const availableVRAM = hardware.gpu.available ? hardware.gpu.vram : 0;
  const availableRAM = hardware.ram.total;

  const scored = MODEL_CATALOG.map((model) => {
    // Calculate fit score (0-1) based on how well the model fits the hardware
    const vramRatio = availableVRAM > 0 ? model.vramRequired / availableVRAM : 1;
    const ramRatio = model.ramRequired / availableRAM;

    // Score components
    let vramScore = 0;
    if (availableVRAM >= model.vramRequired) {
      // Model fits in VRAM — prefer models that use VRAM efficiently
      vramScore = 0.5 * (1 - (model.vramRequired - availableVRAM * 0.3) / availableVRAM);
    } else if (availableRAM >= model.ramRequired) {
      // Model can run in system RAM (slower but works)
      vramScore = 0.2;
    } else {
      // Not enough memory at all
      vramScore = -1;
    }

    let ramScore = 0;
    if (availableRAM >= model.ramRequired) {
      ramScore = 0.3 * (1 - ramRatio * 0.5);
    } else {
      ramScore = -1;
    }

    // Bonus for quantized models (more efficient)
    const quantBonus = model.quantization.startsWith("Q") ? 0.1 : 0;

    // Bonus for Ollama (easier to use)
    const providerBonus = model.provider === "ollama" && hardware.hasOllama ? 0.1 : 0;

    const fitScore = Math.max(0, Math.min(1, vramScore + ramScore + quantBonus + providerBonus));

    return {
      ...model,
      fitScore: roundTo(fitScore, 2),
      // Only include if it can run on this hardware
      canRun: vramScore >= 0 && ramScore >= 0,
    };
  });

  // Filter to models that can run, sort by fit score descending
  const recommendations = scored
    .filter((m) => m.canRun)
    .sort((a, b) => b.fitScore - a.fitScore);

  recommendationsCache = recommendations;

  return {
    success: true,
    recommendations,
    total: recommendations.length,
    hardware,
  };
}

// ─── Model Download ──────────────────────────────────────────────────────────

/**
 * Download a model — either via ollama pull or by downloading a GGUF file.
 * @param {string} modelId - Model ID or URL
 * @returns {Promise<Object>} Download result
 */
async function downloadModel(modelId) {
  // Check if it's an Ollama model
  const isOllamaModel = MODEL_CATALOG.some(
    (m) => m.id === modelId && m.provider === "ollama"
  );

  if (isOllamaModel) {
    return await pullOllamaModel(modelId);
  }

  // Check if it's a Hugging Face GGUF URL or ID
  if (modelId.includes("huggingface.co") || modelId.includes("/")) {
    return await downloadGGUF(modelId);
  }

  // Try as Ollama model anyway (user might know a model not in our catalog)
  return await pullOllamaModel(modelId);
}

/**
 * Pull an Ollama model.
 * @param {string} modelId
 * @returns {Promise<Object>}
 */
async function pullOllamaModel(modelId) {
  try {
    const ollamaRunning = await checkOllama();
    if (!ollamaRunning) {
      return {
        success: false,
        error:
          "Ollama is not running. Start Ollama first (http://127.0.0.1:11434).",
      };
    }

    // Trigger ollama pull via API
    const response = await fetch("http://127.0.0.1:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId, stream: false }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        success: false,
        error: `Ollama pull failed: ${errText}`,
      };
    }

    const result = await response.json();

    return {
      success: true,
      path: `ollama://${modelId}`,
      size: result.size || "unknown",
      progress: 100,
      message: `Successfully pulled ${modelId} via Ollama`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to pull Ollama model: ${err.message}`,
    };
  }
}

/**
 * Download a GGUF model file from Hugging Face.
 * @param {string} modelUrlOrId - Hugging Face model ID or URL
 * @returns {Promise<Object>}
 */
async function downloadGGUF(modelUrlOrId) {
  try {
    // Resolve the actual download URL
    let downloadUrl = modelUrlOrId;

    // If it's a Hugging Face model ID (not a full URL), construct the URL
    if (!modelUrlOrId.startsWith("http")) {
      downloadUrl = `https://huggingface.co/${modelUrlOrId}/resolve/main/`;
    }

    // Determine a local path for the model
    const modelsDir = path.resolve(process.cwd(), "models");
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const modelName = modelUrlOrId.replace(/^.*\//, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const localPath = path.join(modelsDir, `${modelName}.gguf`);

    // Check if already downloaded
    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      return {
        success: true,
        path: localPath,
        size: stats.size,
        progress: 100,
        message: `Model already exists at ${localPath}`,
      };
    }

    // Download the file
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download: HTTP ${response.status} ${response.statusText}`,
      };
    }

    const contentLength = response.headers.get("content-length");
    const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

    // Stream the download to file
    const reader = response.body.getReader();
    const writer = fs.createWriteStream(localPath);
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      downloaded += value.length;
    }

    writer.end();

    return {
      success: true,
      path: localPath,
      size: downloaded,
      progress: 100,
      message: `Downloaded to ${localPath}`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to download GGUF: ${err.message}`,
    };
  }
}

// ─── Model Serving ───────────────────────────────────────────────────────────

/**
 * Start a local inference server for the given model.
 * Auto-configures LOCAL_API_URL and LOCAL_MODEL in .env.
 * @param {string} modelId - Model ID to serve
 * @returns {Promise<Object>} Server info
 */
async function serveModel(modelId) {
  // Stop any existing server first
  if (activeServer) {
    await stopModel();
  }

  // Determine provider from model catalog
  const catalogEntry = MODEL_CATALOG.find((m) => m.id === modelId);
  const provider = catalogEntry?.provider || "ollama";

  try {
    let url;
    let pid;

    if (provider === "ollama") {
      // Ollama should already be running; just verify
      const ollamaRunning = await checkOllama();
      if (!ollamaRunning) {
        // Try to start Ollama
        try {
          const ollamaPath = process.platform === "win32" ? "ollama.exe" : "ollama";
          const proc = execSync(`start /B ${ollamaPath} serve`, {
            encoding: "utf-8",
            timeout: 5000,
          });
        } catch {
          // start may not return output; that's ok
        }

        // Wait for Ollama to be ready
        for (let i = 0; i < 30; i++) {
          await sleep(1000);
          if (await checkOllama()) break;
        }

        if (!(await checkOllama())) {
          return {
            success: false,
            error: "Failed to start Ollama. Please start it manually.",
          };
        }
      }

      url = "http://127.0.0.1:11434/v1";
      pid = -1; // Ollama manages its own process
    } else {
      // For GGUF models, we'd start llama.cpp server
      // This is a placeholder for future implementation
      return {
        success: false,
        error:
          "Automatic serving for non-Ollama models is not yet implemented. " +
          "Please use Ollama or start the server manually.",
      };
    }

    // Update .env with the local model configuration
    await updateEnvFile(url, modelId);

    activeServer = {
      url,
      pid,
      model: modelId,
      startTime: new Date().toISOString(),
    };

    return {
      success: true,
      url,
      pid,
      port: 11434,
      message: `Serving ${modelId} at ${url}. .env updated with LOCAL_API_URL and LOCAL_MODEL.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to serve model: ${err.message}`,
    };
  }
}

/**
 * Stop the local inference server.
 * @returns {Promise<Object>}
 */
async function stopModel() {
  if (!activeServer) {
    return { success: true, message: "No active server to stop." };
  }

  try {
    // If we have a PID and it's not Ollama's (which manages itself), kill it
    if (activeServer.pid && activeServer.pid > 0) {
      try {
        process.kill(activeServer.pid);
      } catch {
        // Process may already be dead
      }
    }

    activeServer = null;
    return { success: true, message: "Server stopped." };
  } catch (err) {
    return {
      success: false,
      error: `Failed to stop server: ${err.message}`,
    };
  }
}

/**
 * Check if a local model server is running.
 * @returns {Promise<Object>} Server status
 */
async function getModelStatus() {
  const ollamaRunning = await checkOllama();

  let ollamaModels = [];
  if (ollamaRunning) {
    try {
      const res = await fetch("http://127.0.0.1:11434/api/tags");
      if (res.ok) {
        const data = await res.json();
        ollamaModels = (data.models || []).map((m) => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        }));
      }
    } catch {
      // Ignore errors listing models
    }
  }

  return {
    success: true,
    running: ollamaRunning,
    url: ollamaRunning ? "http://127.0.0.1:11434/v1" : null,
    model: activeServer?.model || null,
    uptime: activeServer?.startTime
      ? formatUptime(activeServer.startTime)
      : null,
    ollamaModels,
    activeServer: activeServer
      ? {
          url: activeServer.url,
          model: activeServer.model,
          startTime: activeServer.startTime,
        }
      : null,
  };
}

// ─── .env Management ─────────────────────────────────────────────────────────

/**
 * Update .env file with LOCAL_API_URL and LOCAL_MODEL values.
 * @param {string} apiUrl
 * @param {string} modelId
 */
async function updateEnvFile(apiUrl, modelId) {
  const envPath = path.resolve(process.cwd(), ".env");

  try {
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    // Update or add LOCAL_API_URL
    if (envContent.includes("LOCAL_API_URL=")) {
      envContent = envContent.replace(
        /LOCAL_API_URL=.*/,
        `LOCAL_API_URL=${apiUrl}`
      );
    } else {
      envContent += `\nLOCAL_API_URL=${apiUrl}\n`;
    }

    // Update or add LOCAL_MODEL
    if (envContent.includes("LOCAL_MODEL=")) {
      envContent = envContent.replace(
        /LOCAL_MODEL=.*/,
        `LOCAL_MODEL=${modelId}`
      );
    } else {
      envContent += `LOCAL_MODEL=${modelId}\n`;
    }

    fs.writeFileSync(envPath, envContent, "utf-8");
  } catch (err) {
    console.error(`   ⚠️  Could not update .env: ${err.message}`);
  }
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Round a number to the given decimal places.
 * @param {number} num
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(num, decimals) {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

/**
 * Sleep for the given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Estimate CUDA core count from GPU name.
 * @param {string} gpuName
 * @returns {number}
 */
function estimateCudaCores(gpuName) {
  const name = gpuName.toLowerCase();

  // RTX 4090
  if (name.includes("rtx 4090")) return 16384;
  if (name.includes("rtx 4080")) return 9728;
  if (name.includes("rtx 4070")) return 5888;
  if (name.includes("rtx 4060")) return 3072;

  // RTX 3090
  if (name.includes("rtx 3090")) return 10496;
  if (name.includes("rtx 3080")) return 8704;
  if (name.includes("rtx 3070")) return 5888;
  if (name.includes("rtx 3060")) return 3584;

  // RTX 2090 / 2080
  if (name.includes("rtx 2080")) return 4352;
  if (name.includes("rtx 2070")) return 2304;
  if (name.includes("rtx 2060")) return 1920;

  // GTX series
  if (name.includes("gtx 1080")) return 2560;
  if (name.includes("gtx 1070")) return 1920;
  if (name.includes("gtx 1060")) return 1280;

  // A-series (datacenter)
  if (name.includes("a100")) return 6912;
  if (name.includes("a6000")) return 10752;
  if (name.includes("a5000")) return 8192;
  if (name.includes("a4000")) return 6144;

  // H-series
  if (name.includes("h100")) return 18432;
  if (name.includes("h200")) return 18432;

  // Default fallback
  return 0;
}

/**
 * Format uptime from an ISO start time string.
 * @param {string} startTime ISO string
 * @returns {string}
 */
function formatUptime(startTime) {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  const diffMs = now - start;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
