# lv-zero Electron UI — Complete Audit Report

**Date:** 2026-06-15  
**Auditor:** Automated analysis  
**Files audited:** `ui/index.html` (691 lines), `ui/renderer.js` (9432 lines), `ui/styles.css` (6069 lines), `src/preload.js` (550 lines), `src/main.cjs` (3209 lines)

---

## 1. HTML Structure Issues

### 1.1 Duplicate IDs (HIGH)

| # | Element ID | File:Line | Description | Fix |
|---|-----------|-----------|-------------|-----|
| 1 | `authOverlay`, `authInputKey`, `authBtnSave`, `authError` | [`ui/renderer.js:309-316`](ui/renderer.js:309) | `_cacheDom()` assigns these 4 elements **twice** (lines 309-312 and 313-316). Second assignment silently overwrites first. Copy-paste duplication. | Remove lines 313-316 (the duplicate block). |
| 2 | `editor-tab` (legacy) | [`ui/renderer.js:239`](ui/renderer.js:239) | `document.getElementById("editor-tab")` — this element does **not exist** in `index.html`. Always returns `null`. | Remove the cache reference or add the element. |

### 1.2 Missing HTML Elements Referenced by renderer.js (HIGH)

These DOM elements are accessed via `document.getElementById()` in renderer.js but **do not exist** in `index.html`:

| # | Element ID | renderer.js Lines | Impact | Fix |
|---|-----------|-------------------|--------|-----|
| 1 | `grill-me-overlay` | 449, 3267-3278 | **Grill Me wizard is completely broken.** `_cacheDom()` gets `null`. `_createGrillMeOverlay()` creates it dynamically, but cached refs are null until then. | Add Grill Me wizard HTML to `index.html` (similar to Diagnose wizard). |
| 2 | `btn-grill-me-close` | 450, 3271, 3303 | Same as above. | Part of Grill Me wizard fix. |
| 3 | `grill-me-step-indicator` | 451, 3272, 3304 | Same as above. | Part of Grill Me wizard fix. |
| 4 | `grill-me-body` | 452, 3273, 3305 | Same as above. | Part of Grill Me wizard fix. |
| 5 | `grill-me-footer` | 453, 3274, 3306 | Same as above. | Part of Grill Me wizard fix. |
| 6 | `btn-grill-me-prev` | 454, 3275, 3307 | Same as above. | Part of Grill Me wizard fix. |
| 7 | `btn-grill-me-next` | 455, 3276, 3308 | Same as above. | Part of Grill Me wizard fix. |
| 8 | `grill-me-progress` | 456, 3277, 3309 | Same as above. | Part of Grill Me wizard fix. |
| 9 | `wiz-input-name` | 3924, 4033, 4056 | Project Wizard step 0 inputs don't exist in HTML. Dynamically created but `_cacheDom()` won't find them. | Add wizard step fields to HTML or use dynamic creation with proper caching. |
| 10 | `wiz-input-path` | 3925, 4034 | Same as above. | Same fix. |
| 11 | `wiz-btn-browse` | 3926 | Same as above. | Same fix. |
| 12 | `wiz-input-tags` | 3996 | Same as above. | Same fix. |
| 13 | `wiz-chk-trello` | 4005 | Same as above. | Same fix. |
| 14 | `wiz-btn-create` | 4014, 4126 | Same as above. | Same fix. |
| 15 | `wizard-create-progress` | 4127 | Same as above. | Same fix. |
| 16 | `wizard-result` | 4128 | Same as above. | Same fix. |
| 17 | `wiz-btn-finish` | 4228 | Same as above. | Same fix. |
| 18 | `workflow-progress-subtitle` | 5976 | Referenced but doesn't exist in HTML. Code tries to update `textContent` — silently fails. | Add `<div id="workflow-progress-subtitle">` to HTML or remove reference. |

### 1.3 Missing ARIA Labels (LOW)

