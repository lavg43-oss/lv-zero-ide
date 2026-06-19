---
name: awf-session-restore
description: |
  Silent context restoration via Symphony + NeuralMemory with strict project scoping.
  Gathers Git, Symphony, and Brain context silently — no console spam.
  Enforces Project ID → Brain Switch → Memory Read order to prevent cross-project contamination.
metadata:
  stage: core
  version: "7.1"
  replaces: "v7.0"
  requires: symphony-orchestrator
  tags: [session, restore, context, symphony, neuralmemory, silent, multi-project]
trigger: session_start
invocation-type: auto
priority: 2
---

<!-- ⚠️ INIT CHAIN CRITICAL — File này quyết định thứ tự context loading. Sai = rò rỉ cross-project memory. -->

# AWF Session Restore (v7.2 — Symphony Native + Trigger Index)

> **Purpose:** Silently gather unstructured context (Git, Plans, Memory) at session start.
> **Key Change v7.0:** Symphony-native. Strict brain scoping.
> **Output:** NO console block. Context injected silently for AI consumption.

---

## Trigger

Skill này **BẮT BUỘC** chạy khi:
- User mở session mới (đầu conversation)
- User gõ `/recap`
- AI detect context loss (conversation reset)

---

## Position in Init Chain

```
symphony-orchestrator  (Gate 0: Server health + project overview)
  ↓
awf-session-restore    ← BẠN ĐANG Ở ĐÂY (Gate 0.5: Silent context gather)
  ↓
nm-memory-sync         (Gate 1: Associative memory sync)
  ↓
symphony-enforcer      (Gate 2: Project → Brain → Task → Confirmation block)
```

> **Chỉ `symphony-enforcer` mới in ra console block cho user.**
> `awf-session-restore` chạy NGẦM, không in gì.

---

## ⛔ Strict Execution Order (MANDATORY)

> [!CAUTION]
> PHẢI tuân thủ thứ tự dưới đây. Vi phạm thứ tự = rò rỉ bộ nhớ đa dự án.
> TUYỆT ĐỐI KHÔNG gọi `nmem_context`, `nmem_recap`, hay bất kỳ MCP memory tool nào
> TRƯỚC KHI hoàn thành Step 1 và Step 2.

### Step 1: Fetch Project Identity (CHẠY ĐẦU TIÊN)

```bash
cat .project-identity 2>/dev/null || echo "NO_PROJECT"
```

**Nếu tìm thấy:** Extract `projectId` và `projectName` từ JSON.
**Cache Mindful Config:** Extract `mindfulCheckpoint` và `mindfulCheckpointConfig` (defaults: enabled=true, threshold=3, scopeGuard=true, milestoneRest=true).
**Nếu không:** Ghi nhận `raw mode` — các bước sau vẫn chạy nhưng không scope theo project. Mindful defaults vẫn ON.

### Step 2: Switch NeuralMemory Brain (CHẠY THỨ HAI)

> [!IMPORTANT]
> Step này PHẢI hoàn thành TRƯỚC KHI gọi bất kỳ `nmem_*` MCP tool nào.

Nếu Step 1 tìm thấy `projectId`:
```bash
# CLI command — ép NeuralMemory server đổi sang đúng brain
nmem brain use <projectId>
```

**Chờ xác nhận đổi brain thành công** rồi mới tiếp tục Step 3.

### Step 3: Gather Context (song song — tất cả silent)

Sau khi brain đã switch, thu thập 3 nguồn context **song song**:

#### 3a. Git/Code State
```bash
git status --short 2>/dev/null
git log -1 --oneline 2>/dev/null
```

#### 3b. Active Plans (scoped theo projectId)
```bash
# CHÚ Ý: Dùng projectId để scope đúng thư mục
ls -t brain/<projectId>/*/implementation_plan.md 2>/dev/null | head -1
```

Hoặc nếu dùng cấu trúc brain khác:
```bash
cat CODEBASE.md 2>/dev/null | head -5
```

