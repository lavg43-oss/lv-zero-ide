---
name: module-spec-writer
description: >-
  Gate 1.5 — Module Specification Writer. Tạo tài liệu mô tả chi tiết từng module
  của ứng dụng: screens, user flows, business rules, validation, data contracts,
  edge cases. Chạy sau brainstorm (Gate 1) và trước architecture design (Gate 2).
  Đặc biệt critical cho port/migration projects.
  Hỗ trợ auto-detect .kiro/specs modules để bypass khi IDE đã tạo specs.
metadata:
  stage: core
  version: "1.2"
  tags: [gate, spec, module, product-spec, documentation, core, kiro]
  requires: orchestrator
agent: Spec Writer
trigger: conditional
invocation-type: auto
priority: 1
activation_keywords:
  - "module spec"
  - "mô tả module"
  - "screen inventory"
  - "feature spec"
  - "product spec"
---

<!-- ⚠️ GATE 1.5 — User PHẢI approve module specs. COMPLEX + >3 modules = MANDATORY. -->

# Module Spec Writer v1.2 — Gate 1.5: Product Specification (Router)

> **Purpose:** Tạo tài liệu product-level cho từng module (screens, flows, rules)
> TRƯỚC KHI thiết kế kỹ thuật. Đảm bảo shared understanding "app làm gì".

## ⚠️ SCOPE CLARITY

| Skill này LÀM | Skill này KHÔNG làm |
|---------------|---------------------|
| Mô tả screens, user flows, business rules per module | Thiết kế DB/API (việc của spec-gate) |
| Tạo screen inventory cho toàn app | Viết code |
| Document validation rules & edge cases | Track tasks (việc của symphony-enforcer) |
| Scan existing codebase để auto-generate spec | Brainstorm ý tưởng (việc của brainstorm-agent) |

## 📋 Topic Index — Load deep dives as needed

| Topic | Khi nào load | File |
|-------|-------------|------|
| Module Spec Template | Khi viết spec cho 1 module | `templates/module-spec-template.md` |
| Port/Migration Mode | Khi port iOS↔Android hoặc có .kiro/specs | `examples/port-migration-mode.md` |

## 🚀 ACTIVATION

```yaml
mandatory_when:
  - complexity: COMPLEX (score ≥6)
  - project_type: port/migration (iOS→Android, Android→iOS)
  - module_count: >3 modules in BRIEF.md

skip_when:
  - complexity: TRIVIAL or MODERATE
  - module_count: ≤3 AND not port/migration
  - user_override: "skip spec" or "bỏ qua spec"
  - kiro_specs: .kiro/specs/ chứa ≥2 module folders
    → AUTO-SKIP: "Kiro module specs detected. Gate 1.5 AUTO-PASS."
```

## 📋 INPUT REQUIREMENTS

```
REQUIRED:
  → BRIEF.md hoặc docs/specs/<feature>.md (output từ Gate 1)
    HOẶC existing codebase (cho port/migration projects)
  → .project-identity (projectId, techStack)

OPTIONAL:
  → CODEBASE.md, KnowledgeItems, NeuralMemory context
```

## 🔄 PROCESS (6 Phases)

### Phase 1: Module Discovery
- Kiro check first (.kiro/specs/ → AUTO-PASS nếu ≥2 modules)
- Fallback: BRIEF.md → extract modules | Scan source code (port)
- Present danh sách modules → user confirm

### Phase 2: Per-Module Spec Generation
- Gather context (BRIEF, source code, KI, NeuralMemory)
- Generate spec theo template → `templates/module-spec-template.md`
- Self-review checklist: screens đủ? flows rõ? edge cases? **transitions & micro-interactions defined?**

### Phase 3: Cross-Module Consistency Check
- Dependency graph (circular? missing cross-refs?)
- Shared concepts consistent?
- Coverage vs BRIEF.md / source code

### Phase 4: Multi-Role Review (AI Simulated)
6 roles: Tech Lead, PM, UX Designer, QA, Security, DevOps

### Phase 5: Present & Approval
Show summary table → user review → approve

### Phase 6: Write & Store
- Write to `docs/specs/modules/<module-name>_spec.md`
- Create `MODULE_INDEX.md`
- Tag NeuralMemory → proceed to Gate 2

## 🚫 Anti-Patterns

```yaml
never_do:
  - Tự approve module specs (user PHẢI approve)
  - Viết spec quá vắn tắt (< 5 screens → cảnh báo)
  - Skip cross-module consistency check
  - Trộn lẫn product spec với technical spec (DB/API)
  - Bắt đầu Gate 2 khi còn "Draft"

always_do:
  - Show module list cho user confirm TRƯỚC
  - Cross-module consistency check SAU khi viết hết
  - Acceptance criteria phải testable (SMART)
  - Scan source code khi port/migration
  - Tag specs vào NeuralMemory
```

## 🧩 Skill Relationships

```
TRIGGERED BY: orchestrator (Gate 1.5 check fail)
DEPENDS ON: brainstorm-agent output (Gate 1 must pass)
FEEDS INTO: spec-gate (Gate 2 reads module specs)
WORKS WITH: nm-memory-sync, gitnexus-intelligence, KnowledgeItems
```

---

*module-spec-writer v1.2 — Modular Router Architecture*
