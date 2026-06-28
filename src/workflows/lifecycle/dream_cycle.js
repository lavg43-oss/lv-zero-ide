/**
 * Dream Cycle — Enriquecimiento nocturno automático de memoria.
 * Se ejecuta en background cuando el agente está inactivo (>5 min).
 * Inspirado en el dream cycle de gbrain (Garry Tan, YC).
 * Activado por defecto. Toggle: LV_DREAM_CYCLE=false para desactivar.
 *
 * Fases:
 *   1. Entity enrichment — Extraer entidades de checkpoints recientes
 *   2. Memory consolidation — Fusionar memorias similares (usa MemoryEvolution)
 *   3. Graph wiring — Crear edges entre entidades relacionadas
 *   4. Gap detection — Identificar temas con poca cobertura
 */
import { extractEntities, extractTechStack } from "../../core/memory/entity_extractor.js";

let _timer = null, _running = false, _lastRun = null, _stats = { cycles: 0, entitiesExtracted: 0, gapsFound: 0 };

export function startDreamCycle(orchestrator) {
  if (process.env.LV_DREAM_CYCLE === "false") { console.log("   💤 Dream cycle disabled (LV_DREAM_CYCLE=false)"); return; }
  if (_timer) return;
  const interval = (parseInt(process.env.LV_DREAM_CYCLE_INTERVAL) || 5) * 60 * 1000;
  console.log(`   💤 Dream cycle started (interval: ${interval/60000}min)`);
  _timer = setInterval(() => runCycle(orchestrator), interval);
  // Also run once after 30s
  setTimeout(() => runCycle(orchestrator), 30000);
}

export function stopDreamCycle() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  console.log("   💤 Dream cycle stopped");
}

export function getDreamCycleStats() { return { ..._stats, running: _running, lastRun: _lastRun }; }

async function runCycle(orchestrator) {
  if (_running || !orchestrator?.messages?.length) return;
  _running = true;
  const start = Date.now();
  try {
    console.log("   💤 Dream cycle: starting...");

    // Phase 1: Entity enrichment from recent messages
    const recentText = orchestrator.messages.slice(-20).map(m => m.content || "").join("\n");
    const { entities, relations } = extractEntities(recentText);
    const techStack = extractTechStack(recentText);
    _stats.entitiesExtracted += entities.length;
    console.log(`   💤 Phase 1: ${entities.length} entities, ${relations.length} relations, ${techStack.length} techs`);

    // Phase 2: Memory consolidation (delegate to MemoryEvolution if available)
    try {
      const { MemoryEvolution } = await import("../../core/memory/memory-evolution.js");
      const { MemoryDatabase } = await import("../../core/memory/database.cjs");
      const db = MemoryDatabase.getInstance(orchestrator.projectPath || process.cwd());
      const evolution = new MemoryEvolution();
      const pruned = await evolution.pruneExpired(db);
      const consolidated = await evolution.consolidateSimilar(db);
      console.log(`   💤 Phase 2: pruned ${pruned}, consolidated ${consolidated}`);
    } catch (err) {
      console.log(`   💤 Phase 2 skipped (MemoryEvolution not available): ${err.message}`);
    }

    // Phase 3: Gap detection
    const gaps = [];
    if (entities.length === 0 && orchestrator.messages.length > 10) {
      gaps.push("No entities detected despite significant conversation history");
    }
    if (techStack.length === 0 && orchestrator.messages.length > 5) {
      gaps.push("No technology stack detected");
    }
    _stats.gapsFound += gaps.length;
    if (gaps.length) console.log(`   💤 Phase 3: ${gaps.length} gaps detected`);

    // Phase 4: Store dream cycle results as context
    if (entities.length > 0 || gaps.length > 0) {
      const dreamSummary = `[Dream Cycle ${new Date().toISOString()}]\nEntities: ${entities.map(e => e.name).join(", ")}\nTech: ${techStack.join(", ")}\nGaps: ${gaps.join("; ")}`;
      // Inject as system message for next agent loop
      orchestrator.messages.push({ role: "system", content: `🧠 ${dreamSummary}` });
      console.log(`   💤 Phase 4: context injected (${dreamSummary.length} chars)`);
    }

    _lastRun = new Date().toISOString();
    _stats.cycles++;
    console.log(`   💤 Dream cycle complete (${Date.now() - start}ms)`);
  } catch (err) {
    console.log(`   💤 Dream cycle error: ${err.message}`);
  } finally {
    _running = false;
  }
}

export default { startDreamCycle, stopDreamCycle, getDreamCycleStats };