| # | Element | Line | Issue | Fix |
|---|---------|------|-------|-----|
| 1 | `#btn-view-menu` | [`ui/index.html:35`](ui/index.html:35) | Has `title` but no `aria-label`. | Add `aria-label="Toggle Panels"`. |
| 2 | `#btn-new-terminal` | [`ui/index.html:51`](ui/index.html:51) | No `aria-label`. | Add `aria-label="New Terminal"`. |
| 3 | `#btn-clear-conversation` | [`ui/index.html:52`](ui/index.html:52) | No `aria-label`. | Add `aria-label="Clear Conversation"`. |
| 4 | Multiple `.panel-btn` elements | Various | Many icon-only buttons lack `aria-label`. | Add descriptive `aria-label` to all icon-only buttons. |

---

## 2. Missing IPC Handlers

### 2.1 Channels Exposed in preload.js but NOT Handled in main.cjs (HIGH)

| # | Channel | preload.js Line | main.cjs Status | Fix |
|---|---------|----------------|-----------------|-----|
| 1 | `dialog:openFile` | [`src/preload.js:50`](src/preload.js:50) | **NOT FOUND** in main.cjs. Renderer calls it at line 7457. | Add `ipcMain.handle('dialog:openFile', ...)` in `setupIPC()`. |
| 2 | `session:status` | [`src/preload.js:37`](src/preload.js:37) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 3 | `session:plan` | [`src/preload.js:38`](src/preload.js:38) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 4 | `workflows:list` | [`src/preload.js:54`](src/preload.js:54) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 5 | `workflows:help` | [`src/preload.js:55`](src/preload.js:55) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 6 | `workflows:active` | [`src/preload.js:56`](src/preload.js:56) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 7 | `skill:runRepoMapper` | [`src/preload.js:93`](src/preload.js:93) | **NOT FOUND** in main.cjs. Renderer calls it at line 5135. | Add handler or remove from preload. |
| 8 | `skill:runCodeMapper` | [`src/preload.js:94`](src/preload.js:94) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 9 | `skill:runApplyDiff` | [`src/preload.js:95`](src/preload.js:95) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 10 | `crash:getState` | [`src/preload.js:167`](src/preload.js:167) | **NOT FOUND** in main.cjs. | Add handler or remove from preload. |
| 11 | `crash:recover` | [`src/preload.js:168`](src/preload.js:168) | **NOT FOUND** in main.cjs. Renderer calls it at line 8418. | Add handler or remove from preload. |
| 12 | `crash:dismiss` | [`src/preload.js:169`](src/preload.js:169) | **NOT FOUND** in main.cjs. Renderer calls it at line 8423. | Add handler or remove from preload. |
| 13 | `memory:store` through `memory:evolve` (14 channels) | [`src/preload.js:172-186`](src/preload.js:172) | Handled via `registerMemoryIPC()` — conditionally loaded. If memory module fails, **all 14 channels become dead**. | Add graceful fallback handlers. |
| 14 | `session:restore-full` through `session:list-tasks` (8 channels) | [`src/preload.js:189-196`](src/preload.js:189) | Handled via `registerSessionIPC()` — conditionally loaded. | Add fallback handlers. |
| 15 | `workflow:register-trigger` through `workflow:evaluate-event` (4 channels) | [`src/preload.js:199-202`](src/preload.js:199) | Handled via `registerWorkflowTriggerIPC()` — conditionally loaded. | Add fallback handlers. |
| 16 | `memory:audit` / `memory:audit-history` | [`src/preload.js:184-185`](src/preload.js:184) | Handled via `registerMemoryAuditIPC()` — conditionally loaded. | Add fallback handlers. |
| 17 | `memory:evolve` | [`src/preload.js:186`](src/preload.js:186) | Handled via `registerMemoryEvolutionIPC()` — conditionally loaded. | Add fallback handlers. |
| 18 | `mcp:connect` | [`src/preload.js:150`](src/preload.js:150) | **NOT FOUND** in main.cjs. | Add handler. |
| 19 | `mcp:disconnect` | [`src/preload.js:151`](src/preload.js:151) | **NOT FOUND** in main.cjs. | Add handler. |
| 20 | `mcp:reconnect` | [`src/preload.js:152`](src/preload.js:152) | **NOT FOUND** in main.cjs. Renderer calls it at line 1770. | Add handler. |
| 21 | `mcp:config` | [`src/preload.js:153`](src/preload.js:153) | **NOT FOUND** in main.cjs. | Add handler. |

### 2.2 Channels Called in renderer.js but NOT Exposed in preload.js (HIGH)

