/**
 * lv-zero — Punto de Entrada (CLI Wrapper)
 *
 * v4.0
 *   Punto de entrada delgado que inicializa el Orchestrator
 *   y proporciona una interfaz CLI (readline).
 *   El motor real está en src/core/orchestrator.js.
 *
 *   La GUI de Electron (cuando esté activa) usará el mismo Orchestrator
 *   a través del IPC bridge, sin tocar este archivo.
 */

import chalk from "chalk";
import readline from "readline";
import Orchestrator from "./core/orchestrator.js";

// ─── Readline Interface ─────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.cyan("lv-zero> "),
});

// ─── Orchestrator Instance ──────────────────────────────────────────────────
const orchestrator = new Orchestrator();

// ─── Event Handlers ─────────────────────────────────────────────────────────

orchestrator.on("log", (msg) => console.log(chalk.dim(msg)));

orchestrator.on("warn", (msg) => console.log(chalk.yellow(msg)));

orchestrator.on("thought", (thought) => {
  console.log("");
  console.log(chalk.bold.magenta(`[THOUGHT] ${thought}`));
  console.log("");
});

orchestrator.on("step", ({ iteration, total }) => {
  console.log(
    chalk.dim(`\n📡 Paso ${iteration} de ${total} — consultando a DeepSeek...`)
  );
});

orchestrator.on("summary", ({ before, after, reason }) => {
  console.log(
    chalk.dim(
      `   🧠 Compactación de memoria: ${before} → ${after} mensajes (${reason})`
    )
  );
});

orchestrator.on("tool_call", ({ name, args, status, toolIndex, totalTools }) => {
  if (status === "not_found") {
    console.log(chalk.red(`   ❌ Skill "${name}" no encontrada`));
    return;
  }
  if (status === "running") {
    console.log(
      chalk.dim(
        `   🛠  [${toolIndex}/${totalTools}] Ejecutando ${chalk.cyan(name)}(${JSON.stringify(args)})`
      )
    );
  }
});

orchestrator.on("tool_result", ({ name, status, error, toolIndex, totalTools }) => {
  if (status === "success") {
    console.log(chalk.dim(`   ✅ [${toolIndex}/${totalTools}] ${name} completada`));
  } else {
    console.log(chalk.red(`   ❌ [${toolIndex}/${totalTools}] ${name}: ${error}`));
  }
});

orchestrator.on("response", (content) => {
  console.log("");
  console.log(chalk.bold.cyan("🤖 lv-zero:"));
  console.log(chalk.white(content));
  console.log("");
  rl.prompt();
});

orchestrator.on("error", ({ type, message, iteration }) => {
  const prefix = iteration ? `[Paso ${iteration}] ` : "";
  console.error(chalk.red(`\n❌ ${prefix}${message}\n`));
  if (!orchestrator.isRunning) {
    rl.prompt();
  }
});

orchestrator.on("skills_loaded", ({ count, skills }) => {
  // Already logged in init
});

orchestrator.on("ready", ({ sessionId, skillsCount, model }) => {
  showWelcome(sessionId, skillsCount);
  rl.prompt();

  rl.on("line", (line) => {
    processInput(line);
  });

  rl.on("close", async () => {
    await orchestrator.shutdown();
    process.exit(0);
  });
});

orchestrator.on("workflow_start", ({ command, description, input }) => {
  console.log(chalk.dim(`   📋 Workflow activado: ${chalk.cyan(command)} — ${description}`));
  if (input) {
    console.log(chalk.dim(`   📝 Solicitud: "${input}"`));
  }
});

orchestrator.on("workflow_suggest", ({ command, description }) => {
  console.log(chalk.dim(`   💡 Sugerencia: Usa ${chalk.cyan(command)} para ${description}`));
});

orchestrator.on("workflow_end", ({ command }) => {
  console.log(chalk.dim(`   ✅ Workflow completado: ${chalk.cyan(command)}`));
});

// ─── CLI Functions ──────────────────────────────────────────────────────────

