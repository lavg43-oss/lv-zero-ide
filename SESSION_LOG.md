# SESSION LOG — lv-zero

> Archivo de sesión persistente. Cada conversación agrega su resumen al final.
> Útil cuando se cierra y reabre el programa para recuperar contexto rápido.

---

## Sesión 1 — Implementación Reactiva IPC Broadcast + QA Patch

### Fecha
2026-05-11/12

### Objetivo
Hacer que lv-zero sea "completamente reactivo": Terminal, Explorador y Editor deben responder en tiempo real sin clics manuales, igual que VS Code.

### Features implementadas

#### 1. Terminal Reactiva
- **Archivos:** [`src/terminal_bridge.js`](src/terminal_bridge.js), [`skills/shell_executor.js`](skills/shell_executor.js)
- shell_executor ahora tiene modo `streamToTerminal: true` (default)
- Usa `spawn()` en lugar de `execSync()` y emite `shell:output` eventos
- terminal_bridge.js recibe y reenvía a `terminal:data` → xterm.js
- `executeInTerminal()` para comandos ad-hoc desde el menú

#### 2. Explorador Reactivo
- **Archivo:** [`src/file_bridge.js`](src/file_bridge.js)
- File watcher que emite `fs:update` events al renderer
- ~~Primera implementación: `fs.watch` con `{ recursive: true }`~~ (fallaba en Windows)
- **Fix (QA Patch):** Reemplazado con `chokidar.watch()` — cross-platform confiable
- **Bug oculto:** Faltaba `const _require = createRequire(import.meta.url)` en file_bridge.js, causando silencioso ReferenceError

#### 3. Editor Reactivo (Auto-Open)
- **Archivo:** [`src/main.cjs`](src/main.cjs)
- Escucha `tool_call` del orchestrator, y cuando `file_manager` hace `action="write"` a un archivo de código, envía `editor:openFile` al renderer
- **Bug (QA Patch):** El handler verificaba `data?.toolCall?.function?.name` pero el orchestrator emite plano: `{ name, args, toolIndex, totalTools }`. Corregido a `data?.name`.
- **Bug (QA Patch):** `toolCallId: data?.toolCall?.id` cambiado a `data?.toolIndex`

#### 4. View Menu
- **Archivos:** [`ui/index.html`](ui/index.html), [`ui/styles.css`](ui/styles.css), [`ui/renderer.js`](ui/renderer.js), [`src/main.cjs`](src/main.cjs)
- Dropdown ☰ View en la topbar
- Toggle panels: Explorer, Chat, Terminal, Inspector
- Teclas: Ctrl+B, Ctrl+Shift+C, Ctrl+J, Ctrl+Shift+I
- Split.js-aware: oculta/muestra paneles con animación

### Bugs conocidos (todos corregidos)
| Bug | Síntoma | Solución |
|-----|---------|----------|
| `FitAddon is not a constructor` | Terminal no cargaba | UMD wrapper fix |
| `insertBefore` DOM error | Chat se rompía | `body.parentNode.insertBefore` en lugar de directo |
| DeepSeek 400 error | CacheFirstLoop sin assistant_message antes de tool_results | `addAssistantMessage()` en orchestrator.js |
| `fs.watch` en Windows | Explorer no se actualizaba | Reemplazar con chokidar |
| `_require` no definido | File watcher fallaba silenciosamente | Agregar `createRequire()` en file_bridge.js |
| `data?.toolCall?.function?.name` | Auto-Open no se disparaba nunca | Cambiar a `data?.name` |

### Dependencias instaladas
- `chokidar` — File watcher cross-platform

### Próximos pasos (sugeridos)
- Mejorar el debounce del explorador
- Agregar indicador visual cuando el explorador se está actualizando
- Soportar drag-and-drop en el explorador

---

## Sesión 2 — UI Commercial-Grade: Tabs, Diff Editor, @ Mentions

### Fecha
2026-05-12

### Objetivo
Elevar la interfaz de lv-zero a estándar comercial (tipo Cursor/VS Code) con 3 características visuales críticas manteniendo los eventos reactivos existentes.

### Features implementadas

#### 1. Sistema de Pestañas (Tabs) en el Editor
- **Archivos:** [`ui/index.html`](ui/index.html), [`ui/styles.css`](ui/styles.css), [`ui/renderer.js`](ui/renderer.js)
- Se reemplazó el panel-header del editor por una `#editor-tabs-bar` dinámica
- Cada archivo abierto tiene su propio modelo Monaco (`monaco.editor.createModel`) con URI `file:///`
- `_renderTabs()` — renderiza dinámicamente las tabs con indicador dirty (●) y botón de cerrar (×)
- `_switchTab(filePath)` — cambia entre modelos usando `editor.setModel()`
- `_closeTab(filePath)` — cierra tab, limpia modelo, cambia a la siguiente
- `_trackModelChanges()` — escucha `onDidChangeContent` para actualizar indicador dirty
- Welcome screen como tab virtual (`__welcome__`) con URI `inmemory://welcome`
- Tema oscuro personalizado `lvzero-dark` aplicado al editor

