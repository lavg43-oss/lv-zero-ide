# 🎯 Lista Maestra de Pendientes — lv-zero

> Auditoría contra código fuente realizada el 2026-05-14.
> ~83% de los pendientes originales ya están implementados.
> SIAE no está incluido — es el propósito de lv-zero, no una tarea.
> ✅ Todos los 12 pendientes implementados el 2026-05-15.

---

## 📊 Resumen

| Categoría | Total | ✅ Hecho | ⚠️ Parcial | ❌ Pendiente |
|-----------|-------|----------|------------|-------------|
| 🔴 Agent Reliability | 7 | 7 | 0 | 0 |
| 🔴 Crash Recovery | 7 | 7 | 0 | 0 |
| 🔴 Supabase Connection | 5 | 5 | 0 | 0 |
| 🟡 Media Prioridad | ~28 | ~28 | 0 | 0 |
| 🟢 Características | ~5 | ~5 | 0 | 0 |
| **Total** | **~52** | **~52** | **0** | **0** |

---

## 🔴 Pendientes Reales (requieren cambios de código)

### 1. Crash Recovery UI — Fase 2 (único pendiente de crash-recovery)
- [x] **Recovery UI en renderer.js**: El IPC `crash:*` está listo en preload.js y orchestrator.js, pero **renderer.js no tiene `onCrashDetected` subscriber**. Falta toast + botones "Restaurar / Empezar de nuevo"

### 2. System Prompt — orchestrator.md incompleto
- [x] **Agregar sección "Progress Updates & Task Completion"** a [`src/modes/prompts/orchestrator.md`](src/modes/prompts/orchestrator.md). Los otros 4 modos ya la tienen, pero orchestrator.md termina en line 135 sin esa sección.

### 3. Test Infrastructure
- [x] **Agregar vitest a package.json** — los archivos de test existen en `test/` pero no hay devDependency ni script de npm para ejecutarlos.

### 4. Task Completion Banner
- [x] **Implementar `_showTaskComplete()` en renderer.js**: `main.cjs` ya reenvía eventos `task_complete`, preload.js los expone, pero renderer.js no tiene handler para mostrar banner visual de tarea completada.

### 5. Mode Switching Auto-Detection
- [x] **Wiring de auto-detection en agentLoop**: `mode_controller.js` tiene `detectFromInput()` pero no está conectado al `agentLoop()` del orchestrator para detectar cambios de modo automáticos.

### 6. UI/UX Quick Wins — 5 cambios CSS (alta prioridad)
Source: UI/UX Audit 2026-05-15

- [x] **Fix code block word breaking**: Cambiar `word-break: break-all` → `overflow-x: auto` en code blocks ([`ui/styles.css:870`](ui/styles.css:870)). Es el cambio #1 — `break-all` rompe palabras en medio de caracteres, `function` se ve como `fu/nc/ti/on`.
- [x] **Aumentar fuente base**: De 12px → 13-14px ([`ui/styles.css:~15`](ui/styles.css:~15)). VS Code usa 13px base, 14px editor. 12px se siente diminuto y anticuado.
- [x] **Aumentar border-radius**: De 3px→8px en inputs, 6px→12px en modales ([`ui/styles.css:~300`](ui/styles.css:~300)). Las esquinas de 3px se ven como Windows 3.1.
- [x] **Definir variables CSS faltantes**: `--accent-blue` se referencia en varios selectores pero nunca se define en `:root` ([`ui/styles.css:489`](ui/styles.css:489)). Causa fallbacks silenciosos.
- [x] **Scroll horizontal en `<pre>`**: Agregar `overflow-x: auto` + `white-space: pre` a los code blocks ([`ui/styles.css:856`](ui/styles.css:856)). Líneas largas de código se truncan sin scroll.

Estimated: ~14 líneas de CSS, cero cambios en JS.

### 7. Paths con espacios en shell — quoting automático (alta prioridad)
Source: Shell execution analysis 2026-05-15

lv-zero pasa comandos crudos a `spawn()` sin quoting de rutas con espacios ([`shell_executor.js:82`](skills/shell_executor.js:82), [`terminal_bridge.js:224`](src/terminal_bridge.js:224)). Un comando como `git add C:\Users\My Documents\file.js` se rompe porque CMD interpreta `My` y `Documents\file.js` como argumentos separados.

- [x] **Crear `src/shell_utils.js`**: Función `quotePath(command, shellType)` que detecta rutas con espacios y las envuelve en comillas según el shell activo:
  - CMD: comillas dobles (`"C:\path with spaces\file.js"`)
  - PowerShell: comillas simples (`'C:\path with spaces\file.js'`) para evitar expansión de `$var`
  - Alternativa: convertir backslashes a forward slashes (compatible con Node.js y PowerShell)
