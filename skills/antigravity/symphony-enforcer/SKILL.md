---
name: symphony-enforcer
description: |
  Mandatory Symphony checkpoint system. Ensures AI never forgets to create,
  update, or complete tasks in Symphony. Enforces progress reporting at every
  milestone and auto-detects task completion without waiting for user confirmation.
  v3.7: UI-First Three-Phase Execution with Auto Device Checkpoints (Maestro).
metadata:
  stage: core
  version: "3.7"
  replaces: "v3.6"
  requires: symphony-orchestrator
  tags: [symphony, enforcement, checkpoint, task-lifecycle, core, ui-first, maestro]
agent: Symphony Enforcer
trigger: always
invocation-type: auto
priority: 1
---

<!-- ⚠️ TASK INTEGRITY — Sửa file này PHẢI đọc lại GEMINI.md § Symphony rules. Không sửa format Sync Block. -->

# Symphony Enforcer v3.7 — Router

> **Purpose:** Đảm bảo AI KHÔNG BAO GIỜ quên cập nhật Symphony.
> **Principle:** AI tự detect completion — user KHÔNG CẦN nói "xong".

## ⚠️ Core Rule

```
KHÔNG CÓ NGOẠI LỆ:
- Mọi code/debug/plan task PHẢI qua STRICT STARTUP PROTOCOL
- Mọi milestone PHẢI report progress
- AI tự detect completion và auto-complete task
- Task done → PHẢI atomic git commit trước khi suggest next
- BỎ QUA BẤT KỲ STEP NÀO = VI PHẠM

GATE 3 VIOLATION (NẶNG):
- Tạo implementation plan mà KHÔNG tạo Symphony tickets = VI PHẠM NẶNG
- Dùng artifact task.md thay cho Symphony = VI PHẠM
  (task.md = IDE-level tracking, KHÔNG thay thế Symphony)
- Severity tương đương: code logic khi chưa confirm UI
```

## 📋 Topic Index — Load file theo nhu cầu

| Topic | Khi nào load | File |
|-------|-------------|------|
| Startup Protocol (6 steps) | Bắt đầu mọi task | `examples/startup-protocol.md` |
| Three-Phase Execution | Gate 4 với COMPLEX + UI tasks | `examples/three-phase.md` |
| Trigger Points (TP1, TP1.5, TP1.7) | Milestone, schema changes, checkpoints | `examples/trigger-points.md` |
| Task Completion (TP2-TP4) | Khi task sắp done | `examples/task-completion.md` |
| Mindful Stop (TP-ITER, TP-SCOPE, TP-REST) | Iteration counter, scope guard, milestone rest | `examples/mindful-stop.md` |

## Auto-Lifecycle: task_boundary ↔ Symphony

```
LIÊN KẾT TỰ ĐỘNG:
- task_boundary(PLANNING)  → symphony_create_task (nếu chưa có)
- task_boundary(EXECUTION) → symphony_report_progress(40%)
- task_boundary(VERIFICATION) → symphony_report_progress(80%)
- notify_user(BlockedOnUser=false) → TRIGGER TP2 (completion check)

THREE-PHASE MAPPING (Gate 4 — COMPLEX tasks với UI):
- Phase A done (build OK)     → report_progress(25%)
- Phase B done (UI mock)      → report_progress(45%) + TRIGGER TP1.7
- Phase C per-feature done    → report_progress(50-85%) + TRIGGER TP1.7
- Phase C all features done   → report_progress(90%) → Gate 5
```

## XML Task Spec trong Implementation Plans

```xml
<task type="auto">
  <name>Task name</name>
  <files>file1.swift, file2.swift</files>
  <spec_ref>REQUIREMENTS.md § R1</spec_ref>
  <depends_on>none</depends_on>
  <action>Specific instructions</action>
  <verify>How to verify completion</verify>
  <done>Expected final state</done>
</task>
```

Template đầy đủ: `~/.gemini/antigravity/templates/specs/task-spec-template.xml`

## Ngoại lệ

```
- Simple Q&A: Câu hỏi đơn giản, giải thích concept
- Quick lookup: Đọc file, search code, không sửa gì
- User nói rõ bỏ qua: "skip symphony", "không cần task"
```

## Sync Block Format

```
🎯 SYM #sym-XYZ — 40% → 70% "Implemented auth module"
```

Nếu completed:
```
✅ SYM #sym-XYZ — Done "Auth module with tests"
➡️ Next: #sym-A1 — Dashboard UI (P1)
```

## Edge Cases

| Tình huống | Xử lý |
|-----------|--------|
| Project chưa có .project-identity | ⛔ Dừng, tạo file trước |
| Project chưa có docs/specs/ | Skip Step 3, tiếp tục |
| Symphony server down | Start server, retry. Fail → warning + tiếp tục |
| User follow-up nhỏ sau task done | ≤2 file changes → không cần task mới |
| Nhiều task cùng lúc | Track task_id riêng, report đúng task |

## Learnings

- AI quên Symphony vì nó là "side task" — strict protocol biến nó thành MAIN flow
- Three-Phase WORKS vì AI CHỦ ĐỘNG announce
- User test sớm bắt lỗi sớm — code logic trên UI sai = double wasted
- Atomic commits giúp rollback chính xác — 1 task = 1 commit

---

*symphony-enforcer v3.7 — Modular Router Architecture*
