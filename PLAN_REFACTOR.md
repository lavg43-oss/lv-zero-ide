# PLAN REFACTOR — Enrutamiento Dinámico + Escalada de Emergencia + 5 Middlewares Anti-Tokens

**Proyecto:** lv-zero v4.1.0  
**Fecha:** 2026-05-18  
**Objetivo:** Refactorizar el núcleo de orquestación para detener el sangrado de tokens e implementar escalada inteligente DeepSeek→Gemini→DeepSeek Pro.

---

## 📊 FASE 1: Auditoría — Hallazgos Clave

### 1.1 Arquitectura Actual del Núcleo

| Archivo | Líneas | Rol |
|---------|--------|-----|
| [`src/core/orchestrator.js`](src/core/orchestrator.js) | 3905 | Bucle principal, streaming, retry, fallback, tool execution |
| [`src/core/llm_client.js`](src/core/llm_client.js) | 547 | Abstracción multi-provider (DeepSeek, OpenAI-compatible, Mock) |
| [`src/core/circuit_breaker.js`](src/core/circuit_breaker.js) | 314 | Cortacircuitos: CLOSED→OPEN→HALF_OPEN |
| [`src/core/context_manager.js`](src/core/context_manager.js) | 468 | Compactación de memoria, checkpoints Supabase |
| [`src/core/providers/deepseek.js`](src/core/providers/deepseek.js) | 316 | Wrapper OpenAI SDK con `reasoning_content` |
| `30 skills` en [`skills/`](skills/) | ~ | File manager, shell executor, apply_diff, graphify, etc. |

### 1.2 Lo que YA existe ✅

| Feature | Estado | Ubicación |
|---------|--------|-----------|
| Circuit Breaker (3 fallos → OPEN) | ✅ Implementado | [`circuit_breaker.js:39`](src/core/circuit_breaker.js:39) |
| Retry con exponential backoff (5 intentos: 1s→2s→4s→4s) | ✅ Implementado | [`orchestrator.js:1575-1661`](src/core/orchestrator.js:1575) |
| Flash→Pro escalation (`_executeFallbackChain`) | ✅ Implementado | [`orchestrator.js:3727`](src/core/orchestrator.js:3727) |
| Contexto comprimido para Pro (`_buildMinimalContext`) | ✅ Implementado | [`orchestrator.js:3816`](src/core/orchestrator.js:3816) |
| `apply_diff` skill (SEARCH/REPLACE quirúrgico) | ✅ Implementado | [`skills/apply_diff.js`](skills/apply_diff.js) |
| Auto-compactación de memoria (umbrales altos: 500 msgs / 4M chars) | ✅ Implementado | [`context_manager.js:22-29`](src/core/context_manager.js:22) |
| `selectOptimalModel` (Flash por defecto, Pro si Flash degradado) | ✅ Implementado | [`orchestrator.js:3612`](src/core/orchestrator.js:3612) |
| AbortController multi-nivel (stream + tools) | ✅ Implementado | [`orchestrator.js:1538`](src/core/orchestrator.js:1538) |

### 1.3 Lo que FALTA ❌

| Feature | Prioridad |
|---------|-----------|
| **Proveedor Gemini** — No existe ningún archivo ni importación de Gemini en TODO el proyecto | 🔴 CRÍTICO |
| **Destilación de emergencia** — Gemini debe resumir fallos antes de escalar a Pro | 🔴 CRÍTICO |
| **Contador de fallos por diff rechazado** — El usuario dijo "usuario rechaza el Diff dos veces consecutivas" | 🔴 CRÍTICO |
| **Detección de bucles lógicos** — El agente repitiendo las mismas herramientas sin progreso | 🟡 ALTO |
| **`read_file_chunk`** — `file_manager.js` lee archivos completos sin límite de líneas | 🟡 ALTO |
| **`get_code_outline`** — No existe skill que devuelva solo firmas sin lógica | 🟡 ALTO |
| **Truncamiento inteligente del stdout** — Solo hay límite de bytes (10KB), no first 20 + last 50 líneas | 🟡 ALTO |
| **Obligar `apply_diff`** — El system prompt actual no prohíbe sobrescribir archivos completos | 🟡 ALTO |
| **Garbage Collector de historial a 4K tokens** — El threshold actual es 4,000,000 chars (~1M tokens) | 🟡 ALTO |

### 1.4 Modelos Configurados

```env
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_MODEL_CHEAP=deepseek-v4-flash    # Flash — barato/rápido
DEEPSEEK_MODEL_REASONER=deepseek-v4-pro   # Pro — caro/potente
```

