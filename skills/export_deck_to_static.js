/**
 * export_deck_to_static — Universal Presentation Exporter
 *
 * v1.0
 *
 * Converts live presentation decks (Slidev OR Quarto/Reveal.js) into
 * portable static formats: PDF and PPTX. This is the "panic button" — when
 * you need to carry your presentation on a USB drive because the venue's
 * WiFi might fail.
 *
 * Supported engines:
 *   - Slidev: Uses npx slidev export (Playwright-powered — renders each
 *     slide in a headless Chromium, captures vector screenshots, and
 *     packages them into PDF or PPTX).
 *   - Quarto/Reveal.js: Uses quarto render/publish with format pdf or pptx.
 *     Converts the deck to a static document, freezing animation states.
 *
 * Requirements:
 *   - Slidev export: Playwright browsers installed (npx playwright install chromium)
 *   - Quarto export: Quarto CLI installed (https://quarto.org/docs/download/)
 *   - Node.js >= 18
 *
 * Parameters:
 *   engine: "slidev" | "quarto" — which presentation engine to export from
 *   format: "pdf" | "pptx" — output format
 *   deckDir: path to the presentation project directory
 *   timeout: milliseconds to wait for animations to settle before capture (default 1000)
 *   outputPath: custom output file path (optional)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  name: "export_deck_to_static",
  description:
    "Exporta presentaciones Slidev o Quarto/Reveal.js a formatos portátiles (PDF, PPTX). " +
    "Slidev usa Playwright para renderizar cada diapositiva en un navegador headless " +
    "y empaquetarlas. Quarto usa su motor nativo de exportación. " +
    "Ideal para llevar tu presentación en USB sin depender de WiFi. " +
    "Soporta timeout para esperar que las animaciones carguen antes de capturar.",

  parameters: {
    type: "object",
    properties: {
      engine: {
        type: "string",
        enum: ["slidev", "quarto"],
        description:
          'Motor de presentación a exportar. "slidev" para proyectos Slidev, "quarto" para Quarto/Reveal.js.',
      },
      format: {
        type: "string",
        enum: ["pdf", "pptx"],
        description: "Formato de salida. pdf o pptx.",
      },
      deckDir: {
        type: "string",
        description:
          "Directorio del proyecto de presentación. Por defecto: './slidev-deck' para Slidev, './quarto-deck' para Quarto.",
      },
      timeout: {
        type: "integer",
        description:
          "Milisegundos de espera para que las animaciones carguen antes de capturar. " +
          "Default: 1000ms. Aumenta si tienes animaciones complejas. Máximo: 30000ms.",
      },
      outputPath: {
        type: "string",
        description:
          "Ruta de salida personalizada para el archivo exportado. " +
          "Por defecto: deckDir/presentation.{pdf,pptx}",
      },
      slidesToExport: {
        type: "string",
        description:
          "(Slidev) Rango de diapositivas a exportar. Ej: '1-10', '1,3,5-8'. " +
          "Por defecto: todas.",
      },
    },
    required: ["engine", "format"],
  },

  handler: async (params, context) => {
    const signal = context?.signal;
    const {
      engine,
      format,
      deckDir,
      timeout,
      outputPath,
      slidesToExport,
    } = params;

    const defaultDir =
      engine === "quarto" ? "./quarto-deck" : "./slidev-deck";
    const resolvedDir = deckDir
      ? path.resolve(deckDir)
      : path.resolve(process.cwd(), defaultDir);

    const waitMs = Math.min(timeout || 1000, 30000);

    switch (engine) {
      case "slidev":
        return await exportSlidev(resolvedDir, format, waitMs, outputPath, slidesToExport, signal);
      case "quarto":
        return await exportQuarto(resolvedDir, format, waitMs, outputPath, signal);
      default:
        return { success: false, error: `Motor desconocido: ${engine}` };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDEV EXPORT (Playwright-powered via npx slidev export)
// ═══════════════════════════════════════════════════════════════════════════════

async function exportSlidev(deckDir, format, timeoutMs, outputPath, slidesToExport, signal) {
  // ── Validate project ─────────────────────────────────────────────────────
  const pkgPath = path.resolve(deckDir, "package.json");
  const slidesPath = path.resolve(deckDir, "slides.md");

  if (!fs.existsSync(pkgPath)) {
    return {
      success: false,
      error: `Proyecto Slidev no encontrado en ${deckDir}. Verifica la ruta.`,
      hint: "Usa build_slidev_deck con action='create' primero.",
    };
  }

  if (!fs.existsSync(slidesPath)) {
    return {
      success: false,
      error: `slides.md no encontrado en ${deckDir}.`,
      hint: "Crea la presentación primero con build_slidev_deck.",
    };
  }

  // ── Check node_modules ───────────────────────────────────────────────────
  const nodeModulesPath = path.resolve(deckDir, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    try {
      await execPromise("npm", ["install"], { cwd: deckDir });
    } catch (err) {
      return {
        success: false,
        error: `Error instalando dependencias: ${err.message}`,
      };
    }
  }

  // ── Check Playwright browsers ─────────────────────────────────────────────
  try {
    await execPromise("npx", ["playwright", "install", "chromium"], { cwd: deckDir });
  } catch {
    // Non-fatal: Slidev may have its own mechanism
  }

  // ── Build export args ────────────────────────────────────────────────────
  const args = ["slidev", "export"];

  // Format
  args.push("--format", format);

  // Timeout for animation settling
  args.push("--timeout", String(timeoutMs));

  // Slides range
  if (slidesToExport) {
    args.push("--range", slidesToExport);
  }

  // Output path
  if (outputPath) {
    args.push("--output", path.resolve(outputPath));
  }

  // ── Execute export ───────────────────────────────────────────────────────
  const expectedExt = format === "pptx" ? "pptx" : "pdf";
  const defaultOut = outputPath
    ? path.resolve(outputPath)
    : path.resolve(deckDir, `presentation.${expectedExt}`);

  try {
    // Slidev export requires a TTY-like environment; use shell:true
    const result = await execPromise("npx", args, {
      cwd: deckDir,
      maxBuffer: 10 * 1024 * 1024, // 10MB — PDFs can be large
    });

    // Check if output file exists
    if (fs.existsSync(defaultOut)) {
      const stats = fs.statSync(defaultOut);
      return {
        success: true,
        engine: "slidev",
        format,
        outputFile: defaultOut,
        fileSize: stats.size,
        fileSizeFormatted: formatBytes(stats.size),
        message: `Presentación exportada exitosamente: ${path.basename(defaultOut)} (${formatBytes(stats.size)})`,
        note: "El archivo está listo para llevar en USB, subir a la nube, o enviar por correo.",
      };
    }

    // Sometimes Slidev puts the output in a subdirectory
    const distDir = path.resolve(deckDir, "dist");
    if (fs.existsSync(distDir)) {
      const distFiles = fs.readdirSync(distDir).filter((f) => f.endsWith(`.${expectedExt}`));
      if (distFiles.length > 0) {
        const found = path.resolve(distDir, distFiles[0]);
        const stats = fs.statSync(found);
        return {
          success: true,
          engine: "slidev",
          format,
          outputFile: found,
          fileSize: stats.size,
          fileSizeFormatted: formatBytes(stats.size),
          message: `Presentación exportada exitosamente: ${distFiles[0]} (${formatBytes(stats.size)})`,
        };
      }
    }

    return {
      success: false,
      error:
        "La exportación se completó pero no se encontró el archivo de salida. " +
        "Busca archivos ." + expectedExt + " en " + deckDir + " o su subdirectorio dist/.",
    };
  } catch (err) {
    return {
      success: false,
      error: `Error en exportación Slidev: ${err.message || err}`,
      hint:
        "Asegúrate de que Playwright tenga los navegadores instalados: npx playwright install chromium",
      detail: err.stderr || "",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUARTO / REVEAL.JS EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

async function exportQuarto(deckDir, format, timeoutMs, outputPath, signal) {
  // ── Validate project ─────────────────────────────────────────────────────
  const qmdPath = path.resolve(deckDir, "index.qmd");
  const ymlPath = path.resolve(deckDir, "_quarto.yml");

  if (!fs.existsSync(qmdPath) && !fs.existsSync(ymlPath)) {
    return {
      success: false,
      error: `Proyecto Quarto no encontrado en ${deckDir}. Se requiere index.qmd o _quarto.yml.`,
      hint: "Usa build_quarto_deck con action='create' primero.",
    };
  }

  // ── Check Quarto CLI ─────────────────────────────────────────────────────
  try {
    await execPromise("quarto", ["--version"], { cwd: deckDir });
  } catch {
    return {
      success: false,
      error: "Quarto CLI no está instalado o no está en el PATH.",
      hint: "Descarga Quarto desde: https://quarto.org/docs/download/",
      installCommand: "winget install Quarto.Quarto  (Windows)\nbrew install quarto  (macOS)\nDescarga .deb/.rpm desde quarto.org  (Linux)",
    };
  }

  // ── Determine output path ────────────────────────────────────────────────
  const expectedExt = format === "pptx" ? "pptx" : "pdf";
  const resolvedOut = outputPath
    ? path.resolve(outputPath)
    : path.resolve(deckDir, `presentation.${expectedExt}`);

  // ── Build Quarto render command ──────────────────────────────────────────
  // Quarto render supports --to pdf, --to pptx natively
  const args = ["render"];

  // Input file
  const inputFile = fs.existsSync(qmdPath) ? "index.qmd" : ".";
  args.push(inputFile);

  // Output format
  args.push("--to", format);

  // Output path
  if (outputPath) {
    args.push("--output", path.basename(resolvedOut));
    args.push("--output-dir", path.dirname(resolvedOut));
  }

  try {
    const result = await execPromise("quarto", args, {
      cwd: deckDir,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Quarto typically outputs to deckDir/
    const possibleOutputs = [
      resolvedOut,
      path.resolve(deckDir, `presentation.${expectedExt}`),
      path.resolve(deckDir, `index.${expectedExt}`),
    ];

    let foundPath = null;
    for (const candidate of possibleOutputs) {
      if (fs.existsSync(candidate)) {
        foundPath = candidate;
        break;
      }
    }

    // Also check subdirectories
    if (!foundPath) {
      const searchDir = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(`.${expectedExt}`)) {
              foundPath = path.resolve(dir, entry.name);
              return;
            }
            if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
              searchDir(path.resolve(dir, entry.name));
              if (foundPath) return;
            }
          }
        } catch {}
      };
      searchDir(deckDir);
    }

    if (foundPath) {
      const stats = fs.statSync(foundPath);
      return {
        success: true,
        engine: "quarto",
        format,
        outputFile: foundPath,
        fileSize: stats.size,
        fileSizeFormatted: formatBytes(stats.size),
        message: `Presentación Quarto exportada exitosamente: ${path.basename(foundPath)} (${formatBytes(stats.size)})`,
        note: result.stdout?.includes("WARNING") ? "⚠️ Hay warnings de Quarto — revisa la salida." : "Exportación limpia.",
      };
    }

    return {
      success: false,
      error: `La exportación Quarto se completó pero no se encontró el archivo .${expectedExt}.`,
      hint: `Busca en ${deckDir} y subdirectorios. Quarto a veces usa nombres como index.${expectedExt}.`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Error en exportación Quarto: ${err.message || err}`,
      hint: "Verifica que el proyecto Quarto esté bien configurado (_quarto.yml).",
      detail: err.stderr || "",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
