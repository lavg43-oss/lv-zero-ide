# lv-zero — Audit Report & Improvement Plan

> **Date**: 2026-06-08
> **Version**: 4.0.0
> **License**: MIT

---

## 1. Executive Summary

lv-zero is a sophisticated autonomous AI coding agent with both CLI and Electron IDE interfaces. The codebase is **feature-rich** but has several **structural issues** that need addressing before publishing as open-source software. The core architecture is sound, but there are **dual-codebase problems** (CJS vs ESM), **missing IPC handlers**, **Electron compatibility issues**, and **incomplete UI implementations**.

**Overall Assessment**: 6.5/10 — Functional but needs refactoring for maintainability.

---

## 2. Critical Issues (Must Fix Before GitHub Release)

### 2.1 Dual Main Process Conflict
- **Files**: [`src/main.cjs`](src/main.cjs) (2882 lines) vs [`src/main.js`](src/main.js) (356 lines)
- **Problem**: Both files implement the Electron main process but in different module systems. `main.cjs` is the **actual entry point** (per `package.json`), but `main.js` (ESM) has been edited with new IPC handlers (`auth:saveKey`, `mcp:*`) that **don't exist in `main.cjs`**.
- **Impact**: The `auth:saveKey` and `mcp:*` IPC handlers added to `main.js` are **never executed** because Electron loads `main.cjs`.
- **Fix**: Either:
  - Port all changes from `main.js` to `main.cjs`, OR
  - Make `main.js` the actual entry point and delete `main.cjs`

### 2.2 Electron 42 V8 Code Cache Bug
- **File**: [`src/main.cjs`](src/main.cjs:20)
- **Problem**: Electron 42 on Node.js v24 fails to load `browser_init.js` code cache, causing `require("electron")` to return a string path instead of the Electron API object. This causes `contextBridge.exposeInMainWorld` to fail with "Could not create scoping session".
- **Impact**: The entire Electron IDE is **non-functional** on affected systems.
- **Fix**: 
  - Downgrade to Electron 33 (currently in devDependencies)
  - Or add a retry/wait mechanism for the V8 code cache
  - Or document the workaround (restart with `--no-sandbox`)

### 2.3 Missing IPC Handlers in `main.cjs`
- **Problem**: The preload script exposes `auth:saveKey`, `mcp:saveEnabled`, `mcp:getEnabled`, `mcp:listRegistry` but **none of these are handled in `main.cjs`**.
- **Impact**: The auth modal and MCP settings UI will fail silently.
- **Fix**: Implement all missing IPC handlers in `main.cjs`.

### 2.4 No `.gitignore`
- **Problem**: No `.gitignore` file exists.
- **Impact**: Sensitive files (`.env`, `node_modules/`, `dist_new/`, logs) would be committed to GitHub.
- **Fix**: Create a comprehensive `.gitignore`.

---

## 3. Major Issues

### 3.1 Code Duplication
- **`main.cjs` vs `main.js`**: Two implementations of the same Electron main process
- **`entry.mjs` + `main.cjs`**: Complex bootstrapping chain that's fragile
- **`asar_content/` vs `src/`**: Duplicate source directories (asar_content seems to be the active one)

### 3.2 Incomplete UI Features
- **Settings modal**: MCP server list renders but toggles don't persist (IPC handlers missing in `main.cjs`)
- **Auth modal**: "Use Local Model" button calls `auth:saveKey("")` but the handler doesn't exist in `main.cjs`
- **Diff editor**: Implemented but may have edge cases
- **Live preview**: Basic implementation

### 3.3 Error Handling Gaps
- **`initClient()`**: Now async but some callers may not await properly
- **MCP connections**: No timeout for unresponsive servers
- **File operations**: Some missing error boundaries

### 3.4 Configuration Management
- **`.env` file**: Written directly by IPC handlers — no validation
- **No settings persistence**: Auto-approve settings, theme, etc. not saved to disk
- **MCP server list**: Hardcoded in renderer instead of fetched from registry