| # | Channel | renderer.js Line | preload.js Status | Fix |
|---|---------|-----------------|-------------------|-----|
| 1 | `diagnose:delete-session` | [`ui/renderer.js:2824`](ui/renderer.js:2824) | **NOT EXPOSED** in preload.js. Will throw runtime error when Diagnose wizard is dismissed. | Add `"diagnose:delete-session"` to preload.js and add handler in main.cjs. |

### 2.3 Channels Handled in main.cjs but NOT Exposed in preload.js (MEDIUM)

| # | Channel | main.cjs Line | preload.js Status | Fix |
|---|---------|--------------|-------------------|-----|
| 1 | `diff:create-review` | [`src/main.cjs:1010`](src/main.cjs:1010) | **NOT EXPOSED**. Renderer uses `file:acceptDiff` / `file:rejectDiff` instead. | Either expose or remove dead handlers. |
| 2 | `diff:get-review` | [`src/main.cjs:1015`](src/main.cjs:1015) | **NOT EXPOSED**. | Same as above. |
| 3 | `diff:apply-review` | [`src/main.cjs:1023`](src/main.cjs:1023) | **NOT EXPOSED**. | Same as above. |
| 4 | `diff:discard-review` | [`src/main.cjs:1034`](src/main.cjs:1034) | **NOT EXPOSED**. | Same as above. |
| 5 | `orchestrator:execute-workflow` | [`src/main.cjs:961`](src/main.cjs:961) | **NOT EXPOSED** (uses `ipcMain.on` not `ipcMain.handle`). | Expose via preload or remove. |
| 6 | `orchestrator:list-workflows` | [`src/main.cjs:984`](src/main.cjs:984) | **NOT EXPOSED**. | Same as above. |

---

## 3. UI/UX Issues

### 3.1 Broken Buttons / Missing Functionality (HIGH)

| # | Location | Issue | Expected Behavior | Fix |
|---|----------|-------|-------------------|-----|
| 1 | [`ui/index.html:64`](ui/index.html:64) | `btn-parent-folder` has inline `style="margin-left:4px;cursor:pointer"` — inconsistent with other buttons using CSS classes. | Consistent styling. | Move inline styles to CSS. |
| 2 | [`ui/renderer.js:449-456`](ui/renderer.js:449) | Grill Me wizard DOM elements cached in `_cacheDom()` but don't exist in HTML. `_createGrillMeOverlay()` creates them dynamically, but cached refs are `null` until then. | Grill Me wizard should work reliably. | Add Grill Me wizard HTML to `index.html`. |
| 3 | [`ui/renderer.js:2824`](ui/renderer.js:2824) | `diagnose:delete-session` called but not exposed in preload.js. Throws runtime error on wizard dismiss. | Session cleanup should work. | Add IPC channel to preload.js and main.cjs. |
| 4 | [`ui/renderer.js:5976`](ui/renderer.js:5976) | `workflow-progress-subtitle` element doesn't exist in HTML. Code silently fails. | Workflow progress subtitle should display. | Add `<div id="workflow-progress-subtitle">` to HTML. |
| 5 | [`ui/renderer.js:239`](ui/renderer.js:239) | `editorTab: document.getElementById("editor-tab")` — element doesn't exist. Always `null`. | Remove dead code. | Remove line 239. |

### 3.2 CSS Issues (MEDIUM)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| 1 | [`ui/styles.css:966`](ui/styles.css:966) | `.session-tab .session-close:hover` references `var(--danger-color)` which is **not defined** in `:root`. | Define `--danger-color: #e74c3c;` in `:root` or use `#e74c3c` directly. |
| 2 | [`ui/styles.css:1098`](ui/styles.css:1098) | `.auto-approve-bar` uses `var(--border-color, #333)` — `--border-color` is **not defined**. Correct variable is `--border-primary`. | Replace with `var(--border-primary)`. |
| 3 | [`ui/styles.css:1163`](ui/styles.css:1163) | `.task-status-bar` uses `var(--bg-status, #1a2a1a)` — `--bg-status` is **not defined**. | Define `--bg-status` or use `var(--bg-secondary)`. |
| 4 | [`ui/styles.css:1183`](ui/styles.css:1183) | `.queue-badge` uses `var(--accent-primary, #FF6B35)` — actual `--accent-primary` is `#007acc` (blue), not orange. Fallback mismatch. | Fix fallback to `#007acc` or remove fallback. |
| 5 | [`ui/styles.css:1149`](ui/styles.css:1149) | Same fallback mismatch for `accent-color`. | Fix fallback value. |