**Gemini NO tiene API key configurada** — Debe agregarse en `.env`.

### 1.5 Sistema de Proveedores (Extensible)

El `LLMClient` ya tiene arquitectura multi-provider con registro:
```javascript
// src/core/llm_client.js:38
const PROVIDER_MAP = {
  deepseek: DeepSeekProvider,
  "openai-compatible": OpenAICompatibleProvider,
  mock: MockProvider,
};
```

Agregar Gemini es trivial — solo crear `GeminiProvider` y registrarlo.

---

## 📐 FASE 2: Diseño del Enrutamiento Dinámico + Escalada de Emergencia

### 2.1 Nuevo Provider: GeminiFlashProvider

| Archivo | [`src/core/providers/gemini.js`](src/core/providers/gemini.js) (NUEVO) |
|---------|-------------------------------------------------------------------------|

```javascript
// Ejemplo de firma:
export class GeminiFlashProvider {
  constructor(config) { /* apiKey, model="gemini-2.5-flash" */ }
  get name() { return "gemini-flash"; }
  get label() { return "Gemini 2.5 Flash (Emergencia)"; }
  isReady() { return !!this.apiKey; }
  getModel() { return this.model; }
  
  // IMPORTANTE: Gemini Flash se usa SOLO para destilación — NUNCA para tool calls.
  // Por eso solo necesita complete(), no stream() con herramientas.
  async complete(messages, options = {}) { /* llamada simple sin tools */ }
}
```

**Registro en LLMClient:**
```javascript
// Agregar a PROVIDER_MAP:
"gemini-flash": GeminiFlashProvider,
```

### 2.2 Nuevo Flujo de Escalada de Emergencia

```
┌─────────────────────────────────────────────────────────────┐
│              BUCLE PRINCIPAL (agentLoop)                    │
│                                                             │
│  1. Flash (deepseek-chat) — intentos 1 y 2                  │
│     │                                                       │
│     ├── Éxito → continuar                                   │
│     │                                                       │
│     └── Falla → ¿Es fallo de API?                           │
│         │                                                   │
│         ├── Sí → Retry normal (5 intentos, exponential      │
│         │         backoff) → Si agotados → Escalar a Pro    │
│         │                                                   │
│         └── No → ¿Es fallo de diff o bucle?                 │
│              │                                              │
│              └── Sí → 🚨 PROTOCOLO DE EMERGENCIA 🚨         │
│                                                             │
│  2. PROTOCOLO DE EMERGENCIA (Destilación)                   │
│     │                                                       │
│     ├── 2a. Tomar historial completo de la tarea fallida    │
│     │                                                       │
│     ├── 2b. Enviar a gemini-2.5-flash con prompt oculto:    │
│     │       "Resume en 1 párrafo el problema exacto que     │
│     │        estamos intentando resolver y por qué fallaron  │
│     │        los enfoques anteriores."                      │
│     │                                                       │
│     ├── 2c. Recibir resumen (1 párrafo)                     │
│     │                                                       │
│     └── 2d. Construir nuevo array de mensajes temporal:      │
│            • System prompt original                         │
│            • Resumen de Gemini (como system message)         │
│            • Últimos 2 mensajes del usuario/terminal         │
│                                                             │
│  3. Pro (deepseek-reasoner)                                 │
│     │                                                       │
│     └── Recibe el contexto ultra-ligero y genera solución   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Contador de Fallos por Diff Rechazado

**Estado actual:** El renderer emite `file:acceptDiff` o `file:rejectDiff` por IPC. El orchestrator no tiene visibilidad de esto.

**Nuevo mecanismo:**
```javascript
// En orchestrator.js:
this._consecutiveDiffRejections = 0;
this._lastDiffRejectedForFile = null;

// Método llamado desde IPC cuando el usuario rechaza un diff:
async reportDiffRejection(filePath) {
  this._consecutiveDiffRejections++;
  this._lastDiffRejectedForFile = filePath;
  
  if (this._consecutiveDiffRejections >= 2) {
    this.emit("log", "⚠️ 2 diffs rechazados consecutivos — activando protocolo de emergencia");
    this._emergencyEscalationNeeded = true;
    // La próxima iteración del agentLoop detectará esta flag
  }
}

