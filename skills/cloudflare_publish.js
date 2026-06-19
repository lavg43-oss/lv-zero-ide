/**
 * ─── Cloudflare Pages Publisher — Skill for lv-zero ──────────────────────
 *
 * "Nivel Cero" — Publicación en 1 click a Cloudflare Pages.
 *
 * Permite al agente desplegar el proyecto actual en Cloudflare Pages
 * usando la API de Cloudflare o wrangler CLI.
 *
 * Requisitos:
 *   - CLOUDFLARE_API_TOKEN en .env (con permisos de Pages)
 *   - CLOUDFLARE_ACCOUNT_ID en .env
 *
 * v1.0 — June 2026
 *
 * @module cloudflare_publish
 */

import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";

// ─── Constants ────────────────────────────────────────────────────────────────

const CLOUDFLARE_PAGES_API = "https://api.cloudflare.com/client/v4";

// ═══════════════════════════════════════════════════════════════════════════════
// Skill Definition
// ═══════════════════════════════════════════════════════════════════════════════

const cloudflarePublishSkill = {
  name: "cloudflare_publish",
  description:
    "🌐 Publica el proyecto actual en Cloudflare Pages en 1 click. " +
    "Gratuito: 500 builds/mes, ancho de banda ilimitado, almacenamiento ilimitado. " +
    "Detecta automáticamente el framework (Vite, React, Next.js, Astro, Svelte, etc.) " +
    "y configura el build. Devuelve la URL de publicación.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["deploy", "status", "list_projects", "setup"],
        description:
          '"deploy": Publica el proyecto actual en Cloudflare Pages. ' +
          '"status": Verifica el estado del último deploy. ' +
          '"list_projects": Lista los proyectos en Cloudflare Pages. ' +
          '"setup": Configura Cloudflare Pages por primera vez (guía paso a paso).',
      },
      projectPath: {
        type: "string",
        description:
          "(Opcional) Ruta del proyecto a publicar. Por defecto usa el proyecto activo.",
      },
      projectName: {
        type: "string",
        description:
          "(Opcional) Nombre del proyecto en Cloudflare Pages. " +
          "Si no se especifica, usa el nombre del directorio.",
      },
      branch: {
        type: "string",
        description:
          "(Opcional) Rama a desplegar. Por defecto: main",
        default: "main",
      },
    },
  },

  handler: async (params, context = {}) => {
    const { action = "deploy", projectPath, projectName, branch = "main" } = params;

    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    switch (action) {
      case "setup":
        return handleSetup();
      case "deploy":
        return await handleDeploy(projectPath, projectName, branch, apiToken, accountId);
      case "status":
        return await handleStatus(projectPath, projectName, apiToken, accountId);
      case "list_projects":
        return await handleListProjects(apiToken, accountId);
      default:
        return { success: false, error: `Acción desconocida: ${action}` };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Setup guide — shows the user how to configure Cloudflare Pages.
 */
function handleSetup() {
  return {
    success: true,
    message: `Para configurar Cloudflare Pages sigue estos pasos:

1. Ve a https://dash.cloudflare.com/profile/api-tokens
2. Crea un token con permisos: "Cloudflare Pages: Edit"
3. Copia el token y tu Account ID (lo ves en la URL del dashboard)
4. Agrega al archivo .env:
   CLOUDFLARE_API_TOKEN=tu_token
   CLOUDFLARE_ACCOUNT_ID=tu_account_id

5. ¡Listo! Ahora puedes usar "cloudflare_publish" para publicar.`,
    steps: [
      "Ir a https://dash.cloudflare.com/profile/api-tokens",
      "Crear token con permisos Pages:Edit",
      "Copiar token y Account ID",
      "Agregar a .env",
      "Usar cloudflare_publish action:deploy",
    ],
  };
}

/**
 * Deploys the project to Cloudflare Pages.
 */
async function handleDeploy(projectPath, projectName, branch, apiToken, accountId) {
  // Validate credentials
  if (!apiToken || !accountId) {
    return {
      success: false,
      error: "Cloudflare no configurado. Ejecuta 'cloudflare_publish' con action:'setup' para ver las instrucciones.",
      needsSetup: true,
    };
  }

  // Resolve project path
  const targetPath = projectPath
    ? path.resolve(projectPath)
    : process.env.LV_PROJECT_PATH || process.cwd();

  if (!fs.existsSync(targetPath)) {
    return { success: false, error: `Ruta no encontrada: ${targetPath}` };
  }

  const projectDirName = path.basename(targetPath);
  const cfProjectName = projectName || projectDirName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  // Detect build output directory
  const buildDir = detectBuildDir(targetPath);
  const buildCommand = detectBuildCommand(targetPath);

  // Step 1: Build the project if there's a build command
  if (buildCommand) {
    try {
      console.log(`   🔨 Ejecutando build: ${buildCommand}`);
      execSync(buildCommand, { cwd: targetPath, stdio: "pipe", timeout: 120000 });
    } catch (err) {
      return {
        success: false,
        error: `Error en build: ${err.message}`,
        suggestion: "¿El proyecto necesita un build? Si es HTML estático, ignora este error.",
      };
    }
  }

  // Step 2: Check if wrangler is available
  let useWrangler = false;
  try {
    execSync("npx wrangler --version", { stdio: "pipe", timeout: 10000 });
    useWrangler = true;
  } catch {
    useWrangler = false;
  }

  // Step 3: Deploy
  try {
    if (useWrangler) {
      return await deployWithWrangler(targetPath, cfProjectName, branch, buildDir, apiToken, accountId);
    } else {
      return await deployWithAPI(targetPath, cfProjectName, branch, buildDir, apiToken, accountId);
    }
  } catch (err) {
    return {
      success: false,
      error: `Error en deploy: ${err.message}`,
      suggestion: "¿Tienes instalado wrangler? Prueba: npm install -g wrangler",
    };
  }
}

/**
 * Deploy using wrangler CLI (preferred).
 */
async function deployWithWrangler(targetPath, projectName, branch, buildDir, apiToken, accountId) {
  return new Promise((resolve) => {
    const args = [
      "wrangler",
      "pages",
      "deploy",
      buildDir || ".",
      "--project-name", projectName,
      "--branch", branch,
    ];

    const proc = spawn("npx", args, {
      cwd: targetPath,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_ACCOUNT_ID: accountId,
      },
    });

    let output = "";
    proc.stdout.on("data", (chunk) => { output += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { output += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        // Extract URL from output
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.pages\.dev/i);
        const deployUrl = urlMatch ? urlMatch[0] : `https://${projectName}.pages.dev`;
        resolve({
          success: true,
          url: deployUrl,
          projectName,
          message: `✅ ¡Publicado en Cloudflare Pages!\n🌐 ${deployUrl}\nComparte este link con quien quieras.`,
        });
      } else {
        resolve({
          success: false,
          error: `Wrangler exit code: ${code}\n${output.slice(-500)}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Deploy using Cloudflare API directly (no wrangler needed).
 */
async function deployWithAPI(targetPath, projectName, branch, buildDir, apiToken, accountId) {
  const buildPath = buildDir ? path.resolve(targetPath, buildDir) : targetPath;

  if (!fs.existsSync(buildPath)) {
    return { success: false, error: `Build directory not found: ${buildPath}` };
  }

  // Read all files from build directory
  const files = [];
  readDirRecursive(buildPath, buildPath, files);

  if (files.length === 0) {
    return { success: false, error: "No files found to deploy. Did you run the build?" };
  }

  // Create deployment via Cloudflare API
  try {
    // Step 1: Get or create the project
    const projectResult = await cfApiRequest(
      `${CLOUDFLARE_PAGES_API}/accounts/${accountId}/pages/projects/${projectName}`,
      "GET",
      apiToken
    );

    if (projectResult.status === 404) {
      // Create project
      await cfApiRequest(
        `${CLOUDFLARE_PAGES_API}/accounts/${accountId}/pages/projects`,
        "POST",
        apiToken,
        {
          name: projectName,
          production_branch: branch,
        }
      );
    }

    // Step 2: Create deployment
    const deployResult = await cfApiRequest(
      `${CLOUDFLARE_PAGES_API}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      "POST",
      apiToken,
      {
        branch,
        files: files.map((f) => ({
          key: f.relativePath,
          value: f.content,
        })),
      }
    );

    if (deployResult.success) {
      const url = deployResult.result?.url || `https://${projectName}.pages.dev`;
      return {
        success: true,
        url,
        projectName,
        filesCount: files.length,
        message: `✅ ¡Publicado en Cloudflare Pages!\n🌐 ${url}\n📄 ${files.length} archivos desplegados.\nComparte este link con quien quieras.`,
      };
    }

    return { success: false, error: "API deployment failed" };
  } catch (err) {
    return { success: false, error: `API error: ${err.message}` };
  }
}

/**
 * Checks the status of the latest deployment.
 */
async function handleStatus(projectPath, projectName, apiToken, accountId) {
  if (!apiToken || !accountId) {
    return { success: false, error: "Cloudflare no configurado" };
  }

  const targetPath = projectPath
    ? path.resolve(projectPath)
    : process.env.LV_PROJECT_PATH || process.cwd();
  const cfProjectName = projectName || path.basename(targetPath).toLowerCase().replace(/[^a-z0-9-]/g, "-");

  try {
    const result = await cfApiRequest(
      `${CLOUDFLARE_PAGES_API}/accounts/${accountId}/pages/projects/${cfProjectName}/deployments?per_page=5`,
      "GET",
      apiToken
    );

    if (result.success && result.result?.length > 0) {
      const deployments = result.result.map((d) => ({
        id: d.id,
        url: d.url,
        branch: d.deployment_trigger?.metadata?.branch || "unknown",
        created: d.created_on,
        status: d.latest_stage?.status || "unknown",
      }));

      return {
        success: true,
        projectName: cfProjectName,
        deployments,
        latestUrl: deployments[0]?.url || null,
      };
    }

    return {
      success: true,
      projectName: cfProjectName,
      deployments: [],
      message: "No hay deployments todavía. Usa 'deploy' para publicar.",
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Lists all Cloudflare Pages projects.
 */
async function handleListProjects(apiToken, accountId) {
  if (!apiToken || !accountId) {
    return { success: false, error: "Cloudflare no configurado" };
  }

  try {
    const result = await cfApiRequest(
      `${CLOUDFLARE_PAGES_API}/accounts/${accountId}/pages/projects`,
      "GET",
      apiToken
    );

    if (result.success) {
      const projects = (result.result || []).map((p) => ({
        name: p.name,
        url: p.subdomain,
        created: p.created_on,
        pages: p.pages?.length || 0,
      }));

      return {
        success: true,
        projects,
        count: projects.length,
      };
    }

    return { success: false, error: "No se pudieron listar los proyectos" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detects the build output directory.
 */
function detectBuildDir(projectPath) {
  const hasFile = (file) => fs.existsSync(path.resolve(projectPath, file));

  if (hasFile("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(projectPath, "package.json"), "utf-8"));
      // Check for common build output dirs in package.json
      if (pkg.cloudflare?.pages?.directory) return pkg.cloudflare.pages.directory;
    } catch {}
  }

  // Common build output directories (in order of preference)
  const candidates = ["dist", "build", "out", "_site", "public", ".next", "storybook-static"];
  for (const dir of candidates) {
    if (fs.existsSync(path.resolve(projectPath, dir))) {
      // Verify it has an index.html
      if (fs.existsSync(path.resolve(projectPath, dir, "index.html"))) {
        return dir;
      }
    }
  }

  return ".";
}

/**
 * Detects the build command from package.json.
 */
function detectBuildCommand(projectPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(projectPath, "package.json"), "utf-8"));
    if (pkg.scripts?.build) {
      return `npm run build`;
    }
  } catch {}
  return null;
}

/**
 * Reads all files in a directory recursively, returning relative paths and base64 content.
 */
function readDirRecursive(dir, baseDir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        readDirRecursive(fullPath, baseDir, files);
      }
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      const content = fs.readFileSync(fullPath, "base64");
      files.push({ relativePath, content });
    }
  }
}

/**
 * Makes a request to the Cloudflare API.
 */
async function cfApiRequest(url, method, apiToken, body) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  const options = {
    method,
    headers,
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return await response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════════

export default cloudflarePublishSkill;