#### 2. Control de Cambios (Monaco Diff Editor)
- **Archivos:** [`ui/renderer.js`](ui/renderer.js), [`src/main.cjs`](src/main.cjs), [`src/preload.js`](src/preload.js)
- **Frontend (`renderer.js`):**
  - `_showDiffEditor(filePath, original, propuesto)` — crea Monaco diff editor side-by-side en overlay
  - `_hideDiffEditor(accepted)` — limpia modelos, disposed diff editor, oculta overlay
  - Botones flotantes ✅ Aceptar / ❌ Rechazar con bindings IPC
  - Al aceptar: escribe el archivo vía `file:acceptDiff` y recarga la tab
  - Al rechazar: restaura el original vía `file:rejectDiff`
- **Main process (`main.cjs`):**
  - En `connectOrchestratorEvents`, handler de `tool_call` para `file_manager`: cuando escribe a un archivo **existente**, lee el contenido original (antes de que el handler de file_manager ejecute) y envía `editor:diffReview` al frontend
  - Almacena diffs pendientes en `_pendingDiffs` Map
  - `file:acceptDiff` IPC handler: escribe el contenido nuevo a disco
  - `file:rejectDiff` IPC handler: restaura el contenido original
  - Para archivos **nuevos**, sigue auto-opening directamente sin diff
- **Preload (`preload.js`):**
  - Nuevos IPC channels: `file:acceptDiff`, `file:rejectDiff`
  - Nuevo evento: `onDiffReview` para `editor:diffReview` channel

#### 3. Menciones de Archivos (@) en el Chat
- **Archivo:** [`ui/renderer.js`](ui/renderer.js)
- `_showFileAutocomplete(filter)` — cuando el usuario teclea @, muestra lista filtrada de archivos del proyecto
- `_insertMentionPill(filePath)` — inserta pill visual (@nombre-archivo) con botón × para remover
- `_getMentionContext()` — lee contenido de archivos mencionados y construye contexto para el prompt
- `sendMessage()` modificado: prepende el contexto de archivos mencionados al mensaje
- Las pills se limpian automáticamente después de enviar el mensaje
- La lista de archivos (`_fileList`) se sincroniza con `_loadFileTree()` y `_collectFilePaths()`

### Bugs conocidos (todos corregidos en esta sesión)
| Bug | Síntoma | Solución |
|-----|---------|----------|
| — | — | — |

### Archivos modificados
- [`ui/index.html`](ui/index.html) — Tabs bar + diff overlay HTML structure
- [`ui/styles.css`](ui/styles.css) — CSS para tabs, diff editor, @ mentions
- [`ui/renderer.js`](ui/renderer.js) — Tabs system, diff editor methods, @ mentions, event subscriptions
- [`src/main.cjs`](src/main.cjs) — Diff review detection in tool_call handler, file:acceptDiff/rejectDiff IPC
- [`src/preload.js`](src/preload.js) — `onDiffReview`, `file:acceptDiff`, `file:rejectDiff` channels
- [`SESSION_LOG.md`](SESSION_LOG.md) — Esta entrada

### Próximos pasos (sugeridos)
- Keyboard shortcuts for diff Accept (Ctrl+Enter) / Reject (Ctrl+Backspace)
- Drag tabs to reorder
- Syntax highlight for @ mentioned files in chat
- File search/filter in the explorer panel
- Tab context menu (Close Others, Close All)

---

## Sesión 3 — Sistema de Permisos y Ajustes (Auto-Approve)

### Fecha
2026-05-12

### Objetivo
Implementar un sistema de Auto-Approve (Aprobación Automática) configurable para reducir la fricción del Diff Editor en tareas en masa. El usuario puede activar/desactivar la aprobación automática de ediciones y ejecuciones en terminal desde un modal de ajustes.

### Features implementadas

#### 1. Modal de Ajustes (UI)
- **Archivos:** [`ui/index.html`](ui/index.html), [`ui/styles.css`](ui/styles.css)
- Se reutilizó el botón ⚙ existente en el header del chat (`#btn-chat-settings`) para abrir un modal flotante
- Modal con overlay semitransparente, cierre al hacer clic fuera o en el botón ✕
- Dos toggles estilo iOS (checkbox personalizado con slider):
  - "Auto-aprobar edición de archivos (Saltar Diff)"
  - "Auto-aprobar ejecución en terminal"
- Diseño nativo oscuro consistente con el tema `lvzero-dark`

