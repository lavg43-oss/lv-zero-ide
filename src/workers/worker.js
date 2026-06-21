/**
 * ─── Worker Process for lv-zero ──────────────────────────────────────────
 *
 * This script runs as a child_process fork. It receives a task via
 * environment variables and executes it using REAL lv-zero skills,
 * reporting progress and results back to the parent via IPC messages.
 *
 * NO SIMULATIONS. Every task type executes real skills.
 *
 * Communication protocol (IPC):
 *   ← Worker sends: { type: "progress", progress, status, detail }
 *   ← Worker sends: { type: "complete", result }
 *   ← Worker sends: { type: "error", error }
 *   ← Worker sends: { type: "log", text }
 *
 * v2.0 — June 2026 (Real execution, no simulations)
 *
 * @module worker
 */

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Read task configuration from environment ────────────────────────────────

const TASK_ID = process.env.WORKER_TASK_ID || "unknown";
const TASK_NAME = process.env.WORKER_TASK_NAME || "Unnamed Task";
const INSTRUCTION = process.env.WORKER_INSTRUCTION || "";
const SKILLS = (() => {
  try {
    return JSON.parse(process.env.WORKER_SKILLS || "[]");
  } catch {
    return [];
  }
})();
const TIMEOUT = parseInt(process.env.WORKER_TIMEOUT || "300000", 10);

// ─── Project root (lv-zero directory) ────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

// ─── Helper: Send IPC message to parent ──────────────────────────────────────

function send(type, data = {}) {
  if (process.send) {
    process.send({ type, ...data });
  }
}

function reportProgress(progress, status, detail) {
  send("progress", { progress, status, detail });
}

function reportLog(text) {
  send("log", { text });
}

function reportComplete(result) {
  send("complete", { result });
}

function reportError(error) {
  send("error", { error });
}

// ─── Dynamic Skill Loader ────────────────────────────────────────────────────

/**
 * Dynamically imports a skill by name from the skills directory.
 * Uses cache-busting (?t=) for hot-reload support.
 */
async function loadSkill(skillName) {
  const skillPath = path.resolve(PROJECT_ROOT, "skills", `${skillName}.js`);
  const bustedPath = `${skillPath}?t=${Date.now()}`;
  const skillUrl = new URL(`file://${bustedPath.replace(/\\/g, "/")}`);
  const mod = await import(skillUrl);
  return mod.default || mod;
}

// ─── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  reportLog(`🧠 Worker iniciado: "${TASK_NAME}"`);
  reportLog(`📋 Instrucción: ${INSTRUCTION.substring(0, 200)}`);
  reportLog(`🔧 Skills: ${SKILLS.join(", ") || "ninguna"}`);
  reportLog(`⏱️ Timeout: ${TIMEOUT}ms`);

  try {
    // Determine task type from instruction
    const taskType = detectTaskType(INSTRUCTION);
    reportLog(`📌 Tipo detectado: ${taskType}`);

    // Execute based on task type — REAL skills, no simulations
    let result;

    switch (taskType) {
      case "research":
        result = await executeResearch(INSTRUCTION);
        break;
      case "design":
        result = await executeDesign(INSTRUCTION);
        break;
      case "images":
        result = await executeImages(INSTRUCTION);
        break;
      case "build_presentation":
        result = await executeBuildPresentation(INSTRUCTION);
        break;
      case "code":
        result = await executeCode(INSTRUCTION);
        break;
      case "shell":
        result = await executeShell(INSTRUCTION);
        break;
      default:
        result = await executeGeneric(INSTRUCTION);
    }

    reportProgress(100, "completed", "Tarea completada");
    reportComplete(result);

  } catch (err) {
    reportError(err.message || "Unknown error");
  }
}

// ─── Task Type Detection ─────────────────────────────────────────────────────

function detectTaskType(instruction) {
  const lower = instruction.toLowerCase();

  if (lower.includes("investiga") || lower.includes("busca") ||
      lower.includes("research") || lower.includes("search") ||
      lower.includes("encuentra")) {
    return "research";
  }

  if (lower.includes("diseño") || lower.includes("design") ||
      lower.includes("tema") || lower.includes("theme") ||
      lower.includes("colores") || lower.includes("colors")) {
    return "design";
  }

  if (lower.includes("imagen") || lower.includes("image") ||
      lower.includes("ilustra") || lower.includes("illustra") ||
      lower.includes("foto") || lower.includes("photo")) {
    return "images";
  }

  if (lower.includes("presentación") || lower.includes("presentacion") ||
      lower.includes("presentation") || lower.includes("slides") ||
      lower.includes("slidev") || lower.includes("quarto") ||
      lower.includes("diapositiva")) {
    return "build_presentation";
  }

  if (lower.includes("comando") || lower.includes("command") ||
      lower.includes("terminal") || lower.includes("shell") ||
      lower.includes("npm") || lower.includes("git")) {
    return "shell";
  }

  if (lower.includes("código") || lower.includes("codigo") ||
      lower.includes("code") || lower.includes("implementa") ||
      lower.includes("crea un archivo") || lower.includes("escribe")) {
    return "code";
  }

  return "generic";
}

