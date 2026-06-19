---
name: nm-memory-evolution
description: |
  Evidence-based brain optimization. Analyzes usage patterns to consolidate
  fragmented memories, enrich sparse ones, prune stale/irrelevant ones,
  and normalize tags. Improves recall quality over time.
metadata:
  stage: workflow
  version: "1.0"
  requires: neural-memory (pip install neural-memory)
  tags: [memory, evolution, optimize, prune, consolidate]
agent: Memory Evolution Strategist
trigger:
  commands: ["/memory-evolution", "/nm-evolve"]
  keywords: ["optimize brain", "clean memory", "prune", "consolidate memories"]
allowed-tools:
  - nmem_remember
  - nmem_recall
  - nmem_stats
  - nmem_context
  - nmem_auto
---

# NM Memory Evolution — Memory Evolution Strategist

> Evidence-based brain optimization using actual usage patterns.
> Consolidates, enriches, prunes, and normalizes — making recall more precise over time.

## Trigger

```
/memory-evolution                          # Full brain optimization
/memory-evolution "focus on auth topic"    # Scoped to topic
/nm-evolve "prune expired todos"           # Specific operation
```

---

## Analysis Phase

Before any changes, generate evolution opportunities:

```python
# 1. Usage patterns
stats = nmem_stats()
# → recall_frequency, activation_scores, orphan_neurons

# 2. Cluster detection  
context = nmem_context(topic=focus_area)
# → related memory clusters, fragmentation patterns

# 3. Tag analysis
# → inconsistency, synonyms, normalization needs
```

---

## 4 Evolution Operations

### 1. Consolidation
**When:** Multiple fragmented memories cover same concept

**Example:**
```
Before (3 memories):
  [fact] "API uses JWT"
  [fact] "JWT tokens expire in 24h"
  [fact] "JWT stored in Authorization header"

After (1 memory):
  [instruction] "API auth: JWT tokens, 24h expiry, sent via Authorization header. 
                 Chosen for stateless architecture (see decision #42)."
```

**Rules:**
- Show before/after preview — never auto-consolidate
- Keep highest priority + merge all tags
- Create `SUPERSEDES` synapse to old memories
- Log: "Consolidated 3 → 1 [topic]"

### 2. Enrichment
**When:** Memories exist but lack context/reasoning

**Example:**
```
Before: [decision] "Using Redis for cache"
After:  [decision] "Using Redis for cache. Reason: Redis Cluster supports Lua scripts 
                   needed for atomic counter ops. Team has Redis expertise. 
                   Chosen over Memcached on 2026-01-15."
```

**Sources for enrichment:**
- Related memories in the activation cluster
- User can be asked for missing info (non-blocking)

### 3. Pruning
**When:** Memories that reduce recall quality

**Prune candidates:**
- Expired TTL memories (todos past deadline, stale context)
- Duplicate/near-duplicate memories (similarity > 0.95)
- Orphaned facts with 0 recall in 60d
- Superseded decisions (overridden by newer ones)
- Out-of-scope memories (wrong project/context)

**Rules:**
- NEVER hard-delete — archive with `status=archived`
- Show full prune list before executing
- "Archived X memories" — not "deleted"
- Allow rescue: user can un-archive any item

### 4. Tag Normalization
**When:** Inconsistent tags reduce recall precision

**Common issues:**
- Synonyms: "frontend" / "front-end" / "FE" → normalize to "frontend"
- Abbreviations: "db" / "database" / "DB" → normalize to "database"  
- Case: "Auth" / "auth" / "AUTH" → normalize to "auth"
- Language mix: "xác thực" / "auth" for same concept → pick one

**Process:**
1. Build tag frequency map
2. Identify synonym clusters
3. Propose normalization mapping
4. Apply after user confirms

---

## Output Format

```
🔄 Memory Evolution Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Analysis Results
  Memories analyzed: 127
  Evolution opportunities: 23

📋 Proposed Operations

CONSOLIDATE (4 groups → 4 memories)
  1. Auth memories: 5 fragments → 1 instruction [preview]
  2. Database facts: 3 fragments → 1 fact [preview]
  ...

ENRICH (6 memories lacking context)
  1. [decision] "Using Redis" — missing reasoning [add]
  2. [instruction] "Always validate input" — missing scope [add]
  ...

PRUNE (9 memories)
  1. 4 expired todos (past deadline) [archive]
  2. 3 orphaned facts (0 recall in 60d) [archive]
  3. 2 near-duplicates [merge]

NORMALIZE TAGS
  "frontend" / "front-end" / "FE" → "frontend" (affects 18 memories)
  "db" / "database" → "database" (affects 12 memories)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Execute plan? [all / select / cancel]
  > all        → execute all operations
  > select     → choose operations individually
  > cancel     → abort
```

---

## Execution Protocol

1. **Show full plan** — never execute without preview
2. **Execute in order:** Prune → Consolidate → Enrich → Normalize
   (pruning first reduces noise for better consolidation)
3. **Checkpoint after each phase** — can stop mid-way
4. **Create evolution snapshot** before starting (rollback point)

---

## Post-Evolution Report

```
✅ Evolution Complete

  Consolidated: 4 memory groups (15 → 4)
  Enriched: 6 memories
  Archived: 9 memories
  Tags normalised: 30 memories updated

  Brain quality: B- → A- (estimated)
  
💡 Recommended audit in 7 days: /memory-audit
```

---

## Rules

- **Never auto-prune** — always show prune list to user
- **Archive, don't delete** — memories may be relevant later
- **Preserve intent** — consolidation must not lose meaning
- **Test recall after** — spot-check key topics after evolution
- **Vietnamese support** — operations work regardless of language
