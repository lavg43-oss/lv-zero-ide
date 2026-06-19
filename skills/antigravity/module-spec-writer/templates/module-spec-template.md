# Module Spec Template

```markdown
# 📋 Module Spec: [Module Name]

**Project:** [project-name]
**Version:** 1.0
**Created:** [date]
**Status:** Draft | Approved

---

## Overview
[1-2 câu mô tả mục đích module này trong app]

## Dependencies
- **Depends on:** [list modules this depends on]
- **Used by:** [list modules that depend on this]
- **Shared services:** [auth, analytics, etc.]

---

## Screen Inventory

| # | Screen Name | Type | Key Elements | Notes |
|---|------------|------|--------------|-------|
| 1 | [name] | [full/modal/sheet/overlay/tab] | [main UI components] | [optional] |

---

## User Flows

### Flow 1: [Happy Path Name]
**Entry:** [how user gets here]
**Steps:**
1. User [action] → Screen [A]
2. User [action] → System [response]
3. System [shows/navigates] → Screen [B]
4. **End state:** [what user sees/has achieved]

### Flow 2: [Alternative Path / Error Path]
**Trigger:** [what causes this path]
**Steps:**
1. ...

---

## Business Rules

| ID | Rule | Details |
|----|------|---------|
| BR-01 | [rule name] | [full description] |
| BR-02 | [rule name] | [full description] |

---

## Validation Rules

| Field | Condition | Error Message | Screen |
|-------|-----------|---------------|--------|
| [field] | [rule] | [message] | [where] |

---

## Data Contracts

### Input (consumed by this module)
| Data | Type | Source | Required |
|------|------|--------|----------|
| [name] | [type] | [module/API/local] | [yes/no] |

### Output (produced by this module)
| Data | Type | Destination | Trigger |
|------|------|-------------|---------|
| [name] | [type] | [module/API/local] | [when] |

---

## Edge Cases & Error States

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-01 | [scenario] | [what should happen] |
| EC-02 | [scenario] | [what should happen] |

---

## Transitions & Micro-interactions (Mobile)

| Screen/Element | Animation Type | Details |
|----------------|---------------|---------|
| [List/Grid screen] | Staggered fade+slide | Items appear sequentially (50ms delay) |
| [Stats/Dashboard] | Number counter | Values roll/count up from 0 |
| [Navigation A→B] | Hero / Shared element | [which element animates across] |
| [Modal/Sheet] | Spring damping | Spring-based open/close |
| [Buttons/Cards] | Scale on press | Scale 0.95 + haptic impact(light) |
| [Success state] | Checkmark draw | Animated stroke white→green |
| [Error state] | Shake | Horizontal oscillation on invalid field |
| [Toggle/Switch] | Spring bounce | Spring physics + optional haptic |
| [Like/Favorite] | Pulse/Particle | Scale pulse or burst effect |

> Fill only relevant rows. Delete unused ones. Add custom animations as needed.

---

## Acceptance Criteria
- [ ] [measurable criterion 1]
- [ ] [measurable criterion 2]
- [ ] [measurable criterion 3]
- [ ] All loading states use skeleton→content morph transitions (no instant pop-in)
- [ ] All tappable elements have scale-on-press feedback
- [ ] Haptic feedback integrated for key interactions
```

---

# Module Index Template

```markdown
# 📚 Module Index: [Project Name]

**Total modules:** [N]
**Created:** [date]
**Status:** [All Approved / Some Draft]

| # | Module | Spec File | Screens | Status |
|---|--------|-----------|---------|--------|
| 1 | [name] | [link to spec file] | [count] | Approved |
| 2 | [name] | [link to spec file] | [count] | Draft |

## Dependency Graph
[Module A] → [Module B] → [Module C]
[Module D] → [Module B]

## Shared Services
- **Auth:** Used by [modules]
- **Analytics:** Used by [modules]
- **AI/ML:** Used by [modules]
```
