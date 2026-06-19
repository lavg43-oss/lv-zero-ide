/**
 * telegram_notify.js — Migrado de Antigravity telegram-notify
 * Envía notificaciones a Telegram vía awkit CLI (Bot API)
 */
export default {
  name: "telegram_notify",
  description: "Send Telegram notifications via AWKit CLI (Bot API). Use when tasks complete, deploys finish, or user requests Telegram alerts. NEVER send without user consent.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["send", "setup_guide", "check_config"],
        description: '"send": Envía un mensaje a Telegram. "setup_guide": Muestra guía de configuración. "check_config": Verifica si awkit tg está configurado.'
      },
      message: {
        type: "string",
        description: "(send) Mensaje a enviar. Soporta Markdown con --parse-mode md."
      },
      chat: {
        type: "string",
        description: "(send, opcional) Chat ID destino. Ej: -100xxx"
      },
      topic: {
        type: "string",
        description: "(send, opcional) Topic ID para grupos con topics."
      },
      parseMode: {
        type: "string",
        enum: ["md", "html", "plain"],
        description: "(send, opcional) Formato: md (Markdown), html, plain. Default: md."
      }
    },
    required: ["action"]
  },
  handler: async (params, { shell }) => {
    const { action, message, chat, topic, parseMode } = params;

    if (action === "setup_guide") {
      return {
        success: true,
        guide: `Para configurar notificaciones Telegram ejecuta:
\`\`\`bash
awkit tg setup
# Te pedirá: Bot Token → Chat ID → Topic ID (opcional)
\`\`\`
La configuración se guarda en ~/.gemini/antigravity/.tg_config.json`,
        usage: `Una vez configurado, puedes pedirme que envíe mensajes a Telegram.`
      };
    }

    if (action === "check_config") {
      const result = await shell("awkit tg send --help", { timeout: 5000 });
      return {
        success: result.exitCode === 0,
        configured: result.exitCode === 0,
        message: result.exitCode === 0
          ? "✅ awkit tg está instalado y disponible."
          : "❌ awkit tg no está configurado. Ejecuta 'awkit tg setup' primero."
      };
    }

    if (action === "send") {
      if (!message) {
        return { success: false, error: "Se requiere 'message' para action=send." };
      }

      // Construir comando
      let cmd = `awkit tg send "${message.replace(/"/g, '\\"')}"`;

      if (chat) cmd += ` --chat ${chat}`;
      if (topic) cmd += ` --topic ${topic}`;
      if (parseMode && parseMode !== "plain") {
        cmd += ` --parse-mode ${parseMode}`;
      } else if (!parseMode) {
        cmd += ` --parse-mode md`; // default: Markdown
      }

      const result = await shell(cmd, { timeout: 10000 });

      if (result.exitCode === 0) {
        return {
          success: true,
          sent: true,
          command: cmd,
          message: "✅ Mensaje enviado a Telegram correctamente."
        };
      }

      // Si falla, probablemente no está configurado
      return {
        success: false,
        error: "No se pudo enviar el mensaje. ¿Has ejecutado 'awkit tg setup'?",
        hint: "Usa telegram_notify con action='setup_guide' para ver instrucciones."
      };
    }
  }
};