#### 2. Persistencia vía localStorage (Frontend)
- **Archivo:** [`ui/renderer.js`](ui/renderer.js)
- `_loadSettings()` — lee `lvzero_settings` de localStorage, aplica estado a checkboxes, sincroniza con backend
- `_saveSettings()` — guarda `{ autoApproveEdits, autoApproveTerminal }` en localStorage
- `_syncSettings()` — envía preferencias al backend vía `config:setAutoApprove` IPC
- Logging en el Inspector cuando se cambian los toggles

#### 3. Sincronización IPC (Frontend ↔ Backend)
- **Archivos:** [`src/preload.js`](src/preload.js), [`src/main.cjs`](src/main.cjs)
- Nuevo canal IPC: `config:setAutoApprove(settings)` en preload.js
- Backend almacena `_autoApproveEdits` y `_autoApproveTerminal` como variables de estado
- Handler responde con el estado actual confirmado

#### 4. Refactor del Backend — Diff Condicional
- **Archivo:** [`src/main.cjs`](src/main.cjs)
- En `connectOrchestratorEvents()`, el handler `tool_call` para `file_manager` ahora verifica `_autoApproveEdits`:
  - **Si es `true`**: escribe directamente el contenido nuevo al disco (`fs.writeFileSync`) y envía solo `editor:openFile` con flag `autoApproved: true` para recargar la pestaña — **sin evento `editor:diffReview`**
  - **Si es `false`**: mantiene el flujo normal de Diff Review (mostrar overlay con Accept/Reject)
- Para archivos nuevos (sin contenido original), el comportamiento no cambia

### Archivos modificados
- [`ui/index.html`](ui/index.html) — Modal HTML con toggles y overlay
- [`ui/styles.css`](ui/styles.css) — Estilos del modal, toggle switches, overlay
- [`ui/renderer.js`](ui/renderer.js) — `_settings` state, `_loadSettings()`, `_saveSettings()`, `_syncSettings()`, `_bindSettingsUI()`, DOM refs, init hook
- [`src/main.cjs`](src/main.cjs) — `_autoApproveEdits`, `_autoApproveTerminal` state, `config:setAutoApprove` IPC handler, diff conditional skip
- [`src/preload.js`](src/preload.js) — `config:setAutoApprove` IPC channel
- [`SESSION_LOG.md`](SESSION_LOG.md) — Esta entrada

### Próximos pasos (sugeridos)
- Keyboard shortcuts for Accept Diff (Ctrl+Enter) / Reject Diff (Ctrl+Backspace)
- Auto-aprobar terminal: modificar shell_executor o terminal_bridge para saltar confirmaciones
- Indicador visual en el header del chat cuando Auto-Approve esté activo (e.g., badge verde)
- Tooltip en el botón ⚙ mostrando estado actual de Auto-Approve

---

## Sesión 4 — Fase 3 del Protocolo Frankenstein: Git UI + @codebase

### Fecha
2026-05-12

### Objetivo
Asimilar características de Warp Terminal y Cursor: (1) mención especial `@codebase` que invoca el skill `repo_mapper` para inyectar contexto global del proyecto, y (2) panel de Control de Versiones (Git) en la barra lateral izquierda con estado en vivo y auto-commit vía IA.

### Features implementadas

#### 1. Mención @codebase (Repo Map)
- **Archivos:** [`ui/renderer.js`](ui/renderer.js), [`src/preload.js`](src/preload.js), [`src/main.cjs`](src/main.cjs)
- Se agregó `@codebase` como opción estática en el autocompletado de menciones (`_showFileAutocomplete()`) cuando el usuario escribe `@codebase` o `@codeb`, etc.
- Al seleccionarla, se almacena el valor centinela `__codebase__` en `_mentionFiles`
- En `_getMentionContext()`, se detecta `__codebase__` y se invoca `skill:runRepoMapper(".")` vía IPC
- El resultado del repo_mapper (recorrido semántico del proyecto: funciones, clases, imports) se inyecta como contexto oculto en el prompt, truncado a 5000 caracteres
- Nuevo canal IPC: `skill:runRepoMapper(directory)` en preload.js
- Handler en main.cjs que hace `import()` dinámico de `../skills/repo_mapper.js` y llama a su `handler`

#### 2. Panel de Control de Versiones (Git UI)
- **Archivos:** [`ui/index.html`](ui/index.html), [`ui/styles.css`](ui/styles.css), [`ui/renderer.js`](ui/renderer.js)
- La barra lateral izquierda (`#panel-explorer`) ahora tiene dos secciones separadas por un divisor (`.vc-divider`):
  - **📁 Explorer** (arriba) — el árbol de archivos existente
  - **🔀 Source Control** (abajo) — nuevo panel de git
- El panel VC muestra:
  - Branch actual con icono ⎇
  - Lista de archivos modificados con badges de estado coloreados (A=verde, M=amarillo, D=rojo, R=púrpura, C=azul, ?=gris)
  - Cada archivo es clickeable para abrirlo en el editor
