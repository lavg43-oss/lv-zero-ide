/**
 * build_quarto_deck — Native Quarto/Reveal.js Presentation Builder
 *
 * v1.1 — Portable Quarto support
 *
 * Creates and manages Quarto presentations using the Reveal.js engine.
 * Quarto is the scientific-technical standard for presentations — brutally
 * powerful for showing code, interactive graphics, 3D layouts, and
 * mathematical notation.
 *
 * What this skill does:
 *   1. Initializes a Quarto project with Reveal.js format
 *   2. Writes/updates index.qmd with the provided content
 *   3. Creates _quarto.yml with project configuration
 *   4. Renders the presentation to HTML (viewable in browser)
 *   5. Starts a preview server on the specified port (default 3031)
 *
 * Quarto renders markdown with:
 *   - Reveal.js transitions (spatial/camera movement between slides)
 *   - Code blocks with execution (Python, R, Julia, Observable JS)
 *   - Mermaid, Graphviz, and D3 diagrams
 *   - LaTeX math (KaTeX/MathJax)
 *   - Interactive widgets (Jupyter, Observable)
 *   - 3D graphics via Three.js
 *
 * Requirements:
 *   - Quarto CLI installed (auto-detects from PATH or portable locations:
 *     C:\Users\LAVG\quarto\bin\quarto.exe, ~/quarto/bin/quarto)
 *   - Node.js >= 18 (for Reveal.js)
 *
 * Project structure created:
 *   {projectDir}/
 *     index.qmd          ← Main presentation file (Quarto Markdown)
 *     _quarto.yml        ← Project configuration
 *     .gitignore         ← Version control exclusions
 *     _extensions/       ← Quarto extensions (optional)
 *     index_files/       ← Generated assets
 *     index.html         ← Rendered presentation (after quarto render)
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawn, execFileSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track active Quarto preview servers
const activeServers = new Map();

// ── Portable Quarto path resolution ────────────────────────────────────
// Fallback paths to check if `quarto` is not in system PATH.
// On Windows, the portable install is commonly at ~/quarto/bin/quarto.exe
const QUARTO_PATHS = [
  "quarto", // Default: rely on system PATH
  path.join(os.homedir(), "quarto", "bin", "quarto.exe"),
  path.join(os.homedir(), "quarto", "bin", "quarto"),
  path.join(os.homedir(), "AppData", "Local", "Programs", "Quarto", "bin", "quarto.exe"),
  "C:\\Program Files\\Quarto\\bin\\quarto.exe",
  "C:\\Users\\LAVG\\quarto\\bin\\quarto.exe",
];

let _resolvedQuartoPath = null;

/**
 * Resolves the path to the Quarto CLI binary.
 * Caches the result after first successful resolution.
 * Checks PATH first, then common portable/install locations.
 */
function resolveQuartoPath() {
  if (_resolvedQuartoPath) return _resolvedQuartoPath;
  for (const qPath of QUARTO_PATHS) {
    try {
      if (qPath === "quarto") {
        // Check if it's in PATH by trying to spawn it
        const result = execFileSync(qPath, ["--version"], {
          stdio: "pipe",
          encoding: "utf-8",
          timeout: 5000,
        });
        if (result) {
          _resolvedQuartoPath = qPath;
          return qPath;
        }
      } else {
        if (fs.existsSync(qPath)) {
          _resolvedQuartoPath = qPath;
          return qPath;
        }
      }
    } catch {
      // Not found at this path, continue
    }
  }
  return null;
}

/**
 * Returns the quarto command (full path or just "quarto"), or null if not found.
 */
function getQuartoCmd() {
  return resolveQuartoPath();
}

/**
 * Generates _quarto.yml configuration for a Reveal.js presentation.
 */
