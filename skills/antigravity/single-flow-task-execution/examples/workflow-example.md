# Example Workflow: Full Task Execution Cycle

```
You: I'm using single-flow-task-execution to execute this plan.

[Read plan file: docs/plans/feature-plan.md]
[Extract all 5 tasks with full text and context]
[Create Symphony tasks for tracking]

--- Task 1: Hook installation script ---

[Prepare task brief with full text + context]
[Execute implementation following ./implementer-prompt.md structure]

Questions: "Should the hook be installed at user or system level?"
Answer: "User level (~/.config/superpowers/hooks/)"

Implementation:
  - Implemented install-hook command
  - Added tests, 5/5 passing
  - Self-review: Found I missed --force flag, added it
  - Committed

[Run spec compliance review following ./spec-reviewer-prompt.md]
Spec review: Spec compliant — all requirements met, nothing extra

[Run code quality review following ./code-quality-reviewer-prompt.md]
Code review: Strengths: Good test coverage, clean. Issues: None. Approved.

[Mark Task 1 complete in Symphony]

--- Task 2: Recovery modes ---

[Prepare task brief with full text + context]
[Execute implementation]

Implementation:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Run spec compliance review]
Spec review: Issues found:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Fix issues: remove --json flag, add progress reporting]
[Run spec compliance review again]
Spec review: Spec compliant now

[Run code quality review]
Code review: Issue (Important): Magic number (100) should be a constant

[Fix: extract PROGRESS_INTERVAL constant]
[Run code quality review again]
Code review: Approved

[Mark Task 2 complete in Symphony]

... [Continue through remaining tasks] ...

[After all tasks complete]
[Run final code review on entire implementation]
Final review: All requirements met, ready to merge

[Complete Symphony task and present next steps]
Done!
```

## Task Brief Structure

```
task_boundary:
  description: "Implement Task N: [task name]"
  prompt: |
    ## Task Description
    [FULL TEXT of task from plan — paste it here]

    ## Context
    [Where this fits, dependencies, architectural context]

    ## Constraints
    - Only modify [specific files/directories]
    - Follow existing patterns in the codebase
    - Write tests for new functionality

    ## Verification
    - Run: [specific test command]
    - Expected: [what success looks like]
```
