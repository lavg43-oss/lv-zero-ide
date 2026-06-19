---
name: gemini-conductor
description: >-
  Two-Agent Flow — The agent proactively invokes Gemini CLI (headless)
  for project-wide analysis, strategic planning, and second opinions.
  CLI runs on separate quota pool, extending AI capacity.
metadata:
  stage: core
  version: "1.0"
  requires: gemini (npm i -g @anthropic-ai/gemini-cli)
  tags: [conductor, cli, two-agent, strategy, analysis, delegation]
agent: Conductor
trigger: conditional
invocation-type: auto
priority: 5
---

<!-- ⚠️ READ-ONLY CLI — Gemini CLI KHÔNG ĐƯỢC sửa code. Chỉ .md files. Timeout 60s. -->

# 🎼 Gemini Conductor Skill

> **Purpose:** Antigravity tự gọi Gemini CLI qua terminal khi cần tầm nhìn rộng hơn scope IDE.
> **Key Benefit:** CLI dùng quota pool riêng → nhân đôi AI capacity. Giảm tunnel vision.

---

## ⚠️ Core Principle

```
Antigravity (IDE) = Executor — code, debug, file edits
Gemini CLI       = Conductor — analysis, strategy, review

Antigravity CHỦ ĐỘNG gọi CLI khi cần. User KHÔNG cần tự chuyển.
```

---

## 🎯 Trigger Conditions

Skill này kích hoạt khi Antigravity nhận diện task cần tầm nhìn rộng:

```yaml
auto_trigger:
  high_confidence:
    - Project-wide refactoring (>5 files affected)
    - Architecture analysis / design review
    - Cross-module dependency analysis
    - Strategic planning for feature spanning multiple areas
    - Need second opinion on complex technical decision

  medium_confidence (confirm before invoking):
    - Code review before commit (>3 files changed)
    - Test plan generation for new feature
    - Performance audit across codebase

  never_trigger:
    - Simple file edits (<3 files)
    - Bug fix in single module
    - UI changes in one screen
    - Questions user can answer directly
```

---

## 🔧 CLI Invocation Pattern

### Base Command

```bash
gemini -p "ONLY edit/create .md files. DO NOT modify any code. <PROMPT>" \
  --approval-mode auto \
  -o json \
  2>/dev/null
```

| Flag | Purpose |
|------|---------|
| `-p "..."` | Headless mode — MUST explicitly forbid editing source code. |
| `--approval-mode auto` | Allows CLI to execute file edits (only `.md`), bypassing prompts |
| `-o json` | Structured output for easy parsing |

### Safety Rules

```yaml
safety:
  - CLI CHỈ ĐƯỢC PHÉP tạo/sửa file tài liệu (`.md`). TUYỆT ĐỐI KHÔNG ĐƯỢC sửa code thực tế.
  - ALWAYS inject explicit file-editing restrictions into the `-p` prompt.
  - Timeout: 60s max per CLI call
  - If CLI fails → gracefully fallback to Antigravity-only mode
  - NEVER pass secrets/tokens in -p prompt
  - Working directory: ALWAYS set to project root
```

### Command Template

```bash
# Safe invocation with timeout
timeout 60 gemini -p "<prompt>. ONLY edit/create .md files. DO NOT touch source code." --approval-mode auto -o json 2>/dev/null
```

---

## 📋 Use Cases & Prompt Templates

### 1. Project Structure Analysis

```bash
gemini -p "Analyze the project structure in the current directory. \
List main modules, their responsibilities, and key dependencies. \
Output as structured JSON with modules array." \
--approval-mode plan -o json
```

**When:** Starting work on unfamiliar part of codebase, or after long gap.

### 2. Cross-Module Impact Analysis

```bash
gemini -p "I plan to modify <FILE_OR_MODULE>. \
Analyze which other files/modules depend on it and would be impacted. \
List files with risk level (high/medium/low)." \
--approval-mode plan -o json
```

**When:** Before refactoring that touches shared interfaces.

### 3. Strategic Refactoring Plan

```bash
gemini -p "Review the codebase and propose a refactoring strategy for <AREA>. \
Consider: current architecture, dependencies, risk, and migration path. \
Prioritize changes by impact and difficulty." \
--approval-mode plan -o json
```

**When:** Large-scale refactoring spanning multiple modules.

### 4. Second Opinion / Decision Support

```bash
gemini -p "Evaluate two approaches for <PROBLEM>: \
Approach A: <desc>. Approach B: <desc>. \
Compare: complexity, maintainability, performance, and risk. \
Recommend one with reasoning." \
--approval-mode plan -o json
```

**When:** Facing complex architectural decision.

### 5. Pre-Commit Code Review

```bash
gemini -p "Review the following code changes for potential issues: \
<DIFF_OR_DESCRIPTION>. \
Check for: bugs, security issues, performance problems, and best practices." \
--approval-mode plan -o json
```

**When:** Before committing changes across >3 files.

### 6. Test Strategy Generation

```bash
gemini -p "Generate a comprehensive test strategy for <FEATURE>. \
Include: unit tests, integration tests, edge cases, and test data. \
Consider existing test patterns in the project." \
--approval-mode plan -o json
```

**When:** Building new feature that needs thorough test coverage.

---

## 🔄 Integration Flow

```
1. Antigravity detects trigger condition
2. Build CLI prompt with relevant context
3. Run: run_command("timeout 60 gemini -p '...' --approval-mode plan -o json")
4. Parse CLI output (JSON or text)
5. Integrate insights into current task
6. Continue with code execution using enriched context
```

### Output Handling

```yaml
on_success:
  - Parse JSON output from CLI
  - Extract key insights, recommendations, file lists
  - Use them to guide next code edits
  - Optionally save analysis to conductor/tracks.md

on_timeout:
  - Log: "⏳ CLI analysis timed out, proceeding with local context"
  - Fall back to Antigravity-only analysis

on_error:
  - Log: "⚠️ CLI invocation failed, continuing without conductor"
  - Do NOT block the workflow — CLI is enhancement, not dependency
```

---

## 🚫 Anti-Patterns

```yaml
never_do:
  - Call CLI for simple single-file edits
  - Let CLI edit actual source code files (ONLY .md docs are allowed)
  - Pass sensitive data (API keys, tokens) in prompts
  - Block on CLI response indefinitely (always use timeout)
  - Call CLI more than 3 times per task (diminishing returns)
  - Ignore CLI output — if you called it, use the result

always_do:
  - Mention to user when invoking CLI: "📡 Đang gọi Gemini CLI phân tích..."
  - Include project-specific context in CLI prompt
  - Summarize CLI findings before acting on them
  - Fall back gracefully if CLI unavailable
```

---

## 🧩 Skill Relationships

```
Uses:      run_command (to invoke gemini CLI)
Enhances:  /plan, /code, /debug, /refactor workflows
Saves to:  conductor/tracks.md (optional)
Independent of: NeuralMemory (CLI has its own context)
```

---

*gemini-conductor v1.0 — Two-Agent Flow Skill for Antigravity*