function generateQuartoConfig(opts) {
  const lines = [
    "# ── Project Metadata ──────────────────────────────────────────────────",
    "project:",
    "  type: default",
    `  output-dir: ${opts.outputDir || "."}`,
    "",
    "# ── Reveal.js Format Configuration ────────────────────────────────────",
    "format:",
    "  revealjs:",
    `    theme: ${opts.theme || "default"}`,
    `    title: "${opts.title || "Presentation"}"`,
    `    title-slide-attributes:`,
    `      data-background-image: "${opts.titleBackground || ""}"`,
    `      data-background-size: cover`,
    `      data-background-opacity: "0.5"`,
    "    slide-number: true",
    "    chalkboard: false",
    "    preview-links: auto",
    `    width: ${opts.width || 1280}`,
    `    height: ${opts.height || 720}`,
    "    margin: 0.1",
    `    min-scale: ${opts.minScale || 0.2}`,
    `    max-scale: ${opts.maxScale || 2.0}`,
    "    center: true",
    `    navigation-mode: ${opts.navigationMode || "linear"}`,
    `    transition: ${opts.transition || "slide"}`,
    `    transition-speed: ${opts.transitionSpeed || "default"}`,
    `    background-transition: ${opts.backgroundTransition || "fade"}`,
    `    parallax-background-image: "${opts.parallaxBg || ""}"`,
    `    parallax-background-size: "${opts.parallaxBgSize || "2100px 900px"}"`,
    "    auto-slide: 0",
    "    loop: false",
    "    rtl: false",
    `    mouse-wheel: ${opts.mouseWheel ?? false}`,
    "    controls: true",
    "    progress: true",
    `    history: ${opts.history ?? true}`,
    `    hash: ${opts.hash ?? true}`,
    `    overview: ${opts.overview ?? true}`,
    "    touch: true",
    "",
    "# ── Code Execution Engine ─────────────────────────────────────────────",
    `    code-line-numbers: ${opts.codeLineNumbers ?? true}`,
    `    code-overflow: ${opts.codeOverflow || "scroll"}`,
    `    code-copy: ${opts.codeCopy ?? true}`,
    "    code-link: true",
    `    df-print: ${opts.dfPrint || "kable"}`,
    "",
    "# ── Filters and Extensions ───────────────────────────────────────────",
    `    filters: ${JSON.stringify(opts.filters || [])}`,
    `    include-in-header: ${JSON.stringify(opts.includeInHeader || [])}`,
    `    include-before-body: ${JSON.stringify(opts.includeBeforeBody || [])}`,
    `    include-after-body: ${JSON.stringify(opts.includeAfterBody || [])}`,
    "",
    "# ── Bibliography / Citations ──────────────────────────────────────────",
    `    bibliography: ${JSON.stringify(opts.bibliography || [])}`,
    `    csl: ${opts.csl || ""}`,
    `    link-citations: ${opts.linkCitations ?? true}`,
    "",
    "# ── Logo and Footer ───────────────────────────────────────────────────",
    `    logo: "${opts.logo || ""}"`,
    `    footer: "${opts.footer || ""}"`,
    "",
    "# ── Reveal.js Plugins ──────────────────────────────────────────────────",
    "    revealjs-plugins:",
    "      - search",
    "      - zoom",
    `      - ${opts.includeNotes ? "notes" : "#notes"}`,
    `      - ${opts.includeMenu ? "menu" : "#menu"}`,
    "",
    "# ── Executive ──────────────────────────────────────────────────────────",
    "execute:",
    `  echo: ${opts.echoCode ?? true}`,
    `  warning: ${opts.showWarnings ?? false}`,
    "  error: false",
    `  freeze: ${opts.freeze ?? "auto"}`,
    "",
    "# ── Editor ─────────────────────────────────────────────────────────────",
    "editor:",
    "  render-on-save: true",
  ];

  return lines.join("\n");
}

/**
 * Generates index.qmd from frontmatter and content.
 */
