# lv-zero — Lógica de Arquitectura

## Visión General

**lv-zero** es un orquestador open-source Agent-First construido en Node.js (ESM) que utiliza la API de DeepSeek como motor de razonamiento. Su diseño replica y mejora el paradigma "Antigravity", donde el agente de IA opera de forma autónoma, con acceso directo a herramientas del sistema y cero fricción.

---

## Arquitectura en Capas (v3.0)

```
┌─────────────────────────────────────────────────────────┐
│                    USUARIO (Luis)                        │
│                Terminal readline lv-zero>                │
├─────────────────────────────────────────────────────────┤
│              src/index.js (Orquestador v3.0)             │
│  ┌─────────┐  ┌──────────┐  ┌─────────────────────┐     │
│  │ Readline │  │ DeepSeek │  │  3-Phase Skill Load │     │
│  │   Loop   │  │   API    │  │ Native→Bridge→MCP   │     │
│  └─────────┘  └──────────┘  └─────────────────────┘     │
│  ┌──────────────────────────────────────────────────┐    │
│  │   Hot-Reload (skill_factory → reloadAllSkills)   │    │
│  └──────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│              src/system_prompt.js (Constitución v3.0)    │
│  - Rol: Arquitecto de Sistemas Autónomo                 │
│  - "No esperes permiso. Construye."                     │
│  - Permiso total para terminal, crear skills, modificar │
│  - Protocolo de Rigor Empírico preservado               │
├─────────────────────────────────────────────────────────┤
│         skills/ — 7 Nativas + 29 Bridge + 1 MCP          │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │ file_      │ │ internet_    │ │ supabase_manager │   │
│  │ manager    │ │ search       │ │ (SELECT/INSERT)  │   │
│  │ (Archivos) │ │ (Tavily→DDG) │ │                  │   │
│  └────────────┘ └──────────────┘ └──────────────────┘   │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │ shell_     │ │ skill_       │ │ supabase_sql     │   │
│  │ executor   │ │ factory      │ │ (DDL/DML directo)│   │
│  │ (Terminal) │ │ (Crear skills)│ │ SERVICE_ROLE_KEY │   │
│  └────────────┘ └──────────────┘ └──────────────────┘   │
│  ┌──────────────────────────────────────────────────┐    │
│  │ skill_bridge → 29 habilidades Antigravity        │    │
│  │ (Cero duplicación, rutas absolutas, live updates)│    │
│  └──────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐    │
│  │ src/mcp_client.js → Model Context Protocol       │    │
│  │ (JSON-RPC 2.0 sobre HTTP, herramientas externas) │    │
│  └──────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│              PLAN.md (Manager View)                       │
│        Bitácora en tiempo real del agente                │
└─────────────────────────────────────────────────────────┘
```

---

## Flujo de Ejecución

### 1. Inicio (`src/index.js`)
1. Carga manual de `.env` (bypass de `dotenvx` para evitar sobrescritura de vars del sistema).
2. Inicializa cliente OpenAI SDK apuntando a `https://api.deepseek.com/v1`.
3. **Carga de Skills en 3 Fases**:
   - **Fase 1**: Escanea `/skills/` y carga todos los módulos `.js` nativos (con timestamp busting para hot-reload).
   - **Fase 2**: Bridge Antigravity — lee `rutaskills.md`, parsea 29 rutas, registra cada SKILL.md como skill de lv-zero.
   - **Fase 3**: MCP Client — conecta a servidores de herramientas externas vía JSON-RPC 2.0.
4. Convierte cada skill al formato `tools` de Function Calling de OpenAI.
5. Inicializa el prompt de sistema (constitución del agente v3.0).
6. Inicia el bucle readline con el prompt `lv-zero>`.

### 2. Procesamiento de Input
```
Usuario → readline → processInput()
  ├── "salir" / "exit" → cierra sesión
  ├── "ayuda" / "help" → muestra comandos
  ├── "plan <txt>" → actualiza PLAN.md
  ├── "skills" → lista todas las skills cargadas
  ├── "reload" → hot-reload de todas las skills
  └── cualquier otro → agentLoop(input)
```

