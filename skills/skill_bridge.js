/**
 * skill_bridge — Native Process Skill Loader
 *
 * Escanea skills/process/ directamente, registra cada habilidad
 * como una skill nativa de lv-zero con parámetros reales.
 *
 * Skills duplicadas (auto-save → auto_memoria.js, skill-creator → skill_factory.js,
 * code-review → workflows) se omiten automáticamente.
 *
 * v3.0 — Nativo: escanea skills/process/ directamente.
 *         Las 26 skills de proceso se exponen como tools nativas
 *         con { name, description, parameters, handler } indistinguibles
 *         de cualquier otra skill .js en skills/.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Self-location ────────────────────────────────────────────────────────
const THIS_FILE = fileURLToPath(import.meta.url.split("?")[0]);
const SKILLS_DIR = path.dirname(THIS_FILE);
const ANTIGRAVITY_DIR = path.resolve(SKILLS_DIR, "antigravity");

// Skills que ya tienen equivalente nativo en lv-zero → se omiten del bridge
const SKIP_SKILLS = new Set(["auto-save", "skill-creator", "code-review"]);

// ─── Resolve base directory (dev / packaged / legacy) ─────────────────────
function getAntigravityBase() {
  // 1. Local: skills/antigravity/ (dev or unpacked asar)
  const local = ANTIGRAVITY_DIR;
  if (fs.existsSync(local)) return local;

  // 2. Packaged: process.resourcesPath
  if (process.resourcesPath) {
    const packed = path.resolve(process.resourcesPath, "skills", "antigravity");
    if (fs.existsSync(packed)) return packed;
  }

  // 3. Legacy fallback — check common locations
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const legacyCandidates = [
    path.resolve(homeDir, ".gemini", "antigravity", "skills"),
    path.resolve(homeDir, ".antigravity", "skills"),
    path.resolve(homeDir, "antigravity", "skills"),
  ];
  for (const candidate of legacyCandidates) {
    if (fs.existsSync(candidate)) {
      console.warn("   ⚠️  [Bridge] Using legacy Antigravity base:", candidate);
      return candidate;
    }
  }

  return local; // will fail gracefully at readdir time
}

// ─── Read a single SKILL.md and extract metadata ──────────────────────────
function readSkillMd(entryName) {
  const skillPath = path.resolve(getAntigravityBase(), entryName);
  const mdPath = path.resolve(skillPath, "SKILL.md");

  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, "utf-8");
  let name = entryName;
  let description = `Skill de proceso: ${name}`;

  // Parse YAML frontmatter (--- delimited)
  const frontMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (frontMatch) {
    const frontRaw = frontMatch[1];
    const nameMatch = frontRaw.match(/^name:\s*(.+)$/m);
    const descMatch = frontRaw.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }

  return { name, description, content, skillPath };
}

// ─── Scan antigravity/ directory and build native skill objects ───────────
function scanSkills() {
  const baseDir = getAntigravityBase();

  if (!fs.existsSync(baseDir)) {
    console.warn(`   ⚠️  [Bridge] Antigravity directory not found: ${baseDir}`);
    return [];
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_SKILLS.has(entry.name)) continue;

    const data = readSkillMd(entry.name);
    if (!data) {
      console.warn(`   ⚠️  [Bridge] SKILL.md not found in: ${entry.name}`);
      continue;
    }

    // ── Build a skill object indistinguishable from a native .js skill ──
    skills.push({
      name: data.name,
      description: data.description,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["read", "summary"],
            description:
              '"read": Obtener el contenido completo del SKILL.md con instrucciones detalladas. ' +
              '"summary": Obtener un resumen estructurado (nombre, descripción, secciones principales).',
          },
        },
        required: ["action"],
      },

      handler: async (params) => {
        const action = params?.action || "read";

        if (action === "read") {
          return {
            success: true,
            skillName: data.name,
            description: data.description,
            skillPath: data.skillPath,
            content: data.content,
          };
        }

        if (action === "summary") {
          return {
            success: true,
            skillName: data.name,
            description: data.description,
            skillPath: data.skillPath,
            summary: extractSummary(data.content),
          };
        }

        return { success: false, error: `Acción no soportada: ${action}. Usa "read" o "summary".` };
      },
    });

    console.log(`   🛠  ${data.name}`);
  }

  return skills;
}

// ─── Extract key sections from SKILL.md for summary mode ──────────────────
function extractSummary(content) {
  const lines = content.split("\n");
  const sections = [];
  let currentSection = "";
  let currentLines = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentSection) {
        const text = currentLines.join("\n").trim();
        if (text) sections.push({ title: currentSection, preview: text.substring(0, 300) });
      }
      currentSection = line.replace("## ", "").trim();
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }
  // Flush last section
  if (currentSection) {
    const text = currentLines.join("\n").trim();
    if (text) sections.push({ title: currentSection, preview: text.substring(0, 300) });
  }

  return {
    totalSections: sections.length,
    totalLines: lines.length,
    sections: sections.slice(0, 10), // max 10 sections
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Main bridge loader — returns an array of native lv-zero skill objects.
 * Each skill has { name, description, parameters, handler } exactly like
 * any .js skill in skills/.
 */
export async function loadAntigravitySkills() {
  return scanSkills();
}

/**
 * Hot-reload: re-scans disk and returns fresh skill array.
 */
export async function reloadBridgeSkills() {
  return await loadAntigravitySkills();
}

// ─── Default export: the bridge manager skill ─────────────────────────────
export default {
  name: "skill_bridge",
  description:
    "Gestor de skills de proceso. " +
    "Escanea skills/antigravity/ y expone cada habilidad como una herramienta " +
    "con parámetros reales (action: read | summary). " +
    "Skills duplicadas con nativo lv-zero (auto-save, skill-creator, code-review) " +
    "se omiten automáticamente.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "reload"],
        description:
          '"list": Lista todas las habilidades Antigravity nativas disponibles. ' +
          '"reload": Recarga las habilidades desde disco.',
      },
    },
    required: ["action"],
  },

  handler: async (params) => {
    const action = params?.action;

    switch (action) {
      case "list": {
        const skills = scanSkills();
        return {
          success: true,
          total: skills.length,
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
          })),
          skipped: Array.from(SKIP_SKILLS),
          note: 'Usa el nombre de la habilidad como tool call con action: "read" para ver instrucciones detalladas.',
        };
      }

      case "reload": {
        const count = (await loadAntigravitySkills()).length;
        return {
          success: true,
          skillsLoaded: count,
          message: `Bridge recargado: ${count} habilidades Antigravity nativas disponibles.`,
        };
      }

      default:
        return { success: false, error: `Acción desconocida: ${action}. Usa "list" o "reload".` };
    }
  },
};
