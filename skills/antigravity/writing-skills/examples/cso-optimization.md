# Skill Search Optimization

Future sessions need to discover the skill quickly from a short description and a few trigger words.

## 1. Description Field

Descriptions decide whether the skill gets loaded at all.

- Start with `Use when...`
- Describe trigger conditions, symptoms, or user intent
- Do not summarize the workflow in the description

```yaml
# Bad: summarizes workflow
description: Use when executing plans and doing review after each task

# Good: describes trigger conditions only
description: Use when executing implementation plans with multiple independent tasks in the current session
```

## 2. Keyword Coverage

Use the words an agent would actually search for:

- Error strings
- Observable symptoms
- Synonyms for the same failure mode
- Tool names and file types when relevant

## 3. Naming

Prefer clear, active names:

- `writing-skills` over `skill-documentation`
- `systematic-debugging` over `debug-help`

## 4. Token Discipline

- Keep `SKILL.md` lean
- Move heavy detail into `examples/`, `references/`, or scripts
- Avoid repeating the same rule in multiple sections

## 5. Cross-Referencing

Prefer skill names or local relative paths over platform-specific hardcoded paths.

```markdown
✅ **Required skill:** `test-driven-development`
✅ See `examples/tdd-for-skills.md`
❌ Hardcode `.agent/skills/...`
❌ Force-load with `@...` when a plain reference is enough
```
