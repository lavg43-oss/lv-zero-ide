/**
 * skill_factory — Dynamic skill creation + hot-reload
 *
 * Permite al agente:
 *   1. Crear nuevos archivos .js en /skills/ (auto-generación de herramientas)
 *   2. Recargar en caliente (hot-reload) sin reiniciar lv-zero
 *
 * v1.0 — Autopoiesis: el sistema se construye a sí mismo
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.resolve(__dirname);

/**
 * Reference to the live skills array in index.js.
 * Set by index.js at startup via setSkillRegistry().
 */
let liveSkills = null;
let liveReloadFn = null;

/**
 * Injects the live skills registry reference so skill_factory can
 * hot-reload new skills into the running agent.
 */
export function setSkillRegistry(skillsArray, reloadFunction) {
  liveSkills = skillsArray;
  liveReloadFn = reloadFunction;
}

export default {
  name: "skill_factory",
  description:
    "Crea nuevas skills (herramientas) en caliente y recarga el registro. " +
    "El agente puede usar esta herramienta para EXTENDER sus propias capacidades " +
    "sin reiniciar el sistema. " +
    "Ideal para: crear nuevas funciones de terminal, integraciones con APIs, " +
    "o cualquier lógica recurrente que el agente necesite.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "reload", "list_templates"],
        description:
          '"create": escribe un nuevo archivo de skill en /skills/ y lo recarga. ' +
          '"reload": recarga todas las skills desde /skills/ (hot-reload). ' +
          '"list_templates": muestra las plantillas disponibles.',
      },
      skillName: {
        type: "string",
        description:
          "(Solo create) Nombre de la nueva skill. Será el nombre del archivo y el identificador. Ej: 'git_manager'",
      },
      description: {
        type: "string",
        description:
          "(Solo create) Descripción de lo que hace la skill para el agente.",
      },
      code: {
        type: "string",
        description:
          "(Solo create) Código JavaScript completo de la skill. " +
          "Debe exportar un default con { name, description, parameters, handler }. " +
          "El name debe coincidir con skillName.",
      },
    },
    required: ["action"],
  },

  handler: async ({ action, skillName, description, code }) => {
    switch (action) {
      case "create":
        return await handleCreate(skillName, description, code);
      case "reload":
        return await handleReload();
      case "list_templates":
        return handleListTemplates();
      default:
        return { success: false, error: `Acción desconocida: ${action}` };
    }
  },
};

async function handleCreate(skillName, description, code) {
  // ── Validation ─────────────────────────────────────────────────────────
  if (!skillName) {
    return { success: false, error: "skillName es requerido para crear." };
  }

  // Sanitize: lowercase, no spaces, no special chars except underscore
  const safeName = skillName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!safeName) {
    return {
      success: false,
      error: "El nombre de la skill no es válido. Usa solo letras, números y guiones bajos.",
    };
  }

  const filePath = path.resolve(SKILLS_DIR, `${safeName}.js`);

  // Prevent accidental overwrite
  if (fs.existsSync(filePath)) {
    return {
      success: false,
      error: `Ya existe una skill llamada "${safeName}" en ${filePath}. Usa reload si solo quieres recargarla.`,
    };
  }

  // ── Use template if no code provided ────────────────────────────────────
  const finalCode =
    code ||
    generateTemplate(safeName, description || `Skill auto-generada: ${safeName}`);

  // ── Write file ─────────────────────────────────────────────────────────
  try {
    fs.writeFileSync(filePath, finalCode, "utf-8");
  } catch (err) {
    return { success: false, error: `Error al escribir: ${err.message}` };
  }

  // ── Hot-reload ─────────────────────────────────────────────────────────
  if (liveReloadFn) {
    try {
      await liveReloadFn();
    } catch (err) {
      return {
        success: true,
        warning: `Skill creada pero error en recarga: ${err.message}`,
        file: filePath,
        note: "Reinicia lv-zero para usar la nueva skill.",
      };
    }
  }

  // ── Regenerate tool manifest ──────────────────────────────────────────
  let manifestNote = "";
  try {
    const { generateManifest } = await import("../_lib/tool_manifest.js?v=" + Date.now());
    generateManifest(); // refresh so next system prompt injection is up-to-date
    manifestNote = " Tool manifest regenerated.";
  } catch (_) {
    manifestNote = " Note: tool manifest will update on restart.";
  }

  return {
    success: true,
    skillName: safeName,
    file: filePath,
    message: `Skill "${safeName}" creada y cargada en caliente.${manifestNote}`,
  };
}

async function handleReload() {
  if (!liveReloadFn) {
    return {
      success: false,
      error:
        "No hay función de recarga registrada. " +
        "Asegúrate de que index.js llamó a setSkillRegistry().",
    };
  }

  try {
    const count = await liveReloadFn();
    // ── Regenerate tool manifest ──────────────────────────────────────
    let manifestNote = "";
    try {
      const { generateManifest } = await import("../_lib/tool_manifest.js?v=" + Date.now());
      generateManifest();
      manifestNote = " Tool manifest regenerated.";
    } catch (_) {
      manifestNote = "";
    }
    return {
      success: true,
      skillsLoaded: count,
      message: `${count} skill(s) cargadas después del hot-reload.${manifestNote}`,
    };
  } catch (err) {
    return { success: false, error: `Error en recarga: ${err.message}` };
  }
}

function handleListTemplates() {
  return {
    success: true,
    templates: [
      {
        name: "basic",
        description: "Skill básica con un solo handler",
      },
      {
        name: "api_client",
        description: "Skill que llama a una API externa con fetch",
      },
    ],
    instructions:
      "Usa action: 'create' con el código que necesites. " +
      "El código debe exportar un default object con name, description, parameters, y handler.",
  };
}

function generateTemplate(name, desc) {
  return `/**
 * ${name} — Skill auto-generada por lv-zero
 *
 * ${desc}
 */
export default {
  name: "${name}",
  description: "${desc}",

  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Input para procesar",
      },
    },
    required: ["input"],
  },

  handler: async ({ input }) => {
    // TODO: Implementar lógica
    return {
      success: true,
      message: \`Skill "\${name}" ejecutada con input: "\${input}"\`,
    };
  },
};
`;
}