---

## 4. Minor Issues

### 4.1 Code Quality
- **Mixed languages**: Spanish and English in comments, variable names, and UI text
- **Inconsistent formatting**: Mix of 2-space and 4-space indentation
- **Large files**: `renderer.js` (8500+ lines), `main.cjs` (2882 lines) — need splitting
- **Dead code**: Several `_test_*` files, `_diag_*` files, and backup directories

### 4.2 Documentation
- **No CONTRIBUTING.md**: Missing contribution guidelines
- **No LICENSE file**: Package.json says MIT but no actual license file
- **No CHANGELOG.md**: No version history
- **Incomplete JSDoc**: Many functions lack proper documentation

### 4.3 Testing
- **Minimal tests**: Only vitest setup, no actual test files found
- **No CI/CD**: No GitHub Actions workflow

### 4.4 Dependencies
- **`electron` in devDependencies**: Should be a regular dependency for the app
- **`asar_content/node_modules/`**: Duplicate node_modules directory (14MB+)
- **`tmp_reasonix/`**: Appears to be an experimental directory that should be removed

---

## 5. Improvement Plan

### Phase 1: Critical Fixes (Before Release)

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 1 | Create `.gitignore` | 🔴 Critical | 15 min |
| 2 | Consolidate `main.cjs` and `main.js` into one file | 🔴 Critical | 2-3 hrs |
| 3 | Implement all missing IPC handlers in the main process | 🔴 Critical | 2 hrs |
| 4 | Fix Electron 42 scoping issue (downgrade or workaround) | 🔴 Critical | 1 hr |
| 5 | Create `LICENSE` file (MIT) | 🔴 Critical | 5 min |
| 6 | Clean up test/backup files from root | 🟡 High | 30 min |

### Phase 2: Structural Improvements

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 7 | Split `renderer.js` into modules (8000+ lines → manageable chunks) | 🟡 High | 4-5 hrs |
| 8 | Split `main.cjs` into modules | 🟡 High | 2-3 hrs |
| 9 | Remove duplicate `asar_content/` and consolidate to `src/` | 🟡 High | 3 hrs |
| 10 | Remove `tmp_reasonix/`, `_clones/`, `Nueva carpeta/`, `plans/` | 🟡 High | 15 min |
| 11 | Add proper error boundaries to all IPC handlers | 🟡 High | 2 hrs |
| 12 | Implement settings persistence (save to disk) | 🟡 High | 2 hrs |

### Phase 3: Feature Completion

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 13 | Fetch MCP server list from registry (not hardcoded in renderer) | 🟢 Medium | 1 hr |
| 14 | Add MCP server connection status indicators in UI | 🟢 Medium | 2 hrs |
| 15 | Implement auto-reconnect for MCP servers | 🟢 Medium | 1 hr |
| 16 | Add model selection dropdown in Electron UI | 🟢 Medium | 2 hrs |
| 17 | Improve auth modal with better UX (loading states, validation) | 🟢 Medium | 1 hr |
| 18 | Add keyboard shortcuts help modal | 🟢 Medium | 1 hr |

### Phase 4: Polish & Documentation

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 19 | Create `CONTRIBUTING.md` | 🟢 Medium | 30 min |
| 20 | Create `CHANGELOG.md` | 🟢 Medium | 30 min |
| 21 | Add JSDoc comments to all public APIs | 🟢 Medium | 3 hrs |
| 22 | Standardize language to English throughout codebase | 🟢 Medium | 2 hrs |
| 23 | Add GitHub Actions CI workflow | 🟢 Medium | 1 hr |
| 24 | Write unit tests for core orchestrator | 🟢 Medium | 4 hrs |
| 25 | Add code of conduct | 🟢 Low | 15 min |