### 3.3 Icon/Emoji Rendering Issues (MEDIUM)

| # | Emoji | Unicode | Location | Win 10 | Win 11 | Fix |
|---|-------|---------|----------|--------|--------|-----|
| 1 | 🪲 | U+1FAB2 | [`ui/index.html:185`](ui/index.html:185) | ❌ | ✅ | **Will NOT render on Windows 10.** Replace with `🐛` or `🔍`. |
| 2 | 🗺️ | U+1F5FA U+FE0F | [`ui/index.html:66`](ui/index.html:66) | ⚠️ | ✅ | May render as box on Win 10 < 1803. |
| 3 | 🧹 | U+1F9F9 | [`ui/index.html:175`](ui/index.html:175) | ⚠️ | ✅ | Requires Win 10 1803+. |
| 4 | ⊞ | U+229E | [`ui/index.html:51`](ui/index.html:51) | ✅ | ✅ | Math symbol, not intuitive as terminal icon. Replace with `>` or SVG. |
| 5 | ⎇ | U+2387 | [`ui/index.html:93`](ui/index.html:93) | ⚠️ | ⚠️ | May not render. Replace with text "git". |
| 6 | Unicode icons in `_getFileIcon()` | Various | [`ui/renderer.js:1637-1658`](ui/renderer.js:1637) | ⚠️ | ⚠️ | Uses `\ue60b`, `\u03BB`, `\u267B`, `\u2261`, `\u2630`, `\u2699`, `\u2298` — may render as boxes. Use emoji or SVG instead. |

---

## 4. Dead Code

### 4.1 Unused CSS Classes

| # | CSS Class | File:Line | Reason |
|---|-----------|-----------|--------|
| 1 | `.editor-tab` | [`ui/styles.css:478-481`](ui/styles.css:478) | Never used. Tab system uses `.editor-tab-item`. |
| 2 | `.status-tooltip` | [`ui/styles.css:1886-1903`](ui/styles.css:1886) | Defined but never used in HTML or created dynamically. |
| 3 | `.stat-row`, `.stat-label`, `.stat-value` | [`ui/styles.css:1905-1920`](ui/styles.css:1905) | Part of unused `.status-tooltip`. |
| 4 | `.empty-state` | [`ui/styles.css:1922-1938`](ui/styles.css:1922) | Defined but never used. |

### 4.2 Unused DOM References in renderer.js

| # | Reference | Line | Reason |
|---|-----------|------|--------|
| 1 | `this.els.editorTab` | [`ui/renderer.js:239`](ui/renderer.js:239) | Element `#editor-tab` doesn't exist. Never used elsewhere. |
| 2 | `this.els.apiKeyManager` | [`ui/renderer.js:277`](ui/renderer.js:277) | Cached but never directly referenced. |

### 4.3 Dead Handlers in main.cjs

| # | Handler | Line | Reason |
|---|---------|------|--------|
| 1 | `diff:create-review` | [`src/main.cjs:1010`](src/main.cjs:1010) | Not exposed in preload.js. Renderer uses `file:acceptDiff` / `file:rejectDiff`. |
| 2 | `diff:get-review` | [`src/main.cjs:1015`](src/main.cjs:1015) | Same as above. |
| 3 | `diff:apply-review` | [`src/main.cjs:1023`](src/main.cjs:1023) | Same as above. |
| 4 | `diff:discard-review` | [`src/main.cjs:1034`](src/main.cjs:1034) | Same as above. |

### 4.4 Dead IPC Channels in preload.js

