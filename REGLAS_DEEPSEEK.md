# 📋 REGLAS DE DEEPSEEK — Referencia Rápida para LV-ZERO

> Fuente: https://api-docs.deepseek.com — Mayo 2026
> Modelos: `deepseek-v4-flash` y `deepseek-v4-pro`
> 🗺️ **Graphificado**: Usa `graphify query` o abre `graphify-out/graph.html` para explorar interactivamente

---

## 🤖 MODELOS ACTIVOS

| | deepseek-v4-flash | deepseek-v4-pro |
|---|---|---|
| **Contexto** | 1,000,000 tokens (1M) | 1,000,000 tokens (1M) |
| **Max Output** | 384,000 tokens (384K) | 384,000 tokens (384K) |
| **Thinking Mode** | ✅ (default: on) | ✅ (default: on) |
| **Non-Thinking** | ✅ | ✅ |
| **Tool Calls** | ✅ | ✅ |
| **JSON Output** | ✅ | ✅ |
| **Cache KV** | ✅ | ✅ |
| **FIM Completion** | Non-thinking only | Non-thinking only |

> ⚠️ `deepseek-chat` y `deepseek-reasoner` serán deprecados. Equivalen a non-thinking/thinking mode de v4-flash respectivamente.

---

## 💰 PRECIOS (por 1M tokens)

| | v4-flash | v4-pro (75% descuento hasta 2026/05/31) |
|---|---|---|
| **Input (cache miss)** | $0.14 | $0.435 ~~$1.74~~ |
| **Input (cache hit)** | $0.0028 | $0.003625 ~~$0.0145~~ |
| **Output** | $0.28 | $0.87 ~~$3.48~~ |

---

## 🧠 THINKING MODE

### Cómo funciona
- El modelo genera `reasoning_content` (cadena de pensamiento) ANTES de `content` (respuesta final)
- **NO se puede desactivar** via `temperature=0` o `top_p=0`
- Para desactivarlo: usa `chat_template_kwargs: { thinking: false }`
- Para activarlo explícitamente: `chat_template_kwargs: { thinking: true }`

### Regla CRÍTICA para Multi-turno
> ⚠️ **`reasoning_content` DEBE devolverse al API en cada turno subsecuente.**
> Si lo pierdes, obtienes error 400: "The `reasoning_content` in the thinking mode must be passed back to the API."

### Thinking Effort (v4-pro)
Permite controlar profundidad: `chat_template_kwargs: { thinking: { type: "enabled"|"disabled"|"auto" } }`

---

## 🔧 TOOL CALLS

### Non-Thinking Mode
Tool calls se devuelven en `delta.tool_calls` del stream (formato OpenAI estándar).

### Thinking Mode  
Los tool calls aparecen en `delta.tool_calls` del ÚLTIMO mensaje `assistant` (después del razonamiento).

### Strict Mode (Beta)
- Activar: `"strict": true` en la definición de la tool
- Los parámetros DEBEN tener `"additionalProperties": false`
- Todos los campos deben incluirse en `"required"`

---

## ⚠️ ERRORES COMUNES

| Código | Causa | Solución |
|--------|-------|----------|
| **400** | Parámetros inválidos | Revisar formato del cuerpo |
| **401** | API key incorrecta | Verificar API key |
| **402** | Saldo insuficiente | Recargar en platform.deepseek.com |
| **413** | Request Entity Too Large | ⚡ Cuerpo HTTP >1MB — reducir historial |
| **422** | Parámetros inválidos | Revisar campos problemáticos |
| **429** | Rate limit | Espaciar peticiones |
| **500** | Error del servidor | Reintentar |
| **503** | Servidor sobrecargado | Esperar y reintentar |

---

## ⚡ LÍMITES QUE AFECTAN A LV-ZERO

### 1. Context Window: 1M tokens (~4MB texto)
- El system prompt + historial DEBE caber en 1M tokens
- El límite suave: `MAX_CHARS: 4,000,000` en context_manager.js
- Si se excede, el modelo trunca desde el inicio o rechaza la petición

### 2. Max Output: 384K tokens (~1.5MB texto)
- Configurado en: `max_tokens: 384000` en deepseek.js
- Para archivos grandes: usar estrategia chunked (write + append)

### 3. HTTP Body Limit: ~1MB (nginx proxy)
- No es del modelo, es del proxy
- `buildMessages()` en cache_first_loop.js mantiene el cuerpo bajo 800KB
- Si se excede → 413 Request Entity Too Large

### 4. KV Cache (Context Caching)
- DeepSeek cachea prefijos de entrada idénticos entre peticiones
- Cache hit: 1/10 del precio de input
- Para maximizar cache hits: mantener prefix inmutable (ya lo hace cache_first_loop.js)
- Solo los prefijos EXACTOS se cachean

---

## 📐 FÓRMULA DE TOKENS

- 1 carácter inglés ≈ 0.3 tokens
- 1 carácter chino ≈ 0.6 tokens
- 1 token ≈ 4 caracteres (promedio código/inglés)
- 1MB de texto ≈ 250K tokens

---

## 🔗 ENLACES

- Pricing: https://api-docs.deepseek.com/quick_start/pricing
- Error Codes: https://api-docs.deepseek.com/quick_start/error_codes
- Thinking Mode: https://api-docs.deepseek.com/guides/thinking_mode
- Tool Calls: https://api-docs.deepseek.com/guides/tool_calls
- Multi-round Chat: https://api-docs.deepseek.com/guides/multi_round_chat
- JSON Mode: https://api-docs.deepseek.com/guides/json_mode
- KV Cache: https://api-docs.deepseek.com/guides/kv_cache
- Anthropic API: https://api-docs.deepseek.com/guides/anthropic_api
- FIM Completion: https://api-docs.deepseek.com/guides/fim_completion
- Prefix Completion: https://api-docs.deepseek.com/guides/chat_prefix_completion