function generateIndexQmd(frontmatter, content) {
  let yaml = "---\n";
  yaml += `title: "${frontmatter.title || "Presentation"}"\n`;
  yaml += `subtitle: "${frontmatter.subtitle || ""}"\n`;
  yaml += `author: "${frontmatter.author || ""}"\n`;
  yaml += `date: "${frontmatter.date || new Date().toISOString().split("T")[0]}"\n`;
  if (frontmatter.institute) yaml += `institute: "${frontmatter.institute}"\n`;
  if (frontmatter.abstract) yaml += `abstract: "${frontmatter.abstract}"\n`;
  yaml += `format:\n  revealjs: default\n`;
  if (frontmatter.bibliography) yaml += `bibliography: ${JSON.stringify(frontmatter.bibliography)}\n`;
  if (frontmatter.csl) yaml += `csl: ${frontmatter.csl}\n`;
  if (frontmatter.logo) yaml += `logo: "${frontmatter.logo}"\n`;
  if (frontmatter.footer) yaml += `footer: "${frontmatter.footer}"\n`;
  if (frontmatter.titleSlideBackground) {
    yaml += `title-slide-attributes:\n  data-background-image: "${frontmatter.titleSlideBackground}"\n  data-background-size: cover\n`;
  }

  // Extra frontmatter
  if (frontmatter.extra) {
    for (const [key, value] of Object.entries(frontmatter.extra)) {
      if (typeof value === "string") {
        yaml += `${key}: "${value}"\n`;
      } else {
        yaml += `${key}: ${JSON.stringify(value)}\n`;
      }
    }
  }

  yaml += "---\n\n";
  yaml += content || "";
  return yaml;
}

/**
 * Checks if Quarto CLI is available.
 */
async function checkQuartoInstalled() {
  const cmd = getQuartoCmd();
  if (!cmd) {
    return {
      ok: false,
      error: "Quarto CLI no está instalado. Descarga desde https://quarto.org/docs/download/",
      installInstructions: {
        windows: "Descarga el ZIP portable desde https://github.com/quarto-dev/quarto-cli/releases y extrae a C:\\Users\\LAVG\\quarto\\",
        macos: "brew install quarto",
        linux: "Descarga el .deb/.rpm desde https://quarto.org/docs/download/",
      },
    };
  }
  try {
    await execPromise(cmd, ["--version"]);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Quarto CLI no está instalado.",
      installInstructions: {
        windows: "Descarga el ZIP portable desde https://github.com/quarto-dev/quarto-cli/releases y extrae a C:\\Users\\LAVG\\quarto\\",
        macos: "brew install quarto",
        linux: "Descarga el .deb/.rpm desde https://quarto.org/docs/download/",
      },
    };
  }
}

