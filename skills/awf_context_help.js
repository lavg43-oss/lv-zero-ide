/**
 * awf_context_help.js — Migrado de Antigravity awf-context-help
 * Ayuda contextual: detecta estado del usuario y muestra ayuda relevante
 */
export default {
  name: "awf_context_help",
  description: "Context-aware help based on current workflow state. Activates on /help or when user asks questions like 'help', 'what', 'how', 'confused', 'stuck', 'lost', 'guide'.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["detect_state", "show_help", "fallback"],
        description: '"detect_state": Detecta el estado actual del usuario. "show_help": Muestra ayuda para un estado específico. "fallback": Muestra ayuda genérica.'
      },
      state: {
        type: "string",
        enum: ["no_project", "planning", "coding", "debugging", "deploying", "stuck", "idle"],
        description: "(show_help) Estado para el cual mostrar ayuda."
      },
      contextInfo: {
        type: "object",
        description: "(show_help, opcional) Información contextual adicional (workflow, task, status, pending).",
        properties: {
          workflow: { type: "string", description: "Feature/workflow actual." },
          task: { type: "string", description: "Tarea actual." },
          status: { type: "string", description: "Estado: active, blocked, done." },
          pending: { type: "number", description: "Número de tareas pendientes." }
        }
      }
    },
    required: ["action"]
  },
  handler: async (params) => {
    const { action, state, contextInfo } = params;

    if (action === "fallback") {
      return {
        success: true,
        message: `👋 Estoy aquí para ayudarte!

Comandos disponibles:
┌─────────────────────────────────────┐
│ /next       │ Sugerir siguiente paso │
│ /recap      │ Recordar contexto      │
│ /brainstorm │ Idear algo nuevo       │
│ /plan       │ Planificar             │
│ /code       │ Escribir código        │
│ /debug      │ Depurar errores        │
└─────────────────────────────────────┘

O simplemente dime qué necesitas.`
      };
    }

    if (action === "detect_state") {
      return {
        success: true,
        states: {
          no_project: { detection: "No .brain/ folder", response: "Show onboarding" },
          planning: { detection: "workflow contains 'plan'", response: "Planning help" },
          coding: { detection: "workflow contains 'code'", response: "Coding help" },
          debugging: { detection: "workflow contains 'debug'", response: "Debug help" },
          deploying: { detection: "workflow contains 'deploy'", response: "Deploy help" },
          stuck: { detection: "status = 'blocked' or pending > 5", response: "Stuck help" },
          idle: { detection: "No active workflow", response: "General help" }
        },
        triggerKeywords: ["help", "?", "giúp", "cómo", "what", "how", "confused", "stuck", "lost", "guide", "tutorial", "explain"],
        adaptiveLevels: {
          newbie: "Vietnamese only, explain everything, small steps",
          basic: "Mix VN-EN, explain terms once, medium steps",
          technical: "Standard terminology, no explanations, focus on action"
        }
      };
    }

    if (action === "show_help") {
      const ctx = contextInfo || {};
      const pending = ctx.pending || 0;

      const templates = {
        no_project: {
          title: "🆕 No hay proyecto",
          message: `Aún no hay proyecto. Puedes:
1. /brainstorm — Discutir ideas primero
2. /init — Crear un proyecto nuevo
3. Describirme tu idea

Te guiaré paso a paso.`
        },
        planning: {
          title: `📋 Planificando: ${ctx.workflow || 'activo'}`,
          message: `Puedes:
1. Continuar con el plan actual
2. /code — Empezar la primera fase de código
3. Preguntarme sobre diseño

💡 Tip: ¡Un buen plan = código más rápido!`
        },
        coding: {
          title: `💻 Codeando: ${ctx.task || 'activo'}`,
          message: `Status: ${ctx.status || 'active'}

Puedes:
1. Continuar codeando
2. /test — Probar el código escrito
3. /debug — Si encuentras errores
4. /save-brain — Guardar progreso

💡 Tareas pendientes: ${pending}`
        },
        debugging: {
          title: `🔧 Debugging: ${ctx.task || 'activo'}`,
          message: `Puedes:
1. Describir el error con más detalle
2. Pegar el mensaje de error
3. /code — Volver a código tras arreglar

💡 Tip: Copiar y pegar el error me ayuda a entenderlo más rápido.`
        },
        deploying: {
          title: `🚀 Deployando: ${ctx.workflow || 'activo'}`,
          message: `Puedes:
1. Continuar el proceso de deploy
2. /rollback — Volver a versión anterior si falla
3. Revisar logs post-deploy

⚠️ ¡Prueba bien antes de deployar a producción!`
        },
        stuck: {
          title: "😅 Parece que estás atascado",
          message: `Intenta esto:
1. /recap — Revisar qué estábamos haciendo
2. /debug — Si hay un error
3. Descansar 5 minutos y volver
4. Preguntarme específicamente sobre el problema

💡 ${pending} tareas pendientes. ¿Quizás saltar la difícil y hacer otra primero?`
        },
        idle: {
          title: "👋 ¿En qué puedo ayudarte?",
          message: `Comandos populares:
┌─────────────────────────────────────┐
│ /next       │ Sugerir siguiente paso │
│ /recap      │ Recordar contexto      │
│ /brainstorm │ Idear algo nuevo       │
│ /plan       │ Planificar             │
│ /code       │ Escribir código        │
└─────────────────────────────────────┘

¡O pregúntame lo que sea!`
        }
      };

      const tpl = templates[state] || templates.idle;
      return {
        success: true,
        ...tpl,
        adaptiveNote: "Las respuestas se adaptan automáticamente a tu nivel técnico (newbie/basic/technical)."
      };
    }
  }
};
