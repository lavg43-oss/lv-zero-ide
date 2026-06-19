---
name: nm-memory-intake
description: |
  Structured memory creation workflow. Converts messy notes, meeting logs,
  and unstructured thoughts into well-typed, tagged, priority-scored NeuralMemory entries.
  Uses 1-question-at-a-time clarification + batch preview before storing.
metadata:
  stage: workflow
  version: "1.0"
  requires: neural-memory (pip install neural-memory)
  tags: [memory, intake, structured, neuralmemory, workflow]
agent: Memory Intake Specialist
trigger:
  commands: ["/memory-intake", "/nm-intake"]
  keywords: ["lưu notes", "save this", "remember meeting", "ghi lại buổi"]
allowed-tools:
  - nmem_remember
  - nmem_recall
  - nmem_stats
  - nmem_context
  - nmem_auto
---

# NM Memory Intake — Memory Intake Specialist

> Transform raw, unstructured input into high-quality structured memories.
> Acts as a thoughtful librarian — clarifying, categorizing, and filing
> information so it can be recalled precisely when needed.

## Trigger

```
/memory-intake "raw notes or conversation here"
/nm-intake "messy meeting notes..."
```

---

## Memory Types

| Type | Signal Words | Priority |
|------|-------------|----------|
| `fact` | "is", "has", "uses", dates, numbers, names | 5 |
| `decision` | "decided", "chose", "will use", "going with" | 7 |
| `todo` | "need to", "should", "TODO", "must" | 6 |
| `error` | "bug", "crash", "failed", "broken", "fix" | 7 |
| `insight` | "realized", "learned", "turns out", "key takeaway" | 6 |
| `preference` | "prefer", "always use", "never do", "convention" | 5 |
| `instruction` | "rule:", "always:", "never:", "when X do Y" | 8 |
| `workflow` | "process:", "steps:", "first...then...finally" | 6 |
| `context` | background info, project state, env details | 4 |

---

## Process (6 Phases)

### Phase 1: Triage
Scan raw input → classify each information unit by type.
If input is ambiguous → go to Phase 2.
If clearly typed → skip to Phase 3.

### Phase 2: Clarification (1-Question-at-a-Time)
```
Found: "We're using PostgreSQL now"

What type?
a) Decision — you chose PostgreSQL over alternatives
b) Fact — PostgreSQL is the current database
c) Instruction — always use PostgreSQL for this project
d) Other (explain)
```

**Rules:**
- ONE question per round — never dump a checklist
- Always provide options (2-4 choices)
- Infer when confident (>80%) — don't ask obvious ones
- Max 5 rounds — then use best-guess
- Group similar: "Found 3 TODOs. Priority for all? [high/normal/low]"

### Phase 3: Enrichment
For each item, determine:
1. **Tags** — 2-5 relevant tags, normalize ("frontend" not "front-end")
2. **Priority** — 0-10 scale (see type table above)
3. **Expiry** — todo: 30d, error: 90d, fact: none, context: 30d
4. **Source** — "Per meeting 2026-02-26: ...", "From error log: ..."

### Phase 4: Deduplication
```python
nmem_recall("topic keywords")
# → Identical: skip, report duplicate
# → Updated: store new, note supersedes old
# → Contradicts: store with conflict flag, alert user
# → Complements: store, note connection
```

### Phase 5: Batch Preview + Confirm
```
Ready to store 7 memories:

  1. [decision] "Chose PostgreSQL for user service" priority=7 tags=[database, arch]
  2. [todo] "Migrate user table" priority=6 tags=[database, migration] expires=30d
  3. [fact] "PostgreSQL 16 supports JSON path queries" priority=5 tags=[database]
  ...

Store all? [yes / edit # / skip # / cancel]
```

**Rules:**
- Max 10 per batch — split larger batches with pause
- NEVER auto-store without showing preview
- Allow per-item edits before commit
- Store: decisions first, then errors, then facts (priority order)

### Phase 6: Intake Report
```
✅ Intake Complete
   Stored: 7 memories (2 decisions, 3 facts, 1 todo, 1 insight)
   Skipped: 1 duplicate
   Conflicts: 0 | Gaps: 2 items need follow-up

Follow-up needed:
  - "Redis cache TTL" — what's the agreed TTL?
  - "Deploy schedule" — weekly or bi-weekly?
```

---

## Rules

- **Never auto-store** — always show preview before writing
- **Never guess security-sensitive info** — ask explicitly
- **Prefer specific over vague** — "PostgreSQL 16 on AWS RDS" not "using a database"
- **Include reasoning** — "Chose X because Y" not just "Using X"
- **One concept per memory** — don't cram multiple facts
- **Vietnamese support** — if input is Vietnamese, store in Vietnamese
