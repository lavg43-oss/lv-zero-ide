# TDD for Skills

## The Iron Law

```text
NO SKILL WITHOUT A FAILING TEST FIRST
```

This applies to new skills and edits to existing skills.

## RED

Run realistic prompts or pressure scenarios **without** the skill.

- Record the failures
- Capture exact rationalizations
- Note which ambiguity or missing rule caused the failure

## GREEN

Write the smallest useful skill that fixes the observed failure.

- Add only the sections required to teach the missing behavior
- Put heavy detail into side files
- Re-run the same scenarios

## REFACTOR

If new loopholes appear:

- Add explicit counters
- Tighten the trigger description
- Re-test again

## Test by Skill Type

- **Discipline skills**: pressure scenarios and loophole checks
- **Technique skills**: application on fresh problems
- **Pattern skills**: recognition plus counter-examples
- **Reference skills**: retrieval speed and correct application

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This change is obvious" | Obvious to the author is not evidence. |
| "It is only documentation" | Bad documentation teaches bad behavior. |
| "I'll validate later" | Later usually means never. |
