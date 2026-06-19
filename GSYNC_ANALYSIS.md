# gstack Analysis for lv-zero

> Analysis of [gstack](https://github.com/garrytan/gstack) (v1.58.1.0) by Garry Tan (YC CEO) — MIT licensed.
> Cloned and analyzed on 2026-06-15.

---

## What gstack Is

gstack is **Garry's Stack** — an open-source "software factory" that turns Claude Code (and 9 other AI coding agents) into a virtual engineering team. It's a collection of **23+ opinionated workflow skills** (slash commands) and **8 power tools** that enforce a structured **Think → Plan → Build → Review → Test → Ship → Reflect** sprint cycle.

The core insight: **AI agents need process, not just prompts.** Without structure, agents produce chaotic, incomplete results. gstack provides the process — each skill is a specialist role (CEO, Eng Manager, Designer, QA Lead, Security Officer, Release Engineer) with a detailed Markdown prompt that tells the agent exactly how to think and act.

### Key Stats

- **Version:** 1.58.1.0
- **License:** MIT
- **Language:** TypeScript (Bun runtime), Markdown (skills)
- **Dependencies:** Playwright, Puppeteer, @huggingface/transformers, ngrok
- **Size:** 1,162 files across ~70 skill directories
- **Tests:** 100+ test files in browse/ alone

---

## Architecture

### High-Level Design

```
Claude Code                     gstack
─────────                      ──────
                               ┌──────────────────────┐
  Tool call: $B snapshot -i    │  CLI (compiled binary)│
  ─────────────────────────→   │  • reads state file   │
                               │  • POST /command      │
                               │    to localhost:PORT   │
                               └──────────┬───────────┘
                                          │ HTTP
                               ┌──────────▼───────────┐
                               │  Server (Bun.serve)   │
                               │  • dispatches command  │
                               │  • talks to Chromium   │
                               │  • returns plain text  │
                               └──────────┬───────────┘
                                          │ CDP
                               ┌──────────▼───────────┐
                               │  Chromium (headless)   │
                               │  • persistent tabs     │
                               │  • cookies carry over  │
                               │  • 30min idle timeout  │
                               └───────────────────────┘
```

### Key Architectural Decisions

1. **Daemon model for browser** — Long-lived Chromium daemon over localhost HTTP. First call ~3s, subsequent calls ~100-200ms. Persistent state (cookies, tabs, login sessions) across commands.

2. **Bun runtime** — Compiled binaries (~58MB) via `bun build --compile`. No node_modules at runtime. Native SQLite for cookie decryption. Native TypeScript execution. Built-in HTTP server (no Express/Fastify).

3. **Skills are Markdown** — Every skill is a `SKILL.md` file with YAML frontmatter (name, version, allowed-tools, triggers) and a detailed prompt body. Skills are auto-generated from `.tmpl` templates. This means **anyone can create a skill by writing Markdown**.

4. **Security-first** — Localhost-only binding, Bearer token auth, dual-listener tunnel architecture for remote agents, prompt injection defense (ML classifier + canary tokens + ensemble combiner), cookie security (in-memory decryption, never written to disk).

5. **Multi-agent support** — Works with Claude Code, OpenAI Codex CLI, OpenCode, Cursor, Factory Droid, Slate, Kiro, Hermes, GBrain. Cross-model second opinions via `/codex`.

### Skill Structure

Each skill directory contains:
- `SKILL.md` — The actual skill prompt (auto-generated from template)
- `SKILL.md.tmpl` — Template with frontmatter + preamble + body
- Optional: `bin/`, `src/`, `references/`, `templates/`, `specialists/` subdirectories

The SKILL.md frontmatter defines:
```yaml
---
name: review
preamble-tier: 4
version: 1.0.0
description: Pre-landing PR review. (gstack)
allowed-tools:
  - Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, WebSearch
triggers:
  - review this pr
  - code review
  - check my diff
  - pre-landing review
---
```

---

## Key Features

### Sprint Cycle Skills

| Skill | Role | What It Does |
|-------|------|-------------|
| `/office-hours` | YC Office Hours | Six forcing questions that reframe your product. Pushes back, challenges premises, generates alternatives. |
| `/plan-ceo-review` | CEO/Founder | Rethink the problem. Find the 10-star product. Four scope modes. |
| `/plan-eng-review` | Eng Manager | Lock architecture, data flow, diagrams, edge cases, tests. |
| `/plan-design-review` | Senior Designer | Rate design dimensions 0-10, explain what a 10 looks like. |
| `/review` | Staff Engineer | Find bugs that pass CI but blow up in production. Auto-fixes obvious ones. |
| `/qa` | QA Lead | Test app, find bugs, fix with atomic commits, re-verify, generate regression tests. |
| `/cso` | Chief Security Officer | OWASP Top 10 + STRIDE threat model. Zero-noise (8/10 confidence gate). |
| `/ship` | Release Engineer | Sync main, run tests, audit coverage, push, open PR. |
| `/document-release` | Technical Writer | Update all project docs to match what was shipped. |
| `/retro` | Eng Manager | Team-aware weekly retro with trends and growth opportunities. |

### Browser Power Tools

| Tool | What It Does |
|------|-------------|
| `/browse` | Real Chromium browser control via `$B` commands (snapshot, click, type, screenshot) |
| `/open-gstack-browser` | Launches GStack Browser with sidebar, anti-bot stealth, auto model routing |
| `/qa` | Opens real browser, clicks through flows, finds and fixes bugs |
| `/pair-agent` | Cross-agent browser sharing (Claude + OpenClaw + Codex in same browser) |
| `/setup-browser-cookies` | Import cookies from real Chrome/Brave/Edge into headless session |

### Safety & Quality

| Tool | What It Does |
|------|-------------|
| `/careful` | Warns before destructive commands (rm -rf, DROP TABLE, force-push) |
| `/freeze` | Restrict edits to one directory |
| `/guard` | `/careful` + `/freeze` combined |
| `/codex` | Second opinion from OpenAI Codex CLI (cross-model review) |
| `/benchmark` | Core Web Vitals, page load times, resource sizes |

### Memory & Knowledge

| Tool | What It Does |
|------|-------------|
| `/learn` | Manage cross-session learnings (patterns, pitfalls, preferences) |
| `/setup-gbrain` | Persistent knowledge base via gbrain (Supabase/PGLite) |
| `/sync-gbrain` | Re-index repo code into gbrain |
| `/context-save` / `/context-restore` | Save/resume working context across sessions |

---

## What We Can Use/Learn for lv-zero

lv-zero already has a sophisticated skill system (skills in `skills/` directory, mode system in `src/modes/`, workflows in `src/workflows/`). gstack offers several patterns and ideas we can adapt.

### 1. Skill-as-Markdown Pattern (HIGH)

**gstack approach:** Every skill is a `SKILL.md` with YAML frontmatter + Markdown body. Skills are auto-generated from `.tmpl` templates. The frontmatter declares allowed tools, trigger phrases, and version.

**lv-zero current state:** Skills are JavaScript files in `skills/` directory. They're powerful but require coding to create/modify.

**What to adopt:** Add a `SKILL.md` template system where skills can optionally be defined in Markdown with frontmatter. This would let non-developers create skills. The Markdown skills could be compiled/loaded by a skill loader.

**Implementation idea:**
```
skills/
  review/
    SKILL.md       # Markdown definition with frontmatter
    SKILL.md.tmpl   # Template for regeneration
    handlers/       # Optional JS handlers for complex logic
```

### 2. Structured Sprint Workflow (HIGH)

**gstack approach:** Think → Plan → Build → Review → Test → Ship → Reflect. Each skill feeds into the next. `/office-hours` writes a design doc that `/plan-ceo-review` reads. `/review` catches bugs that `/ship` verifies.

**lv-zero current state:** Has workflows in `src/workflows/` (lifecycle: code, debug, deploy, init, plan, review, run) but they're more about mode switching than a connected sprint pipeline.

**What to adopt:** Create a **connected sprint pipeline** where skills pass artifacts (design docs, test plans, review findings) to downstream skills. Implement a shared context/artifact store.

**Implementation idea:**
```
src/workflows/sprint/
  pipeline.js       # Orchestrates the sprint cycle
  artifact_store.js # Shared context between skills
  stages/
    think.md
    plan.md
    build.md
    review.md
    test.md
    ship.md
    reflect.md
```

### 3. Browser Automation Daemon (HIGH)

**gstack approach:** Long-lived Chromium daemon with sub-second commands. Persistent cookies, tabs, login sessions. ~100ms per command after first call.

**lv-zero current state:** No browser automation capability visible in the codebase.

**What to adopt:** Integrate Playwright-based browser automation as an MCP server or skill. This would enable:
- `/qa`-style automated testing of web UIs
- Screenshot/snapshot capabilities
- Form filling and interaction testing
- Cookie-based session management for authenticated testing

**Implementation idea:**
```
src/browser/
  daemon.js         # Long-lived Chromium process manager
  commands.js       # $B-style commands (snapshot, click, type, screenshot)
  security.js       # Token auth, localhost-only binding
  cookie-manager.js # Cookie import/export for sessions
```

### 4. Security Audit Skill (HIGH)

**gstack approach:** `/cso` runs OWASP Top 10 + STRIDE threat modeling with zero-noise filtering (8/10 confidence gate). Each finding includes a concrete exploit scenario.

**lv-zero current state:** Has `src/prompt_security.js` and `src/rate_limiter.js` for basic security, but no comprehensive security audit skill.

**What to adopt:** Create a `/cso`-inspired security audit skill that:
- Scans for secrets in the codebase
- Checks dependency vulnerabilities
- Runs OWASP Top 10 analysis
- Reviews MCP server security (tool permissions, data access)
- Generates a structured security report

### 5. QA Pipeline with Regression Tests (MEDIUM)

**gstack approach:** `/qa` opens a real browser, clicks through flows, finds bugs, fixes them with atomic commits, and auto-generates regression tests for every fix.

**lv-zero current state:** Has test files in `tests/` but no automated QA pipeline.

**What to adopt:** Create a QA skill that:
- Runs through defined test scenarios
- Captures screenshots at each step
- Reports failures with reproduction steps
- Generates regression tests for fixed bugs
- Produces a health score before/after

### 6. Cross-Model Second Opinion (MEDIUM)

**gstack approach:** `/codex` gets an independent review from OpenAI Codex CLI. Cross-model analysis shows which findings overlap and which are unique.

**lv-zero current state:** Has multiple provider support in `src/core/providers/` (deepseek, gemini, openai-compatible, mock) but no cross-model review capability.

**What to adopt:** Create a cross-model review skill that:
- Runs the same review through 2+ models
- Compares findings
- Highlights unique findings per model
- Generates a consolidated report

### 7. Document Generation Pipeline (MEDIUM)

**gstack approach:** `/document-release` reads every doc file, cross-references the diff, updates everything that drifted. `/document-generate` creates missing docs using Diataxis framework (reference/how-to/tutorial/explanation).

**lv-zero current state:** Has various `.md` files but no automated documentation pipeline.

**What to adopt:** Create a documentation skill that:
- Detects stale documentation
- Generates missing docs from code analysis
- Uses a structured framework (Diataxis or similar)
- Auto-updates README and key docs on significant changes

### 8. Skill Trigger System (MEDIUM)

**gstack approach:** Skills have `triggers` in frontmatter — natural language phrases that activate the skill. Proactive skill suggestions based on what stage the user is in.

**lv-zero current state:** Skills are invoked explicitly or via slash handler in `skills/slash_handler.js`.

**What to adopt:** Add trigger phrases to lv-zero skills so they can be activated by natural language. Implement proactive suggestion based on conversation context.

### 9. Builder Ethos / Philosophy Injection (MEDIUM)

**gstack approach:** `ETHOS.md` contains builder principles (Boil the Ocean, Search Before Building, User Sovereignty) that are injected into every workflow skill's preamble automatically.

**lv-zero current state:** Has `ROO_CONTEXT.md` and `CLAUDE.md` but no systematic philosophy injection into skills.

**What to adopt:** Create an `ETHOS.md` for lv-zero with core principles, and inject relevant sections into skill prompts automatically.

### 10. Checkpoint / Context Persistence (LOW)

**gstack approach:** Continuous checkpoint mode auto-commits work with structured context. `/context-restore` reconstructs session state from commits.

**lv-zero current state:** Has `_roo/` directory with session checkpoints, but no structured context persistence across sessions.

**What to adopt:** Enhance the checkpoint system to include structured metadata (decisions made, remaining work, failed approaches) and a restore command.

### 11. Design Review Pipeline (LOW)

**gstack approach:** `/design-shotgun` generates 4-6 mockup variants, opens comparison board, collects feedback, iterates. `/design-html` turns mockups into production HTML.

**lv-zero current state:** No design review capabilities.

**What to adopt:** Create a design review skill that evaluates UI consistency, accessibility, and visual quality. Could integrate with the existing `ui/` directory.

### 12. Telemetry & Analytics (LOW)

**gstack approach:** Opt-in telemetry with local analytics dashboard. Tracks skill usage, duration, success/fail. Schema in `supabase/migrations/`.

**lv-zero current state:** No telemetry system.

**What to adopt:** Add opt-in anonymous usage tracking for skills to understand which features are most valuable and where improvements are needed.

---

## Priority Matrix

| # | Idea | Priority | Effort | Impact | Dependencies |
|---|------|----------|--------|--------|-------------|
| 1 | Skill-as-Markdown Pattern | **HIGH** | Medium | High | Skill loader system |
| 2 | Structured Sprint Workflow | **HIGH** | Medium | High | Workflow system |
| 3 | Browser Automation Daemon | **HIGH** | High | Very High | Playwright, MCP server |
| 4 | Security Audit Skill | **HIGH** | Medium | High | Prompt security, dependency scanner |
| 5 | QA Pipeline | **MEDIUM** | High | High | Browser daemon |
| 6 | Cross-Model Second Opinion | **MEDIUM** | Medium | Medium | Multi-provider support |
| 7 | Document Generation Pipeline | **MEDIUM** | Medium | Medium | Code analysis |
| 8 | Skill Trigger System | **MEDIUM** | Low | Medium | Slash handler |
| 9 | Philosophy Injection | **MEDIUM** | Low | Medium | Skill preamble system |
| 10 | Checkpoint Persistence | **LOW** | Medium | Low | State manager |
| 11 | Design Review Pipeline | **LOW** | High | Medium | Browser daemon |
| 12 | Telemetry & Analytics | **LOW** | Medium | Low | Analytics infra |

---

## Key Differences Between gstack and lv-zero

| Dimension | gstack | lv-zero |
|-----------|--------|---------|
| **Target Agent** | Claude Code (primary) + 9 others | Roo/Claude Code (custom modes) |
| **Skill Format** | Markdown (SKILL.md) | JavaScript (skills/*.js) |
| **Runtime** | Bun (compiled binaries) | Node.js (Electron app) |
| **Browser** | Built-in Chromium daemon | None |
| **Architecture** | CLI + HTTP daemon | Electron + MCP servers |
| **Sprint Model** | Explicit (Think→Plan→Build→Review→Test→Ship→Reflect) | Implicit (modes + workflows) |
| **Security** | ML-based prompt injection defense | Basic prompt security + rate limiting |
| **Memory** | gbrain (Supabase/PGLite) | Session checkpoints |
| **Multi-Agent** | Cross-model reviews, pair-agent | Single agent orchestrator |
| **License** | MIT | MIT |

---

## What lv-zero Does Better

1. **Custom modes system** — lv-zero's mode system (`src/modes/`) with dedicated prompts for architect, code, debug, ask, orchestrator is more sophisticated than gstack's flat skill list.

2. **MCP server integration** — lv-zero has a robust MCP client/server architecture (`src/mcp_client.js`, `src/mcp_server.js`, `src/mcp_registry.js`) that gstack doesn't have.

3. **Electron app** — lv-zero runs as a desktop application with UI (`ui/`), preload scripts, and native OS integration.

4. **Provider abstraction** — lv-zero's provider system (`src/core/providers/`) supports multiple LLM backends with a clean abstraction layer.

5. **Secret storage** — lv-zero has `src/secret_storage.js` for secure credential management.

---

## Recommended Next Steps

1. **Immediate (this week):** Implement the **Skill-as-Markdown Pattern** — add SKILL.md template support to lv-zero's skill system. This is low-hanging fruit that enables all other improvements.

2. **Short-term (next sprint):** Build the **Browser Automation Daemon** using Playwright. This unlocks QA, design review, and testing capabilities. Create a `/qa`-inspired skill.

3. **Medium-term:** Implement the **Structured Sprint Workflow** — connect skills into a pipeline with artifact passing between stages.

4. **Ongoing:** Port the most valuable gstack skills (`/review`, `/cso`, `/document-release`) to lv-zero's format, adapting them to lv-zero's architecture.

---

## License Compatibility

gstack is **MIT licensed** (Copyright 2026 Garry Tan). lv-zero is also **MIT licensed**. Full compatibility — we can use, modify, and integrate gstack code and patterns without restriction.