export default {
  name: "build_quarto_deck",
  description:
    "Crea y gestiona presentaciones Quarto/Reveal.js. " +
    "Inicializa un proyecto Quarto con Reveal.js, escribe index.qmd con contenido, " +
    "crea _quarto.yml con la configuración del proyecto, renderiza a HTML, " +
    "e inicia un servidor de preview. " +
    "Quarto renderiza Markdown con Reveal.js para transiciones espaciales, código ejecutable, " +
    "gráficos interactivos, LaTeX, diagramas Mermaid/Graphviz, y widgets 3D. " +
    "Es el estándar científico-tecnológico para presentaciones.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "render", "preview", "stop", "status"],
        description:
          '"create": Crea un nuevo proyecto Quarto con index.qmd y _quarto.yml. ' +
          '"render": Renderiza la presentación a HTML (y a PDF/PPTX si se especifica). ' +
          '"preview": Inicia servidor de preview con live-reload. ' +
          '"stop": Detiene el servidor de preview. ' +
          '"status": Verifica el estado del proyecto y servidor.',
      },
      projectDir: {
        type: "string",
        description:
          "Directorio donde se creará/encuentra el proyecto Quarto. " +
          "Por defecto: './quarto-deck' dentro del proyecto activo.",
      },
      title: {
        type: "string",
        description:
          "(create) Título de la presentación. Aparece en la portada y metadatos.",
      },
      subtitle: {
        type: "string",
        description: "(create) Subtítulo de la presentación.",
      },
      author: {
        type: "string",
        description: "(create) Autor(es) de la presentación.",
      },
      theme: {
        type: "string",
        description:
          "(create) Tema de Reveal.js. Opciones: 'default', 'simple', 'sky', 'beige', 'serif', 'solarized', 'blood', 'night', 'moon', 'league', 'white', 'black'. Default: 'default'.",
      },
      transition: {
        type: "string",
        description:
          "(create) Transición entre diapositivas: 'none', 'fade', 'slide', 'convex', 'concave', 'zoom'. Default: 'slide'.",
      },
      content: {
        type: "string",
        description:
          "(create) Contenido completo en Quarto Markdown para index.qmd. " +
          "Cada diapositiva se separa con '---' o '## ' (heading nivel 2). " +
          "Soporta: código ejecutable (Python, R, Julia), bloques de código con resaltado, " +
          "LaTeX math, diagramas Mermaid, columnas, fragments, background images, videos, iframes.\n\n" +
          "Ejemplo:\n" +
          '"## Slide 1\\n\\nContent\\n\\n---\\n\\n## Slide 2 {background-image=\\"img/bg.jpg\\"}\\n\\n- Point 1\\n- Point 2\\n\\n## Code\\n\\n```python\\nprint(42)\\n```"',
      },
      port: {
        type: "integer",
        description:
          "(preview) Puerto para el servidor de preview. Default: 3031.",
      },
      includeNotes: {
        type: "boolean",
        description:
          "(create) Incluir plugin de presenter notes. Default: true.",
      },
      includeMenu: {
        type: "boolean",
        description:
          "(create) Incluir plugin de menú de navegación. Default: false.",
      },
      codeLineNumbers: {
        type: "boolean",
        description:
          "(create) Mostrar números de línea en bloques de código. Default: true.",
      },
      codeCopy: {
        type: "boolean",
        description:
          "(create) Botón de copiar en bloques de código. Default: true.",
      },
      logo: {
        type: "string",
        description: "(create) Ruta a imagen de logo para el footer.",
      },
      footer: {
        type: "string",
        description: "(create) Texto del footer.",
      },
      extraConfig: {
        type: "object",
        description:
          "(create) Configuración adicional para _quarto.yml (key-value). " +
          "Se fusiona con la configuración por defecto.",
      },
    },
    required: ["action"],
  },

  handler: async (params, context) => {
    const signal = context?.signal;
    const {
      action,
      projectDir,
      title,
      subtitle,
      author,
      theme,
      transition,
      content,
      port,
      includeNotes,
      includeMenu,
      codeLineNumbers,
      codeCopy,
      logo,
      footer,
      extraConfig,
    } = params;

    const deckDir = projectDir
      ? path.resolve(projectDir)
      : path.resolve(process.cwd(), "quarto-deck");

    switch (action) {
      case "create":
        return await handleCreate(deckDir, {
          title, subtitle, author, theme, transition, content,
          includeNotes, includeMenu, codeLineNumbers, codeCopy,
          logo, footer, extraConfig,
        });
      case "render":
        return await handleRender(deckDir, signal);
      case "preview":
        return await handlePreview(deckDir, port || 3031, signal);
      case "stop":
        return handleStop(deckDir);
      case "status":
        return handleStatus(deckDir);
      default:
        return { success: false, error: `Acción desconocida: ${action}` };
    }
  },
};

// ─── Action Handlers ─────────────────────────────────────────────────────────