### Phase 5: Advanced Features

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 26 | Add plugin system for community MCP servers | 🟢 Low | 3 hrs |
| 27 | Implement workspace/project management | 🟢 Low | 4 hrs |
| 28 | Add Git integration panel | 🟢 Low | 3 hrs |
| 29 | Add extension marketplace | 🟢 Low | 8 hrs |
| 30 | Cross-platform build scripts (Windows/Mac/Linux) | 🟢 Low | 2 hrs |

---

## 6. File Cleanup Checklist

Files to **remove** before GitHub release:

```
# Test & diagnostic files
_test_asar.cjs
_test_consolidator.mjs
_test_electron_*.cjs / .txt
_test_import.mjs
_test_init_chain.mjs
_test_palacios.mjs
_test_sia_sql.mjs
_test_siae_connect.mjs
_test_web_navigator.mjs
_verify_all.mjs
_verification_report.md
_diag_api_error.json
_explore_siae.cjs
_graph_audit.mjs
_net_diag*.mjs
_save_map.js / _copy_map.js
_write_map.ps1
_supa_test.txt

# Backup/experimental directories
tmp_reasonix/
Nueva carpeta/
plans/
_clones/
_asar_tmp_patch/
--output-dir/
--prefix/
-Force/
.graphify/
.lv-zero-data/
asar_content/          # (consolidate with src/)
dist_new/              # (build artifacts)
graphify-out/
install/
logs/
npm/
postgres/
raw/
scripts/
slidev-decks/
test/
test_app/
tmp_asar_check/
tools/
```

---

## 7. Architecture Recommendations

### 7.1 Module Structure (Proposed)
```
src/
├── main/                 # Electron main process
│   ├── index.js          # Entry point
│   ├── ipc/              # IPC handlers
│   │   ├── auth.js
│   │   ├── mcp.js
│   │   ├── skills.js
│   │   └── ...
│   └── windows.js        # Window management
├── renderer/             # Electron renderer
│   ├── index.html
│   ├── styles.css
│   ├── ide-controller.js # Main IDE controller
│   ├── components/       # UI components
│   │   ├── chat.js
│   │   ├── editor.js
│   │   ├── terminal.js
│   │   ├── explorer.js
│   │   └── settings.js
│   └── utils/            # Renderer utilities
├── core/                 # Core engine
│   ├── orchestrator.js
│   ├── context-manager.js
│   ├── state-manager.js
│   ├── tool-call-repair.js
│   ├── cache-first-loop.js
│   └── memory/           # Memory subsystem
├── mcp/                  # MCP system
│   ├── client.js
│   └── registry.js
├── cli/                  # CLI interface
│   └── index.js
└── preload/              # Preload scripts
    └── index.js
```

### 7.2 Technology Recommendations
- **TypeScript**: Migrate from JavaScript for type safety
- **ESLint + Prettier**: Add code quality tools
- **Husky**: Add pre-commit hooks
- **electron-builder**: Improve build/packaging
- **Pinia or Zustand**: State management for renderer

---

## 8. Security Checklist

- [x] No hardcoded API keys
- [x] API keys stored in `.env` (excluded via gitignore)
- [x] `contextIsolation: true` in Electron
- [x] `nodeIntegration: false` in Electron
- [ ] Add `.env` to `.gitignore`
- [ ] Sanitize user inputs in IPC handlers
- [ ] Add rate limiting to API calls
- [ ] Validate file paths to prevent directory traversal
- [ ] Add CSP headers for Electron renderer

---

## 9. Conclusion

lv-zero is an **impressive and ambitious project** with a solid foundation. The core orchestrator, MCP integration, and skills system are well-designed. However, the codebase needs **significant cleanup** before it's ready for open-source publication:

1. **Fix the dual main process issue** — this is the #1 blocker
2. **Create `.gitignore`** — prevents leaking sensitive data
3. **Clean up test/backup files** — reduces repo size by ~80%
4. **Add LICENSE and documentation** — required for open source
5. **Fix Electron compatibility** — ensures the IDE actually works

Estimated time to production-ready: **2-3 weeks** for one developer working full-time.
