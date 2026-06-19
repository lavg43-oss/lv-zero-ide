---
name: single-flow-task-execution
description: Use when executing implementation plans, handling multiple independent tasks, or doing structured task-by-task development with review gates.
---

# Single-Flow Task Execution — Router

Execute plans by working through one task at a time with two-stage review after each: spec compliance review first, then code quality review.

**Core principle:** One task at a time + two-stage review (spec then quality) = high quality, disciplined iteration.

## 📋 Topic Index

| Topic | Khi nào load | File |
|-------|-------------|------|
| Example full execution cycle & task brief template | Khi cần reference pattern | `examples/workflow-example.md` |

## Antigravity Execution Model

1. **One active task only** — never work on multiple tasks simultaneously
2. **One execution thread** — no parallel dispatch, no `Task(...)`
3. **Browser automation** may use `browser_subagent` in isolated steps
4. **Track progress** via Symphony task system
5. **Use `task_boundary`** to delineate each unit of work

## When to Use / Don't Use

**Use:** Implementation plan with multiple independent tasks | 2+ test files failing different causes | Structured execution with quality gates

**Don't:** Related failures (fix one → fix others) | Tightly coupled tasks | Single simple task

## The Process

```
Read plan → Extract tasks → [Per task loop]:
  1. Execute implementation (./implementer-prompt.md)
  2. Questions? → Ask & wait → Re-execute
  3. Implement, test, commit, self-review
  4. Run spec compliance review (./spec-reviewer-prompt.md)
     → Issues? Fix → Re-review until approved
  5. Run code quality review (./code-quality-reviewer-prompt.md)
     → Issues? Fix → Re-review until approved
  6. Mark task complete via Symphony
  7. More tasks? → Loop | No → Final code review → Complete
```

## UI-First Task Ordering (Gate 4 Three-Phase)

When tasks include UI components (COMPLEX/MODERATE):

| Phase | Priority | Examples | Gate |
|-------|----------|----------|------|
| **A: Infrastructure** | FIRST | Dependencies, DI, nav skeleton | App MUST build |
| **B: UI Shell** | SECOND | All screens with mock data | 🧪 USER/AUTO CHECKPOINT |
| **C: Logic** | LAST | Real API/DB, business logic | 🧪 Per-feature checkpoint |

**Auto checkpoint:** Check `.project-identity` → `autoVerification: true` = Maestro auto-test, `false` = wait for user.

### Task Sorting Rule
1. Tag each task: `[INFRA]` `[UI]` `[LOGIC]`
2. Sort: INFRA first → UI second → LOGIC last
3. Within each phase: respect dependency ordering

## Task Decomposition

1. **Identify independent domains** — Group failures by what's broken
2. **Create task units** — Specific scope, clear goal, constraints, expected output
3. **Execute sequentially** with full review cycle
4. **Review & integrate** — Full test suite, check conflicts

## Review Templates

- `./implementer-prompt.md` — Implementation structure
- `./spec-reviewer-prompt.md` — Did we build what was requested?
- `./code-quality-reviewer-prompt.md` — Is it well-built?

**Order:** Always spec compliance FIRST, then code quality.

## Checkpoint Pattern

Report at logical boundaries:
- **What changed**, **What verification ran**, **What remains**
- Update Symphony task progress
- `autoVerification: true` → don't block between tasks
- `autoVerification: false` → wait for manual validation

## Red Flags

**Never:** Start on main without consent | Skip reviews | Work on multiple tasks | Accept "close enough" | Start quality review before spec passes | Skip re-review after fixes

## Completion

1. All Symphony tasks marked `done`/`cancelled`
2. Full test/validation command ran
3. No regressions across all tasks
4. Evidence summarized

## Integration

- **Required:** `symphony-orchestrator`, `symphony-enforcer`
- **Recommended:** TDD, verification-before-completion

---

*single-flow-task-execution — Modular Router Architecture*