### 3. Agent Loop (`agentLoop()`)
```
1. Agregar mensaje del usuario al historial
2. Llamar a DeepSeek API (con tools de skills)
3. DeepSeek responde:
   ├── tool_calls → ejecutar cada skill handler
   │   └── agregar resultado al historial
   │   └── repetir paso 2 (máx 20 iteraciones)
   └── contenido texto → mostrar al usuario
4. Volver al prompt
```

---

## Skills (Sistema de Herramientas)

### file_manager
- **Propósito**: Interactuar con el sistema de archivos del proyecto.
- **Acciones**: `read`, `write`, `list`, `delete`, `ensure_dir`, `find`.
- **Seguridad**: Protección contra path traversal — todas las rutas deben estar dentro del proyecto.
- **Refinamiento**: Si un archivo conocido (flows.json, etc.) no está en la ruta indicada, busca automáticamente en todo el proyecto y sugiere ubicaciones alternativas.

### internet_search
- **Propósito**: Única fuente de verdad externa para datos factuales.
- **Motor**: **Híbrido** — Tavily SDK (`@tavily/core`) como primario + DuckDuckGo HTML como respaldo soberano.
- **Estrategia**:
  1. Si `TAVILY_API_KEY` está configurada → intenta Tavily primero.
  2. Si Tavily falla (error de red, cuota, etc.) o no hay key → DuckDuckGo automático.
  3. DuckDuckGo usa `html.duckduckgo.com` (scraping HTML directo, sin dependencias externas, sin VQD token, sin JS challenges).
- **Anti-alucinación**: Si ambos motores fallan, retorna "No tengo suficiente información. No se puede verificar este dato."
- **Límite**: Máximo 10 resultados por consulta.

### supabase_manager
- **Propósito**: Persistencia de datos y memoria entre sesiones.
- **Motor**: `@supabase/supabase-js`.
- **Acciones**: `select` (con filtros, columnas, límite, orden), `insert` (con datos), `update` (con datos + filtros).
- **Uso**: El agente puede guardar conversaciones, resultados de investigación, y contexto para usarlos en el futuro.

### shell_executor (NUEVO v3.0)
- **Propósito**: Ejecución de comandos en terminal Windows/PowerShell.
- **Motor**: `execSync` de `child_process`.
- **Protecciones**: Blacklist de comandos destructivos (`rm -rf`, `del /f`, `format`, `diskpart`, `fdisk`, `dd if=`, `shutdown`, `reg delete`, `sc delete`).
- **Parámetros**: `command` (requerido), `shell` (cmd/powershell), `cwd`, `timeout` (default 30s, máx 120s), `confirm` (para comandos marcados).
- **Filosofía**: El agente puede ejecutar comandos sin aprobación humana, pero con protecciones contra autodestrucción.

### supabase_sql (NUEVO v3.0)
- **Propósito**: Ejecución directa de SQL en Supabase via SERVICE_ROLE_KEY.
- **Acceso**: DDL y DML completo (CREATE, ALTER, DROP, SELECT, INSERT, UPDATE, DELETE, TRUNCATE).
- **Seguridad**: Muestra advertencia para comandos destructivos pero permite su ejecución.
- **Métodos**: Tres fallbacks automáticos:
  1. `pg_query` RPC (`/rest/v1/rpc/pg_query`)
  2. Direct SQL header (`X-Supabase-SQL`)
  3. Management API (`api.supabase.com/v1/projects`)

### skill_factory (NUEVO v3.0)
- **Propósito**: Creación dinámica de nuevas skills en caliente sin reiniciar el orquestador.
- **Acciones**: `create` (escribe skill + hot-reload), `reload` (recarga todas), `list_templates` (muestra plantillas).
- **Validación**: Nombres sanitizados `[a-z0-9_]`, evita sobrescritura de skills existentes.
- **Plantillas**: Genera automáticamente el boilerplate de una skill.

### skill_bridge (NUEVO v3.0)
- **Propósito**: Puente de integración masiva con las 29 habilidades de Antigravity.
- **Fuente**: `C:\Users\LAVG\Documents\PROYECTO SIAE\rutaskills.md`
- **Cero Duplicación**: Las habilidades NO se copian a lv-zero. Se referencian por ruta absoluta.
- **Live Updates**: Cada llamada al handler relee el SKILL.md fresco del disco.
- **Registro**: Las 29 habilidades aparecen como tools individuales en el Function Calling de DeepSeek.