// Reset cuando el diff es aceptado o la tarea termina:
resetDiffCounter() {
  this._consecutiveDiffRejections = 0;
  this._lastDiffRejectedForFile = null;
  this._emergencyEscalationNeeded = false;
}
```

### 2.4 Detección de Bucles Lógicos

```javascript
// En agentLoop, después de cada iteración:
_detectLoop(messages) {
  const recentToolCalls = [];
  for (let i = messages.length - 1; i >= 0 && recentToolCalls.length < 6; i--) {
    if (messages[i].tool_calls) {
      for (const tc of messages[i].tool_calls) {
        recentToolCalls.push({
          name: tc.function?.name,
          args: tc.function?.arguments?.substring(0, 100)
        });
      }
    }
  }
  
  // Si las últimas 4+ tool calls son idénticas en nombre y args → bucle
  const unique = new Set(recentToolCalls.map(tc => `${tc.name}:${tc.args}`));
  if (recentToolCalls.length >= 4 && unique.size <= 2) {
    this.emit("log", `⚠️ Bucle lógico detectado (${recentToolCalls.length} tool calls, solo ${unique.size} únicas)`);
    return true;
  }
  return false;
}
```

---

## 🛡️ FASE 3: 5 Middlewares de Ahorro de Tokens

### 3.1 Middleware 1: `read_file_chunk`

| Archivo | [`skills/file_manager.js`](skills/file_manager.js) → modificar `handleRead` |
|---------|------------------------------------------------------------------------------|
| Cambio | Exigir `start_line` y `end_line`, límite 150 líneas, rechazar lectura completa |

**Regla de negocio:**
```javascript
function handleRead(safePath, filePath, options = {}) {
  const MAX_CHUNK_LINES = 150;
  
  // Si no hay start_line/end_line, RECHAZAR con mensaje instructivo
  if (!options.start_line && !options.end_line) {
    const totalLines = countLines(content);
    return {
      success: false,
      error: "read_file requiere start_line y end_line. Usa get_code_outline primero para ver la estructura.",
      totalLines,
      suggestion: `Usa start_line: 1, end_line: ${Math.min(totalLines, 150)} para leer el inicio del archivo.`
    };
  }
  
  const start = options.start_line || 1;
  const end = options.end_line || Math.min(start + MAX_CHUNK_LINES, totalLines);
  
  if ((end - start + 1) > MAX_CHUNK_LINES) {
    return {
      success: false,
      error: `Chunk demasiado grande: ${end - start + 1} líneas. Máximo: ${MAX_CHUNK_LINES}.`,
      suggestion: `Divide la lectura en chunks más pequeños.`
    };
  }
  
  // Leer solo el chunk solicitado
  const lines = content.split(/\r?\n/);
  const chunk = lines.slice(start - 1, end).join('\n');
  return { success: true, content: chunk, lines: { start, end, total: totalLines } };
}
```

### 3.2 Middleware 2: `get_code_outline` (NUEVA skill)

| Archivo | [`skills/code_outline.js`](skills/code_outline.js) (NUEVO) |
|---------|------------------------------------------------------------|

```javascript
export default {
  name: "get_code_outline",
  description: "Devuelve SOLO firmas de funciones, clases, imports y exports de un archivo, sin la lógica interna. Úsalo ANTES de read_file para saber qué partes del código necesitas leer.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Ruta del archivo" }
    },
    required: ["path"]
  },
  handler: async ({ path: filePath }) => {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const outline = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      // Detect imports
      if (/^(import|export)\s+.*from\s+['"]/.test(line.trim())) {
        outline.push({ type: "import", line: lineNum, text: line.trim() });
      }
      // Detect class declarations
      else if (/^\s*(export\s+)?class\s+\w+/.test(line.trim())) {
        outline.push({ type: "class", line: lineNum, text: line.trim() });
      }
      // Detect function/method declarations
      else if (/^\s*(export\s+)?(async\s+)?function\s+\w+/.test(line.trim()) ||
               /^\s*(async\s+)?\w+\s*\([^)]*\)\s*\{/.test(line.trim())) {
        outline.push({ type: "function", line: lineNum, text: line.trim() });
      }
    }
    
    return {
      success: true,
      path: filePath,
      totalLines: lines.length,
      outline,
      summary: `${outline.length} elementos encontrados en ${lines.length} líneas`
    };
  }
};
```

### 3.3 Middleware 3: Auto-truncamiento del stdout

| Archivo | [`skills/shell_executor.js`](skills/shell_executor.js) → modificar `truncateOutput` |
|---------|------------------------------------------------------------------------------------|

**Regla:**
```javascript
function truncateOutputLines(output, maxLines = 100) {
  if (!output) return output;
  
  const lines = output.split(/\r?\n/);
  
  if (lines.length <= maxLines) return output;
  
  // Conserve first 20 + last 50 = 70 lines, replace 30+ middle
  const head = lines.slice(0, 20).join('\n');
  const tail = lines.slice(-50).join('\n');
  const skipped = lines.length - 70;
  
  return `${head}\n\n... [${skipped} LÍNEAS TRUNCADAS] ...\n\n${tail}`;
}
```

### 3.4 Middleware 4: Obligar `apply_diff`

**Estrategia:** Modificar el system prompt, NO el código.

Agregar al system prompt de los modos `code` y `debug`:
```markdown
## REGLA OBLIGATORIA DE EDICIÓN