- Botón ↻ para refrescar el estado de git manualmente
- Botón 🤖 **Auto-Commit** que:
  1. Obtiene el diff vía `git diff`
  2. Lo envía al modelo DeepSeek (a través de `orchestrator.client.chat.completions.create()`) para generar un mensaje de commit descriptivo
  3. Ejecuta `git add -A && git commit -m "<message>"`
  4. Refresca el panel VC automáticamente
- Estado de carga con animación pulse `⟳ Scanning...`
- Mensaje contextual: "Not a Git repository", "✓ No changes", o lista de cambios

#### 3. IPC y Backend Git
- **Archivos:** [`src/main.cjs`](src/main.cjs), [`src/preload.js`](src/preload.js)
- Tres nuevos canales IPC:
  - `git:status` — ejecuta `git status --porcelain`, parsea formato XY, obtiene branch y diff stat
  - `git:diff` — ejecuta `git diff <filePath>` para ver cambios específicos
  - `git:autoCommit` — flujo completo: diff → IA → add → commit
- Nuevo import: `const { execSync } = require("child_process")` en main.cjs
- Manejo de errores: detecta si no es un repositorio git, si no hay cambios, etc.

### Archivos modificados
- [`src/preload.js`](src/preload.js) — 4 nuevos canales IPC: `git:status`, `git:diff`, `git:autoCommit`, `skill:runRepoMapper`
- [`src/main.cjs`](src/main.cjs) — `execSync` import, 4 IPC handlers (git status/diff/autoCommit, repo_mapper), todos antes del handler de Auto-Approve existente
- [`ui/index.html`](ui/index.html) — Sidebar dividido en Explorer + Source Control con botones ↻ y 🤖, branch display, file list container
- [`ui/styles.css`](ui/styles.css) — ~100 líneas de estilos VC: `.vc-divider`, `.vc-header`, `.vc-panel`, `.vc-branch`, `.vc-file-item` con colores de estado, `.vc-loading` con animación pulse, `.vc-commit-status`
- [`ui/renderer.js`](ui/renderer.js) — DOM refs VC, `_loadGitStatus()`, `_renderVCItems()`, `@codebase` en `_showFileAutocomplete()`, `__codebase__` handling en `_insertMentionPill()` y `_getMentionContext()`, botones bindeados en `_bindUIEvents()`, init hook
- [`SESSION_LOG.md`](SESSION_LOG.md) — Esta entrada

### Notas técnicas
- El Auto-Approve (Sesión 3) sigue funcionando — los interruptores no fueron tocados
- La sintaxis de `main.cjs` fue verificada con `node --check` (exit code 0)
- El servidor Electron se reinició exitosamente después de los cambios

### Próximos pasos (sugeridos)
- Keyboard shortcuts for Accept Diff (Ctrl+Enter) / Reject Diff (Ctrl+Backspace)
- Auto-aprobar terminal: modificar shell_executor o terminal_bridge para saltar confirmaciones
- Git status reactivo: escuchar `fs:update` para refrescar automáticamente el panel VC
- Diff view integrado en el panel VC (ver cambios antes de commit)
- Staging individual de archivos (git add/restore por archivo)

---

## Sesión 4 — Auto-Healing y Live Preview (Fase 4 del Protocolo)

### Fecha
2026-05-12

### Objetivo
Dotar a lv-zero de capacidad de auto-sanación (Auto-Healing) y de un motor de previsualización web embebido (Live Preview).

---

### 🩺 Misión 1 — Terminal Inmortal (Auto-Healing)

#### 1A. Shell Executor — Emitir `shell:error` en exit code ≠ 0
- **Archivo:** [`skills/shell_executor.js`](skills/shell_executor.js)
- Dentro de `child.on("close")`, si `exitCode !== 0`, se emite `process.emit("shell:error", { command, exitCode, stderr, stdout })`
- Captura el stderr completo para análisis, o null si no hubo texto en stderr

#### 1B. Main Process — Forward IPC + CSP para iframes
- **Archivo:** [`src/main.cjs`](src/main.cjs)
- En `connectShellOutput()`: `process.on("shell:error")` captura el evento y lo reenvía a `mainWindow.webContents.send("terminal:commandError", ...)`
- CSP actualizado: `frame-src http://localhost:* http://127.0.0.1:*;` para permitir iframes en Live Preview

#### 1C. Preload — Canal de evento `onCommandError`
- **Archivo:** [`src/preload.js`](src/preload.js)
- Nuevo canal en `EVENT_CHANNELS`: `onCommandError` — escucha `terminal:commandError` IPC, retorna cleanup function