async function handleCreate(deckDir, opts) {
  // Check Quarto CLI
  const quartoCheck = await checkQuartoInstalled();
  if (!quartoCheck.ok) {
    return {
      success: false,
      error: quartoCheck.error,
      installInstructions: quartoCheck.installInstructions,
    };
  }

  // Kill existing server if any
  killExistingServer(deckDir);

  // Ensure directory exists
  if (!fs.existsSync(deckDir)) {
    fs.mkdirSync(deckDir, { recursive: true });
  }

  const ymlPath = path.resolve(deckDir, "_quarto.yml");
  const qmdPath = path.resolve(deckDir, "index.qmd");
  const isNew = !fs.existsSync(ymlPath) && !fs.existsSync(qmdPath);

  // Build _quarto.yml
  const quartoConfig = generateQuartoConfig({
    title: opts.title || "Presentation",
    theme: opts.theme || "default",
    transition: opts.transition || "slide",
    includeNotes: opts.includeNotes ?? true,
    includeMenu: opts.includeMenu ?? false,
    codeLineNumbers: opts.codeLineNumbers ?? true,
    codeCopy: opts.codeCopy ?? true,
    logo: opts.logo || "",
    footer: opts.footer || "",
    ...(opts.extraConfig || {}),
  });
  fs.writeFileSync(ymlPath, quartoConfig, "utf-8");

  // Build index.qmd
  const qmdContent = generateIndexQmd(
    {
      title: opts.title || "Presentation",
      subtitle: opts.subtitle || "",
      author: opts.author || "",
      logo: opts.logo || "",
      footer: opts.footer || "",
    },
    opts.content || ""
  );
  fs.writeFileSync(qmdPath, qmdContent, "utf-8");

  // Create .gitignore
  const gitignorePath = path.resolve(deckDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      "_site/\nindex_files/\nindex.html\n.Rproj.user/\n*.Rproj\n",
      "utf-8"
    );
  }

  // Initialize Quarto project (installs extensions if needed)
  try {
    await execPromise("quarto", ["check"], { cwd: deckDir });
  } catch {
    // Non-fatal — quarto check may warn but project is still valid
  }

  return {
    success: true,
    action: "created",
    projectDir: deckDir,
    files: {
      qmd: qmdPath,
      yml: ymlPath,
    },
    message: isNew
      ? `Proyecto Quarto creado en ${deckDir}. Usa action='render' para renderizar a HTML, o action='preview' para vista en vivo.`
      : `Archivos Quarto actualizados en ${deckDir}.`,
    nextSteps: [
      "Ejecuta build_quarto_deck con action='render' para generar el HTML",
      "O action='preview' para iniciar servidor con live-reload en http://localhost:3031",
      "Edita index.qmd para modificar el contenido. Quarto regenera automáticamente.",
      "Usa export_deck_to_static con engine='quarto' para exportar a PDF/PPTX.",
    ],
  };
}

async function handleRender(deckDir, signal) {
  const quartoCheck = await checkQuartoInstalled();
  if (!quartoCheck.ok) {
    return {
      success: false,
      error: quartoCheck.error,
      installInstructions: quartoCheck.installInstructions,
    };
  }

  const qmdPath = path.resolve(deckDir, "index.qmd");
  const ymlPath = path.resolve(deckDir, "_quarto.yml");

  if (!fs.existsSync(qmdPath) && !fs.existsSync(ymlPath)) {
    return {
      success: false,
      error: `Proyecto Quarto no encontrado en ${deckDir}. Usa action='create' primero.`,
    };
  }

  const cmd = getQuartoCmd();
  if (!cmd) {
    return {
      success: false,
      error: "Quarto CLI no está instalado. No se puede renderizar.",
    };
  }

  try {
    const result = await execPromise(cmd, ["render"], {
      cwd: deckDir,
      maxBuffer: 10 * 1024 * 1024,
    });

    const htmlPath = path.resolve(deckDir, "index.html");
    const htmlExists = fs.existsSync(htmlPath);

    return {
      success: true,
      action: "rendered",
      projectDir: deckDir,
      htmlFile: htmlExists ? htmlPath : null,
      htmlExists,
      message: htmlExists
        ? `Presentación renderizada exitosamente: ${htmlPath}`
        : "Renderizado completado, pero no se encontró index.html. Revisa los logs de Quarto.",
      note: htmlExists
        ? "Abre index.html en tu navegador para ver la presentación, o usa action='preview' para live-reload."
        : "",
    };
  } catch (err) {
    return {
      success: false,
      error: `Error al renderizar: ${err.message || err}`,
      hint: "Revisa que index.qmd y _quarto.yml tengan sintaxis válida.",
      detail: err.stderr || "",
    };
  }
}