#### 3d. Legacy Artifact Detection (v7.1)
```bash
# Detect stale JSON task files — Symphony uses SQLite only
test -f .symphony/tasks.json && echo "LEGACY_TASKS_JSON_FOUND" || echo "CLEAN"
```

Nếu phát hiện `LEGACY_TASKS_JSON_FOUND`:
→ Ghi vào silent context: `legacy_artifacts: ["tasks.json"]`
→ `symphony-enforcer` Step 0.5 sẽ warn user.

#### 3c. Symphony Task State
```bash
symphony task list -P <projectId> -s in_progress --json 2>/dev/null
```

Hoặc dùng MCP tool (sau khi brain đã switch):
```
symphony_available_tasks(filter="my")
```

#### 3e. Skill Trigger Index (v7.2 — Two-Tier Loading)
```
Read: ~/.gemini/antigravity/skills/TRIGGER_INDEX.md
→ Memorize trigger table (~150 tokens)
→ Load specific SKILL.md files ON DEMAND khi action matches trigger
→ KHÔNG load toàn bộ SKILL.md files upfront
```

### Step 4: Compose Silent Context

**KHÔNG in ra console.** Tổng hợp thành context object ngầm cho AI sử dụng nội bộ:

```json
{
  "project": {
    "id": "<projectId>",
    "name": "<projectName>",
    "codebase_loaded": true
  },
  "git": {
    "changed_files": ["file1.swift", "file2.swift"],
    "last_commit": "feat: add auth module"
  },
  "symphony": {
    "active_tasks": ["sym-XYZ"],
    "ready_tasks_count": 3
  },
  "brain": {
    "switched_to": "<projectId>",
    "active_plan": "plans/260316-auth/implementation_plan.md"
  },
  "mindful": {
    "enabled": true,
    "iteration_threshold": 3,
    "scope_guard": true,
    "milestone_rest": true
  }
}
```

AI dùng context này để:
- Hiểu user đang code dở gì
- Biết task nào đang in-progress
- Gợi ý tiếp tục đúng chỗ

---

## Error Handling

| Tình huống | Xử lý |
|-----------|--------|
| `.project-identity` không tồn tại | Raw mode — skip brain switch, vẫn thu thập Git + Symphony global |
| `nmem brain use` fail | Warning log — tiếp tục với Git + Symphony context |
| Symphony server down | Đã được `symphony-orchestrator` xử lý trước đó — nếu vẫn down thì skip |
| Git không phải repo | Skip git context — vẫn có Symphony + Brain |
| Tất cả fail | AI bắt đầu với clean state — không block workflow |

---

## What Changed from v6.4

| v6.4 (Old) | v7.0 (New) |
|------------|------------|
| CLI task list | `symphony task list` (Symphony MCP) |
| In block `🧠 SESSION RESTORED` | **Silent** — không in gì |
| Đọc `.project-identity` và `CODEBASE.md` | Chỉ đọc `.project-identity` (CODEBASE gate do orchestrator xử lý) |
| `brain/*` wildcard scan | `brain/<projectId>/` scoped access |
| Không switch brain trước khi đọc memory | **BẮT BUỘC** `nmem brain use` trước mọi memory read |
| Smart Suggestions block | Nhường cho `symphony next` |
| 3 sources: CLI + Brain + Git | 3 sources: Symphony + Brain + Git |

---

## Integration Notes

- **symphony-orchestrator** đã check server health → skill này KHÔNG cần check lại.
- **symphony-enforcer** sẽ in confirmation block → skill này KHÔNG in gì.
- **nm-memory-sync** chạy SAU skill này → brain đã switch đúng project.
- **orchestrator** sẽ dispatch workflow → skill này chỉ gather context.

---

## Configuration

User có thể customize trong `brain/preferences.json`:

```json
{
  "session_restore": {
    "auto_trigger": true,
    "sources": ["symphony", "brain", "git"]
  }
}
```

> **Removed:** `verbosity` option (no longer needed — always silent).
> **Removed:** Legacy CLI task source (replaced by Symphony MCP).