#### 1D. Renderer — Auto-Healing Handler
- **Archivo:** [`ui/renderer.js`](ui/renderer.js)
- En `_connectEvents()`: suscripción a `onCommandError` que:
  1. Extrae el texto del error (stderr o "Exit code N", truncado a 500 chars)
  2. Registra en el inspector: `🩺 Command failed: ...`
  3. Si el sistema no está ocupado (`this.busy`), construye el mensaje: `"El último comando falló con este error: [error]. Por favor, analízalo y arréglalo."`
  4. Lo envía automáticamente al orquestador tras 800ms de delay

---

### 🌐 Misión 2 — Live Preview (Navegador Integrado)

#### 2A. HTML — Estructura DOM del Preview
- **Archivo:** [`ui/index.html`](ui/index.html)
- `#editor-tabs-bar`: botón `🌐 Preview` (`#btn-preview`) en `.panel-actions` (lado derecho)
- `#editor-main-area`: nuevo wrapper flex que contiene:
  - `#monaco-editor` (`.monaco-editor-holder`) — editor a la izquierda
  - `#preview-panel` (`.preview-panel.hidden`) — panel de preview a la derecha
- `#preview-panel` contiene:
  - `.preview-toolbar` con `#btn-preview-reload` (↻) y `#preview-url` input (value por defecto: `http://localhost:3000`)
  - `#preview-iframe` con `sandbox="allow-scripts allow-same-origin allow-forms"` y `src="about:blank"`

#### 2B. CSS — Estilos del Preview
- **Archivo:** [`ui/styles.css`](ui/styles.css)
- `.editor-main-area`: `display: flex; flex-direction: row; flex: 1; overflow: hidden`
- `.editor-main-area .monaco-editor-holder`: `flex: 1` por defecto, `flex: 7` cuando `.has-preview` está activo
- `.editor-main-area.has-preview .monaco-editor-holder`: `border-right: 1px solid var(--border-primary)` para separación visual
- `.preview-panel`: `flex: 3; display: flex; flex-direction: column; min-width: 200px`
- `.preview-panel.hidden`: `display: none`
- `.preview-toolbar`: flex horizontal con gap 4px, padding, fondo oscuro, borde inferior
- `.preview-url-input`: input estilizado oscuro, `flex: 1`, foco con borde azul
- `.preview-iframe`: `flex: 1; border: none; background: white; width: 100%; height: 100%`

#### 2C. Renderer — Lógica de Toggle y Navegación
- **Archivo:** [`ui/renderer.js`](ui/renderer.js)
- **Constructor:** `this._previewVisible = false`
- **_cacheDom():** Nuevos refs DOM: `previewPanel`, `previewIframe`, `previewUrl`, `btnPreview`, `btnPreviewReload`, `editorMainArea`
- **_togglePreview():**
  - Toggle `.hidden` en previewPanel, toggle `.has-preview` en editorMainArea
  - Al abrir: carga la URL del address bar en el iframe, cambia botón a `📝 Editor`
  - Al cerrar: cambia botón a `🌐 Preview`, registra log
  - Re-layout de Monaco con `setTimeout(100ms)`
- **_previewNavigate():** Lee URL del input, asigna a `iframe.src`, registra log
- **_bindUIEvents():**
  - `btnPreview` click → `_togglePreview()`
  - `btnPreviewReload` click → `_previewNavigate()`
  - `previewUrl` keydown (Enter) → `_previewNavigate()`

---

### Archivos modificados
- [`skills/shell_executor.js`](skills/shell_executor.js) — Emisión `shell:error` en exit code ≠ 0
- [`src/main.cjs`](src/main.cjs) — IPC forward `terminal:commandError` + CSP `frame-src`
- [`src/preload.js`](src/preload.js) — Nuevo canal `onCommandError`
- [`ui/index.html`](ui/index.html) — `#editor-main-area` flex container, `#btn-preview`, `#preview-panel` con toolbar + iframe
- [`ui/styles.css`](ui/styles.css) — ~70 líneas de estilos preview (flex 70/30 split, toolbar, URL input, iframe)
- [`ui/renderer.js`](ui/renderer.js) — Auto-heal handler, preview state/toggle/navigate, DOM refs, button bindings
- [`SESSION_LOG.md`](SESSION_LOG.md) — Esta entrada

### Notas técnicas
- La sintaxis de `main.cjs` y `renderer.js` fue verificada con `node --check` (exit code 0 ambos)
- El servidor Electron se reinició exitosamente después de los cambios
- El CSP fue actualizado con `frame-src` para permitir iframes — necesario para Live Preview
- El iframe usa `sandbox` restrictivo por seguridad: solo scripts, mismo origen, y formularios
- El auto-heal incluye un guard `if (this.busy) return;` para evitar spam de mensajes cuando el sistema ya está procesando
- El delay de 800ms en auto-heal permite que la salida del terminal se asiente antes de enviar

### Próximos pasos (sugeridos)
- Keyboard shortcuts for Accept Diff (Ctrl+Enter) / Reject Diff (Ctrl+Backspace)
- Git status reactivo: escuchar `fs:update` para refrescar automáticamente el panel VC
- Staging individual de archivos (git add/restore por archivo)
- Preview automático: detectar servidor web iniciado y abrir preview automáticamente
- Múltiples pestañas de preview para diferentes puertos/URLs

