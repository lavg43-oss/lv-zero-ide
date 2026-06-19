---
name: verification-gate
description: Use BEFORE claiming any work is complete, fixed, or passing. Requires running verification commands and confirming output before making success claims. Evidence before assertions, always. Auto-triggers on task completion, commit, deploy, or any positive status claim.
---

<!-- ⚠️ IRON LAW — NO completion claims without FRESH verification evidence. Non-negotiable. -->

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim
6. AUTO-COMMIT: Build 0 errors → git add → git commit → git push (non-force)
   - Do NOT ask user permission for regular commits
   - Use conventional commit message (fix:/feat:/refactor:)
   - If push fails → git pull --rebase && git push (retry once)

Skip any step = lying, not verifying
```

## When to Apply

**ALWAYS before:**
- ANY variation of success/completion claims
- ANY expression of satisfaction ("Done!", "Fixed!", "Works!")
- Committing, PR creation, task completion
- `symphony_complete_task` calls
- Moving to next task
- Deploying or pushing code

## Verification Requirements by Claim Type

| Claim | Requires | NOT Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, looks good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Feature works | Maestro MCP auto run/Screenshot | Code written, assumed works |
| Requirements met | Line-by-line checklist | Tests passing |
| Deploy succeeded | Health check: 200 OK | Deploy command completed |

## Red Flags — STOP

If you catch yourself thinking any of these, STOP and run verification:

- Using "should", "probably", "seems to", "looks correct"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")
- About to commit/push without verification
- Relying on partial verification
- Thinking "just this once I can skip"
- Tired and wanting work to be over
- **ANY wording implying success without having run verification**

## Anti-Rationalization Table

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler ≠ runtime |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Build passed so tests pass" | Build ≠ tests |
| "I just changed one line" | One line can break everything |
| "It's a trivial change" | Trivial changes have the sneakiest bugs |

## Key Patterns

**Tests:**
```
✅ [Run test command] → [See: 34/34 pass] → "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Build:**
```
✅ [Run build] → [See: BUILD SUCCEEDED] → auto git add+commit+push → "Build passes, committed & pushed"
❌ "Linter passed so build is fine"
❌ Build succeeded but forgot to commit
```

**Bug Fix:**
```
✅ Write regression test → Run (FAIL) → Fix → Run (PASS) → "Bug is fixed"
❌ "I've changed the code, bug should be fixed"
```

**UI/Feature Verification:**
```
✅ Run Automated App Build → Run mcp_maestro_launch_app → Take mcp_maestro_take_screenshot → "UI renders correctly and no crash"
❌ "Code looks good, layouts conform to specs, should render fine."
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, so requirements are met"
```

## Symphony Integration

When calling `symphony_complete_task`:
1. Run ALL relevant verification commands FIRST
2. Include verification evidence in the `summary` parameter
3. Include `files_changed` list with ACTUAL changed files

```
❌ symphony_complete_task(summary="Implemented feature X")
✅ symphony_complete_task(summary="Implemented feature X. Build: ✅ (exit 0). Tests: ✅ 47/47 pass. Lint: ✅ 0 errors.")
```

## Boil-the-Lake Completeness Checklist

> **Principle:** AI's marginal cost is near zero. Ship completeness, not shortcuts.

Trước khi claim DONE, kiểm tra **mỗi item** dưới đây:

```
☐ Error handling: MỌI code path có proper error handling?
  → Network errors, parsing errors, invalid input, timeouts
☐ Edge cases: Đã handle empty states, nil/null, boundary values?
  → Empty list, first item, last item, max size
☐ Logging: Đủ log cho production debugging?
  → Errors logged with context, key operations tracked
☐ Cleanup: Resources released? Listeners removed? Timers cancelled?
☐ Input validation: User input được validate trước khi process?
☐ Concurrency: Thread-safe? Race conditions handled?
☐ Backwards compatibility: Breaking changes documented?
☐ Localization (I18N): Text UI mới đã được thêm vào Localizable.strings (EN & VI) chưa?
  → Việc bọc `Localized()` trong code là chưa đủ. Phải THỰC SỰ mở file .strings (hoặc chạy update_strings.py) để bổ sung key/value trước khi báo cáo DONE.
```

**Nếu thiếu bất kỳ item nào → report DONE_WITH_CONCERNS, không DONE.**

## The Bottom Line

**No shortcuts for verification. No shortcuts for completeness.**

Run the command. Read the output. Check the checklist. THEN claim the result.

This is non-negotiable.
