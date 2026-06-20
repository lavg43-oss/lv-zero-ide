# Skills — Function Calling Protocol

El directorio `/skills` define el protocolo de herramientas (Function Calling) que el agente orquestador de lv-zero utiliza para interactuar con el sistema operativo.

---

## Filosofía

Cada **skill** es una función registrada que el agente puede invocar. Las skills son:

- **Modulares** — cada skill hace una sola cosa bien.
- **Descubribles** — el agente conoce su firma y propósito.
- **Componibles** — se pueden encadenar para flujos complejos.

---

## Skills Nativas (10)

| Skill | Archivo | Descripción | Estado |
|-------|---------|-------------|--------|
| `file_manager` | [`file_manager.js`](file_manager.js) | Leer, escribir, buscar, listar y eliminar archivos | ✅ Activa |
| `internet_search` | [`internet_search.js`](internet_search.js) | Búsqueda híbrida Tavily → DuckDuckGo (respaldo soberano) | ✅ Activa |
| `supabase_manager` | [`supabase_manager.js`](supabase_manager.js) | Operaciones SELECT, INSERT, UPDATE en Supabase | ✅ Activa |
| `shell_executor` | [`shell_executor.js`](shell_executor.js) | Ejecución de comandos en terminal con protecciones | ✅ Activa |
| `skill_factory` | [`skill_factory.js`](skill_factory.js) | Creación dinámica de nuevas skills + hot-reload | ✅ Activa |
| `skill_bridge` | [`skill_bridge.js`](skill_bridge.js) | Puente a habilidades externas (cero duplicación) | ✅ Activa |
| `supabase_sql` | [`supabase_sql.js`](supabase_sql.js) | SQL directo en Supabase via SERVICE_ROLE_KEY | ✅ Activa |
| `build_slidev_deck` | [`build_slidev_deck.js`](build_slidev_deck.js) | Crea y gestiona presentaciones Slidev (Markdown + Vue.js + animaciones) | ✅ Activa |
| `build_quarto_deck` | [`build_quarto_deck.js`](build_quarto_deck.js) | Crea y gestiona presentaciones Quarto/Reveal.js (científico-técnico) | ✅ Activa |
| `export_deck_to_static` | [`export_deck_to_static.js`](export_deck_to_static.js) | Exporta decks Slidev o Quarto a PDF/PPTX portátil vía Playwright | ✅ Activa |

## Skills Puenteadas (29)

El [`skill_bridge.js`](skill_bridge.js) carga dinámicamente habilidades desde directorios externos configurados.

| # | Skill | Directorio |
|---|-------|-----------|
| 1 | awf-auto-save | `auto-save` |
| 2 | awf-adaptive-language | `awf-adaptive-language` |
| 3 | awf-context-help | `awf-context-help` |
| 4 | awf-error-translator | `awf-error-translator` |
| 5 | awf-session-restore | `awf-session-restore` |
| 6 | awf-version-tracker | `awf-version-tracker` |
| 7 | brainstorm-agent | `brainstorm-agent` |
| 8 | code-review | `code-review` |
| 9 | codex-conductor | `codex-conductor` |
| 10 | gemini-conductor | `gemini-conductor` |
| 11 | gitnexus-intelligence | `gitnexus-intelligence` |
| 12 | module-spec-writer | `module-spec-writer` |
| 13 | nm-memory-audit | `nm-memory-audit` |
| 14 | nm-memory-evolution | `nm-memory-evolution` |
| 15 | nm-memory-intake | `nm-memory-intake` |
| 16 | nm-memory-sync | `nm-memory-sync` |
| 17 | orchestrator | `orchestrator` |
| 18 | ship-to-code | `ship-to-code` |
| 19 | single-flow-task-execution | `single-flow-task-execution` |
| 20 | skill-creator | `skill-creator` |
| 21 | spec-gate | `spec-gate` |
| 22 | symphony-enforcer | `symphony-enforcer` |
| 23 | symphony-orchestrator | `symphony-orchestrator` |
| 24 | systematic-debugging | `systematic-debugging` |
| 25 | telegram-notify | `telegram-notify` |
| 26 | trello-sync | `trello-sync` |
| 27 | verification-gate | `verification-gate` |
| 28 | visual-design-gate | `visual-design-gate` |
| 29 | writing-skills | `writing-skills` |

> **Cero duplicación**: Estas habilidades NO están copiadas en lv-zero. Se referencian por ruta absoluta.

---

## 🎬 Skills de Presentaciones (Slidev + Quarto)

### build_slidev_deck — Slidev Presentation Builder

La joya de la corona para devs. Slidev renderiza Markdown con componentes Vue.js, animaciones Framer Motion, WebGL, y temas espectaculares. Es la herramienta #1 en tendencia para desarrolladores.

**Acciones disponibles:**
- `create` — Crea un nuevo proyecto Slidev con `slides.md` y `package.json`
- `start` — Inicia servidor de desarrollo en puerto 3030 (HMR incluido)
- `stop` — Detiene el servidor
- `status` — Verifica estado del proyecto

**Parámetros clave:** `theme` (default, seriph, apple-basic, geist…), `aspectRatio` (16/9, 4/3), `colorSchema`, `content` (Markdown completo con soporte Slidev).

### build_quarto_deck — Quarto/Reveal.js Scientific Builder