---

---

## Sesión 5 — Recovery Post-Crash + Portable .exe Fix

### Fecha
2026-05-12

### Objetivo
Recuperar el contexto de la sesión anterior tras un crash que perdió archivos temporales de debug, diagnosticar por qué el `.exe` portátil compilado no funciona en otra PC, y aplicar correcciones.

### Diagnóstico del Crash
- **Síntoma:** 5 archivos de debug temporales perdidos (`_debug_ddg.mjs`, `_debug_ddg_fix.mjs`, `_test_search.mjs`, `_diagnostic.mjs`, `_test_env.mjs`) — existen como "tabs fantasma" en VSCode pero no en disco.
- **Recuperación:** Imposible — no hay git repo ni local history de VSCode.
- **Estado del proyecto:** Todos los archivos core (`main.cjs`, `preload.js`, `orchestrator.js`, `renderer.js`, skills) pasan `node --check` sin errores.

### Diagnóstico del Portable .exe
- **Síntoma confirmado:** "No apareció NADA — ni ventana, ni error, ni proceso en Task Manager" en otra PC con Windows 10.
- **Causa raíz más probable:** Falta Visual C++ Redistributable en la PC destino, o Windows Defender bloqueó la extracción. El portable `lv-zero-portable-4.0.0.exe` (103 MB) ni siquiera comenzó a ejecutarse.
- **Problemas de código identificados (no causan el crash inicial pero afectarían si el app lograra iniciar):**
  1. Ruta de skills en asar: `orchestrator.js` usaba `path.resolve(__dirname, "..", "..", "skills")` que dentro del asar no resuelve correctamente. Ahora tiene fallback a `process.resourcesPath/skills`.
  2. Sin file logger: Todo `console.log` se perdía en modo portable. Ahora se escribe a `userData/logs/lv-zero-*.log`.
  3. Sin try-catch global en `init()`: Errores no capturados mataban el app silenciosamente. Ahora hay `try-catch` + `dialog.showErrorBox()`.
  4. Sin captura de `uncaughtException`/`unhandledRejection`: Ahora se registran en el file logger.
  5. Sin monitoreo de errores del renderer: Ahora `webContents.on("console-message")` reenvía logs al main process.

### Correcciones aplicadas

#### 1. [`src/main.cjs`](src/main.cjs) — File Logger + Error Handling
- `setupFileLogger()` — Redirige `console.log/error/warn` a archivo en `userData/logs/`
- Captura `uncaughtException` y `unhandledRejection` globales
- `init()` envuelto en `try-catch` con `dialog.showErrorBox()` como último recurso
- `webContents.on("console-message")` para capturar errores del renderer
- `webContents.on("did-fail-load")` para detectar fallo al cargar UI
- `notifications: false` en webPreferences para evitar crash en Win10 sin servicio de notificaciones

#### 2. [`src/core/orchestrator.js`](src/core/orchestrator.js) — Skill Loading Path
- `skillsDir` ahora tiene fallback: si la ruta relativa no existe (contexto asar), prueba `process.resourcesPath + "/skills"` (extraResources)
- Logging de la ruta usada para skills

### Archivos modificados
- [`src/main.cjs`](src/main.cjs) — File logger, try-catch global, error handlers, window crash safety
- [`src/core/orchestrator.js`](src/core/orchestrator.js) — Asar-compatible skill loading path
- [`SESSION_LOG.md`](SESSION_LOG.md) — Esta entrada

### Estado del build
- Recompilando: `lv-zero-portable-4.0.0.exe` en proceso
- La API key del `.env` se excluye automáticamente del build (`!.env` en `files` config)

### Próximos pasos (sugeridos)
- Probar el nuevo portable en otra PC para confirmar la corrección
- Si sigue sin arrancar, instalar Visual C++ Redistributable en la PC destino
- Si arranca pero pide API key, ingresarla en el auth modal (se guarda en userData)
- Considerar agregar `win.signAndEditExecutable` false en `package.json` para evitar problemas de signing

---

## Sesión 5 — Fix: Revertir ESM Wrapper + Rebuild Portable

### Fecha
2026-05-12

### Objetivo
Corregir el Root Cause #2 (ESM wrapper `src/entry.mjs` no funcionaba) y rebuildear el portable `.exe`.

### Problema identificado

La sesión anterior introdujo un ESM wrapper (`src/entry.mjs`) para solucionar un problema de resolución de `require("electron")`. Sin embargo:

1. **`import * as electron from 'electron'` retorna objeto vacío** incluso dentro del runtime de Electron — `{ default: {}, "module.exports": {} }` sin `app`, `BrowserWindow`, etc. Probado ejecutando `dist_new/win-unpacked/lv-zero.exe src/entry.mjs` que mostró `app available: false`.

