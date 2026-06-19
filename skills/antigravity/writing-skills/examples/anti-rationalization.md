# Bulletproofing Skills Against Rationalization

Skills that enforce discipline need to resist rationalization. Agents will look for loopholes under pressure.

## Close Every Loophole Explicitly

Do not just state the rule. Forbid the common workarounds.

```markdown
# Bad
Write code before test? Delete it.

# Good
Write code before test? Delete it. Start over.

**No exceptions:**
- Do not keep it as "reference"
- Do not adapt it while writing tests
- Do not look at it
- Delete means delete
```

## Address Spirit-vs-Letter Arguments

Add the foundational rule early:

```markdown
**Violating the letter of the rules is violating the spirit of the rules.**
```

## Build a Rationalization Table

Every repeated excuse should become an explicit counter-rule.

```markdown
| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code still breaks. |
| "I'll test after" | Tests-after answers a different question. |
| "This case is special" | Special pleading is how process discipline collapses. |
```

## Create a Red Flags List

```markdown
## Red Flags
- Code before test
- "I already checked manually"
- "Close enough"
- "I'll tighten it later"
```

When these appear, stop and re-run the intended process.
