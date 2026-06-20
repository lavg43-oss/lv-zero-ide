/**
 * ─── Task Analyzer for lv-zero ───────────────────────────────────────────
 *
 * Analyzes user input and detects if it can be split into parallel sub-tasks.
 * Used by the Swarm Architecture to automatically delegate work to background
 * workers without the user needing to specify anything.
 *
 * v1.0 — June 2026
 *
 * @module task_analyzer
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Parallel Task Detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} SubTask
 * @property {string} id - Unique task ID
 * @property {string} name - Human-readable name
 * @property {string} description - Description for UI
 * @property {string} instruction - Instruction for the sub-agent
 * @property {string[]} skills - Skills the task needs
 * @property {string[]} dependsOn - Task IDs this depends on
 * @property {number} estimatedTime - Estimated time in ms
 */

/**
 * @typedef {object} AnalysisResult
 * @property {boolean} canParallelize - Whether the task can be split
 * @property {SubTask[]} tasks - List of sub-tasks
 * @property {string} reason - Why it was split (or not)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Patterns for detecting parallelizable tasks
// ═══════════════════════════════════════════════════════════════════════════════

const PARALLEL_PATTERNS = [
  // Explicit parallel markers
  { pattern: /mientras\s+(tanto|que)/i, type: "parallel" },
  { pattern: /al\s+mismo\s+tiempo/i, type: "parallel" },
  { pattern: /por\s+un\s+lado.*por\s+otro/i, type: "parallel" },
  { pattern: /en\s+paralelo/i, type: "parallel" },
  { pattern: /simultáneamente|simultaneamente/i, type: "parallel" },
  { pattern: /también\s+(investiga|busca|crea|haz)/i, type: "parallel" },
  { pattern: /y\s+mientras/i, type: "parallel" },

  // Presentation creation (the classic use case)
  { pattern: /presentación|presentacion|slides|diapositivas/i, type: "presentation" },

  // Complex tasks that imply multiple steps
  { pattern: /investiga.*(?:y|while).*(?:crea|haz|genera)/i, type: "research_then_build" },
  { pattern: /busca.*imágenes|imagenes.*(?:y|while)/i, type: "research_and_images" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Task Analyzer
// ═══════════════════════════════════════════════════════════════════════════════

export class TaskAnalyzer {
  /**
   * Analyzes user input and determines if it can be split into parallel tasks.
   *
   * @param {string} userInput - The user's message
   * @returns {AnalysisResult}
   */
  static analyze(userInput) {
    if (!userInput || userInput.length < 10) {
      return { canParallelize: false, tasks: [], reason: "Input demasiado corto" };
    }

    const lower = userInput.toLowerCase();

    // Check for explicit parallel markers
    for (const p of PARALLEL_PATTERNS) {
      if (p.pattern.test(lower)) {
        return TaskAnalyzer._splitByType(userInput, p.type);
      }
    }

    // Check for presentation creation (most common complex task)
    if (lower.includes("presentación") || lower.includes("presentacion") ||
        lower.includes("slides") || lower.includes("diapositivas")) {
      return TaskAnalyzer._splitPresentationTask(userInput);
    }

    // Check for research + build patterns
    if ((lower.includes("investiga") || lower.includes("busca")) &&
        (lower.includes("crea") || lower.includes("haz") || lower.includes("genera"))) {
      return TaskAnalyzer._splitResearchAndBuild(userInput);
    }

    return { canParallelize: false, tasks: [], reason: "Tarea simple, no requiere paralelización" };
  }

  /**
   * Splits a task by detected type.
   */
  static _splitByType(input, type) {
    switch (type) {
      case "presentation":
        return TaskAnalyzer._splitPresentationTask(input);
      case "research_then_build":
        return TaskAnalyzer._splitResearchAndBuild(input);
      case "research_and_images":
        return TaskAnalyzer._splitResearchAndImages(input);
      default:
        return TaskAnalyzer._splitGenericParallel(input);
    }
  }

  /**
   * Splits a presentation creation task into 4 parallel sub-tasks.
   *
   * This is the classic use case:
   *   1. Research → content
   *   2. Design → theme
   *   3. Images → visuals
   *   4. Assembly → final presentation (depends on 1, 2, 3)
   */
  static _splitPresentationTask(input) {
    const topic = TaskAnalyzer._extractTopic(input, "presentación");
    const baseId = `pres-${Date.now()}`;

    const tasks = [
      {
        id: `${baseId}-research`,
        name: "🧠 Investigación",
        description: `Investigando sobre: ${topic}`,
        instruction: `Investiga a fondo sobre "${topic}". Busca información actualizada, datos clave, y estructura el contenido para una presentación.`,
        skills: ["internet_search", "deep_research"],
        dependsOn: [],
        estimatedTime: 30000,
      },
      {
        id: `${baseId}-design`,
        name: "🎨 Diseño",
        description: `Creando diseño visual para: ${topic}`,
        instruction: `Diseña un tema visual moderno y profesional para una presentación sobre "${topic}". Define colores, tipografía y estilo.`,
        skills: ["ui_ux_pro_max"],
        dependsOn: [],
        estimatedTime: 20000,
      },
      {
        id: `${baseId}-images`,
        name: "🖼️ Imágenes",
        description: `Buscando imágenes sobre: ${topic}`,
        instruction: `Encuentra o genera imágenes relevantes para una presentación sobre "${topic}". Busca fotos, ilustraciones o genera imágenes con IA.`,
        skills: ["internet_search", "image_generation"],
        dependsOn: [],
        estimatedTime: 25000,
      },
      {
        id: `${baseId}-assembly`,
        name: "🏗️ Montaje",
        description: `Armando presentación sobre: ${topic}`,
        instruction: `Crea la presentación final sobre "${topic}" usando el contenido investigado, el diseño definido y las imágenes encontradas.`,
        skills: ["build_slidev_deck", "build_quarto_deck"],
        dependsOn: [`${baseId}-research`, `${baseId}-design`, `${baseId}-images`],
        estimatedTime: 40000,
      },
    ];

    return {
      canParallelize: true,
      tasks,
      reason: `Dividí la creación de la presentación sobre "${topic}" en 4 tareas paralelas`,
    };
  }

  /**
   * Splits research + build tasks.
   */
  static _splitResearchAndBuild(input) {
    const topic = TaskAnalyzer._extractTopic(input, "investigación");
    const baseId = `rb-${Date.now()}`;

    const tasks = [
      {
        id: `${baseId}-research`,
        name: "🔍 Investigación",
        description: `Investigando: ${topic}`,
        instruction: `Investiga a fondo sobre "${topic}". Recopila información actualizada y estructurada.`,
        skills: ["internet_search", "deep_research"],
        dependsOn: [],
        estimatedTime: 25000,
      },
      {
        id: `${baseId}-build`,
        name: "🔨 Construcción",
        description: `Construyendo: ${topic}`,
        instruction: `Implementa o construye lo solicitado sobre "${topic}". Usa la investigación cuando esté disponible.`,
        skills: [],
        dependsOn: [`${baseId}-research`],
        estimatedTime: 60000,
      },
    ];

    return {
      canParallelize: true,
      tasks,
      reason: `Dividí la tarea en investigación y construcción`,
    };
  }

  /**
   * Splits research + images tasks.
   */
  static _splitResearchAndImages(input) {
    const topic = TaskAnalyzer._extractTopic(input, "búsqueda");
    const baseId = `ri-${Date.now()}`;

    const tasks = [
      {
        id: `${baseId}-research`,
        name: "🔍 Investigación",
        description: `Investigando: ${topic}`,
        instruction: `Busca información sobre "${topic}".`,
        skills: ["internet_search"],
        dependsOn: [],
        estimatedTime: 20000,
      },
      {
        id: `${baseId}-images`,
        name: "🖼️ Imágenes",
        description: `Buscando imágenes de: ${topic}`,
        instruction: `Encuentra imágenes relacionadas con "${topic}".`,
        skills: ["internet_search", "image_generation"],
        dependsOn: [],
        estimatedTime: 20000,
      },
    ];

    return {
      canParallelize: true,
      tasks,
      reason: `Dividí la tarea en investigación y búsqueda de imágenes`,
    };
  }

  /**
   * Generic parallel split for tasks with explicit parallel markers.
   */
  static _splitGenericParallel(input) {
    // Try to split by "y" or commas for simple parallel tasks
    const parts = input.split(/y\s+(mientras\s+tanto|también|al\s+mismo\s+tiempo)/i);
    const baseId = `gen-${Date.now()}`;

    const tasks = parts
      .filter((p) => p.trim().length > 10)
      .map((part, i) => ({
        id: `${baseId}-${i}`,
        name: `Tarea ${i + 1}`,
        description: part.trim().substring(0, 100),
        instruction: part.trim(),
        skills: [],
        dependsOn: [],
        estimatedTime: 30000,
      }));

    if (tasks.length < 2) {
      return { canParallelize: false, tasks: [], reason: "No se detectaron tareas paralelas claras" };
    }

    return {
      canParallelize: true,
      tasks,
      reason: `Dividí la solicitud en ${tasks.length} tareas paralelas`,
    };
  }

  /**
   * Extracts the topic from the user input.
   */
  static _extractTopic(input, defaultLabel) {
    // Try to extract topic after common patterns
    const patterns = [
      /(?:sobre|acerca\s+de|de)\s+["""]?([^""".\n]+)["""]?/i,
      /(?:presentación|presentacion|slides)\s+(?:de|sobre|acerca\s+de)\s+["""]?([^""".\n]+)["""]?/i,
      /(?:investiga|busca)\s+(?:sobre|acerca\s+de|información\s+de)\s+["""]?([^""".\n]+)["""]?/i,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Fallback: use the first 50 chars of input
    return input.replace(/^(?:crea|haz|genera|investiga|busca)\s+/i, "").substring(0, 50).trim() || defaultLabel;
  }
}