| # | Channel | Line | Reason |
|---|---------|------|--------|
| 1 | `session:status` | [`src/preload.js:37`](src/preload.js:37) | Never called in renderer.js. |
| 2 | `session:plan` | [`src/preload.js:38`](src/preload.js:38) | Never called in renderer.js. |
| 3 | `workflows:list` | [`src/preload.js:54`](src/preload.js:54) | Never called in renderer.js. |
| 4 | `workflows:help` | [`src/preload.js:55`](src/preload.js:55) | Never called in renderer.js. |
| 5 | `workflows:active` | [`src/preload.js:56`](src/preload.js:56) | Never called in renderer.js. |
| 6 | `skill:runCodeMapper` | [`src/preload.js:94`](src/preload.js:94) | Never called in renderer.js. |
| 7 | `skill:runApplyDiff` | [`src/preload.js:95`](src/preload.js:95) | Never called in renderer.js. |
| 8 | `mcp:config` | [`src/preload.js:153`](src/preload.js:153) | Never called in renderer.js. |
| 9 | `mcp:connect` | [`src/preload.js:150`](src/preload.js:150) | Never called in renderer.js. |
| 10 | `mcp:disconnect` | [`src/preload.js:151`](src/preload.js:151) | Never called in renderer.js. |

---

## 5. Missing Error Handling

### 5.1 IPC Handlers Missing try-catch in main.cjs

| # | Handler | Line | Severity |
|---|---------|------|----------|
| 1 | `project:current` | [`src/main.cjs:1895`](src/main.cjs:1895) | MEDIUM |
| 2 | `project:listRecent` | [`src/main.cjs:1909`](src/main.cjs:1909) | MEDIUM |
| 3 | `project:info` | [`src/main.cjs:1917`](src/main.cjs:1917) | MEDIUM |
| 4 | `mcp:getEnabled` | [`src/main.cjs:2151`](src/main.cjs:2151) | MEDIUM |
| 5 | `config:get` | [`src/main.cjs:2300`](src/main.cjs:2300) | MEDIUM |
| 6 | `skills:list` | [`src/main.cjs:2448`](src/main.cjs:2448) | MEDIUM |
| 7 | `timer:config` | [`src/main.cjs:2700`](src/main.cjs:2700) | MEDIUM |
| 8 | `timer:get-timeout` | [`src/main.cjs:2716`](src/main.cjs:2716) | MEDIUM |

### 5.2 DOM Operations Missing Null Checks in renderer.js

| # | Location | Line | Issue | Severity |
|---|----------|------|-------|----------|
| 1 | `_showDiffEditor` — `this.els.diffOverlay` | [`ui/renderer.js:921`](ui/renderer.js:921) | No null check before `classList.remove()`. If overlay is null, throws TypeError. | HIGH |
| 2 | `_hideDiffEditor` — `this.els.diffOverlay` | [`ui/renderer.js:998`](ui/renderer.js:998) | Same issue. | HIGH |
| 3 | `_toggleMCPForm` — multiple `this.els` | [`ui/renderer.js:1893-1912`](ui/renderer.js:1893) | Checks `if (!form) return` but then accesses other els without null checks. | MEDIUM |
| 4 | `_saveMCPConfig` — multiple `this.els` | [`ui/renderer.js:1940-2000`](ui/renderer.js:1940) | Inconsistent use of optional chaining `?.`. | MEDIUM |
| 5 | `_openMCPEnvConfig` — `this.els.mcpEnvStatus` | [`ui/renderer.js:2201`](ui/renderer.js:2201) | No null check before `textContent`. | MEDIUM |

### 5.3 console.log Statements in Production Code

| # | File | Line | Content |
|---|------|------|---------|
| 1 | [`ui/renderer.js:198`](ui/renderer.js:198) | `console.log("[IDE] File watcher started")` |
| 2 | [`ui/renderer.js:223`](ui/renderer.js:223) | `console.log("[IDE] Initialized successfully")` |
| 3 | [`ui/renderer.js:4375`](ui/renderer.js:4375) | `console.log(... restoring workspace state ...)` |
| 4 | [`ui/renderer.js:4565`](ui/renderer.js:4565) | `console.log("[IDE] highlight.js loaded")` |
| 5 | [`src/main.cjs`](src/main.cjs) | 45+ `console.log` statements (partially intentional — feeds file logger) |

---

## 6. Icon/Emoji Audit