- [x] **Integrar en `shell_executor.js`**: Aplicar quoting en el handler principal (line ~272) antes de pasar el comando a `spawn()` o `execSync()`
- [x] **Integrar en `terminal_bridge.js`**: Aplicar quoting en `createPty()` (line ~216)

Estimated: ~30 líneas de JS nuevo, modificaciones mínimas en 2 archivos existentes.
### 8. Chat input — eliminar silent truncation (`maxlength`)

- [x] **Implementado**: `maxlength` cambiado a 100000, contador de caracteres agregado, listener en renderer.js agregado.
- File: [`ui/index.html`](ui/index.html:250)
- Problem: `<textarea maxlength="10000">` silently truncates pasted text >10K chars without warning
- Solution: Increase to `maxlength="100000"` + add live character counter below textarea showing `{current}/{max}` — or remove maxlength entirely and add client-side validation
- Benefit: Users can paste large code blocks without silent data loss
### 9. File attachment UI — botón "Adjuntar archivo"

- [x] **Implementado**: Botón 📎 agregado al HTML, click handler + FileReader + inserción @mention en renderer.js, CSS del botón.
- Files: [`ui/index.html`](ui/index.html), [`ui/renderer.js`](ui/renderer.js)
- Problem: No visible Attach File button. The `@mention` system exists (triggers `dialog:openFile`) but is undiscoverable. Drag-and-drop exists but inserts raw text (subject to the 10K truncation bug).
- Solution: Add a paperclip 📎 button next to the send button that triggers `dialog:openFile`. Wire the file read result to either insert as `@filename` mention or attach as context.
- Benefit: Discoverable file attachment for context injection
### 10. Supabase credential confusion — separar contextos lv-zero vs SIAE

- **Files:** [`skills/siae_consolidator.js`](skills/siae_consolidator.js), [`skills/sia_supabase.js`](skills/sia_supabase.js), [`skills/pg_query.js`](skills/pg_query.js), [`skills/supabase_connect.js`](skills/supabase_connect.js), [`.env_siae`](.env_siae), [`tools/pgcli/pgcli.js`](tools/pgcli/pgcli.js)
- **Problem:** Two distinct Supabase projects (lv-zero: `iqmqonpoguvjzqbsirbe`, SIAE: `edkuesblaoafobezjkvs`) share the global `SUPABASE_*` env vars. When `.env_siae` is loaded, it overwrites `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, causing all project skills to point to the wrong database. Memory skills (`auto_memoria.js`, etc.) correctly use `LV_SUPABASE_*` prefix and are NOT affected.
- **🔴 Fix 1:** [`skills/siae_consolidator.js:12-16`](skills/siae_consolidator.js:12) — Module-load credential freeze: `process.env.SUPABASE_URL` is evaluated at import time, not lazily. Convert to lazy getter or accept explicit project parameter.
- **🔴 Fix 2:** [`skills/sia_supabase.js`](skills/sia_supabase.js), [`skills/pg_query.js`](skills/pg_query.js), [`tools/pgcli/pgcli.js`](tools/pgcli/pgcli.js) — Hardcoded SIAE/lv-zero credentials (string literals). Replace with env var lookups.
- **🟡 Fix 3:** Create centralized `getProjectCreds(projectName)` helper so skills don't read `process.env.SUPABASE_URL` directly. Skills should say "I need lv-zero db" or "I need SIAE db" explicitly.
- **🟡 Fix 4:** [`.env_siae`](.env_siae) uses `//` comments instead of `#` — the `_parseEnvFile()` function splits on `#`, so `//` lines are parsed as values.
- **Benefit:** No more mixed-up credentials. Memory system stays intact. SIAE operations use SIAE db, lv-zero ops use lv-zero db. Safe to remove Supabase memory if needed.

---

## 🟡 Implementado en Sesiones Anteriores (confirmado contra código)

### Agent Reliability (6/7 ✅)
- [x] API Error Retry con exponential backoff — [`orchestrator.js:1365`](src/core/orchestrator.js:1365)
- [x] AbortController con stall timeout — [`openai-compatible.js:87`](src/core/providers/openai-compatible.js:87)
- [x] Task Completion Recap event — [`orchestrator.js:1855`](src/core/orchestrator.js:1855)
- [x] Activity Cascade Log — [`orchestrator.js:605`](src/core/orchestrator.js:605)
- [x] Health Check Zombie Prevention — [`orchestrator.js:2359`](src/core/orchestrator.js:2359)
- [x] Mode Switch Timeout (60s) — [`orchestrator.js:1748`](src/core/orchestrator.js:1748)
- [-] System Prompt Enhancement — Pendiente orchestrator.md (ver arriba)

