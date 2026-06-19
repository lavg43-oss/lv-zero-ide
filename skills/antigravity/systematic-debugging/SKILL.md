---
name: systematic-debugging
description: Use for ANY technical issue - bugs, test failures, build errors, crashes. Enforces 4-phase root cause process before any fix attempts. Auto-triggers on /debug, error detection, test failures.
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you CANNOT propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Runtime crashes / EXC_BAD_ACCESS / ANR
- Unexpected behavior
- Performance problems
- Build failures (Xcode, Gradle, npm)
- Integration issues (API, SDK, Firebase)

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation (BEFORE ANY FIX)

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - Read stack traces COMPLETELY — they often contain the exact answer
   - Note line numbers, file paths, error codes
   - For iOS: read the full crash log, not just the top frame
   - For Android: read logcat with proper filters

2. **Reproduce Consistently**
   - Can you trigger it reliably? What are the exact steps?
   - If not reproducible → gather more data, DON'T guess
   - For intermittent: add diagnostic logging at component boundaries

3. **Check Recent Changes**
   - `git diff` — what changed?
   - Recent commits, new dependencies, config changes
   - Environmental differences (device, OS version, network)

4. **Gather Evidence in Multi-Component Systems**
   ```
   For EACH component boundary:
     - Log what data enters component
     - Log what data exits component  
     - Verify environment/config propagation
     - Check state at each layer
   
   Run once to gather evidence showing WHERE it breaks
   THEN analyze evidence to identify failing component
   THEN investigate that specific component
   ```

5. **Trace Data Flow**
   - Where does the bad value originate?
   - What called this with the bad value?
   - Keep tracing UP until you find the source
   - **Fix at source, not at symptom**

### Phase 2: Pattern Analysis

1. **Find Working Examples** — Locate similar working code in same codebase
2. **Compare Against References** — Read reference implementation COMPLETELY (don't skim)
3. **Identify Differences** — List EVERY difference, however small
4. **Understand Dependencies** — What components, settings, config does this need?

### Phase 3: Hypothesis & Testing

1. **Form Single Hypothesis** — "I think X is the root cause because Y"
2. **Test Minimally** — SMALLEST possible change. One variable at a time
3. **Verify Before Continuing** — Worked? → Phase 4. Didn't? → NEW hypothesis
4. **When You Don't Know** — Say "I don't understand X". Don't pretend. Research more

### Phase 4: Implementation

1. **Create Failing Test Case** — Simplest possible reproduction. MUST have before fixing
2. **Implement Single Fix** — ONE change at a time. No "while I'm here" improvements
3. **Verify Fix** — Test passes? No other tests broken? Issue actually resolved?

## The 3-Strike Escalation Protocol

```
If 3+ fixes have FAILED → STOP. ESCALATE. NO EXCEPTIONS.

This is NOT a failed hypothesis.
This is a WRONG ARCHITECTURE.
```

**Escalation Protocol (BẮT BUỘC sau 3 failed attempts):**

```
1. STOP — Không thử fix thứ 4.
2. REPORT full context cho user:
   🚫 ESCALATION — 3 fix attempts failed
   ─────────────────────────────────────
   Attempt 1: {what tried} → {why failed}
   Attempt 2: {what tried} → {why failed}
   Attempt 3: {what tried} → {why failed}
   
   Root Cause Hypothesis: {current best guess}
   Architectural Concern: {pattern detected}
   
   Recommended: [refactor approach | seek expert | alternative solution]
   ─────────────────────────────────────
3. WAIT for user decision — do NOT proceed autonomously.
```

**Pattern indicating architectural problem:**
- Each fix reveals new shared state/coupling
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

## Scope Freeze During Debug

```
Khi đang debug một issue:
- KHÔNG sửa bug khác "tiện tay"
- KHÔNG refactor code xung quanh
- KHÔNG thêm feature "nhân tiện"
- CHỈ tập trung vào root cause hiện tại

Violation → revert side changes, focus on current scope
```

## Red Flags — STOP and Return to Phase 1

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals new problem in different place**

**ALL of these mean: STOP. Return to Phase 1.**

## Anti-Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start |
| "I'll write test after confirming fix" | Untested fixes don't stick. Test first proves it |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause |
| "One more fix attempt" (after 2+) | 3+ failures = architectural problem. Question pattern |
| "Reference too long, I'll adapt" | Partial understanding guarantees bugs. Read completely |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify | Bug resolved, tests pass |

## NeuralMemory Integration

After fixing a bug:
1. `nmem_remember` the root cause, fix, and pattern — tag with projectId
2. Before debugging NEW bugs: `nmem_recall` for similar past issues
3. Saves hours on recurring patterns

## Integration

**Related skills:**
- **verification-gate** — Verify fix worked before claiming success
- **single-flow-task-execution** — For structured task execution
- **symphony-enforcer** — Report debug progress to Symphony

**Related workflows:**
- `/debug` — Primary trigger workflow
- `/bug-hunter` — Automated bug hunting
- `/hotfix` — Production emergency (still follows 4-phase!)