function showWelcome(sessionId, skillsCount) {
  console.log("");
  console.log(chalk.bold.green("╔══════════════════════════════════════╗"));
  console.log(chalk.bold.green("║       lv-zero  v4.0.0               ║"));
  console.log(chalk.bold.green("║   Autonomous System Architect       ║"));
  console.log(chalk.bold.green("╚══════════════════════════════════════╝"));
  console.log("");
  console.log(
    chalk.yellow(
      `Bienvenido a lv-zero — Sistema Autónomo de Arquitectura.`
    )
  );
  console.log(chalk.yellow(`🎯 ${skillsCount} skills armadas y listas.`));
  console.log(
    chalk.dim(`📂 Sesión: ${sessionId}`)
  );
  console.log(
    chalk.dim("Escribe 'ayuda' para ver comandos disponibles.")
  );
  console.log("");
}

function showHelp() {
  console.log("");
  console.log(chalk.bold("Comandos disponibles:"));
  console.log(`  ${chalk.cyan("salir")}        → Termina la sesión`);
  console.log(`  ${chalk.cyan("ayuda")}        → Muestra esta ayuda`);
  console.log(`  ${chalk.cyan("plan <txt>")}   → Actualiza el Manager View`);
  console.log(`  ${chalk.cyan("skills")}       → Lista todas las skills cargadas`);
  console.log(`  ${chalk.cyan("reload")}       → Recarga todas las skills en caliente`);
  console.log(`  ${chalk.cyan("status")}       → Estado del orquestador`);
  console.log(`  ${chalk.cyan("clear")}        → Limpia el historial de conversación`);
  console.log(`  ${chalk.cyan("workflows")}    → Lista los workflows disponibles`);
  console.log(`  ${chalk.cyan("workspace")}    → Muestra info del workspace multi-carpeta`);
  console.log(`  ${chalk.cyan("ws-add <path> [label]")} → Agrega carpeta al workspace`);
  console.log(`  ${chalk.cyan("ws-rm <path>")} → Elimina carpeta del workspace`);
  console.log(`  ${chalk.cyan("/plan")}        → Inicia workflow de planificación`);
  console.log(`  ${chalk.cyan("/code")}        → Inicia workflow de implementación`);
  console.log(`  ${chalk.cyan("/debug")}       → Inicia workflow de depuración`);
  console.log(`  ${chalk.cyan("/review")}      → Inicia workflow de revisión`);
  console.log(`  ${chalk.cyan("<input>")}      → Enviar mensaje al agente DeepSeek`);
  console.log("");
}

function showWorkflows() {
  const workflows = orchestrator.getWorkflows();
  console.log("");
  console.log(chalk.bold(`📋 Workflows disponibles (${workflows.length}):`));
  console.log("");
  for (const w of workflows) {
    const aliasStr = w.aliases.length > 0 ? chalk.dim(` (${w.aliases.join(", ")})`) : "";
    console.log(`  ${chalk.cyan(w.command.padEnd(10))}${aliasStr} ${chalk.dim(w.description)}`);
  }
  console.log("");
  console.log(chalk.dim("Uso: Escribe /plan, /code, /debug o /review seguido de tu solicitud."));
  console.log(chalk.dim("Ej: /code Crea un endpoint REST para usuarios"));
  console.log("");
}

function showSkills() {
  const skillList = orchestrator.getSkills();
  console.log("");
  console.log(chalk.bold(`📦 Skills registradas (${skillList.length}):`));
  console.log("");
  for (const s of skillList) {
    const desc =
      s.description.length > 80
        ? s.description.substring(0, 77) + "..."
        : s.description;
    console.log(`  ${chalk.cyan(s.name.padEnd(20))} ${chalk.dim(desc)}`);
  }
  console.log("");
}

function showStatus() {
  const status = orchestrator.getStatus();
  console.log("");
  console.log(chalk.bold("📊 Estado del Orquestador:"));
  console.log(`  ${chalk.cyan("Sesión:")}       ${status.session.sessionId || "N/A"}`);
  console.log(`  ${chalk.cyan("Ejecutando:")}   ${status.running ? "Sí" : "No"}`);
  console.log(`  ${chalk.cyan("Skills:")}       ${status.skillsCount}`);
  console.log(`  ${chalk.cyan("Mensajes:")}     ${status.messagesCount}`);
  console.log(`  ${chalk.cyan("Modelo:")}       ${status.model}`);
  console.log(`  ${chalk.cyan("Cliente:")}      ${status.clientReady ? "Conectado" : "Desconectado"}`);
  console.log(`  ${chalk.cyan("Iteración:")}    ${status.iteration}/${status.maxIterations}`);
  console.log("");
}

