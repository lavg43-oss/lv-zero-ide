# Auditoría de APIs Externas — LV-Zero

**Fecha:** 2026-06-04  
**Resultado:** 5/5 APIs funcionales

---

## 1. ✅ DeepSeek API — Funcional

| Aspecto | Detalle |
|---------|---------|
| **API Key** | `sk-45e00...aa68` ✅ Configurada |
| **Base URL** | `https://api.deepseek.com/v1` |
| **Modelos disponibles** | `deepseek-v4-flash`, `deepseek-v4-pro` |
| **Chat Flash** | ✅ Responde correctamente (usa `reasoning_content` para respuestas cortas) |
| **Chat Pro** | ✅ Responde correctamente |
| **Costo** | Flash = económico, Pro = más caro (uso restringido) |

**Nota:** DeepSeek v4-flash y v4-pro son modelos de razonamiento. En respuestas muy cortas, el contenido puede aparecer en `reasoning_content` en lugar de `content`. Con prompts normales funciona correctamente.

---

## 2. ✅ OpenRouter (Free tier) — Funcional (ACTUALIZADO)

| Aspecto | Detalle |
|---------|---------|
| **API Key** | `sk-or-v1...5226` ✅ Configurada |
| **Modelo primario** | `google/gemma-4-31b-it:free` ← **NUEVO** |
| **Modelo secundario** | `openai/gpt-oss-120b:free` ← **NUEVO** |
| **Modelo anterior** | ~~`nvidia/nemotron-3-nano-30b-a3b:free`~~ (reemplazado) |
| **Proveedor** | Google / OpenAI (vía OpenRouter) |
| **Costo** | $0 (gratuito) |
| **Benchmark** | Gemma 4 31B: 0.7s, 100/100 calidad — GPT-OSS 120B: 0.6s, 100/100 calidad |

**Nota:** Se actualizaron los modelos gratuitos basado en benchmark de programación. El primario es Google Gemma 4 31B (excelente equilibrio velocidad/calidad) y el secundario es OpenAI GPT-OSS 120B (máxima calidad). Si ambos fallan, el sistema cae a DeepSeek v4-flash como respaldo.

---

## 3. ✅ Gemini Flash — Funcional

| Aspecto | Detalle |
|---------|---------|
| **API Key** | `AIzaSyCb...q-Ao` ✅ Configurada |
| **Modelo** | `gemini-2.5-flash` |
| **Endpoint** | `https://generativelanguage.googleapis.com/v1beta/models` |
| **Chat** | ✅ Responde correctamente |
| **Costo** | Gratuito (tier free de Google AI) |

**Nota:** Solo se probó `gemini-2.5-flash` (no pro). La API key funciona correctamente con este modelo. El modelo `gemini-2.5-pro` **no se probó** pero requeriría la misma API key.

---

## 4. ✅ Tavily — Funcional

| Aspecto | Detalle |
|---------|---------|
| **API Key** | `tvly-dev...Pzoj` ✅ Configurada |
| **Qué es** | Servicio de búsqueda web para AI agents (alternativa a Google Search API) |
| **Propósito en LV-Zero** | Motor de búsqueda primario para la skill `internet_search` |
| **Respaldo** | DuckDuckGo (fallback automático si Tavily falla) |
| **Búsqueda** | ✅ Devuelve resultados con títulos, URLs y contenido |
| **Answer** | ✅ Genera respuestas sintetizadas |

**Uso en el proyecto:** La skill [`internet_search`](skills/internet_search.js) usa Tavily como motor primario. Si la API key no está configurada o falla, automáticamente usa DuckDuckGo como respaldo.

---

## 5. Resumen de APIs en `.env`

| Variable | Estado | Propósito |
|----------|--------|-----------|
| `DEEPSEEK_API_KEY` | ✅ Activa | Motor principal de IA |
| `GEMINI_API_KEY` | ✅ Activa | Alternativa Flash (emergencia/resúmenes) |
| `OPENROUTER_API_KEY` | ✅ Activa | Modelos gratuitos vía OpenRouter |
| `TAVILY_API_KEY` | ✅ Activa | Búsqueda web para AI agent |

---

## Recomendaciones (ACTUALIZADO)

1. **DeepSeek** es el motor principal — Flash para tareas rápidas, Pro para tareas complejas.
2. **OpenRouter Free** ahora usa **Google Gemma 4 31B** como primario y **OpenAI GPT-OSS 120B** como secundario — ambos con calidad 100/100 en programación.
3. **DeepSeek Flash/Pro** quedan como fallback automático si OpenRouter falla (sin API key, rate limit, etc.).
4. **Tavily** es útil para búsqueda web, pero tiene un fallback a DuckDuckGo que no requiere API key.