NUNCA uses write_to_file o file_manager con action="write" para modificar archivos existentes. 
SIEMPRE usa apply_diff con SEARCH/REPLACE para cambios menores a 50 líneas.

Excepción: write_to_file SOLO para archivos NUEVOS (que no existen aún).

Razón: Los diffs quirúrgicos son más seguros, rastreables, y consumen 10x menos tokens.
```

### 3.5 Middleware 5: Garbage Collector de Historial a 4K tokens

| Archivo | [`src/core/context_manager.js`](src/core/context_manager.js) → nuevo threshold + usar Gemini |
|---------|---------------------------------------------------------------------------------------------|

**Cambios:**
```javascript
// Nuevo umbral agresivo para conversaciones normales (no tool-call intensivas):
const CONFIG = {
  MAX_MESSAGES: 500,           // Sin cambio — para tareas tool-call intensivas
  MAX_CHARS: 4000000,          // Sin cambio — para tareas tool-call intensivas
  MAX_TOOL_CALLS: 100,        // Sin cambio
  
  // NUEVO: Umbral para conversación normal (sin tool calls intensivas)
  MAX_CONVERSATION_TOKENS: 4000,  // ~16K chars para conversación normal
  MAX_CONVERSATION_CHARS: 16000,
};

// NUEVA: Función de resumen con Gemini
async function summarizeWithGemini(messages) {
  // Usar Gemini Flash (gratis) para resumir mensajes viejos
  const geminiProvider = getProvider("gemini-flash");
  if (!geminiProvider) return null;
  
  const summaryPrompt = [
    { role: "system", content: "Resume esta conversación en 1-2 frases, capturando SOLO el tema principal y las decisiones tomadas. Sé extremadamente conciso." },
    { role: "user", content: messages.map(m => `${m.role}: ${String(m.content).substring(0, 200)}`).join('\n') }
  ];
  
  try {
    const result = await geminiProvider.complete(summaryPrompt, { max_tokens: 200 });
    return result.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// NUEVA: Garbage collector con Gemini
async function garbageCollectHistory(messages) {
  const totalChars = messages.reduce((sum, m) => sum + (String(m.content||'').length), 0);
  
  if (totalChars <= CONFIG.MAX_CONVERSATION_CHARS) return messages;
  
  // Tomar los mensajes más viejos (dejando los últimos 10)
  const oldMessages = messages.slice(0, -10);
  const recentMessages = messages.slice(-10);
  
  // Intentar resumir con Gemini
  const summary = await summarizeWithGemini(oldMessages);
  
  if (summary) {
    return [
      messages.find(m => m.role === 'system'), // System prompt original
      { role: 'system', content: `[RESUMEN DE CONVERSACIÓN ANTERIOR]: ${summary}` },
      ...recentMessages
    ];
  }
  
  // Fallback: simple truncation
  return [
    messages.find(m => m.role === 'system'),
    { role: 'system', content: `[${oldMessages.length} mensajes anteriores omitidos por límite de tokens]` },
    ...recentMessages
  ];
}
```

---

## 📋 Archivos a Modificar — Resumen

| # | Archivo | Tipo de Cambio | Fase |
|---|---------|---------------|------|
| 1 | `src/core/providers/gemini.js` | **NUEVO** — GeminiFlashProvider | F2 |
| 2 | `src/core/llm_client.js` | MODIFICAR — Registrar "gemini-flash" en PROVIDER_MAP | F2 |
| 3 | `src/core/orchestrator.js` | MODIFICAR — Emergency distillation, diff rejection counter, loop detection | F2 |
| 4 | `.env` | MODIFICAR — Agregar GEMINI_API_KEY | F2 |
| 5 | `skills/file_manager.js` | MODIFICAR — `handleRead` con start_line/end_line + 150 límite | F3 |
| 6 | `skills/code_outline.js` | **NUEVO** — skill get_code_outline | F3 |
| 7 | `skills/shell_executor.js` | MODIFICAR — `truncateOutputLines` (first 20 + last 50) | F3 |
| 8 | `src/modes/prompts/code.md` | MODIFICAR — Regla obligatoria apply_diff | F3 |
| 9 | `src/modes/prompts/debug.md` | MODIFICAR — Regla obligatoria apply_diff | F3 |
| 10 | `src/core/context_manager.js` | MODIFICAR — 4K token GC + Gemini summarization | F3 |

---

## ⏱️ Plan de Ejecución Cronológico

### Paso 1: GeminiFlashProvider + Registro (F2) → 15 min

1. Crear [`src/core/providers/gemini.js`](src/core/providers/gemini.js)
2. Registrar en `LLMClient.PROVIDER_MAP`
3. Verificar: `npm start` → sin errores de import

### Paso 2: Emergency Distillation (F2) → 30 min

1. Agregar `_emergencyDistill()` al orchestrator
2. Agregar `_detectLogicalLoop()` 
3. Agregar `reportDiffRejection()` y `resetDiffCounter()`
4. Conectar IPC: `diff:rejected` → `reportDiffRejection()`
5. Verificar: Simular reject de diff 2 veces → debuggear

### Paso 3: Middleware `read_file_chunk` (F3) → 20 min

1. Modificar `handleRead` en `skills/file_manager.js`
2. Actualizar descripción del parámetro `action: "read"` para incluir `start_line` y `end_line`
3. Verificar: Archivo de 500 líneas → `read_file` sin params → error instructivo

### Paso 4: Middleware `get_code_outline` (F3) → 15 min

1. Crear `skills/code_outline.js`
2. Agregar a la carga de skills en el orchestrator
3. Verificar: `get_code_outline("src/core/orchestrator.js")` → lista de funciones/clases

### Paso 5: Middleware `truncateOutputLines` (F3) → 10 min

1. Modificar `truncateOutput` en `skills/shell_executor.js`
2. Verificar: Comando con 500 líneas → head 20 + tail 50 con marcador `[TRUNCADO]`

### Paso 6: Middleware `apply_diff` obligatorio (F3) → 5 min

1. Editar `src/modes/prompts/code.md`
2. Editar `src/modes/prompts/debug.md`
3. Verificar: El agente usa `apply_diff` para cambios existentes

### Paso 7: Middleware Garbage Collector 4K tokens (F3) → 20 min

1. Agregar `MAX_CONVERSATION_TOKENS` y `MAX_CONVERSATION_CHARS` al context_manager
2. Agregar `summarizeWithGemini()` y `garbageCollectHistory()`
3. Integrar en el bucle principal (llamar cada N iteraciones)
4. Verificar: Conversación >4000 tokens → se compacta con Gemini

### Paso 8: Integración y Pruebas → 20 min

1. `npm start` — verificar que todo arranca
2. Simular fallo de Flash → Gemini → Pro
3. Verificar que los 5 middlewares funcionan

---

## ⚠️ Riesgos y Mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|-------------|------------|
| Gemini API no disponible (sin key o sin balance) | Alto | Media | Fallback: usar resumen local sin Gemini |
| `read_file_chunk` rompe flujos existentes que leen archivos completos | Medio | Alta | Agregar opción `full: true` para bypass manual |
| Destilación con Gemini puede exceder el límite de tokens de Gemini Flash | Bajo | Baja | Truncar historial a últimos 20 mensajes antes de enviar |
| Loop detection falsos positivos | Medio | Baja | Solo disparar emergencia en iteración >5 |
| `apply_diff` obligatorio frustra al agente en archivos nuevos | Bajo | Media | Excepción explícita en el prompt: "write_to_file SOLO para archivos NUEVOS" |
| AbortController conflictos entre Gemini y DeepSeek en el mismo ciclo | Medio | Baja | Crear AbortController separado para cada provider |

---

## 🎯 Métricas de Éxito

| Métrica | Actual | Objetivo |
|---------|--------|----------|
| Tokens por tarea promedio | ~15K-50K | <8K |
| Flash→Pro escalada | Tras 5 fallos de API | + destilación Gemini entre Flash y Pro |
| Líneas leídas por `read_file` | Archivo completo (hasta 2000 líneas) | Máximo 150 líneas |
| stdout enviado al LLM | Hasta 10KB | First 20 + last 50 líneas (máx ~70 líneas) |
| Sobrescrituras de archivos completos | Permitidas | Bloqueadas (apply_diff obligatorio) |
| Tiempo hasta GC de historial | 4M caracteres (~1M tokens) | 16K caracteres (~4K tokens) |

---

*Documento generado tras auditoría completa de 3905 líneas del orchestrator, 30 skills, sistema de providers, circuit breaker, y context manager.*

**⚠️ ESPERANDO APROBACIÓN DEL USUARIO PARA COMENZAR LA IMPLEMENTACIÓN.**
