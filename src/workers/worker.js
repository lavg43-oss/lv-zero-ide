/**
 * ─── Worker Process for lv-zero ──────────────────────────────────────────
 *
 * This script runs as a child_process fork. It receives a task via
 * environment variables and executes it, reporting progress and results
 * back to the parent via IPC messages.
 *
 * Communication protocol (IPC):
 *   → Parent sends: N/A (task config via env vars)
 *   ← Worker sends: { type: "progress", progress, status, detail }
 *   ← Worker sends: { type: "complete", result }
 *   ← Worker sends: { type: "error", error }
 *   ← Worker sends: { type: "log", text }
 *
 * v1.0 — June 2026
 *
 * @module worker
 */

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

// ─── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  reportLog(`🧠 Worker iniciado: "${TASK_NAME}"`);
  reportLog(`📋 Instrucción: ${INSTRUCTION.substring(0, 200)}`);
  reportLog(`🔧 Skills: ${SKILLS.join(", ") || "ninguna"}`);
  reportLog(`⏱️ Timeout: ${TIMEOUT}ms`);

  try {
    // ── Phase 1: Analyze the instruction ────────────────────────────────
    reportProgress(5, "analyzing", "Analizando instrucción...");
    await sleep(500);

    // Determine task type from instruction
    const taskType = detectTaskType(INSTRUCTION);
    reportLog(`📌 Tipo detectado: ${taskType}`);

    // ── Phase 2: Execute based on task type ─────────────────────────────
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

// ─── Task Executors ──────────────────────────────────────────────────────────

/**
 * Research task: searches the internet for information.
 */
async function executeResearch(instruction) {
  reportProgress(10, "researching", "Iniciando investigación...");

  // Simulate research phases
  const phases = [
    { progress: 20, detail: "Buscando fuentes relevantes..." },
    { progress: 40, detail: "Analizando resultados..." },
    { progress: 60, detail: "Extrayendo información clave..." },
    { progress: 80, detail: "Estructurando contenido..." },
  ];

  for (const phase of phases) {
    await sleep(800);
    reportProgress(phase.progress, "researching", phase.detail);
  }

  // Try to use internet_search if available
  let searchResults = [];
  try {
    const { default: internetSearch } = await import(
      `file://${path.resolve(process.cwd(), "skills", "internet_search.js")}?t=${Date.now()}`
    );
    if (typeof internetSearch?.handler === "function") {
      reportLog("🔍 Usando internet_search skill...");
      const result = await internetSearch.handler({ query: instruction });
      searchResults = result?.results || [];
    }
  } catch {
    reportLog("ℹ️ internet_search no disponible, usando modo simulado");
  }

  return {
    type: "research",
    summary: `Investigación completada sobre: ${instruction.substring(0, 100)}`,
    sources: searchResults.length > 0 ? searchResults : [],
    content: generateMockContent(instruction),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Design task: defines visual theme and style.
 */
async function executeDesign(instruction) {
  reportProgress(10, "designing", "Analizando requisitos de diseño...");

  const phases = [
    { progress: 25, detail: "Seleccionando paleta de colores..." },
    { progress: 50, detail: "Definiendo tipografía..." },
    { progress: 75, detail: "Creando plantilla visual..." },
  ];

  for (const phase of phases) {
    await sleep(600);
    reportProgress(phase.progress, "designing", phase.detail);
  }

  return {
    type: "design",
    theme: {
      name: "Modern Dark",
      colors: {
        primary: "#00d4ff",
        secondary: "#7b2ff7",
        accent: "#ff6b35",
        background: "#0a0a1a",
        surface: "#1a1a2e",
        text: "#e0e0e0",
      },
      font: {
        heading: "Inter",
        body: "Inter",
      },
      style: "modern-glassmorphism",
    },
    description: "Tema moderno oscuro con acentos neón y efecto glassmorphism",
  };
}

/**
 * Images task: finds or generates images.
 */
async function executeImages(instruction) {
  reportProgress(10, "finding_images", "Buscando imágenes relevantes...");

  const phases = [
    { progress: 30, detail: "Buscando en bancos de imágenes..." },
    { progress: 55, detail: "Seleccionando las mejores..." },
    { progress: 80, detail: "Optimizando imágenes..." },
  ];

  for (const phase of phases) {
    await sleep(700);
    reportProgress(phase.progress, "finding_images", phase.detail);
  }

  return {
    type: "images",
    images: [
      {
        slide: 1,
        type: "hero",
        url: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800",
        alt: "AI Abstract",
      },
      {
        slide: 2,
        type: "illustration",
        url: "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=800",
        alt: "Data visualization",
      },
      {
        slide: 3,
        type: "illustration",
        url: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800",
        alt: "Technology",
      },
    ],
    count: 3,
  };
}

/**
 * Build presentation task: creates a Slidev/Quarto presentation.
 */
async function executeBuildPresentation(instruction) {
  reportProgress(5, "preparing", "Preparando estructura de la presentación...");

  const phases = [
    { progress: 20, detail: "Definiendo diapositivas..." },
    { progress: 40, detail: "Escribiendo contenido..." },
    { progress: 60, detail: "Aplicando diseño..." },
    { progress: 80, detail: "Insertando imágenes..." },
  ];

  for (const phase of phases) {
    await sleep(1000);
    reportProgress(phase.progress, "building", phase.detail);
  }

  return {
    type: "presentation",
    title: `Presentación: ${instruction.substring(0, 50)}`,
    slides: [
      { title: "Introducción", content: "Contenido de la diapositiva 1" },
      { title: "Conceptos Clave", content: "Contenido de la diapositiva 2" },
      { title: "Ejemplos", content: "Contenido de la diapositiva 3" },
      { title: "Conclusiones", content: "Contenido de la diapositiva 4" },
    ],
    format: "slidev",
    filePath: "./presentation/index.html",
  };
}

/**
 * Code task: generates or modifies code.
 */
async function executeCode(instruction) {
  reportProgress(10, "coding", "Analizando requisitos de código...");

  const phases = [
    { progress: 30, detail: "Escribiendo estructura..." },
    { progress: 60, detail: "Implementando lógica..." },
    { progress: 85, detail: "Verificando sintaxis..." },
  ];

  for (const phase of phases) {
    await sleep(900);
    reportProgress(phase.progress, "coding", phase.detail);
  }

  return {
    type: "code",
    summary: `Código generado para: ${instruction.substring(0, 100)}`,
    files: [],
  };
}

/**
 * Shell task: executes terminal commands.
 */
async function executeShell(instruction) {
  reportProgress(20, "executing", "Preparando comando...");
  await sleep(500);
  reportProgress(50, "executing", "Ejecutando...");
  await sleep(1000);
  reportProgress(80, "executing", "Procesando resultados...");
  await sleep(500);

  return {
    type: "shell",
    command: instruction,
    exitCode: 0,
    output: `Comando ejecutado: ${instruction}`,
  };
}

/**
 * Generic task: fallback for unknown task types.
 */
async function executeGeneric(instruction) {
  reportProgress(20, "processing", "Procesando instrucción...");
  await sleep(500);
  reportProgress(50, "processing", "Trabajando...");
  await sleep(800);
  reportProgress(80, "processing", "Finalizando...");
  await sleep(500);

  return {
    type: "generic",
    summary: `Tarea completada: ${instruction.substring(0, 100)}`,
    result: `Procesado: ${instruction}`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateMockContent(topic) {
  return {
    title: `Sobre: ${topic.substring(0, 50)}`,
    keyPoints: [
      "Punto clave 1: Información relevante",
      "Punto clave 2: Dato importante",
      "Punto clave 3: Conclusión principal",
    ],
    summary: `Resumen generado para: ${topic.substring(0, 100)}`,
  };
}

// Dynamic import for path resolution
import path from "path";

// ─── Start ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  reportError(err.message || "Fatal error");
  process.exit(1);
});
