---
name: nm-memory-audit
description: |
  6-dimension quality review of NeuralMemory brain health.
  Grades each dimension (A-F), produces graded findings, and recommends
  concrete actions for improvement. Run weekly or before major sprints.
metadata:
  stage: review
  version: "1.0"
  requires: neural-memory (pip install neural-memory)
  tags: [memory, audit, quality, review, neuralmemory]
agent: Memory Quality Inspector
trigger:
  commands: ["/memory-audit", "/nm-audit"]
  keywords: ["audit brain", "check memory", "memory health"]
allowed-tools:
  - nmem_recall
  - nmem_stats
  - nmem_context
---

# NM Memory Audit — Memory Quality Inspector

> Systematic quality review of the NeuralMemory brain.
> Grades memory health across 6 dimensions, surfaces actionable findings.

## Trigger

```
/memory-audit
/nm-audit
```

---

## 6 Audit Dimensions

### 1. Purity (A-F)
**Question:** Are memories well-typed and single-concept?

Check for:
- Mixed types in one memory (fact + decision combined)
- Vague or generic content ("fixed a bug" → F)
- Missing source attribution
- Over-broad scope ("everything about auth")

**Grade:**
- A: 90%+ memories are single-concept, well-typed
- B: 75-89% clean
- C: 60-74% — noticeable clutter
- D: 40-59% — significant cleanup needed
- F: <40% — urgent restructuring required

### 2. Freshness (A-F)
**Question:** Are memories still current and relevant?

Check for:
- Expired memories (past TTL) still active
- Outdated decisions (superseded but not marked)
- Stale context (project state changed)
- Memories about deprecated features/APIs

**Grade based on:** % expired / stale vs total

### 3. Coverage (A-F)
**Question:** Are important areas of the project well-documented?

Check for:
- Core architecture decisions — present? complete?
- Recent bugs/fixes — all captured?
- Team preferences — documented?
- Onboarding knowledge — accessible?

**Grade based on:** Key areas vs documented areas ratio

### 4. Clarity (A-F)
**Question:** Can memories be understood without context?

Check for:
- Jargon without explanation ("the THING was fixed")
- Missing who/what/why ("updated it")
- Inconsistent terminology (same concept, multiple names)
- Vietnamese/English mixing without clear pattern

**Grade based on:** Avg clarity score across sampled memories

### 5. Relevance (A-F)
**Question:** Are memories being recalled and used?

Check for:
- Low-activation memories (never recalled in 30d)
- Duplicate memories competing for activation
- Orphaned memories (no synapse connections)
- Memories blocking relevant recall (noise)

**Grade based on:** Recall frequency + synapse connectivity

### 6. Structure (A-F)
**Question:** Is the synapse graph healthy?

Check for:
- Isolated neurons (no connections)
- Missing causal links (decisions without causes)
- Tag inconsistency (similar concepts, different tags)
- Temporal gaps (events without before/after links)

**Grade based on:** Graph connectivity metrics from nmem_stats

---

## Output Format

```
🔍 Memory Brain Audit — [date]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Health Overview
  Total memories: 127
  Active (recalled 7d): 43 (34%)
  Expired/stale: 12 (9%)
  Orphaned neurons: 8 (6%)

📋 Dimension Grades
  Purity:    B (78%) — Some mixed-concept memories found
  Freshness: A (92%) — Brain is current ✨
  Coverage:  C (61%) — Auth and deploy areas sparse
  Clarity:   B (80%) — Minor jargon issues
  Relevance: B (75%) — 8 orphaned low-priority memories
  Structure: C (65%) — Missing causal links in 15 decisions

Overall: B- (75%)

🔴 Critical Findings (fix now)
  1. 3 expired `todo` memories still active — run /memory-evolution to prune
  2. Auth architecture has no decision memories — document now

🟡 Moderate Findings (fix this week)
  3. 8 orphaned memories — no synapse connections
  4. "deployment" and "deploy" tags used inconsistently (15 memories)

🟢 Minor Findings (optional)
  5. 5 memories could be split into smaller single-concept memories
  6. 3 decisions missing "because Y" reasoning

💡 Recommended Next Step
  Run: /memory-evolution "prune expired, fix auth coverage"
```

---

## Rules

- Always show the full 6-dimension breakdown
- Never modify memories during audit — report only
- Grade based on objective metrics when possible
- Prioritize by impact: Critical > Moderate > Minor
- End with one concrete "next step" recommendation
