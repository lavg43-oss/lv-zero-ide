/**
 * gbrain_think — Síntesis con Gap Analysis.
 * Consulta la memoria existente (Supabase + Symphony + entidades) y produce
 * respuestas sintetizadas con citas + gap analysis explícito.
 * Inspirado en gbrain de Garry Tan (YC).
 * Activado por defecto. Toggle: LV_GBRAIN_THINK=false para desactivar.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let _supabase = null;
function _sb() {
  if (_supabase) return _supabase;
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.LV_SUPABASE_URL;
  const key = process.env.LV_SUPABASE_SERVICE_ROLE_KEY || process.env.LV_SUPABASE_KEY;
  if (url && key) _supabase = createClient(url, key);
  return _supabase;
}

export default {
  name: "gbrain_think",
  description: "Síntesis con gap analysis. Consulta la memoria (Supabase + entidades) y produce respuestas con citas + 'lo que no sé'. Activado por defecto. Toggle: LV_GBRAIN_THINK=false. Actions: think (sintetizar), search (buscar), status (mostrar estado de memoria).",
  parameters: {
    type: "object", properties: {
      action: { type: "string", enum: ["think","search","status"], description: "think: sintetizar respuesta con gap analysis. search: buscar en memoria. status: mostrar estado." },
      query: { type: "string", description: "Consulta o pregunta del usuario." },
      maxSources: { type: "number", description: "Máximo de fuentes a consultar. Default: 10." },
    }, required: ["action"],
  },
  handler: async (p) => {
    if (process.env.LV_GBRAIN_THINK === "false") return { success: false, error: "gbrain_think disabled (LV_GBRAIN_THINK=false)" };
    switch (p.action) {
      case "think": return await _think(p);
      case "search": return await _search(p);
      case "status": return await _status();
      default: return { success: false, error: `Unknown: ${p.action}` };
    }
  },
};

async function _think(p) {
    if (!p.query) return { success: false, error: "query required" };
    const maxSrc = p.maxSources || 10;

    // 1. Buscar en Supabase (checkpoints)
    const sb = _sb();
    let supabaseResults = [];
    if (sb) {
      try {
        const { data } = await sb.from("lvzero_memory").select("topic, content, created_at").ilike("content", `%${p.query}%`).order("created_at", { ascending: false }).limit(maxSrc);
        if (data) supabaseResults = data;
      } catch {}
    }

    // 2. Buscar en entidades (entity_extractor)
    let entityResults = [];
    try {
      const { extractEntities } = await import("../src/core/memory/entity_extractor.js");
      const extracted = extractEntities(p.query);
      entityResults = extracted.entities;
    } catch {}

    // 3. Construir gap analysis
    const totalSources = supabaseResults.length + entityResults.length;
    const gaps = [];
    if (totalSources === 0) gaps.push("No hay información en la memoria sobre este tema.");
    if (supabaseResults.length < 3) gaps.push("Pocos checkpoints encontrados. La información puede estar incompleta.");
    if (entityResults.length === 0) gaps.push("No se detectaron entidades (personas, empresas, tecnologías) relacionadas.");

    // 4. Sintetizar respuesta
    let synthesis = "";
    if (supabaseResults.length > 0) {
      synthesis += `## Respuesta Sintetizada\n\nBasado en ${supabaseResults.length} fuentes de memoria:\n\n`;
      for (const r of supabaseResults.slice(0, 5)) {
        const preview = r.content.substring(0, 300);
        synthesis += `- **${r.topic || "Checkpoint"}** (${new Date(r.created_at).toLocaleDateString()}): ${preview}...\n`;
      }
    }
    if (entityResults.length > 0) {
      synthesis += `\n### Entidades Detectadas\n\n`;
      for (const e of entityResults.slice(0, 10)) {
        synthesis += `- **${e.name}** (${e.type})\n`;
      }
    }

    // 5. Gap analysis
    synthesis += `\n### Gap Analysis\n\n`;
    if (gaps.length === 0) {
      synthesis += "La memoria tiene cobertura adecuada sobre este tema.\n";
    } else {
      for (const g of gaps) synthesis += `- ⚠️ ${g}\n`;
    }
    synthesis += `\n*Fuentes consultadas: ${totalSources}*`;

    return { success: true, query: p.query, synthesis, sources: supabaseResults.length, entities: entityResults.length, gaps };
}

async function _search(p) {
    if (!p.query) return { success: false, error: "query required" };
    const sb = _sb();
    if (!sb) return { success: false, error: "Supabase not configured" };
    const { data } = await sb.from("lvzero_memory").select("topic, content, created_at").ilike("content", `%${p.query}%`).order("created_at", { ascending: false }).limit(20);
    return { success: true, query: p.query, results: data || [], count: data?.length || 0 };
}

async function _status() {
    const sb = _sb();
    let totalMemories = 0, latestMemory = null;
    if (sb) {
      try {
        const { data } = await sb.from("lvzero_memory").select("id", { count: "exact", head: true });
        totalMemories = data?.length || 0;
        const { data: latest } = await sb.from("lvzero_memory").select("topic, created_at").order("created_at", { ascending: false }).limit(1);
        if (latest?.length) latestMemory = latest[0];
      } catch {}
    }
    return {
      success: true,
      enabled: process.env.LV_GBRAIN_THINK !== "false",
      supabase: !!sb,
      totalMemories,
      latestMemory: latestMemory ? `${latestMemory.topic} (${new Date(latestMemory.created_at).toLocaleDateString()})` : "none",
      entityExtractor: process.env.LV_ENTITY_EXTRACTOR !== "false",
    };
}
