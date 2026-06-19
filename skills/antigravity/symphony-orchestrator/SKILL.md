---
name: symphony-orchestrator
description: |
  Symphony setup, health check, and auto-start skill. Ensures Symphony server
  is running before any task management. Handles installation, global CLI setup,
  project registration, and server lifecycle management.
metadata:
  stage: core
  version: "3.0"
  replaces: null
  requires: "@leejungkiin/awkit-symphony (npm i -g @leejungkiin/awkit-symphony)"
  tags: [symphony, setup, server, orchestration, core, preflight, multi-project, agent]
agent: Symphony Conductor
allowed-tools:
  - run_command
  - read_url_content
  - view_file
trigger: always
invocation-type: auto
priority: 0
---

<!-- ⚠️ GATE 0 — Preflight checklist PHẢI hiển thị. Bỏ qua = VI PHẠM. DB centralized = cross-project. -->

# Symphony Orchestrator Skill — Multi-Project & Agent Orchestration

> **Purpose:** Đảm bảo Symphony server luôn sẵn sàng cho mọi session.
> **Key Feature:** Single preflight call thay thế 4+ API calls.
> **Gate Enforcement:** User PHẢI thấy checklist block, nếu không = vi phạm.

---

## ⚠️ Core Principle: Multi-Project First

```
QUAN TRỌNG:
- Symphony quản lý tasks từ NHIỀU project cùng lúc
- "Active project" trên UI CHỈ ảnh hưởng hiển thị dashboard
- "Active project" KHÔNG filter queries API/CLI
- CLI/API mặc định trả về TẤT CẢ tasks, dùng --project/-P để filter
- AI agents làm việc cross-project — không bị giới hạn bởi active project
```

**Database:** Centralized tại `~/.gemini/antigravity/symphony/symphony.db`
- CLI (`core/db.js`) và API (`lib/core.mjs`) dùng CHUNG 1 database
- Tất cả tasks từ mọi project nằm trong 1 DB duy nhất

---

## Installation (One-Time Setup)

### Bước 1: Install Global

```bash
npm i -g @leejungkiin/awkit-symphony
```

> Dev mode (từ source):
> ```bash
> cd ~/Dev/NodeJS/main-awf/symphony && npm link
> ```

### Bước 2: Verify

```bash
symphony --version   # Expected: 1.5.0+
symphony --help      # Shows: preflight, task, agent, dispatch, next, etc.
```

### Bước 3: Build + Start

```bash
symphony build          # Production build (~5-10s)
symphony start -p 3100  # Start server
```

### Troubleshooting

| Lỗi | Giải pháp |
|------|-----------|
| `command not found: symphony` | `source ~/.nvm/nvm.sh && nvm use default` |
| `better-sqlite3 architecture mismatch` | `npm rebuild better-sqlite3` |
| `EADDRINUSE port 3100` | Đã có instance → dùng port khác: `-p 3101` |
| `.next/ not found` | Chạy `symphony build` thủ công |

---

## 🚦 Preflight Gate Protocol (Gate 0) — BẮT BUỘC

Mỗi session, AI PHẢI thực hiện **1 call duy nhất**:

### Via API (khi server đang chạy):

```bash
curl -s http://localhost:3100/api/preflight
```

### Via CLI:

```bash
symphony preflight          # Pretty output
symphony preflight --json   # JSON cho AI parsing
```

### Checklist Output (AI PHẢI hiển thị):

```
🚦 SYMPHONY PREFLIGHT
──────────────────────────────────────────────────
   Server:  ✅ PASS
   Project: ✅ PASS — 🧘 Giác Ngộ
   Tasks:   🔵 HAS_ACTIVE
   Overall: ✅ PASS

📿 In Progress: #sym-X1Y2 — Theme System (P1)
📋 Ready: #sym-A3B4 — Dark Mode (P2)
```

> ⚠️ **Nếu không hiển thị checklist block này = VI PHẠM GATE**

---

## Auto-Start Protocol

```
1. curl -s http://localhost:3100/api/preflight
2. Nếu FAIL (connection refused):
   → symphony start -p 3100 &
   → Đợi 3-5 giây
   → Retry preflight
3. Nếu vẫn FAIL (command not found):
   → AI tự chạy: npm i -g @leejungkiin/awkit-symphony
   → Retry symphony start
4. Nếu vẫn FAIL:
   → "⚠️ Symphony không khởi động được"
   → Hướng dẫn user cài thủ công
```

---

## CLI Commands — Full Reference

### Task Management

```bash
# Listing (cross-project by default)
symphony task list                   # ALL tasks, mọi project
symphony task list -P giacngo        # Chỉ project giacngo
symphony task list -s ready          # Filter by status
symphony task list -P awkit -s done  # Combine filters

# CRUD
symphony task create "title"         # Create task
symphony task show <id>              # Show details

# Lifecycle
symphony task claim <id>             # ready → claimed
symphony task start <id>             # → in_progress (auto-claim)
symphony task done <id> -m "summary" # → done (auto-claim nếu cần)
symphony task approve <id>           # draft → ready
symphony task reopen <id>            # done → ready
symphony task abandon <id>           # → ready (reset agent)
symphony task delete <id>            # Xóa (draft/ready only)
symphony task update <id>            # Sửa title/priority/desc
```