El estándar científico-tecnológico. Quarto usa Reveal.js como motor para transiciones espaciales (movimiento de cámara entre diapositivas), código ejecutable (Python, R, Julia), LaTeX math, diagramas Mermaid/Graphviz, y widgets 3D.

**Acciones disponibles:**
- `create` — Crea proyecto Quarto con `index.qmd` y `_quarto.yml`
- `render` — Renderiza a HTML
- `preview` — Servidor con live-reload en puerto 3031
- `stop` / `status`

**Parámetros clave:** `theme` (default, sky, beige, blood, night…), `transition` (slide, convex, concave, zoom, fade), `codeLineNumbers`, `codeCopy`.

### export_deck_to_static — Universal Exporter (PDF/PPTX)

El botón de pánico. Convierte cualquier deck (Slidev o Quarto) a PDF/PPTX portátil para llevar en USB.

**Slidev export:** Usa `npx slidev export --format pdf|pptx` impulsado por Playwright — levanta un navegador Chromium headless, renderiza cada diapositiva, toma "fotos" vectoriales y las empaqueta.

**Quarto export:** Usa `quarto render --to pdf|pptx` nativo, congelando estados de animaciones.

**Parámetros:** `engine` (slidev|quarto), `format` (pdf|pptx), `timeout` (ms para animaciones), `slidesToExport` (rango para Slidev).

---

## Estructura de una Skill

Cada skill se define como un módulo que exporta:

```js
export default {
  name: "mi_skill",
  description: "Descripción de lo que hace.",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string" },
    },
    required: ["param1"],
  },
  handler: async ({ param1 }) => {
    // implementación
    return { result: "ok" };
  },
};
```

---

## Integración con DeepSeek

Las skills se convierten en herramientas de Function Calling para la API de DeepSeek:

```js
const tools = skills.map((skill) => ({
  type: "function",
  function: {
    name: skill.name,
    description: skill.description,
    parameters: skill.parameters,
  },
}));
```

Cuando el modelo responde con `tool_calls`, el orquestador:
1. Extrae el nombre y argumentos de la tool call.
2. Busca la skill correspondiente.
3. Ejecuta el `handler` con los argumentos.
4. Retorna el resultado al modelo para la siguiente iteración.

---

## Detalle de Skills

### internet_search (Búsqueda Híbrida)

Estrategia de dos niveles:
1. **Tavily** (primario) — Usa `@tavily/core` SDK. Requiere `TAVILY_API_KEY`.
2. **DuckDuckGo HTML** (respaldo soberano) — Scrapea `html.duckduckgo.com` sin API key, sin VQD token, sin dependencias externas.

El agente siempre recibe resultados. Nunca se queda sin fuente de información.

### shell_executor (Terminal Automática)

Ejecuta comandos en CMD o PowerShell con protecciones contra autodestrucción:
- **Blacklist**: `rm -rf`, `del /f`, `format`, `diskpart`, `fdisk`, `dd if=`, `shutdown`, `reg delete`, `sc delete`
- **Timeout**: Default 30s, máximo 120s
- **Shell**: `cmd` (default) o `powershell`
- **Confirm**: Parámetro opcional para comandos marcados como destructivos

### skill_factory (Creador de Skills)

Permite al agente crear nuevas skills en caliente:
- `create`: Escribe un nuevo archivo en `/skills/` y hace hot-reload
- `reload`: Recarga todas las skills sin reiniciar
- `list_templates`: Muestra plantillas disponibles

### supabase_manager

Requiere `SUPABASE_URL` y `SUPABASE_KEY` en `.env`. Si no están configuradas, todas las operaciones retornan un mensaje informativo.

### supabase_sql (SQL Maestro)

Ejecuta SQL directo en Supabase usando `SUPABASE_SERVICE_ROLE_KEY`:
- DDL completo: CREATE, ALTER, DROP
- DML completo: SELECT, INSERT, UPDATE, DELETE, TRUNCATE
- Tres métodos de ejecución con fallback automático

---

## 🛑 Stop Button — Mecanismo de Aborto

El botón de stop en la UI se comunica con el orquestador mediante:

1. **Renderer → Preload**: `lvzero["agent:stop"]()` → `ipcRenderer.invoke("agent:stop")`
2. **Main Process**: [`ipcMain.handle("agent:stop", ...)`](../src/main.js) → `orchestrator.abortAgent()`
3. **Orchestrator**: 
   - [`abortAgent()`](../src/core/orchestrator.js) establece `_abortRequested = true`
   - Cancela el HTTP stream en vuelo vía `this._abortController.abort()`
   - Cancela tools en ejecución vía `this._toolAbortController.abort()`
4. **Checks distribuidos**: El agent loop verifica `_abortRequested` en 6 puntos (antes de cada iteración, durante streaming, post-stream, pre-tool-repair, pre-tool-execution, post-tool-results)

---

## Extensión

Para agregar una nueva skill, tienes dos opciones:

1. **Manual**: Crea un archivo en `/skills/` que exporte el schema y handler. Se cargará automáticamente al iniciar.
2. **Dinámica**: Usa la skill `skill_factory` con acción `create` desde el agente. La skill se crea y se recarga en caliente.

---

## MCP Client

Además de las skills nativas, el sistema incluye un cliente MCP (Model Context Protocol) en [`src/mcp_client.js`](../src/mcp_client.js) que permite conectar servidores de herramientas externas vía JSON-RPC 2.0 sobre HTTP.