| # | Emoji | Unicode | Location | Win 10 | Win 11 | Notes |
|---|-------|---------|----------|--------|--------|-------|
| 1 | ⏳ | U+23F3 | [`ui/index.html:25`](ui/index.html:25) | ✅ | ✅ | |
| 2 | ☰ | U+2630 | [`ui/index.html:35`](ui/index.html:35) | ✅ | ✅ | Hamburger menu |
| 3 | ✓ | U+2713 | [`ui/index.html:38`](ui/index.html:38) | ✅ | ✅ | |
| 4 | ⊞ | U+229E | [`ui/index.html:51`](ui/index.html:51) | ✅ | ✅ | Math symbol, not intuitive |
| 5 | 🗑 | U+1F5D1 | [`ui/index.html:52`](ui/index.html:52) | ✅ | ✅ | |
| 6 | 📁 | U+1F4C1 | [`ui/index.html:62`](ui/index.html:62) | ✅ | ✅ | |
| 7 | ⬆ | U+2B06 | [`ui/index.html:64`](ui/index.html:64) | ✅ | ✅ | |
| 8 | ↻ | U+21BB | [`ui/index.html:65`](ui/index.html:65) | ✅ | ✅ | |
| 9 | 🗺️ | U+1F5FA U+FE0F | [`ui/index.html:66`](ui/index.html:66) | ⚠️ | ✅ | May render as box on Win 10 < 1803 |
| 10 | 🔀 | U+1F500 | [`ui/index.html:85`](ui/index.html:85) | ✅ | ✅ | |
| 11 | 🤖 | U+1F916 | [`ui/index.html:88`](ui/index.html:88) | ✅ | ✅ | |
| 12 | ⎇ | U+2387 | [`ui/index.html:93`](ui/index.html:93) | ⚠️ | ⚠️ | May not render |
| 13 | 🌐 | U+1F310 | [`ui/index.html:110`](ui/index.html:110) | ✅ | ✅ | |
| 14 | ◀ | U+25C0 | [`ui/index.html:126`](ui/index.html:126) | ✅ | ✅ | |
| 15 | ▶ | U+25B6 | [`ui/index.html:127`](ui/index.html:127) | ✅ | ✅ | |
| 16 | ➤ | U+279E | [`ui/index.html:130`](ui/index.html:130) | ✅ | ✅ | |
| 17 | 🔗 | U+1F517 | [`ui/index.html:131`](ui/index.html:131) | ✅ | ✅ | |
| 18 | 🖼 | U+1F5BC | [`ui/index.html:132`](ui/index.html:132) | ✅ | ✅ | |
| 19 | 📋 | U+1F4CB | [`ui/index.html:133`](ui/index.html:133) | ✅ | ✅ | |
| 20 | ✕ | U+2715 | [`ui/index.html:134`](ui/index.html:134) | ✅ | ✅ | |
| 21 | ⬛ | U+2B1B | [`ui/index.html:156`](ui/index.html:156) | ✅ | ✅ | |
| 22 | ➕ | U+2795 | [`ui/index.html:174`](ui/index.html:174) | ✅ | ✅ | |
| 23 | 🧹 | U+1F9F9 | [`ui/index.html:175`](ui/index.html:175) | ⚠️ | ✅ | Requires Win 10 1803+ |
| 24 | ⚙ | U+2699 | [`ui/index.html:176`](ui/index.html:176) | ✅ | ✅ | |
| 25 | 🪲 | U+1FAB2 | [`ui/index.html:185`](ui/index.html:185) | ❌ | ✅ | **BROKEN on Win 10** — use 🐛 |
| 26 | 🏗️ | U+1F3D7 U+FE0F | [`ui/index.html:182`](ui/index.html:182) | ✅ | ✅ | |
| 27 | 💻 | U+1F4BB | [`ui/index.html:183`](ui/index.html:183) | ✅ | ✅ | |
| 28 | ❓ | U+2753 | [`ui/index.html:184`](ui/index.html:184) | ✅ | ✅ | |
| 29 | ⚡ | U+26A1 | [`ui/index.html:188`](ui/index.html:188) | ✅ | ✅ | |
| 30 | 🆓 | U+1F193 | [`ui/index.html:196`](ui/index.html:196) | ✅ | ✅ | |
| 31 | 🧠 | U+1F9E0 | [`ui/index.html:206`](ui/index.html:206) | ✅ | ✅ | |
| 32 | ⚠️ | U+26A0 U+FE0F | [`ui/index.html:231`](ui/index.html:231) | ✅ | ✅ | |
| 33 | ✅ | U+2705 | [`ui/index.html:287`](ui/index.html:287) | ✅ | ✅ | |
| 34 | 📎 | U+1F4CE | [`ui/index.html:314`](ui/index.html:314) | ✅ | ✅ | |
| 35 | ⏹ | U+23F9 | [`ui/index.html:316`](ui/index.html:316) | ✅ | ✅ | |
| 36 | 🔌 | U+1F50C | [`ui/index.html:357`](ui/index.html:357) | ✅ | ✅ | |
| 37 | 📦 | U+1F4E6 | [`ui/index.html:359`](ui/index.html:359) | ✅ | ✅ | |
| 38 | 🚀 | U+1F680 | [`ui/index.html:481`](ui/index.html:481) | ✅ | ✅ | |

