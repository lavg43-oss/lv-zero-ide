---
name: spec-gate
description: >-
  Gate 2 — Architecture & Data Design Gate. Chốt thiết kế kỹ thuật (DB Schema,
  API Contract, State Machine) TRƯỚC KHI cho phép code. Bắt buộc user approve
  thiết kế để tránh "vừa làm vừa sửa database". Auto-triggered bởi orchestrator
  khi Gate 2 chưa thỏa mãn. Hỗ trợ auto-detect .kiro/specs/design.md.
metadata:
  stage: core
  version: "1.2"
  tags: [gate, architecture, database, design, spec-first, core, kiro]
  requires: orchestrator
agent: Architect
trigger: conditional
invocation-type: auto
priority: 2
activation_keywords:
  - "thiết kế database"
  - "schema design"
  - "data model"
  - "API design"
---

<!-- ⚠️ GATE 2 — User PHẢI approve design. AI KHÔNG được tự approve. Đọc GEMINI.md § 7-Gate trước khi sửa. -->

# Spec Gate v1.2 — Architecture & Data Design Gate (Router)

> **Purpose:** Chốt thiết kế kỹ thuật (DB Schema, API Contract, State Machine)
> TRƯỚC KHI code. Đảm bảo persistence changes đã được suy nghĩ kỹ + user approved.

## ⚠️ SCOPE

| LÀM | KHÔNG làm |
|-----|-----------|
| Data Model (tables, fields, indexes) | Viết code |
| API Contract (endpoints, req/res) | Tạo BRIEF/spec (brainstorm-agent) |
| State Machine diagram | Track tasks (symphony-enforcer) |
| Self-review checklist + user approve | Deploy, sửa lỗi |

## 📋 Topic Index

| Topic | Khi nào load | File |
|-------|-------------|------|
| Design templates (Data/API/State Machine) + Review checklist | Khi tạo design doc | `templates/design-templates.md` |

## 🚀 ACTIVATION

- **Orchestrator auto-trigger:** Gate 2 check FAIL
- **Commands:** `/architect`, `/design-db`
- **Keywords:** "thiết kế database", "schema design", "data model"

## 📋 INPUT

```
REQUIRED (priority order):
  1. .kiro/specs/<module>/design.md → AUTO-APPROVE (skip Phase 2-7)
  2. BRIEF.md hoặc docs/specs/<feature>.md (Gate 1 output)
  3. .project-identity (projectId, techStack)

OPTIONAL: TECH-SPEC.md, existing DB schema, NeuralMemory context
```

## 🔄 PROCESS (8 Phases)

### Phase 1: Context Gathering (Silent)
- **Kiro check first** → .kiro/specs/design.md → AUTO-PASS Gate 2
- Fallback: Read BRIEF.md → extract entities, relationships, rules
- Read .project-identity, TECH-SPEC.md, NeuralMemory

### Phase 2: Data Model Design
- Per entity: Fields, Indexes, Relationships, Constraints
- Template → `templates/design-templates.md`

### Phase 3: API Contract (nếu có API)
- Per endpoint: Method, Auth, Request, Response, Notes

### Phase 4: State Machine (nếu có stateful flows)
- States, transitions, triggers, guards

### Phase 5: Self-Review Checklist
- Data integrity, performance, consistency, edge cases, security
- Full checklist → `templates/design-templates.md`

### Phase 6: Multi-Role Architecture Review (AI Simulated)
- 5 roles: DBA, Backend Lead, Security, QA, SRE
- P0/P1 issues → fix draft before presenting

### Phase 7: Present & Approval
- Show design doc → user review → approve

### Phase 8: Write Design Doc
- Save to `docs/architecture/<feature>_design.md`
- Approval marker + NeuralMemory tag → proceed Gate 3

## 🔙 DESIGN DEVIATION PROTOCOL

Khi đang code (Gate 4) và cần sửa schema khác approved:
1. ⛔ DỪNG CODE
2. Thông báo user → update design doc → re-approve
3. Update marker: "Revision 2" → tiếp tục code

## 🚫 Anti-Patterns

```yaml
never_do:
  - Tự approve design (user PHẢI approve)
  - Skip self-review checklist
  - Code trước khi có approval marker
  - Phớt lờ TECH-SPEC.md constraints

always_do:
  - Đọc ALL input sources trước khi design
  - Highlight trade-offs và concerns
  - Ghi decisions vào NeuralMemory
  - Kiểm tra consistency với existing schema
```

## 🧩 Relationships

```
TRIGGERED BY: orchestrator (Gate 2 check fail)
DEPENDS ON: brainstorm-agent output (Gate 1 must pass)
FEEDS INTO: symphony-enforcer (Gate 3)
WORKS WITH: nm-memory-sync
```

---

*spec-gate v1.2 — Modular Router Architecture*
