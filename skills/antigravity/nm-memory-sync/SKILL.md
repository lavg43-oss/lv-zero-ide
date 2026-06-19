---
name: nm-memory-sync
description: |
  NeuralMemory-powered ambient brain sync. Replaces flat-file memory-sync with
  associative graph recall via spreading activation. Auto-reads/writes brain on
  every session, debug, task, and error — with richer context than keyword matching.
metadata:
  stage: core
  version: "1.0"
  replaces: memory-sync, ambient-brain
  requires: neural-memory (pip install neural-memory)
  tags: [memory, neural, sync, core, ambient]
agent: Ambient Neural Brain
allowed-tools:
  - nmem_remember
  - nmem_recall
  - nmem_context
  - nmem_stats
  - nmem_auto
---

# NM Memory Sync — Ambient Neural Brain

> Drop-in upgrade for `memory-sync` and `ambient-brain`.
> Uses NeuralMemory's spreading activation instead of keyword overlap.

---

## Core Difference vs memory-sync

| Feature | memory-sync (flat-file) | nm-memory-sync (this) |
|---------|------------------------|----------------------|
| Storage | Markdown files | SQLite graph (neurons + synapses) |
| Recall | keyword overlap > 2 | Spreading activation graph |
| Causality | None | `CAUSED_BY`, `LEADS_TO` links |
| Time decay | None | Natural decay by age/priority |
| Dedup | None | Automatic conflict detection |
| Context | Whole file | Scoped activation subgraph |

---

## READ TRIGGERS (Auto-Read từ Brain)

### R1: Session Start
**Condition:** Conversation bắt đầu
**Action:** `nmem_context()` → load recent + high-activation memories
**Output:** Silent loading, brief summary nếu relevant

### R2: New Task / Debugging
**Condition:** User bắt đầu task mới hoặc debug session
**Action:** `nmem_recall(task_keywords)` → associative recall
**Output:** Show relevant decisions, past errors, solutions

### R3: Error Encountered
**Condition:** Exception, crash, hoặc lỗi xuất hiện
**Action:** `nmem_recall(error_type + keywords)` → find past similar errors
**Output:** Auto-propose known solutions if confidence > 0.7

### R4: Architecture Question
**Condition:** User hỏi về design, pattern, tech choice
**Action:** `nmem_recall(topic, depth=3)` → deep associative recall
**Output:** Related decisions, constraints, context

### R5: Recurring Problem (Enhanced)
**Condition:** Vấn đề tương tự đã gặp (spreading activation detects similarity)
**Action:** Activate related memory cluster
**Output:** "🧠 Similar to [memory]: [solution]" — NO keyword threshold needed

---

## WRITE TRIGGERS (Auto-Write vào Brain)

### W1: Decision Made → `decision` type
**Condition:** AI hoặc user đưa ra quyết định kỹ thuật
**Capture:** "Chose X because Y" format
**Store:** `nmem_remember(content, type="decision", priority=7)`
**Links:** Auto-link to related memories via NeuralMemory engine

### W2: Bug Fixed → `error` type
**Condition:** User confirm fix thành công ("xong", "ok", "chạy rồi")
**Capture:** Error + root cause + solution
**Store:** `nmem_remember(content, type="error", priority=8)`
**Links:** `CAUSED_BY` → triggering condition, `LEADS_TO` → fix applied

### W3: Architecture Change → `instruction` type
**Condition:** File structure thay đổi, pattern mới được áp dụng
**Capture:** What changed + why
**Store:** `nmem_remember(content, type="instruction", priority=7)`
**Links:** `SUPERSEDES` → old pattern if exists

### W4: Task Complete → `workflow` type
**Condition:** Task marked done trong Symphony
**Capture:** What was done + approach taken
**Store:** `nmem_remember(content, type="workflow", priority=5)`

### W5: User Preference Detected → `preference` type
**Condition:** User consistently uses pattern or expresses preference
**Capture:** The preference + context
**Store:** `nmem_remember(content, type="preference", priority=6)`

---

## Sync Protocol

### Session Start Flow
```
1. nmem_context() → get active memory cluster
2. Filter by project tags (from .project-identity if available)
3. SILENT load — no output unless > 3 highly relevant memories
4. If relevant: "🧠 Recalled: [brief summary]"
```

### Error Flow
```
1. Extract: error_type, file, function, keywords
2. nmem_recall(f"{error_type} {keywords}", depth=2)
3. If match (activation > 0.6):
   → "🧠 Similar error: [past error] — Solution: [fix]"
4. After fix confirmed:
   → nmem_remember(error + solution, type="error", tags=[...])
   → Create CAUSED_BY + LEADS_TO synapses
```

### Decision Write Flow
```
1. Detect decision signal words: "chose", "decided", "going with", "will use"
2. Extract: choice + reason (requires both for quality decision memory)
3. nmem_recall(topic) → check for conflicts
4. SILENT store: nmem_remember(content, type="decision", priority=7)
5. Confirm: "💾 Saved decision: [brief]"
```

---

## Associative Recall Strategy

Unlike keyword overlap (old memory-sync), nm-memory-sync uses:

```
Query: "API authentication failing"
         ↓ spreading activation
Anchor neurons: [api, auth, fail]
         ↓ activate synapses (depth=2)
Related neurons: [jwt, token, session, middleware]
         ↓ intersect top activations
Surface memories: 
  - "Decided JWT over sessions for stateless API" (decision, auth tags)
  - "Fixed middleware order causing 401" (error, api tags)
  - "Never store tokens in localStorage" (instruction, security tags)
```

This surfaces memories that a keyword search would miss.

---

## Notification Behavior

| Event | Output |
|-------|--------|
| Relevant memory found (activation > 0.7) | `🧠 [brief recall]` |
| Decision auto-saved | `💾 Saved: [brief]` |
| Bug solution stored | `🔧 Stored fix: [brief]` |
| No relevant memory | Silent (no output) |
| Conflict detected | `⚠️ Conflicts with: [memory]` |

---

## Auto-Install Protocol (New Machine)

If `nmem` CLI is not available:
```
1. AI detects: command not found: nmem
2. AI auto-runs: pip install neural-memory (or python3 -m pip install neural-memory)
   → Requires Python >= 3.11
3. After install: nmem init (initialize brain DB)
4. Verify: nmem --version
5. If Python < 3.11 or pip fails:
   → Show user: "⚠️ NeuralMemory requires Python >= 3.11. Install via: brew install python@3.12"
```

## Fallback Mode (NeuralMemory Not Installed)

If `nmem` is not available AND auto-install fails, falls back to flat-file behavior:
```
- Reads from brain/decisions/, brain/solutions/
- Keyword overlap matching (legacy behavior)
- Shows warning once: "⚠️ NeuralMemory not installed. Using flat-file fallback."
```

---

## Integration

- Works alongside `symphony-orchestrator` for task lifecycle hooks
- Reads `.project-identity` for project-scoped memory filtering
- Feeds data to `nm-memory-audit` for quality checks
- Activated before `orchestrator` dispatches (priority 2.5 in skill chain)