---

## 7. Complete Fix Plan

### P0 — CRITICAL (Will cause crashes or broken functionality)

| # | File | Line(s) | What to Change | Why |
|---|------|---------|----------------|-----|
| 1 | [`ui/index.html`](ui/index.html) | After line 509 | Add Grill Me wizard HTML overlay (similar to Diagnose wizard at lines 494-509) with elements: `grill-me-overlay`, `btn-grill-me-close`, `grill-me-step-indicator`, `grill-me-body`, `grill-me-footer`, `btn-grill-me-prev`, `btn-grill-me-next`, `grill-me-progress`. | Grill Me wizard is completely broken — all 8 DOM elements don't exist. |
| 2 | [`src/preload.js`](src/preload.js) | After line 217 | Add `"diagnose:delete-session": (projectPath, sessionId) => ipcRenderer.invoke("diagnose:delete-session", projectPath, sessionId)` | Renderer calls this channel but it's not exposed. Causes runtime error. |
| 3 | [`src/main.cjs`](src/main.cjs) | After line 1728 | Add `ipcMain.handle("diagnose:delete-session", ...)` handler | Required for the channel exposed in fix #2. |
| 4 | [`ui/index.html`](ui/index.html) | After line 283 | Add `<div id="workflow-progress-subtitle" class="workflow-progress-stepname"></div>` | Renderer tries to update this element's textContent at line 5976. |
| 5 | [`ui/renderer.js`](ui/renderer.js) | 921 | Add null check: `if (!this.els.diffOverlay) return;` before `classList.remove("hidden")` | Prevents TypeError if overlay element is missing. |
| 6 | [`ui/renderer.js`](ui/renderer.js) | 998 | Add null check: `if (!this.els.diffOverlay) return;` before `classList.add("hidden")` | Same as above. |

### P1 — HIGH (Broken features, missing IPC handlers)

| # | File | Line(s) | What to Change | Why |
|---|------|---------|----------------|-----|
| 7 | [`src/main.cjs`](src/main.cjs) | In `setupIPC()` | Add `ipcMain.handle("dialog:openFile", wrapIPCHandler(...))` using `dialog.showOpenDialog()` | Channel exposed in preload.js but no handler. Renderer calls it at line 7457. |
| 8 | [`src/main.cjs`](src/main.cjs) | In `setupIPC()` | Add handlers for `crash:getState`, `crash:recover`, `crash:dismiss` | Exposed in preload.js, called by renderer, but no handlers. |
| 9 | [`src/main.cjs`](src/main.cjs) | In `setupIPC()` | Add handler for `skill:runRepoMapper` | Exposed in preload.js, called by renderer at line 5135. |
| 10 | [`src/main.cjs`](src/main.cjs) | In `setupIPC()` | Add handlers for `mcp:connect`, `mcp:disconnect`, `mcp:reconnect`, `mcp:config` | Exposed in preload.js, `mcp:reconnect` called by renderer at line 1770. |
| 11 | [`src/main.cjs`](src/main.cjs) | In `setupIPC()` | Add fallback handlers for all `memory:*`, `session:*`, `workflow:*` channels | Currently conditionally loaded — if modules fail, channels are dead. |
| 12 | [`ui/renderer.js`](ui/renderer.js) | 309-316 | Remove duplicate `authOverlay`, `authInputKey`, `authBtnSave`, `authError` assignments (lines 313-316) | Copy-paste duplication. |
| 13 | [`ui/renderer.js`](ui/renderer.js) | 239 | Remove `editorTab: document.getElementById("editor-tab")` — element doesn't exist | Dead code, always returns null. |
| 14 | [`ui/index.html`](ui/index.html) | 64 | Move inline `style="margin-left:4px;cursor:pointer"` to CSS class | Inconsistent styling. |