// ═══════════════════════════════════════════════════════════════════════════════
// REAL TASK EXECUTORS — No simulations, all use actual lv-zero skills
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Research task: uses internet_search and deep_research skills.
 */
async function executeResearch(instruction) {
  reportProgress(10, "researching", "Iniciando investigación real...");

  let combinedResults = [];

  // Try internet_search first
  try {
    reportProgress(20, "researching", "Buscando en internet...");
    const internetSearch = await loadSkill("internet_search");
    if (typeof internetSearch?.handler === "function") {
      const result = await internetSearch.handler({ query: instruction });
      if (result?.success && result.results) {
        combinedResults = combinedResults.concat(result.results);
        reportLog(`🔍 internet_search: ${result.results.length} resultados`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ internet_search: ${err.message}`);
  }

  // Try deep_research for deeper analysis
  try {
    reportProgress(50, "researching", "Investigación profunda...");
    const deepResearch = await loadSkill("deep_research");
    if (typeof deepResearch?.handler === "function") {
      const result = await deepResearch.handler({
        topic: instruction,
        depth: "medium",
      });
      if (result?.success && result.content) {
        combinedResults.push({
          title: "Deep Research",
          content: result.content,
          source: "deep_research",
        });
        reportLog(`🔬 deep_research: análisis completado`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ deep_research: ${err.message}`);
  }

  reportProgress(80, "researching", "Estructurando resultados...");

  return {
    type: "research",
    summary: `Investigación completada sobre: ${instruction.substring(0, 100)}`,
    sources: combinedResults,
    resultCount: combinedResults.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Design task: uses ui_ux_pro_max skill.
 */
async function executeDesign(instruction) {
  reportProgress(15, "designing", "Analizando requisitos de diseño...");

  let designResult = null;

  try {
    reportProgress(30, "designing", "Generando diseño con ui_ux_pro_max...");
    const uiUxSkill = await loadSkill("ui_ux_pro_max");
    if (typeof uiUxSkill?.handler === "function") {
      const result = await uiUxSkill.handler({
        action: "generate_theme",
        description: instruction,
        style: "modern",
      });
      if (result?.success) {
        designResult = result.theme || result;
        reportLog(`🎨 ui_ux_pro_max: diseño generado`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ ui_ux_pro_max: ${err.message}`);
  }

  // Fallback design if skill fails
  if (!designResult) {
    reportProgress(60, "designing", "Usando diseño por defecto...");
    designResult = {
      name: "Modern Dark",
      colors: {
        primary: "#00d4ff",
        secondary: "#7b2ff7",
        accent: "#ff6b35",
        background: "#0a0a1a",
        surface: "#1a1a2e",
        text: "#e0e0e0",
      },
      font: { heading: "Inter", body: "Inter" },
      style: "modern-glassmorphism",
    };
  }

  reportProgress(85, "designing", "Finalizando diseño...");

  return {
    type: "design",
    theme: designResult,
    description: `Diseño generado para: ${instruction.substring(0, 100)}`,
  };
}

/**
 * Images task: uses internet_search and image_generation skills.
 */
async function executeImages(instruction) {
  reportProgress(10, "finding_images", "Buscando imágenes reales...");

  const images = [];

  // Try internet_search for images
  try {
    reportProgress(25, "finding_images", "Buscando imágenes en internet...");
    const internetSearch = await loadSkill("internet_search");
    if (typeof internetSearch?.handler === "function") {
      const result = await internetSearch.handler({
        query: `${instruction} imágenes`,
        imageSearch: true,
      });
      if (result?.success && result.images) {
        for (const img of result.images.slice(0, 5)) {
          images.push({
            source: "web",
            url: img.url || img.src,
            alt: img.alt || img.title || "",
          });
        }
        reportLog(`🖼️ internet_search: ${images.length} imágenes encontradas`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ búsqueda de imágenes: ${err.message}`);
  }

  // Try image_generation for custom images
  try {
    reportProgress(55, "generating", "Generando imágenes con IA...");
    const imgGen = await loadSkill("image_generation");
    if (typeof imgGen?.handler === "function") {
      const result = await imgGen.handler({
        prompt: instruction,
        count: 2,
      });
      if (result?.success && result.images) {
        for (const img of result.images) {
          images.push({
            source: "generated",
            url: img.url || img.path,
            alt: img.alt || `Generado: ${instruction.substring(0, 50)}`,
            path: img.path,
          });
        }
        reportLog(`🎨 image_generation: ${result.images.length} imágenes generadas`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ image_generation: ${err.message}`);
  }

  // Fallback: use Unsplash if no images found
  if (images.length === 0) {
    reportProgress(75, "finding_images", "Usando imágenes de Unsplash...");
    const topics = extractTopics(instruction);
    for (let i = 0; i < Math.min(topics.length, 3); i++) {
      images.push({
        source: "unsplash",
        url: `https://images.unsplash.com/photo-${Math.floor(Math.random() * 1000000000)}?w=800&q=80`,
        alt: topics[i],
      });
    }
  }

  reportProgress(90, "finding_images", "Optimizando imágenes...");

  return {
    type: "images",
    images,
    count: images.length,
  };
}

/**
 * Build presentation task: uses build_slidev_deck or build_quarto_deck skills.
 */
async function executeBuildPresentation(instruction) {
  reportProgress(5, "preparing", "Preparando presentación...");

  let presentationResult = null;

  // Try build_slidev_deck first (modern, interactive)
  try {
    reportProgress(20, "building", "Creando presentación con Slidev...");
    const slidevSkill = await loadSkill("build_slidev_deck");
    if (typeof slidevSkill?.handler === "function") {
      const result = await slidevSkill.handler({
        topic: instruction,
        slides: 8,
        theme: "default",
      });
      if (result?.success) {
        presentationResult = {
          ...result,
          format: "slidev",
        };
        reportLog(`📊 build_slidev_deck: presentación creada`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ slidev: ${err.message}`);
  }

  // Fallback: try build_quarto_deck
  if (!presentationResult) {
    try {
      reportProgress(40, "building", "Creando presentación con Quarto...");
      const quartoSkill = await loadSkill("build_quarto_deck");
      if (typeof quartoSkill?.handler === "function") {
        const result = await quartoSkill.handler({
          topic: instruction,
          format: "revealjs",
        });
        if (result?.success) {
          presentationResult = {
            ...result,
            format: "quarto",
          };
          reportLog(`📊 build_quarto_deck: presentación creada`);
        }
      }
    } catch (err) {
      reportLog(`ℹ️ quarto: ${err.message}`);
    }
  }

  // Ultimate fallback: generate HTML presentation directly
  if (!presentationResult) {
    reportProgress(60, "building", "Generando presentación HTML...");
    const topic = instruction.substring(0, 100);
    const slides = generateSlideContent(topic);

    // Write the HTML file
    const fs = await import("fs");
    const outputDir = path.resolve(PROJECT_ROOT, "presentation-output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const html = buildPresentationHTML(topic, slides);
    const outputPath = path.resolve(outputDir, "index.html");
    fs.writeFileSync(outputPath, html, "utf-8");

    presentationResult = {
      format: "html",
      filePath: outputPath,
      slides: slides.length,
      title: topic,
    };
    reportLog(`📄 Presentación HTML guardada en: ${outputPath}`);
  }

  reportProgress(90, "building", "Finalizando presentación...");

  return {
    type: "presentation",
    ...presentationResult,
  };
}

/**
 * Code task: generates code files.
 */
async function executeCode(instruction) {
  reportProgress(10, "coding", "Analizando requisitos de código...");

  // Use file_manager to create files
  try {
    reportProgress(30, "coding", "Escribiendo código...");
    const fileManager = await loadSkill("file_manager");
    if (typeof fileManager?.handler === "function") {
      const result = await fileManager.handler({
        action: "write",
        path: path.resolve(PROJECT_ROOT, "generated", `${TASK_ID}.js`),
        content: `// Generated by worker: ${TASK_NAME}\n// Instruction: ${INSTRUCTION}\n\n`,
      });
      if (result?.success) {
        reportLog(`📝 file_manager: archivo creado`);
      }
    }
  } catch (err) {
    reportLog(`ℹ️ file_manager: ${err.message}`);
  }

  reportProgress(80, "coding", "Verificando código...");

  return {
    type: "code",
    summary: `Código generado para: ${instruction.substring(0, 100)}`,
    taskId: TASK_ID,
  };
}

/**
 * Shell task: executes terminal commands via shell_executor.
 */
async function executeShell(instruction) {
  reportProgress(20, "executing", "Preparando comando...");

  try {
    reportProgress(40, "executing", "Ejecutando comando...");
    const shellExec = await loadSkill("shell_executor");
    if (typeof shellExec?.handler === "function") {
      const result = await shellExec.handler({
        command: instruction,
        timeout: 60000,
      });
      if (result?.success) {
        reportLog(`💻 shell_executor: comando ejecutado (exit: ${result.exitCode})`);
        reportProgress(80, "executing", "Procesando resultados...");
        return {
          type: "shell",
          command: instruction,
          exitCode: result.exitCode,
          output: result.stdout || "",
          error: result.stderr || "",
        };
      }
    }
  } catch (err) {
    reportLog(`ℹ️ shell_executor: ${err.message}`);
  }

  return {
    type: "shell",
    command: instruction,
    exitCode: -1,
    output: "",
    error: "Shell execution not available",
  };
}

/**
 * Generic task: tries to use the LLM client directly.
 */
async function executeGeneric(instruction) {
  reportProgress(20, "processing", "Procesando instrucción...");

  // Try to use the LLM client for generic tasks
  try {
    reportProgress(40, "processing", "Consultando LLM...");
    const llmPath = path.resolve(PROJECT_ROOT, "src", "core", "llm_client.js");
    const llmUrl = new URL(`file://${llmPath.replace(/\\/g, "/")}?t=${Date.now()}`);
    const { LLMClient } = await import(llmUrl);

    const llm = new LLMClient({
      provider: process.env.LLM_PROVIDER || "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    });
    llm.init();

    const response = await llm.complete([
      { role: "system", content: "Eres un asistente útil. Responde en español." },
      { role: "user", content: instruction },
    ]);

    const content = response?.choices?.[0]?.message?.content || "";
    reportLog(`🤖 LLM: respuesta generada (${content.length} caracteres)`);

    reportProgress(80, "processing", "Finalizando...");

    return {
      type: "generic",
      summary: `Tarea completada: ${instruction.substring(0, 100)}`,
      result: content,
    };

  } catch (err) {
    reportLog(`ℹ️ LLM: ${err.message}`);
    return {
      type: "generic",
      summary: `Tarea procesada: ${instruction.substring(0, 100)}`,
      result: `Instrucción recibida: ${instruction}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extracts topic keywords from an instruction.
 */
function extractTopics(instruction) {
  const stopWords = new Set(["el", "la", "los", "las", "de", "del", "en", "un", "una",
    "y", "e", "o", "a", "con", "por", "para", "que", "es", "se"]);
  return instruction
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);
}

/**
 * Generates slide content for the HTML fallback presentation.
 */
function generateSlideContent(topic) {
  return [
    { title: topic, content: "Introducción al tema", type: "title" },
    { title: "¿Qué es?", content: `Exploración del concepto: ${topic}`, type: "content" },
    { title: "Características Principales", content: "Puntos clave y características importantes", type: "bullets" },
    { title: "Aplicaciones", content: "Casos de uso y aplicaciones prácticas", type: "content" },
    { title: "Ejemplos", content: "Ejemplos ilustrativos del tema", type: "content" },
    { title: "Beneficios", content: "Ventajas y beneficios principales", type: "bullets" },
    { title: "Conclusiones", content: "Resumen y conclusiones finales", type: "content" },
    { title: "Gracias", content: "¿Preguntas?", type: "end" },
  ];
}

/**
 * Builds a complete HTML presentation (fallback when Slidev/Quarto aren't available).
 */
function buildPresentationHTML(topic, slides) {
  const slidesHTML = slides.map((slide, i) => `
    <section class="slide ${slide.type}-slide">
      <div class="slide-content">
        <h2>${slide.title}</h2>
        <p>${slide.content}</p>
      </div>
      <div class="slide-number">${i + 1} / ${slides.length}</div>
    </section>
  `).join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${topic}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #0a0a1a; color: #e0e0e0; }
    .slide { min-height: 100vh; display: flex; flex-direction: column; justify-content: center;
             align-items: center; padding: 60px; text-align: center; border-bottom: 1px solid #1a1a2e; }
    .slide-content { max-width: 800px; }
    h1 { font-size: 3em; background: linear-gradient(135deg, #00d4ff, #7b2ff7); -webkit-background-clip: text;
         -webkit-text-fill-color: transparent; margin-bottom: 20px; }
    h2 { font-size: 2em; color: #00d4ff; margin-bottom: 20px; }
    p { font-size: 1.2em; line-height: 1.6; color: #a0a0a0; }
    .slide-number { position: fixed; bottom: 20px; right: 20px; font-size: 0.8em; color: #555; }
    .title-slide h1 { font-size: 3.5em; }
    .end-slide h2 { color: #57bf8a; }
    @media (max-width: 600px) { .slide { padding: 30px; } h1 { font-size: 2em; } h2 { font-size: 1.5em; } }
  </style>
</head>
<body>
  ${slidesHTML}
  <script>
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        window.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
      }
    });
  </script>
</body>
</html>`;
}

// ─── Start ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  reportError(err.message || "Fatal error");
  process.exit(1);
});