async function handlePreview(deckDir, port, signal) {
  const quartoCheck = await checkQuartoInstalled();
  if (!quartoCheck.ok) {
    return {
      success: false,
      error: quartoCheck.error,
      installInstructions: quartoCheck.installInstructions,
    };
  }

  const qmdPath = path.resolve(deckDir, "index.qmd");
  const ymlPath = path.resolve(deckDir, "_quarto.yml");

  if (!fs.existsSync(qmdPath) && !fs.existsSync(ymlPath)) {
    return {
      success: false,
      error: `Proyecto Quarto no encontrado en ${deckDir}. Usa action='create' primero.`,
    };
  }

  // Kill existing server
  killExistingServer(deckDir);

  const cmd = getQuartoCmd();
  if (!cmd) {
    return {
      success: false,
      error: "Quarto CLI no está instalado. No se puede iniciar preview.",
    };
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, ["preview", "--port", String(port), "--no-browser"], {
      cwd: deckDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let started = false;
    let url = `http://localhost:${port}`;
    let startTimeout;

    const key = path.resolve(deckDir);
    activeServers.set(key, child);

    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        resolve({ success: false, error: "Operación cancelada." });
        return;
      }
      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        resolve({ success: false, error: "Operación cancelada." });
      }, { once: true });
    }

    child.stdout.on("data", (data) => {
      const text = data.toString();
      const urlMatch = text.match(/http:\/\/localhost:\d+/);
      if (urlMatch && !started) {
        url = urlMatch[0];
        started = true;
        clearTimeout(startTimeout);
        setTimeout(() => {
          resolve({
            success: true,
            action: "preview",
            projectDir: deckDir,
            url,
            port: parseInt(url.split(":").pop(), 10),
            pid: child.pid,
            message: `Quarto preview iniciado en ${url}`,
            note: "Los cambios en index.qmd y _quarto.yml se reflejan con live-reload automático.",
          });
        }, 2000);
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      const urlMatch = text.match(/http:\/\/localhost:\d+/);
      if (urlMatch && !started) {
        url = urlMatch[0];
        started = true;
        clearTimeout(startTimeout);
        setTimeout(() => {
          resolve({
            success: true,
            action: "preview",
            projectDir: deckDir,
            url,
            port: parseInt(url.split(":").pop(), 10),
            pid: child.pid,
            message: `Quarto preview iniciado en ${url}`,
          });
        }, 2000);
      }
    });

    child.on("error", (err) => {
      clearTimeout(startTimeout);
      activeServers.delete(key);
      resolve({
        success: false,
        error: `Error al iniciar Quarto preview: ${err.message}`,
      });
    });

    child.on("exit", (code) => {
      activeServers.delete(key);
      if (!started) {
        clearTimeout(startTimeout);
        resolve({
          success: false,
          error: `Quarto preview terminó con código ${code}.`,
        });
      }
    });

    startTimeout = setTimeout(() => {
      if (!started) {
        child.kill("SIGTERM");
        activeServers.delete(key);
        resolve({
          success: false,
          error: "Timeout esperando a Quarto preview (30s).",
        });
      }
    }, 30000);
  });
}

function handleStop(deckDir) {
  const key = path.resolve(deckDir);
  const existing = activeServers.get(key);

  if (!existing) {
    return {
      success: true,
      action: "already_stopped",
      message: `No hay servidor Quarto preview activo para ${deckDir}.`,
    };
  }

  try {
    existing.kill("SIGTERM");
    setTimeout(() => {
      try { existing.kill("SIGKILL"); } catch {}
    }, 3000);
    activeServers.delete(key);
    return {
      success: true,
      action: "stopped",
      message: `Quarto preview detenido para ${deckDir}.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Error al detener: ${err.message}`,
    };
  }
}

function handleStatus(deckDir) {
  const key = path.resolve(deckDir);
  const existing = activeServers.get(key);
  const qmdPath = path.resolve(deckDir, "index.qmd");
  const ymlPath = path.resolve(deckDir, "_quarto.yml");
  const htmlPath = path.resolve(deckDir, "index.html");

  return {
    success: true,
    projectDir: deckDir,
    projectExists: fs.existsSync(qmdPath) || fs.existsSync(ymlPath),
    qmdExists: fs.existsSync(qmdPath),
    ymlExists: fs.existsSync(ymlPath),
    htmlExists: fs.existsSync(htmlPath),
    serverRunning: !!existing,
    pid: existing?.pid || null,
  };
}

function killExistingServer(deckDir) {
  const key = path.resolve(deckDir);
  const existing = activeServers.get(key);
  if (existing) {
    try {
      existing.kill("SIGTERM");
      setTimeout(() => {
        try { existing.kill("SIGKILL"); } catch {}
      }, 3000);
    } catch {}
    activeServers.delete(key);
  }
}

function execPromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`${command} ${args.join(" ")} exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}