2. **El asar existente usaba código VIEJO** (anterior a las modificaciones): `package.json` → `"main": "src/main.cjs"` con simple `require("electron")`. Este código funciona correctamente dentro del runtime empaquetado de Electron porque Electron intercepta la resolución de módulos para `require("electron")` y retorna el módulo interno real en lugar del paquete npm.

3. **El fix de la sesión anterior empeoraba el build**: Si se rebuildeara con `package.json` → `"src/entry.mjs"`, el asar nuevo fallaría porque:
   - `src/entry.mjs` intenta ESM import → retorna vacío
   - `src/main.cjs` verifica `globalThis.__electron` → no tiene `app`
   - `src/main.cjs` intenta `require("electron")` fallback → MODULE_NOT_FOUND (sin paquete npm)

### Correcciones aplicadas

#### 1. [`package.json`](package.json) — Revertir entry point
- `"main"` cambiado de `"src/entry.mjs"` a `"src/main.cjs"`
- Agregada configuración `"build"` para electron-builder (portable target)
- Agregados `electron` y `electron-builder` en devDependencies
- `"npmRebuild": false` para evitar error MSVC (Spectre mitigations faltantes)

#### 2. [`src/main.cjs`](src/main.cjs) — Eliminar globalThis.__electron workaround
- Header actualizado a v2.3 con explicación de que `require("electron")` funciona correctamente dentro del runtime empaquetado
- Eliminado bloque de detección `globalThis.__electron` (líneas 24-40 anteriores)
- Restaurado simple: `const { app, BrowserWindow, ipcMain, dialog, session, Menu } = require("electron");`
- **Conservados** todos los improvements de la sesión anterior: file logger, try-catch en init(), error handlers, window crash safety

#### 3. [`src/entry.mjs`](src/entry.mjs) — Mantenido como herramienta dev
- El archivo se conserva pero ya no es el entry point del package.json
- Solo útil para depuración en modo dev ejecutando manualmente con el binario de Electron

### Lecciones aprendidas

- **`require("electron")` funciona dentro del runtime de Electron** porque Electron parcha `Module._resolveFilename` para interceptar el nombre del módulo "electron" y retornar el built-in module. El paquete npm `electron` (que exporta un string path) solo se usa cuando se requiere desde fuera del proceso de Electron.
- **El `import * as electron from 'electron'` de Electron 42 NO funciona en código de usuario** — solo funciona en el `default_app.asar` interno de Electron porque usa un mecanismo especial de V8 bootstrap/code cache.
- **El paquete npm `electron` debe estar en devDependencies** para que electron-builder pueda encontrar el binario de Electron, pero **no debe estar en dependencies** porque no se necesita dentro del asar.

### Archivos modificados
- [`package.json`](package.json) — main revertido, build config agregado, devDependencies actualizados
- [`src/main.cjs`](src/main.cjs) — Header actualizado, globalThis workaround eliminado
- [`SESSION_LOG.md`](SESSION_LOG.md) — Esta entrada

### Archivos creados
- (ninguno nuevo)

### Estado del build
- **Portable rebuild exitoso:** `dist_new/lv-zero 4.0.0.exe` (firmado, 4.0.0)
- Asar verificado: contiene `package.json` con `"main": "src/main.cjs"` y `main.cjs` con `require("electron")` limpio
- El portable se inicia correctamente en esta PC (lanza ventana GUI)

### Próximos pasos (sugeridos)
- Probar `dist_new/lv-zero 4.0.0.exe` en otra PC para confirmar que arranca
- Si no arranca, instalar Visual C++ Redistributable en la PC destino (causa más probable del fallo)
- Si arranca: ingresar API key en auth modal (se guarda en `userData/config.json`, persiste entre rebuilds)
- `src/entry.mjs` puede eliminarse en el futuro si no se necesita para dev

---

## Sesión 6 — Terminal Shell Selector + Auto-Detect

### Fecha
2026-05-12/13

### Objetivo
Implementar un selector de shell (CMD / PowerShell) en la terminal física de lv-zero, permitiendo al usuario cambiar el shell activo sin reiniciar la app, y al agente detectar automáticamente qué shell usar según el comando.

### Features implementadas

#### 1. Shell Selector en Terminal Bridge (Main Process)
- **Archivo:** [`src/terminal_bridge.js`](src/terminal_bridge.js)
- Agregado estado global `currentShell` y `currentShellType` para trackear el shell activo
- `createPty(win, shellType?)` ahora acepta parámetro opcional `shellType` ("cmd" | "powershell")
- Nuevo IPC handler `terminal:switchShell` — mata el PTY actual y recrea con el nuevo shell, emite evento `terminal:shellChanged` al renderer
- Nuevo IPC handler `terminal:shellInfo` — retorna `{ shell, path, pid, active }`
- Exportada función `getCurrentShellType()` para consumo externo
- Emite `process.emit("shell:changed", shellType)` para sincronizar `process.env.__LV_ACTIVE_SHELL`

