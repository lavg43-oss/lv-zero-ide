# 🧠 Roo Context — Recovery File

> **NUNCA borrar este archivo.** Es el punto de entrada único para que Roo sepa dónde se quedó tras un crash.

---

## 📍 Último estado conocido

| Campo | Valor |
|---|---|
| **Última actualización** | 2026-05-16T05:33:00Z |
| **Tarea activa** | Smart Model Switching: Flash→Pro with minimal context |
| **Modo actual** | code |
| **Modelo activo** | deepseek-reasoner |
| **Arquitectura** | Flash-first con escalación automática a Pro |

---

## 🏗️ Arquitectura de Modelos (Smart Model Switching)

### Concepto
Todos los modos de lv-zero usan **DeepSeek V4 Flash** (`deepseek-v4-flash`) por defecto. Solo cuando falla 2 veces seguidas, escala automáticamente a **DeepSeek V4 Pro** (`deepseek-v4-pro`) con contexto comprimido.

### Flujo de escalación
```
Modo X → selectOptimalModel() → "cheap" (Flash)
  → API call with Flash → FAIL
  → 1 retry (1s delay) with Flash → FAIL (2nd attempt)
  → _executeFallbackChain()
    → _buildMinimalContext() (comprime: system + summary + last user msg)
    → switchProvider + setModel → Pro
    → stream con contexto mínimo
  → ✅ Success → continúa procesamiento
  → ❌ Failed → error fatal
```

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/core/orchestrator.js` | MAX_RETRIES=1, fallback cheap→reasoner, _buildMinimalContext, _getFallbackChain, _executeFallbackChain |
| `src/core/llm_client.js` | Removido sistema de degradación (DEGRADED_THRESHOLD, AUTO_RECOVERY, degraded fields) |
| `src/modes/mode_registry.js` | Todos los modes: defaultModel="cheap" |

### Variables de entorno
```
DEEPSEEK_MODEL_CHEAP=deepseek-v4-flash   → usado por defecto
DEEPSEEK_MODEL_REASONER=deepseek-v4-pro  → usado en escalación
```

---

## 🔧 Archivos modificados esta sesión

1. `src/core/orchestrator.js` — Smart Model Switching: Flash→Pro, minimal context, MAX_RETRIES=1
2. `src/core/llm_client.js` — Removido sistema de degradación de providers
3. `src/modes/mode_registry.js` — Todos los modos usan "cheap" por defecto
4. `src/main.cjs` — Logo LOGOLVZERO.png
5. `package.json` — build.files + icon
6. `mcp_servers.json` — 5 MCPs: playwright, firecrawl, document-processing, slidev, casablanca
7. `_lib/tool_manifest.js` — Soporte dual formato + MCPs
8. `ui/renderer.js` — **BUG FIX**: follow-up question input/texto libre ahora funciona
9. `ROO_CONTEXT.md` — CREADO: archivo único de recovery

---

## 📋 TODO

- [x] Logo cambiado a LOGOLVZERO.png
- [x] mcp_servers.json — 5 MCPs reales en formato objeto
- [x] tool_manifest.js — dual formato + nuevos MCPs
- [x] Slidev + Casablanca en MCPs
- [x] **BUG FIX**: follow-up question input no funcionaba
- [x] Remover degradación de proveedores (llm_client.js)
- [x] Modos usan Flash por defecto (mode_registry.js)
- [x] Smart escalación Flash→Pro con contexto mínimo (orchestrator.js)
- [ ] Verificar MCPConfigManager con nuevo formato
- [ ] FIRECRAWL_API_KEY en .env
- [ ] Probar graphify_explorer

---

## ⚠️ Reglas para Roo al iniciar

1. **LEE ESTE ARCHIVO PRIMERO** (`C:\Users\LAVG\Documents\lv-zero\ROO_CONTEXT.md`)
2. Revisa la sección "Arquitectura de Modelos" arriba
3. Lee el plan mencionado arriba
4. Revisa pestañas abiertas en VS Code
5. Continúa desde donde te quedaste

## 🔌 MCP Servers (5)

| MCP | Comando | Licencia |
|---|---|---|
| playwright | `npx -y @playwright/mcp` | Apache 2.0 |
| firecrawl | `npx -y firecrawl-mcp` | Freemium |
| document-processing | `npx -y @anthropic/mcp-document-processing-server` | MIT |
| slidev | `npx -y @slidev/cli` | MIT |
| casablanca | `npx -y @niklasingvar/casablanca` | MIT |

## 🐛 Bugs fixeados

- **Follow-up input roto** (`ui/renderer.js:2731-2748`): El HTML tenía botón "Enviar" e input pero JS no les ponía event handlers. Solo funcionaban los botones de opciones predefinidas. Agregado `onclick` al botón Submit, `onkeydown` (Enter) al input, y `onclick` al botón Cancelar.
