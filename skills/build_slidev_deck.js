/**
 * build_slidev_deck — Native Slidev Presentation Builder
 *
 * v1.0
 *
 * Creates and manages Slidev presentations directly from Markdown.
 * Slidev is the #1 trending dev tool for presentations — it renders
 * Markdown with Vue.js components, Framer Motion animations, WebGL,
 * and beautiful themes with live preview.
 *
 * What this skill does:
 *   1. Initializes a Slidev project (if not already present)
 *   2. Writes/updates slides.md with the provided content
 *   3. Starts a dev server on the specified port (default 3030)
 *   4. Returns the local URL for live preview
 *
 * Requirements:
 *   - Node.js >= 18
 *   - npx (comes with npm) — no global install needed, uses npx @slidev/cli
 *
 * Project structure created:
 *   {projectDir}/
 *     slides.md          ← Main presentation file (Markdown + frontmatter)
 *     package.json       ← Slidev dependencies
 *     node_modules/      ← Auto-installed by Slidev
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track active Slidev dev server processes
const activeServers = new Map();

/**
 * Generates a minimal package.json for a Slidev project.
 */
function generatePackageJson(projectDir) {
  return JSON.stringify(
    {
      name: path.basename(projectDir),
      private: true,
      scripts: {
        dev: "slidev",
        build: "slidev build",
        export: "slidev export",
      },
      dependencies: {
        "@slidev/cli": "^0.50.0",
        "@slidev/theme-default": "latest",
      },
    },
    null,
    2
  );
}

/**
 * Generates slides.md with frontmatter from user content.
 */
function generateSlidesMarkdown(frontmatter, content) {
  const fm = {
    theme: frontmatter.theme || "default",
    title: frontmatter.title || "Presentation",
    titleTemplate: frontmatter.titleTemplate || "%s — Slidev",
    info: frontmatter.info || false,
    author: frontmatter.author || "",
    keywords: frontmatter.keywords || "",
    presenter: frontmatter.presenter || false,
    download: frontmatter.download || false,
    exportFilename: frontmatter.exportFilename || "presentation",
    highlighter: frontmatter.highlighter || "shiki",
    lineNumbers: frontmatter.lineNumbers ?? true,
    monaco: frontmatter.monaco ?? "dev",
    remoteAssets: frontmatter.remoteAssets ?? false,
    selectable: frontmatter.selectable ?? true,
    record: frontmatter.record ?? false,
    colorSchema: frontmatter.colorSchema || "auto",
    routerMode: frontmatter.routerMode || "hash",
    aspectRatio: frontmatter.aspectRatio || "16/9",
    canvasWidth: frontmatter.canvasWidth || 980,
    fonts: frontmatter.fonts || {
      sans: "Nunito Sans",
      serif: "Georgia",
      mono: "Fira Code",
    },
    ...frontmatter.extra,
  };

  // Build YAML frontmatter
  let yaml = "---\n";
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      yaml += `${key}:\n`;
      for (const [sk, sv] of Object.entries(value)) {
        yaml += `  ${sk}: ${JSON.stringify(sv)}\n`;
      }
    } else if (typeof value === "string") {
      yaml += `${key}: ${value}\n`;
    } else if (typeof value === "boolean") {
      yaml += `${key}: ${value}\n`;
    } else {
      yaml += `${key}: ${value}\n`;
    }
  }
  yaml += "---\n\n";

  return yaml + (content || "");
}

/**
 * Checks if Node.js and npx are available.
 */
