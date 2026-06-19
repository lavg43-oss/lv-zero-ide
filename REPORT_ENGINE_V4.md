# REPORTE DE INGENIERÍA — lv-zero v4.0.0

> **Fecha:** 11 de Mayo de 2026
> **Propósito:** Documentar la arquitectura, capacidades y modo de uso de lv-zero
> **Logro:** Paridad funcional y visual con sistemas de élite (clon de Antigravity)

---

## 📋 Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura del Sistema (v4.0)](#2-arquitectura-del-sistema-v40)
3. [FASE 1: Perfeccionamiento del Motor (Cerebro)](#3-fase-1-perfeccionamiento-del-motor-cerebro)
4. [FASE 2: Refactorización para Desacople (Transmisión)](#4-fase-2-refactorización-para-desacople-transmisión)
5. [FASE 3: Construcción de la Carrocería (GUI - Electron)](#5-fase-3-construcción-de-la-carrocería-gui---electron)
6. [FASE 4: Empaquetado (El .exe)](#6-fase-4-empaquetado-el-exe)
7. [Inventario de Archivos](#7-inventario-de-archivos)
8. [Instrucciones de Ejecución](#8-instrucciones-de-ejecución)
9. [Próximos Pasos](#9-próximos-pasos)

---

## 1. Resumen Ejecutivo

**lv-zero v4.0.0** es un orquestador de agente autónomo open-source potenciado por DeepSeek API. El sistema ha evolucionado de un CLI simple a una plataforma completa con:

- **Motor de agente event-driven** desacoplado de la interfaz
- **Gestión de memoria** con auto-summarization para prevenir saturación de tokens
- **Persistencia de sesión** con recuperación ante cortes
- **Parser AST** para análisis estructural de código sin leer archivos completos
- **GUI nativa con Electron** — Chat Panel, Skill Sidebar, Logic Inspector
- **Empaquetado** como instalador `.exe` para Windows

### Métricas Clave

| Métrica | Valor |
|---------|-------|
| Skills registradas | ~38 (8 nativas + 29 Antigravity bridge + 1 MCP) |
| Dependencias | 12 (producción) + 4 (desarrollo) |
| Archivos de código fuente | 16 |
| Líneas de código | ~4,500+ |
| Versión | 4.0.0 |
| Licencia | MIT |

---

## 2. Arquitectura del Sistema (v4.0)

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTERFACES DE USUARIO                        │
├──────────────────────┬──────────────────────────────────────────┤
│   CLI (index.js)     │     GUI Electron (main.js + ui/)         │
│   readline + chalk   │     IPC Bridge (preload.js)              │
├──────────────────────┴──────────────────────────────────────────┤
│                    ORCHESTRATOR (core/orchestrator.js)           │
│   EventEmitter-based, desacoplado de toda interfaz              │
│   Maneja: agentLoop, skills, tool_calls, memoria, estado        │
├──────────────────────┬──────────────────────────────────────────┤
│   context_manager    │   state_manager                          │
│   (compactHistory)   │   (session.json persist)                 │
├──────────────────────┴──────────────────────────────────────────┤
│                    SKILLS (38 total)                             │
├─────────────────────────────────────────────────────────────────┤
│   nativas/       bridge/ (29 Antigravity)      mcp_client/      │
│   file_manager   skill_bridge                   MCP over HTTP    │
│   internet_search (Tavily→DDG)                                   │
│   supabase_manager                                                │
│   supabase_sql                                                    │
│   shell_executor                                                  │
│   skill_factory                                                   │
│   db_explorer (PostgreSQL directo)                                │
│   code_mapper (AST parser)                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. FASE 1: Perfeccionamiento del Motor (Cerebro)

### 3.1 ContextManager — `src/core/context_manager.js`

**Propósito:** Prevenir la "alucinación por saturación" monitoreando el historial de conversación y resumiendo automáticamente cuando se exceden los límites.

**Límites configurables:**
- `MAX_MESSAGES: 50` — Máximo de mensajes antes de forzar resumen
- `MAX_CHARS: 32000` — Máximo de caracteres totales
- `MAX_TOOL_CALLS: 15` — Máximo de tool_calls consecutivas
- `KEEP_RATIO: 0.3` — Percentil de mensajes a conservar

**API pública:**
- `analyzeHistory(messages)` → Estadísticas del historial
- `needsSummary(messages)` → Determina si necesita resumen
- `compactHistory(messages)` → Compacta: conserva system prompt + primeros mensajes + últimos relevantes, resume tool_calls intermedias
- `withMemoryManagement(chatFn)` → Decorator para integrar directamente en el agent loop

**Flujo:**
1. Antes de cada llamada a DeepSeek, se verifica `needsSummary()`
2. Si excede límites → `compactHistory()` reduce el historial
3. Los tool_calls intermedios se resumen en un solo mensaje `[RESUMEN AUTOMÁTICO - N tool_calls compactadas]`
4. Se conserva siempre: instrucción original (system prompt), primeros mensajes (cabeza), últimos mensajes relevantes (cola)

### 3.2 StateManager — `src/core/state_manager.js`

**Propósito:** Persistencia de sesión con auto-guardado y recuperación ante cortes.

**Ubicación del estado:** `.lv-zero/session.json` (directorio oculto en la raíz del proyecto)

**CAPIs:**
- `initSession()` — Restaura sesión existente o crea una nueva (ID formato `LV-{timestamp}-{random}`)
- `saveSessionSync()` / `saveSession()` — Guarda estado actual
- `updateState(key, value)` / `updateStateBatch(updates)` — Actualiza campos
- `updatePlanProgress(step, total, description)` — Progreso del plan
- `trackMessage(message)` — Registra mensaje en historial persistido
- `trackToolCall()` — Incrementa contador
- `startAutoSave()` / `stopAutoSave()` — Autoguardado periódico (cada 5s)
- `clearSession()` — Limpia sesión

**Persistencia:**
- Los mensajes se truncan a 100 para evitar archivos enormes
- El autoguardado corre en un intervalo de 5s
- `before-quit` en Electron dispara `stopAutoSave()` + guardado final
- El archivo `session.json` incluye: sessionId, startedAt, lastActivity, planStep/Total, messageCount, skillsCount, toolCallsExecuted, messages (truncados)

### 3.3 CodeMapper — `skills/code_mapper.js`

**Propósito:** Parser AST para extraer estructura de código (imports, funciones, exports, clases, declaraciones) sin consumir tokens leyendo archivos completos.

**Parser dual:**
1. **Acorn (AST)** — Intenta parseo completo primero
2. **Regex (fallback)** — Si acorn falla (JSX, sintaxis no estándar), usa regex avanzados

**Lo que extrae:**
- `imports` — Import statements con módulo fuente y specifiers
- `functions` — Function declarations, arrow functions, métodos de clase. Incluye: nombre, parámetros, async, generator, línea
- `exports` — Default y named exports
- `classes` — Class declarations con extends/implements
- `declarations` — Top-level const/let/var

**Optimizaciones:**
- Solo lee los primeros 50KB del archivo (cubre ~99% de los casos)
- `scanDirectory()` escanea recursivamente excluyendo `node_modules/` y `.directorios`
- Límite configurable de `maxFiles` (default 20)
- `parseFiles()` ejecuta en paralelo con `Promise.allSettled()`

**Archivos soportados:** `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`

---

## 4. FASE 2: Refactorización para Desacople (Transmisión)

### 4.1 Orchestrator — `src/core/orchestrator.js`

**El corazón del sistema.** Extiende `EventEmitter` y contiene TODA la lógica del agente, completamente desacoplada de cualquier interfaz (CLI o GUI).

**Eventos emitidos:**

| Evento | Datos | Propósito |
|--------|-------|-----------|
| `log` | string | Mensajes informativos |
| `warn` | string | Advertencias |
| `thought` | string | Monólogo interno del agente |
| `step` | `{iteration, total}` | Progreso de iteración |
| `summary` | `{before, after, reason}` | Compactación de memoria |
| `tool_call` | `{name, args, status, toolIndex, totalTools}` | Skill invocada |
| `tool_result` | `{name, status, error/result, toolIndex, totalTools}` | Resultado de skill |
| `response` | string | Respuesta final del agente |
| `error` | `{type, message, iteration}` | Error controlado |
| `skills_loaded` | `{count, skills[]}` | Skills cargadas |
| `ready` | `{sessionId, skillsCount, model}` | Sistema listo |

**API pública:**
- `init(options)` — Inicialización completa (env, sesión, cliente, skills, system prompt)
- `agentLoop(userInput)` → Promise<string> — Ciclo principal del agente
- `loadAllSkills()` — Carga skills en 3 fases (nativas, bridge, MCP)
- `reloadAllSkills()` — Hot-reload con timestamp busting
- `executeToolCall(toolCall)` — Ejecuta una skill y emite eventos
- `shutdown()` — Detiene autoguardado y guarda estado final
- `getStatus()` — Estado actual del orquestador
- `getSkills()` — Lista de skills registradas
- `clearConversation()` — Limpia historial (mantiene system prompt)

**Flujo interno del agentLoop:**
1. Verifica `isRunning` (previene concurrencia)
2. Agrega mensaje del usuario al historial
3. Loop de iteraciones (max 20):
   a. Verifica `needsSummary()` → compacta si es necesario
   b. Llama a DeepSeek API con mensajes + tools
   c. Procesa tool_calls en paralelo con `Promise.all()`
   d. Si no hay tool_calls → respuesta final
   e. Auto-guarda después de cada iteración
4. Retorna respuesta o mensaje de límite alcanzado

### 4.2 Index.js — `src/index.js`

**Ahora un wrapper delgado** que solo maneja la interfaz CLI (readline) y delega todo al Orchestrator.

**Comandos CLI:**
- `salir`/`exit` — Termina sesión
- `ayuda`/`help` — Muestra ayuda
- `skills` — Lista skills
- `status` — Estado del orquestador
- `clear` — Limpia historial
- `reload` — Recarga skills en caliente
- `plan <texto>` — Actualiza Manager View

---

## 5. FASE 3: Construcción de la Carrocería (GUI - Electron)

### 5.1 Main Process — `src/main.js`

**Proceso principal de Electron.** Gestiona:
- Creación de ventana (1400x900, dark theme, preload seguro)
- Manejadores IPC (agent:send, skills:list, session:status, etc.)
- Conexión de eventos del Orchestrator → renderer vía IPC
- Ciclo de vida de la app (ready, window-all-closed, before-quit)

**IPC Channels (request/response):**
- `agent:send(userInput)` → Envía mensaje al agente
- `agent:status()` → Estado actual
- `agent:clear()` → Limpia historial
- `skills:list()` → Lista skills
- `skills:reload()` → Recarga skills
- `session:status()` → Estado de sesión
- `session:plan(content)` → Actualiza PLAN.md
- `config:get()` → Configuración actual
- `dialog:openFile()` → Diálogo de archivo nativo

**Orchestrator → Renderer events (push):**
- `orchestrator:log`, `:thought`, `:step`, `:summary`
- `orchestrator:tool_call`, `:tool_result`
- `orchestrator:response`, `:error`
- `orchestrator:skills_loaded`, `:ready`

### 5.2 Preload — `src/preload.js`

**Puente seguro** entre el proceso principal y el renderer usando `contextBridge`.

Expone `window.lvzero` con:
- Métodos IPC directos: `lvzero["agent:send"](text)`, `lvzero["skills:list"]()`, etc.
- Suscripción a eventos: `lvzero.events.on("thought", callback)`, `lvzero.events.once(...)`, `lvzero.events.removeAllListeners(...)`

### 5.3 Renderer — `ui/`

**Tres archivos construidos con diseño Antigravity-style (cyberpunk dark):**

#### `ui/index.html`
- Top bar con logo, status badge, session ID, skills count
- Chat panel (main): mensajes con avatares, timestamps, formato código
- Input area con textarea auto-redimensionable + botón enviar
- Sidebar (360px) con 3 tabs: Skills, Inspector, Status

#### `ui/styles.css`
- Variables CSS: colores neón (púrpura, cian, verde, naranja, rosa)
- Tema oscuro profundo con bordes sutiles
- Animaciones: `message-in` para nuevos mensajes, `pulse-badge` para status running
- Scrollbar personalizado
- Responsive: min-width 1000px

#### `ui/renderer.js`
- Maneja el DOM y eventos IPC en tiempo real
- Renderiza mensajes por tipo (user, assistant, thought, tool_call, tool_result, system)
- Skills list en la sidebar con scroll
- Logic Inspector con logs por tipo (info, thought, tool_call, tool_result, error, response, warn)
- Status panel con métricas en tiempo real
- Tab switching (Skills / Inspector / Status)

---

## 6. FASE 4: Empaquetado (El .exe)

### 6.1 Configuración de Compilación

**package.json** — `electron-builder` config:

```json
{
  "build": {
    "appId": "com.lavg.lv-zero",
    "productName": "lv-zero",
    "directories": { "output": "dist", "buildResources": "build" },
    "files": ["src/**/*", "ui/**/*", "skills/**/*", ".env.example", "PLAN.md", "LOGICA.md"],
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "icon": "build/icon.ico",
      "artifactName": "lv-zero-setup-${version}.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
}
```

**Scripts disponibles:**
- `npm run electron` — Inicia GUI en modo producción
- `npm run electron:dev` — Inicia GUI con DevTools abiertas
- `npm run electron:build` — Genera `dist/lv-zero-setup-4.0.0.exe`

### 6.2 Requisitos para Empaquetar

1. **Icono:** Se necesita `build/icon.ico` (Windows), `build/icon.png` (Linux), `build/icon.icns` (macOS)
   - Generar desde PNG de 1024x1024 usando herramientas como `icon-gen` o https://icoconvert.com
   
2. **Comando de build:**
   ```bash
   npm run electron:build
   ```

3. **Output:** El instalador se genera en `dist/lv-zero-setup-4.0.0.exe`

---

## 7. Inventario de Archivos

```
lv-zero/
├── .env                          # Variables de entorno (API keys)
├── .env.example                  # Plantilla de .env
├── .gitignore                    # Git ignore
├── package.json                  # v4.0.0 — Manifiesto + build config
├── package-lock.json             # Lock de dependencias
├── PLAN.md                       # Manager View (progreso)
├── LOGICA.md                     # Documentación técnica
├── REPORT_ENGINE_V4.md           # ← ESTE ARCHIVO
│
├── src/
│   ├── index.js                  # CLI wrapper (readline → orchestrator)
│   ├── main.js                   # Electron main process (NUEVO)
│   ├── preload.js                # IPC bridge (NUEVO)
│   ├── system_prompt.js          # v3.4 — Constitución del agente
│   ├── mcp_client.js             # MCP Client (JSON-RPC)
│   └── core/
│       ├── orchestrator.js       # Motor event-driven (NUEVO)
│       ├── context_manager.js    # Memoria con auto-summarization (NUEVO)
│       └── state_manager.js      # Persistencia session.json (NUEVO)
│
├── skills/
│   ├── code_mapper.js            # Parser AST con acorn (NUEVO)
│   ├── db_explorer.js            # PostgreSQL directo (v1.0)
│   ├── file_manager.js           # CRUD de archivos
│   ├── internet_search.js        # Tavily → DuckDuckGo híbrido
│   ├── shell_executor.js         # Terminal automation
│   ├── skill_bridge.js           # 29 Antigravity skills bridge
│   ├── skill_factory.js          # Creación dinámica de skills
│   ├── supabase_manager.js       # Supabase CRUD
│   ├── supabase_sql.js           # SQL directo a Supabase
│   └── README.md                 # Documentación de skills
│
├── ui/
│   ├── index.html                # GUI principal (NUEVO)
│   ├── styles.css                # Antigravity cyberpunk theme (NUEVO)
│   └── renderer.js               # Controlador DOM + IPC (NUEVO)
│
├── build/
│   └── icon_placeholder.txt      # Reemplazar con icon.ico real (NUEVO)
│
└── plans/
    └── architecture-plan.md      # Plan arquitectónico
```

---

## 8. Instrucciones de Ejecución

### 8.1 CLI (Terminal)

```bash
# Modo producción
npm start

# O directamente
node src/index.js
```

### 8.2 GUI (Electron)

```bash
# Modo producción
npm run electron

# Modo desarrollo (con DevTools)
npm run electron:dev
```

### 8.3 Build .exe

```bash
# Generar instalador de Windows
npm run electron:build
```

El instalador se generará en `dist/lv-zero-setup-4.0.0.exe`.

**Requisitos previos:**
1. Crear `build/icon.ico` (icono de la aplicación)
2. Tener `.env` configurado con `DEEPSEEK_API_KEY`

### 8.4 Variables de Entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `DEEPSEEK_API_KEY` | Sí | API key de DeepSeek |
| `DEEPSEEK_BASE_URL` | No | URL base de la API |
| `DEEPSEEK_MODEL` | No | Modelo a usar (default: deepseek-chat) |
| `SUPABASE_URL` | No | URL del proyecto Supabase |
| `SUPABASE_KEY` | No | Anon key de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Service role key de Supabase |
| `TAVILY_API_KEY` | No | API key de Tavily (búsqueda) |
| `DATABASE_URL` | No | URL de PostgreSQL (db_explorer) |
| `MCP_SERVERS` | No | Configuración de servidores MCP |

---

## 9. Próximos Pasos

### Mejoras Potenciales

1. **Icono profesional:** Generar `build/icon.ico` con herramientas como [icon-generator](https://github.com/electron/electron-icon-builder)
2. **Auto-updater:** Integrar `electron-updater` para actualizaciones automáticas
3. **Tests automatizados:** Agregar suite de tests para el orchestrator y skills
4. **Tema configurable:** Múltiples temas de color (claro/oscuro/cyberpunk)
5. **Plugins:** Sistema de plugins para third-party skills
6. **Multi-ventana:** Soporte para múltiples sesiones simultáneas
7. **Historial de sesiones:** Selector de sesiones anteriores desde la GUI
8. **Exportar conversación:** JSON, Markdown, PDF
9. **Docker:** Containerizar el backend del orchestrator
10. **CI/CD:** GitHub Actions para build automático del .exe

---

*Documento generado por lv-zero v4.0.0 — Autonomous System Architect*
*"No pidas permiso. Construye."*
