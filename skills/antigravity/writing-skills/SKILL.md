---
name: writing-skills
description: Use when creating or updating AWKit skills or workflow documentation and you need a lean, searchable, testable skill structure.
---

# Writing Skills — Router

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

Write pressure scenarios, observe failure, write the minimum useful skill, then close loopholes without bloating the main file.

**Core principle:** If you did not watch an agent fail without the skill, you do not know whether the skill teaches the right behavior.

**Required background:** `test-driven-development` from the `superpowers` pack when you need the full RED-GREEN-REFACTOR discipline.

## What is a Skill?

**Skills are:** Reusable techniques, patterns, tools, reference guides
**Skills are not:** Session narratives or one-off implementation logs

### Skill Types

- **Technique** — Concrete method with steps
- **Pattern** — Decision framework or mental model
- **Reference** — API docs, syntax guides, environment-specific notes

## Topic Index

| Topic | When to Load | File |
|-------|--------------|------|
| Search optimization and descriptions | Naming skills and writing trigger metadata | `examples/cso-optimization.md` |
| TDD for skills | Designing validation for skills and workflow docs | `examples/tdd-for-skills.md` |
| Anti-rationalization patterns | Hardening discipline skills against loopholes | `examples/anti-rationalization.md` |

## SKILL.md Structure

**Frontmatter:** Only `name` and `description`

- `name`: letters, numbers, hyphens only
- `description`: start with `Use when...`
- Keep the description focused on trigger conditions, not on the workflow internals

```markdown
---
name: skill-name
description: Use when [triggering conditions and symptoms]
---

# Skill Name
## Overview
## When to Use / When Not to Use
## Core Pattern
## Quick Reference
## Implementation
## Common Mistakes
```

## Directory Structure

```text
skills/skill-name/
├── SKILL.md
├── examples/
├── references/
└── scripts/
```

Put only the routing logic and core rules in `SKILL.md`. Push heavy references and extended examples into side files.

## Code Examples

**One excellent example beats many mediocre ones.**

Prefer one real, runnable example over five thin examples in different languages.

## Flowchart Usage

Use flowcharts only for non-obvious branching or loops where agents commonly stop too early. Use plain markdown for linear instructions and reference material.

## The Iron Law

```text
NO SKILL WITHOUT A FAILING TEST FIRST
```

No exceptions for "small doc updates" or "just adding one section".

## Skill Creation Checklist

**RED**

- [ ] Create pressure scenarios or realistic retrieval tasks
- [ ] Run them without the skill
- [ ] Capture exact failures and rationalizations

**GREEN**

- [ ] Write the minimum skill that addresses the observed failures
- [ ] Keep trigger metadata short and precise
- [ ] Add only the references/examples required to teach the missing behavior

**REFACTOR**

- [ ] Add explicit counters for new loopholes
- [ ] Keep `SKILL.md` lean and move detail to side files
- [ ] Re-run the same validation after every material change

## Stop Rule

Do not batch-create multiple skills without validating each one first.

## Integration

- `awf-version-tracker` — snapshot skill changes
- `single-flow-task-execution` — useful when implementing multi-step skill refactors
- `superpowers` pack — deeper TDD and verification references when you need them

---

*writing-skills — Lean Router Architecture*