function checkPrerequisites() {
  try {
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
    if (major < 18) {
      return { ok: false, error: `Node.js >= 18 required. Current: ${nodeVersion}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Node.js not found." };
  }
}

/**
 * Kills any previously running Slidev dev server for the given project.
 */
function killExistingServer(projectDir) {
  const key = path.resolve(projectDir);
  const existing = activeServers.get(key);
  if (existing) {
    try {
      existing.kill("SIGTERM");
      // Force kill after 3s
      setTimeout(() => {
        try { existing.kill("SIGKILL"); } catch {}
      }, 3000);
    } catch {}
    activeServers.delete(key);
  }
}

export default {
  name: "build_slidev_deck",
  description:
    "Crea y gestiona presentaciones Slidev desde Markdown. " +
    "Inicializa un proyecto Slidev, escribe slides.md con el contenido proporcionado, " +
    "y levanta un servidor de desarrollo en el puerto especificado para vista previa en vivo. " +
    "Slidev renderiza Markdown con componentes Vue.js, animaciones Framer Motion, WebGL, " +
    "y temas espectaculares. Ideal para crear presentaciones técnicas, demos, y pitches.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "start", "stop", "status"],
        description:
          '"create": Crea un nuevo proyecto Slidev con slides.md. ' +
          '"start": Inicia el servidor de desarrollo con vista previa. ' +
          '"stop": Detiene el servidor de desarrollo. ' +
          '"status": Verifica el estado del servidor y proyecto.',
      },
      projectDir: {
        type: "string",
        description:
          "Directorio donde se creará/encuentra el proyecto Slidev. " +
          "Por defecto: './slidev-deck' dentro del proyecto activo.",
      },
      title: {
        type: "string",
        description:
          "(create) Título de la presentación. Aparece en la portada y en el titleTemplate.",
      },
      theme: {
        type: "string",
        description:
          "(create) Tema de Slidev. Opciones populares: 'default', 'seriph', 'apple-basic', 'geist', 'neversink', 'academic', 'penguin', 'unicorn'. Default: 'default'.",
      },
      content: {
        type: "string",
        description:
          "(create) Contenido completo en Markdown para slides.md. " +
          "Cada diapositiva se separa con '---'. " +
          "Incluye el soporte completo de Slidev: componentes Vue, layouts, clicks, animaciones, código con resaltado, diagramas Mermaid, etc.\n\n" +
          "Ejemplo de estructura:\n" +
          '  "# Mi Presentación\\n\\n---\\n\\n## Diapositiva 2\\n\\n- Punto 1\\n- Punto 2\\n\\n---\\n\\n## Código\\n\\n```ts\\nconst x = 1;\\n```"',
      },
      port: {
        type: "integer",
        description:
          "(start) Puerto para el servidor de desarrollo. Default: 3030.",
      },
      aspectRatio: {
        type: "string",
        description:
          "(create) Relación de aspecto. '16/9' (widescreen) o '4/3' (clásico). Default: '16/9'.",
      },
      colorSchema: {
        type: "string",
        description:
          "(create) Esquema de color: 'auto', 'light', 'dark'. Default: 'auto'.",
      },
      extraFrontmatter: {
        type: "object",
        description:
          "(create) Campos adicionales de frontmatter YAML (key-value). " +
          "Ej: { 'download': true, 'author': 'Tu Nombre', 'presenter': true }",
      },
    },
    required: ["action"],
  },

  handler: async (params, context) => {
    const signal = context?.signal;
    const { action, projectDir, title, theme, content, port, aspectRatio, colorSchema, extraFrontmatter } = params;

    const deckDir = projectDir
      ? path.resolve(projectDir)
      : path.resolve(process.cwd(), "slidev-deck");

    switch (action) {
      case "create":
        return await handleCreate(deckDir, { title, theme, content, aspectRatio, colorSchema, extraFrontmatter });
      case "start":
        return await handleStart(deckDir, port || 3030, signal);
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
  const { title, theme, content, aspectRatio, colorSchema, extraFrontmatter } = opts;

  // Check prerequisites
  const prereq = checkPrerequisites();
  if (!prereq.ok) return { success: false, error: prereq.error };

  // Kill existing server if any
  killExistingServer(deckDir);

  // Ensure directory exists
  if (!fs.existsSync(deckDir)) {
    fs.mkdirSync(deckDir, { recursive: true });
  }

  // Check if project already exists
  const pkgPath = path.resolve(deckDir, "package.json");
  const slidesPath = path.resolve(deckDir, "slides.md");
  const isNew = !fs.existsSync(pkgPath);

  // Build frontmatter
  const frontmatter = {
    theme: theme || "default",
    title: title || "Presentation",
    aspectRatio: aspectRatio || "16/9",
    colorSchema: colorSchema || "auto",
    ...(extraFrontmatter || {}),
  };

  // Generate slides.md
  const slidesContent = generateSlidesMarkdown(frontmatter, content || "");
  fs.writeFileSync(slidesPath, slidesContent, "utf-8");

  // Generate package.json if new
  if (isNew) {
    fs.writeFileSync(pkgPath, generatePackageJson(deckDir), "utf-8");

    // Create a basic .gitignore
    const gitignorePath = path.resolve(deckDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n.slidev/\n", "utf-8");
    }

    return {
      success: true,
      action: "created",
      projectDir: deckDir,
      slidesFile: slidesPath,
      message: `Proyecto Slidev creado en ${deckDir}. Usa action='start' para iniciar el servidor de desarrollo.`,
      nextSteps: [
        "Ejecuta build_slidev_deck con action='start' para ver la presentación en vivo",
        "El servidor estará disponible en http://localhost:3030",
        "Edita slides.md para modificar el contenido y ver cambios en tiempo real",
      ],
    };
  }

  return {
    success: true,
    action: "updated",
    projectDir: deckDir,
    slidesFile: slidesPath,
    message: `slides.md actualizado en ${deckDir}. Usa action='start' para (re)iniciar el servidor.`,
  };
}

async function handleStart(deckDir, port, signal) {
  // Check prerequisites
  const prereq = checkPrerequisites();
  if (!prereq.ok) return { success: false, error: prereq.error };

  // Validate project exists
  const pkgPath = path.resolve(deckDir, "package.json");
  const slidesPath = path.resolve(deckDir, "slides.md");

  if (!fs.existsSync(pkgPath)) {
    return {
      success: false,
      error: `Proyecto Slidev no encontrado en ${deckDir}. Usa action='create' primero.`,
    };
  }

  if (!fs.existsSync(slidesPath)) {
    return {
      success: false,
      error: `slides.md no encontrado en ${deckDir}. Usa action='create' para generar uno.`,
    };
  }

  // Kill existing server for this project
  killExistingServer(deckDir);

  // Install dependencies if node_modules missing
  const nodeModulesPath = path.resolve(deckDir, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    try {
      await execPromise("npm", ["install"], { cwd: deckDir });
    } catch (err) {
      return {
        success: false,
        error: `Error instalando dependencias: ${err.message}`,
        hint: "Asegúrate de que npm está disponible y hay conexión a internet.",
      };
    }
  }

  // Start Slidev dev server
  return new Promise((resolve) => {
    const child = spawn("npx", ["slidev", "--port", String(port), "--open", "false"], {
      cwd: deckDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let started = false;
    let url = `http://localhost:${port}`;
    let startTimeout;

    const key = path.resolve(deckDir);
    activeServers.set(key, child);

    // Handle abort signal
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        resolve({ success: false, error: "Operación cancelada por el usuario." });
        return;
      }
      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        resolve({ success: false, error: "Operación cancelada por el usuario." });
      }, { once: true });
    }

    child.stdout.on("data", (data) => {
      const text = data.toString();
      // Slidev outputs the local URL when ready
      const urlMatch = text.match(/http:\/\/localhost:\d+/);
      if (urlMatch && !started) {
        url = urlMatch[0];
        started = true;
        clearTimeout(startTimeout);

        // Give Slidev 2 more seconds to fully initialize before resolving
        setTimeout(() => {
          resolve({
            success: true,
            action: "started",
            projectDir: deckDir,
            url,
            port: parseInt(url.split(":").pop(), 10),
            pid: child.pid,
            message: `Servidor Slidev iniciado en ${url}`,
            note: "Abre esta URL en tu navegador para ver la presentación en vivo. Los cambios en slides.md se reflejan instantáneamente (HMR).",
            stopCommand: "Usa build_slidev_deck con action='stop' cuando termines.",
          });
        }, 2000);
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      // Slidev sometimes outputs URLs on stderr too
      const urlMatch = text.match(/http:\/\/localhost:\d+/);
      if (urlMatch && !started) {
        url = urlMatch[0];
        started = true;
        clearTimeout(startTimeout);
        setTimeout(() => {
          resolve({
            success: true,
            action: "started",
            projectDir: deckDir,
            url,
            port: parseInt(url.split(":").pop(), 10),
            pid: child.pid,
            message: `Servidor Slidev iniciado en ${url}`,
          });
        }, 2000);
      }
    });

    child.on("error", (err) => {
      clearTimeout(startTimeout);
      activeServers.delete(key);
      resolve({
        success: false,
        error: `Error al iniciar Slidev: ${err.message}`,
        hint: "Verifica que npx y @slidev/cli estén disponibles.",
      });
    });

    child.on("exit", (code) => {
      activeServers.delete(key);
      if (!started) {
        clearTimeout(startTimeout);
        resolve({
          success: false,
          error: `Slidev terminó inesperadamente con código ${code}.`,
          hint: "Revisa los logs del servidor para más detalles.",
        });
      }
    });

    // Timeout — 30 seconds to start
    startTimeout = setTimeout(() => {
      if (!started) {
        child.kill("SIGTERM");
        activeServers.delete(key);
        resolve({
          success: false,
          error: "Timeout esperando a que Slidev inicie (30s).",
          hint: "Puede que el puerto esté ocupado o falten dependencias.",
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
      message: `No hay servidor Slidev activo para ${deckDir}.`,
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
      message: `Servidor Slidev detenido para ${deckDir}.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Error al detener servidor: ${err.message}`,
    };
  }
}

function handleStatus(deckDir) {
  const key = path.resolve(deckDir);
  const existing = activeServers.get(key);
  const pkgPath = path.resolve(deckDir, "package.json");
  const slidesPath = path.resolve(deckDir, "slides.md");

  return {
    success: true,
    projectDir: deckDir,
    projectExists: fs.existsSync(pkgPath),
    slidesExist: fs.existsSync(slidesPath),
    serverRunning: !!existing,
    pid: existing?.pid || null,
    activeServersCount: activeServers.size,
  };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

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
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}\n${stderr || stdout}`));
      }
    });
  });
}