### Agent Management & AI Orchestration

```bash
# Agents
symphony agent list                         # Tất cả agents + status
symphony agent register <id> -n "name" -s "code,debug"  # Đăng ký
symphony agent show <id>                    # Chi tiết
symphony agent update <id> -s "new,specs"   # Sửa profile
symphony agent remove <id>                  # Xóa (idle only)
symphony agent assign <agent-id> <task-id>  # Gán task → agent
symphony agent idle <id>                    # Mark idle

# Orchestration Shortcuts
symphony dispatch <task-id>              # 🎯 Auto-pick idle agent phù hợp
symphony dispatch <task-id> -a <agent>   # 🎯 Dispatch cho agent chỉ định
symphony next                            # 📋 Gợi ý task tiếp theo
symphony next -n 5                       # 📋 Top 5 suggestions
```

### Server & System

```bash
symphony status                # Full system status
symphony preflight             # Gate check (BẮT BUỘC)
symphony start [-p PORT]       # Production mode
symphony dev [-p PORT]         # Dev mode
symphony build                 # Build dashboard
symphony dashboard             # Open browser
```

---

## Multi-Project Workflow

### Scenario: AI làm việc trên 2 project cùng lúc

```bash
# 1. Xem tất cả tasks cross-project
symphony task list
# → Hiển thị tasks từ cả giacngo, awkit, filmcam...

# 2. Filter khi cần focus 1 project
symphony task list -P giacngo -s ready

# 3. Claim task từ project bất kỳ
symphony task start sym-W0jcDtRo       # giacngo task
symphony task start sym-VKTqZkyF       # awkit task — vẫn hoạt động

# 4. Complete không cần switch project
symphony task done sym-W0jcDtRo -m "Theme system done"

# 5. Dispatch task cho agent cụ thể
symphony dispatch sym-A3B4 -a agent-frontend
```

### AI Agent Orchestration Flow

```
1. AI registers as agent:
   symphony agent register antigravity-main -n "Antigravity" -s "code,debug,plan"

2. AI picks next task from ANY project:
   symphony next
   → Shows ready tasks across all projects with project column

3. AI claims and starts:
   symphony task start <task-id>

4. AI completes:
   symphony task done <task-id> -m "summary"

5. AI checks next:
   symphony next
```

### Concurrency Control

```bash
# Max 3 working agents (symphony.config.js → maxAgents: 3)
# Dispatch will fail if all slots occupied:
#   "❌ No available agent slots"
# → Free a slot: symphony agent idle <agent-id>
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | **`/api/preflight`** | **🚦 Single-call gate check (BẮT BUỘC)** |
| GET | `/api/status` | Full system status |
| GET | `/api/tasks` | List tasks (?status=, ?project=) |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks` | Actions: claim, complete, abandon, approve, reopen |
| DELETE | `/api/tasks?id=` | Delete task |
| GET | `/api/projects` | List projects (?stats=true) |
| POST | `/api/projects` | Register project |
| PATCH | `/api/projects` | Activate project (UI only) |
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Register agent |
| PATCH | `/api/agents` | Update profile / assign task |
| DELETE | `/api/agents` | Remove agent |

---

## Integration with GEMINI.md Gates

| Gate | Protocol |
|------|----------|
| **Gate 0** | `curl /api/preflight` → checklist block → NeuralMemory warm-up |
| Gate 0.5 | Check `preflight.projects` → auto-register if missing → switch brain |
| Gate 1 | `symphony task list -s in_progress` → claim/create task (cross-project) |
| Gate 2 | `symphony task done <id> -m "..."` → `symphony next` → suggest |
| Gate 3 | `symphony task list -s in_progress` → block deploy if any |

---

## Database Location

```
~/.gemini/antigravity/symphony/symphony.db  # Centralized (all projects share 1 DB)
```

> ⚠️ CLI và API dùng CHUNG database này.
> Active project selection trên dashboard KHÔNG ảnh hưởng queries.

---

## Learnings

- `npm link` requires NVM PATH — user may need `source ~/.nvm/nvm.sh`
- `better-sqlite3` is native module — may need `npm rebuild` after arch changes
- Production server ~170ms vs ~3s for dev — always prefer `symphony start`
- Preflight replaces 4+ API calls with 1 — much harder for AI to skip
- Preflight checklist block acts as visual enforcement — user sees immediately if skipped
- Active project is UI-only — NEVER use it to scope CLI/API queries
- CLI and API share centralized DB at `~/.gemini/antigravity/symphony/symphony.db`
- Multi-project work is default — tasks from all projects visible simultaneously