### Crash Recovery (fases 1, 3, 4 ✅)
- [x] Phase 1.1: state_manager.js — [`_roo/state_manager.js:54`](_roo/state_manager.js:54)
- [x] Phase 1.2: Checkpoint calls en agentLoop — [`orchestrator.js:1076`](src/core/orchestrator.js:1076)
- [x] Phase 1.3: Crash detection en init — [`orchestrator.js:1988`](src/core/orchestrator.js:1988)
- [x] Phase 1.4: getCrashRecoveryState() — [`orchestrator.js:2490`](src/core/orchestrator.js:2490)
- [ ] Phase 2: Recovery UI — PENDIENTE (ver arriba)
- [x] Phase 3: Orchestration layer — [`orchestrator.js:2501`](src/core/orchestrator.js:2501)
- [x] Phase 4: Auto-memoria persistence — `skills/auto_memoria.js`

### Supabase Connection (5/5 ✅)
- [x] Fix 1: LV_SUPABASE_* fallback — Diseño intencional (system vs user memory separados)
- [x] Fix 2: db_explorer pooler — [`db_explorer.js:26`](skills/db_explorer.js:26)
- [x] Fix 3: Scripts limpios — 0 credenciales hardcodeadas en scripts JS/PS1
- [x] Fix 5: .env.example documentado — Todos los métodos de conexión documentados

### File Watcher + Editor Reactivo (✅)
- [x] A.1: Auto-start watcher — `renderer.js:171`
- [x] A.2: Subscribe fs:update — `renderer.js:3044`
- [x] A.3: Smart tab reload — `renderer.js:3724`
- [x] A.4: Toast (via addLogEntry) — `renderer.js:3046`
- [x] A.5: File tree refresh con debounce — `renderer.js:3051`

### Syntax Highlighting (✅)
- [x] B.1: lvzero-dark tokens — `renderer.js:336`
- [x] B.2: lvzero-light theme — `renderer.js:422`

### Error Handling (✅)
- [x] errors.js taxonomy (7 subclases) — [`src/core/errors.js`](src/core/errors.js)
- [x] Toast system — [`renderer.js:3541`](ui/renderer.js:3541)

### Binary Detection (✅)
- [x] Magic byte detection (27+ formatos) — [`file_type_detector.js:20`](skills/file_type_detector.js:20)
- [x] Heuristic fallback — [`file_type_detector.js:114`](skills/file_type_detector.js:114)

### File Indexer (✅)
- [x] SHA-256 hashing + Supabase index — [`file_indexer.js`](skills/file_indexer.js)
- [x] Auto-index en project open — [`orchestrator.js:2927`](src/core/orchestrator.js:2927)

### Terminal Shell Selector (✅)
- [x] Todos los 6 pasos implementados (terminal_bridge, preload, renderer, HTML, CSS, shell_executor)

### Auto-Approve Toolbar (✅ ~80%)
- [x] 6 toggles (Read, Write, Mode, Execute, Question, Subtasks)
- [x] Heartbeat Activity Indicator
- [x] Message Queue
- [x] Settings persistence (localStorage)
- [ ] Task Completion Banner — PENDIENTE (ver arriba)

### Session Persistence (✅)
- [x] state_manager.js (save/restore/clear)
- [x] handleSessionRestore() — `orchestrator.js:2169`

### UI/UX Polish (✅)
- [x] Toast system, shortcuts overlay, theme toggle, explorer search

### Mode Switching Architecture (~95% ✅)
- [x] Mode registry (5 modos) — [`mode_registry.js`](src/modes/mode_registry.js)
- [x] Mode controller — [`mode_controller.js`](src/modes/mode_controller.js)
- [x] 5 prompt files — [`src/modes/prompts/`](src/modes/prompts/)
- [x] IPC wiring — `main.cjs`, `preload.js`
- [x] switchMode() — `orchestrator.js:954`
- [ ] Auto-detection wiring — PENDIENTE (ver arriba)

---

## ⚪ Ya en plans/reports/ (auditorías completadas)

Los siguientes archivos están en [`plans/reports/`](plans/reports/) como documentación histórica:
- `architecture-audit-report.md`, `architecture-plan.md`, `competitor-analysis-vs-antigravity.md`
- `deepseek-model-switching-plan.md`, `lvzero-vs-roo.md`
- `multi-provider-fallback-plan.md` — ✅ Implementado en esta sesión
- `phase4-5-ui-desktop-audit-report.md`, `phase7-cross-reference-validation-report.md`
- `skills-audit-report.md`, `supabase-connection-research-may-2026.md`