#### 2. IPC Bridge (Preload)
- **Archivo:** [`src/preload.js`](src/preload.js)
- Nuevos canales IPC: `terminal:switchShell(shellType)`, `terminal:shellInfo()`
- Nuevo evento `onTerminalShellChanged(callback)` escuchando `terminal:shellChanged`

#### 3. UI: Shell Selector Dropdown
- **Archivo:** [`ui/index.html`](ui/index.html)
- Agregado `<select id="terminal-shell-selector">` con opciones `CMD` / `PowerShell` en el panel-header del terminal

#### 4. UI: Estilos del Selector
- **Archivo:** [`ui/styles.css`](ui/styles.css)
- Estilos oscuros para `.terminal-shell-selector` con hover/focus en azul `#007acc`

#### 5. UI: Lógica de Cambio de Shell (Renderer)
- **Archivo:** [`ui/renderer.js`](ui/renderer.js)
- Nuevo método `_switchTerminalShell(shellType)` — llama a `terminal:switchShell` IPC, maneja errores, revierte selector en fallo
- DOM ref `terminalShellSelector` cacheado
- Event listener `change` en el selector enlazado a `_switchTerminalShell()`
- Suscripción a `onTerminalShellChanged` para actualizar selector cuando el shell cambia externamente
- `startTerminal()` actualizado: después de crear PTY, obtiene shell info via `terminal:shellInfo()` y sincroniza el selector

#### 6. Shell Executor — Modo Auto-Detect
- **Archivo:** [`skills/shell_executor.js`](skills/shell_executor.js)
- Nuevo valor `"auto"` en el enum del parámetro `shell` (default: `"auto"`)
- Nueva función `detectShell(command)` que detecta patrones PowerShell (Get-*, $variable, pipeline a Select-Object) vs CMD (type, copy, ren, cls)
- Fallback a `process.env.__LV_ACTIVE_SHELL` para respetar el shell activo del terminal físico

#### 7. Main Process — Sincronización de Entorno
- **Archivo:** [`src/main.cjs`](src/main.cjs)
- Inicialización de `process.env.__LV_ACTIVE_SHELL = "cmd"` al arrancar
- Listener `process.on("shell:changed")` en `connectShellOutput()` para sincronizar el env var cuando el shell cambia

### Archivos modificados
- [`src/terminal_bridge.js`](src/terminal_bridge.js) — Shell state, createPty con shellType, IPC switchShell/shellInfo, evento shellChanged
- [`src/preload.js`](src/preload.js) — Canales IPC + onTerminalShellChanged
- [`ui/index.html`](ui/index.html) — Dropdown selector en terminal panel-header
- [`ui/styles.css`](ui/styles.css) — Estilos .terminal-shell-selector
- [`ui/renderer.js`](ui/renderer.js) — _switchTerminalShell(), events, selector sync
- [`skills/shell_executor.js`](skills/shell_executor.js) — Modo "auto", detectShell(), default "auto"
- [`src/main.cjs`](src/main.cjs) — __LV_ACTIVE_SHELL sync

### Notas técnicas
- Todos los archivos modificados pasan `node --check` sin errores
- El flujo de cambio de shell: el usuario selecciona "PowerShell" → IPC `terminal:switchShell` → main process mata PTY actual → spawn nuevo PTY con `powershell.exe` → emite `terminal:shellChanged` → renderer actualiza selector y log
- `shell_executor` con `shell: "auto"` primero intenta detectar por patrón de comando, luego cae a `process.env.__LV_ACTIVE_SHELL` (el shell activo del terminal), y por último a `"cmd"`

### Próximos pasos (sugeridos)
- Soporte para PowerShell Core (`pwsh.exe`) como tercera opción
- Persistencia de selección de shell entre reinicios (localStorage + config)
- Indicador visual cuando el terminal se está reiniciando (spinner)
- Keyboard shortcut para cambiar de shell (Ctrl+Shift+P / Ctrl+Shift+C)

---

## Instrucciones para próximas sesiones

1. **Leer este archivo primero** para entender el estado actual del proyecto.
2. Si hay un servidor Electron corriendo, no reiniciar a menos que se modifique `main.cjs` o `preload.js` (los módulos ESM como file_bridge.js se recargan con cada `import()` dinámico).
3. No tocar bases de datos (SIAE/supabase) a menos que se indique explícitamente.
4. Este archivo debe actualizarse al final de cada sesión con un resumen de lo que se hizo.
5. **Portable .exe:** Recordar que la API key se guarda en `userData/config.json` (persiste entre rebuilds). Si se prueba en otra PC, ingresar la API key en el auth modal la primera vez.
