/**
 * lv-zero — Slash Command Handler (Skill)
 *
 * v2.0
 *   Skill que permite al agente listar, inspeccionar y gestionar
 *   los workflows del sistema. También expone la detección de
 *   intención para sugerir comandos slash.
 *
 *   v2.0 — Added trigger-based skill suggestions from SKILL.md files.
 *   Uses matchTriggers() from skill_md_loader.js to find skills whose
 *   trigger phrases match the user's input.
 *
 *   Esta skill NO reemplaza la detección en orchestrator.js.
 *   Es una herramienta que el agente puede usar para:
 *     - Listar workflows disponibles
 *     - Obtener instrucciones de un workflow específico
 *     - Obtener ayuda sobre los comandos slash
 *     - Detectar intención en el input del usuario
 *     - Sugerir skills por trigger phrases (desde SKILL.md)
 */

import {
  listWorkflows,
  getWorkflowInstructions,
  getWorkflow,
  resolveCommand,
  detectIntent,
  getHelpText,
  getCategories,
} from "../src/workflows/loader.js";
import { matchTriggers } from "./loader/skill_md_loader.js";

// ─── Skill Definition ───────────────────────────────────────────────────────

const slashHandler = {
  name: "slash_handler",
  description:
    "Gestiona los comandos slash (/plan, /code, /debug, /review) y los workflows del sistema. " +
    "Úsala para listar workflows, obtener instrucciones de un workflow, detectar intención en input del usuario, " +
    "o mostrar ayuda sobre los comandos disponibles.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "Acción a ejecutar:\n" +
          "- 'list' → Lista todos los workflows disponibles con descripciones y aliases\n" +
          "- 'get' → Obtiene las instrucciones completas de un workflow específico (requiere 'command')\n" +
          "- 'help' → Muestra texto de ayuda con todos los comandos slash\n" +
          "- 'detect' → Detecta si un texto contiene un comando slash o sugiere uno por keywords (requiere 'input')\n" +
          "- 'suggest' → Sugiere skills por trigger phrases desde SKILL.md (requiere 'input')\n" +
          "- 'categories' → Lista las categorías de workflows",
        enum: ["list", "get", "help", "detect", "suggest", "categories"],
      },
      command: {
        type: "string",
        description:
          "Comando slash a consultar (ej: '/plan', '/code', '/debug', '/review'). " +
          "También acepta alias como '/design' (→ /plan) o '/fix' (→ /debug). " +
          "Requiere action='get'.",
      },
      input: {
        type: "string",
        description:
          "Texto del usuario para detectar intención. Requiere action='detect'. " +
          "Ej: 'Necesito arreglar un error' → detecta /debug",
      },
    },
    required: ["action"],
  },

  /**
   * Handler principal de la skill.
   * @param {object} args - Argumentos de la skill
   * @param {string} args.action - Acción a ejecutar
   * @param {string} [args.command] - Comando slash (para action='get')
   * @param {string} [args.input] - Input del usuario (para action='detect')
   * @returns {Promise<string>} Resultado formateado
   */
  async handler(args) {
    const { action, command, input } = args;

    switch (action) {
      case "list": {
        const workflows = listWorkflows();
        if (workflows.length === 0) {
          return "No hay workflows registrados.";
        }

        const categories = getCategories();
        let result = `📋 **${workflows.length} Workflows Disponibles:**\n\n`;

        // Group by category
        const byCategory = {};
        for (const w of workflows) {
          const cat = w.category || "uncategorized";
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(w);
        }

        for (const [catId, catWorkflows] of Object.entries(byCategory)) {
          const catName = categories[catId]?.name || catId;
          result += `**${catName}:**\n`;
          for (const w of catWorkflows) {
            const aliasStr =
              w.aliases.length > 0
                ? ` (alias: ${w.aliases.join(", ")})`
                : "";
            result += `  • \`${w.command}\`${aliasStr} — ${w.description}\n`;
          }
          result += "\n";
        }

        result += "*Usa `action: 'get', command: '/plan'` para ver las instrucciones de un workflow.*";
        return result;
      }

      case "get": {
        if (!command) {
          return "❌ Debes especificar un 'command' (ej: '/plan', '/code').";
        }

        const resolved = resolveCommand(command);
        if (!resolved) {
          return `❌ Comando '${command}' no encontrado. Usa 'list' para ver los disponibles.`;
        }

        const instructions = await getWorkflowInstructions(command);
        if (!instructions) {
          return `❌ No se pudieron cargar las instrucciones para '${command}'.`;
        }

        return instructions;
      }

      case "help": {
        return getHelpText();
      }

      case "detect": {
        if (!input) {
          return "❌ Debes especificar un 'input' para detectar intención.";
        }

        const intent = detectIntent(input);

        if (intent.type === "command") {
          const instructions = await getWorkflowInstructions(intent.command);
          return (
            `🔍 Detectado comando: \`${intent.command}\`\n` +
            `Descripción: ${intent.workflow.description}\n\n` +
            `Instrucciones del workflow:\n${instructions}`
          );
        }

        if (intent.type === "suggestion") {
          return (
            `💡 Sugerencia: Basado en tu mensaje, podrías usar \`${intent.command}\` ` +
            `(${intent.workflow.description}).\n\n` +
            `*Usa 'get' con command: '${intent.command}' para cargar el workflow, ` +
            `o escribe /${intent.command.replace("/", "")} al inicio de tu mensaje.*`
          );
        }

        return (
          "ℹ️ No se detectó ningún comando slash en el texto. " +
          "Usa 'help' para ver los comandos disponibles."
        );
      }

      case "suggest": {
        if (!input) {
          return "❌ Debes especificar un 'input' para sugerir skills.";
        }

        // Load markdown skills and match triggers
        try {
          const { loadMarkdownSkills } = await import("./loader/skill_md_loader.js");
          const mdSkills = await loadMarkdownSkills({ includeAntigravity: true });
          const matches = matchTriggers(input, mdSkills);

          if (matches.length === 0) {
            return "ℹ️ No se encontraron skills con triggers que coincidan con tu input.";
          }

          let result = `💡 **${matches.length} skill(s) sugerida(s) por trigger:**\n\n`;
          for (const m of matches) {
            const confidence = Math.round(m.confidence * 100);
            result += `• **${m.skill.name}** (${confidence}% match) — "${m.match}"\n`;
            result += `  ${m.skill.description}\n\n`;
          }
          return result;
        } catch (err) {
          return `⚠️ Error cargando skills para sugerencias: ${err.message}`;
        }
      }

      case "categories": {
        const categories = getCategories();
        const entries = Object.entries(categories);
        if (entries.length === 0) {
          return "No hay categorías definidas.";
        }

        let result = "**Categorías de Workflows:**\n\n";
        for (const [id, cat] of entries) {
          result += `• **${cat.name}** (\`${id}\`): ${cat.description}\n`;
        }
        return result;
      }

      default:
        return `❌ Acción desconocida: '${action}'. Acciones válidas: list, get, help, detect, categories.`;
    }
  },
};

export default slashHandler;