### Model Context Protocol (NUEVO v3.0)
- **Propósito**: Conectar servidores de herramientas externas vía protocolo estándar MCP.
- **Protocolo**: JSON-RPC 2.0 sobre HTTP.
- **Configuración**: `MCP_SERVERS` en `.env` o `mcp_servers.json`.
- **Cliente**: Implementación en `src/mcp_client.js` con conexión, listado de herramientas, y llamadas individuales.

---

## Protocolo de Rigor Empírico (v3.0)

La Constitución del agente en [`src/system_prompt.js`](src/system_prompt.js) establece cuatro reglas supremas preservadas de v2.1, más la nueva directiva de autonomía:

| Regla | Descripción |
|-------|-------------|
| **Mandato de Actualidad** 🔴 | Prohibido usar memoria interna para datos factuales. Priorizar resultados de mayo 2026. Búsqueda híbrida Tavily → DuckDuckGo |
| **Anti-Alucinación** 🚫 | Si no hay resultados claros → "No tengo suficiente información para responder esta pregunta de manera verificada." |
| **Cero Fricción con Evidencia** 🔗 | Cada dato debe incluir su fuente URL y el motor usado (Tavily/DDG). Sin URL = el dato no existe |
| **Mentalidad de Investigador** 🕵️ | Asumir que TODO el conocimiento previo está desactualizado. |
| **Autonomía Absoluta** 🚀 | No esperes permiso. Construye. Si algo falta, créalo. Acceso a terminal, creación de skills, modificación de código propio. |

---

## Variables de Entorno

| Variable | Propósito | Obligatoria |
|----------|-----------|-------------|
| `DEEPSEEK_API_KEY` | API key de DeepSeek | ✅ Sí |
| `DEEPSEEK_BASE_URL` | URL base de la API | Opcional (default: DeepSeek) |
| `DEEPSEEK_MODEL` | Modelo a usar | Opcional (default: deepseek-reasoner) |
| `SUPABASE_URL` | URL del proyecto Supabase | ❌ No |
| `SUPABASE_KEY` | Anon/public key de Supabase | ❌ No |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (SQL maestro) | ❌ No |
| `TAVILY_API_KEY` | API key de Tavily | ❌ No (DuckDuckGo como respaldo) |
| `MCP_SERVERS` | URLs de servidores MCP (coma separadas) | ❌ No |

---

## Dependencias

| Paquete | Propósito |
|---------|-----------|
| `openai` | SDK cliente para API de DeepSeek |
| `chalk` | Output de terminal con colores |
| `@supabase/supabase-js` | Cliente de Supabase (persistencia) |
| `@tavily/core` | SDK de Tavily (búsqueda web primaria) |

### Nota sobre DuckDuckGo
La búsqueda de respaldo DuckDuckGo NO requiere ninguna dependencia npm. Implementa scraping directo de `html.duckduckgo.com` usando la API nativa `fetch()` de Node.js 24+. No usa VQD tokens, ni JS challenges, ni librerías de terceros propensas a romperse.

### Nota sobre duck-duck-scrape
El paquete `duck-duck-scrape` fue eliminado en v3.0 porque su parser interno se rompió por cambios en el HTML de DuckDuckGo. Fue reemplazado por scraping directo con `fetch()`.

---

## Historial de Versiones

| Versión | Cambios |
|---------|---------|
| v1.0 | Arquitectura base: readline, DeepSeek API, file_manager |
| v2.0 | Supabase (memoria), Tavily (búsqueda), file_manager refinado, Protocolo de Rigor Empírico |
| v2.1 | Sistema de Respaldo Soberano: DuckDuckGo HTML como fallback, Filtro Mayo 2026 |
| **v3.0** | **Autonomous System Architect**: shell_executor, skill_factory, skill_bridge (29 habilidades Antigravity), supabase_sql, MCP Client, hot-reload, autonomía absoluta en system_prompt |