### P2 — MEDIUM (CSS issues, dead code, missing error handling)

| # | File | Line(s) | What to Change | Why |
|---|------|---------|----------------|-----|
| 15 | [`ui/styles.css`](ui/styles.css) | 966 | Replace `var(--danger-color)` with `#e74c3c` or define `--danger-color` in `:root` | Undefined CSS variable. |
| 16 | [`ui/styles.css`](ui/styles.css) | 1098 | Replace `var(--border-color, #333)` with `var(--border-primary)` | Wrong variable name. |
| 17 | [`ui/styles.css`](ui/styles.css) | 1163 | Replace `var(--bg-status, #1a2a1a)` with `var(--bg-secondary)` | Undefined CSS variable. |
| 18 | [`ui/styles.css`](ui/styles.css) | 1183, 1149 | Fix fallback values for `--accent-primary` from `#FF6B35` to `#007acc` | Fallback mismatch. |
| 19 | [`ui/index.html`](ui/index.html) | 185 | Replace 🪲 (U+1FAB2) with 🐛 (U+1F41B) | 🪲 doesn't render on Windows 10. |
| 20 | [`ui/index.html`](ui/index.html) | 51 | Replace ⊞ with a more intuitive terminal icon | Math symbol is confusing. |
| 21 | [`ui/index.html`](ui/index.html) | 93 | Replace ⎇ with text "git" or a Git icon | Obscure symbol may not render. |
| 22 | [`ui/renderer.js`](ui/renderer.js) | 1637-1658 | Replace Unicode icons in `_getFileIcon()` with emoji or SVG | Unicode symbols may render as boxes. |
| 23 | [`src/main.cjs`](src/main.cjs) | 1895, 1909, 1917, 2151, 2300, 2448, 2700, 2716 | Wrap handlers in try-catch or use `wrapIPCHandler()` | Prevent unhandled rejections. |
| 24 | [`ui/renderer.js`](ui/renderer.js) | 1893-1912 | Add null checks for all `this.els` accesses in `_toggleMCPForm()` | Prevent TypeError on missing elements. |
| 25 | [`ui/renderer.js`](ui/renderer.js) | 1940-2000 | Consistent use of optional chaining `?.` in `_saveMCPConfig()` | Prevent TypeError. |
| 26 | [`ui/renderer.js`](ui/renderer.js) | 2201 | Add null check before `this.els.mcpEnvStatus.textContent` | Prevent TypeError. |
| 27 | [`ui/styles.css`](ui/styles.css) | 478-481 | Remove unused `.editor-tab` class | Dead code. |
| 28 | [`ui/styles.css`](ui/styles.css) | 1886-1920 | Remove unused `.status-tooltip`, `.stat-row`, `.stat-label`, `.stat-value` | Dead code. |
| 29 | [`ui/styles.css`](ui/styles.css) | 1922-1938 | Remove unused `.empty-state` | Dead code. |
| 30 | [`src/preload.js`](src/preload.js) | 37-38, 54-56 | Remove dead channels: `session:status`, `session:plan`, `workflows:list`, `workflows:help`, `workflows:active` | Never called by renderer. |
| 31 | [`src/preload.js`](src/preload.js) | 93-95 | Remove dead channels: `skill:runCodeMapper`, `skill:runApplyDiff` | Never called by renderer. |
| 32 | [`src/preload.js`](src/preload.js) | 150-153 | Remove dead channels: `mcp:connect`, `mcp:disconnect`, `mcp:config` | Never called by renderer. |
| 33 | [`src/main.cjs`](src/main.cjs) | 1010-1037 | Remove dead `diff:*` handlers | Not exposed in preload.js, renderer uses `file:acceptDiff`/`file:rejectDiff`. |
| 34 | [`ui/index.html`](ui/index.html) | Various | Add `aria-label` attributes to all icon-only buttons | Accessibility improvement. |