// ─── Input Processing ───────────────────────────────────────────────────────

async function processInput(input) {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === "salir" || trimmed === "exit") {
    console.log(chalk.yellow("\n¡Hasta pronto, Luis! 🚀\n"));
    await orchestrator.shutdown();
    rl.close();
    return;
  }

  if (trimmed === "ayuda" || trimmed === "help") {
    showHelp();
    rl.prompt();
    return;
  }

  if (trimmed === "skills") {
    showSkills();
    rl.prompt();
    return;
  }

  if (trimmed === "status") {
    showStatus();
    rl.prompt();
    return;
  }

  if (trimmed === "clear") {
    orchestrator.clearConversation();
    rl.prompt();
    return;
  }

  if (trimmed === "reload") {
    console.log(chalk.dim("🔄 Recargando skills..."));
    const count = await orchestrator.reloadAllSkills();
    console.log(chalk.green(`✅ ${count} skills recargadas.`));
    rl.prompt();
    return;
  }

  if (trimmed === "workflows") {
    showWorkflows();
    rl.prompt();
    return;
  }

  if (trimmed.startsWith("plan ")) {
    const planContent = input.slice(5).trim();
    orchestrator.updatePlan(planContent);
    rl.prompt();
    return;
  }

  // ── Workspace Commands ────────────────────────────────────────────────
  if (trimmed === "workspace") {
    const ws = orchestrator.workspaceManager;
    if (!ws || !ws.isOpen) {
      console.log(chalk.yellow("\n📂 No hay workspace activo.\n"));
      rl.prompt();
      return;
    }
    console.log("");
    console.log(chalk.bold(`📂 Workspace: ${chalk.cyan(ws.name)}`));
    console.log(chalk.dim(`   Root: ${ws.rootPath}`));
    console.log(chalk.dim(`   Carpetas (${ws.folders.length}):`));
    for (const folder of ws.listFolders()) {
      const label = folder.label ? ` [${folder.label}]` : "";
      const primary = folder.isPrimary ? " ★" : "";
      const exists = folder.exists ? "✅" : "⚠️";
      console.log(`     ${exists} ${folder.path}${label}${primary}`);
    }
    console.log("");
    rl.prompt();
    return;
  }

  if (trimmed.startsWith("ws-add ")) {
    const rest = input.slice(7).trim();
    const parts = rest.match(/(["'])(?:\\.|[^\\])*?\1|\S+/g) || [];
    const folderPath = parts[0]?.replace(/^["']|["']$/g, "") || "";
    const label = parts.slice(1).join(" ").replace(/^["']|["']$/g, "") || null;
    if (!folderPath) {
      console.log(chalk.red("❌ Uso: ws-add <ruta> [etiqueta]"));
      rl.prompt();
      return;
    }
    const result = orchestrator.workspaceManager.addFolder(folderPath, label);
    if (result.success) {
      console.log(chalk.green(`✅ Carpeta agregada: ${folderPath}${label ? ` [${label}]` : ""}`));
      await orchestrator.setProjectPath(orchestrator.projectPath);
    } else {
      console.log(chalk.red(`❌ ${result.error}`));
    }
    rl.prompt();
    return;
  }

  if (trimmed.startsWith("ws-rm ")) {
    const folderPath = input.slice(6).trim().replace(/^["']|["']$/g, "");
    if (!folderPath) {
      console.log(chalk.red("❌ Uso: ws-rm <ruta>"));
      rl.prompt();
      return;
    }
    const result = orchestrator.workspaceManager.removeFolder(folderPath);
    if (result.success) {
      console.log(chalk.green(`✅ Carpeta eliminada: ${folderPath}`));
      await orchestrator.setProjectPath(orchestrator.projectPath);
    } else {
      console.log(chalk.red(`❌ ${result.error}`));
    }
    rl.prompt();
    return;
  }

  // Delegate to orchestrator agent loop
  // Workflow commands (/plan, /code, etc.) are detected inside agentLoop
  try {
    const result = await orchestrator.agentLoop(input);
    console.log(result);
  } catch (err) {
    console.error("Agent loop error:", err.message);
    // Don't crash — return to prompt
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

async function main() {
  try {
    await orchestrator.init({ autoSave: true });
  } catch (err) {
    console.error(chalk.red(`Fatal: ${err.message}`));
    process.exit(1);
  }
}

main();
