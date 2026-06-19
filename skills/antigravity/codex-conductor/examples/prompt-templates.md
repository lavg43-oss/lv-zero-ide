# Codex CLI Prompt Templates

## 1. Bug Root Cause Analysis

```bash
codex "A bug was reported: <BUG_DESCRIPTION>. \
Analyze the codebase to find the root cause. \
List: (1) most likely root cause with file:line, \
(2) contributing factors, (3) suggested fix approach. \
DO NOT edit any files." \
--approval-mode suggest -q
```
**Report to:** `codex-reports/bug-analysis-<date>.md`

## 2. Pre-Commit Code Review

```bash
codex "Review the uncommitted changes in this repo. \
Check for: bugs, logic errors, edge cases, thread safety, \
security issues, performance problems, naming inconsistencies. \
Rank issues by severity (critical/warning/info). \
DO NOT edit any files." \
--approval-mode suggest -q
```
**Report to:** `codex-reports/review-<date>.md`

## 3. Logic & Edge Case Analysis

```bash
codex "Analyze <FILE_OR_MODULE> for logic correctness. \
Focus on: edge cases (null, empty, boundary), race conditions, \
error handling gaps, unreachable code, off-by-one errors. \
List each issue with file:line and severity. \
DO NOT edit any files." \
--approval-mode suggest -q
```
**Report to:** `codex-reports/logic-analysis-<date>.md`

## 4. Test Case Generation

```bash
codex "Analyze <FILE_OR_MODULE> and generate a comprehensive \
list of test cases. Include: happy path, edge cases, error cases, \
boundary values, concurrent scenarios. Format as markdown table. \
DO NOT edit any files." \
--approval-mode suggest -q
```
**Report to:** `codex-reports/test-cases-<date>.md`

## 5. Implementation Plan Review

```bash
codex "Review this implementation plan: <PLAN_CONTENT>. \
Find: logic holes, missing error handling, security risks, \
race conditions, scalability issues, missing edge cases. \
Rate each issue by severity. \
DO NOT edit any files." \
--approval-mode suggest -q
```
**Report to:** `codex-reports/plan-review-<date>.md`

## 6. Refactor Verification

```bash
codex "Compare the recent changes in this repo against the \
original code. Verify: (1) no behavioral regression, \
(2) all original edge cases still handled, \
(3) no new bugs introduced. List any regressions found. \
DO NOT edit any files." \
--approval-mode suggest -q
```
**Report to:** `codex-reports/refactor-verify-<date>.md`
