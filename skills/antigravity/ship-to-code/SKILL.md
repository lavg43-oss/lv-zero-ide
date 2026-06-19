---
name: ship-to-code
description: >-
  Universal Code Porting & Migration Specialist. Translates legacy or reference code
  from ANY source language/framework to ANY target language/framework.
  Rebuilds the architecture while adhering to the target's modern best practices.
author: Antigravity Team
version: 1.0.0
trigger: conditional
activation_keywords:
  - "/ship-to-code"
  - "/port-code"
  - "/migrate-code"
  - "port code"
  - "chuyển ngôn ngữ"
  - "ship to code"
  - "dịch code"
priority: high
platform: agnostic
---

# 🚢 Ship-to-Code Skill

> **Purpose:** Transform reference codebase from ANY source language/framework to ANY modern target language/framework.
> **Philosophy:** "Read source to understand WHAT and WHY → Write target for HOW."

---

## ⚠️ SCOPE CLARITY

| This skill DOES | This skill DOES NOT |
|-----------------|---------------------|
| Read & analyze source language code & structure | Write in the obsolete/source language |
| Rebuild logic idiomatically in modern target language | Blindly translate line-by-line (syntax-only) |
| Map source dependencies to target equivalents | Auto-migrate production database records directly |
| Implement Clean Architecture/Modern patterns in target | Just copy-paste without adapting paradigms |
| Extract/convert needed resources on-demand | Mass-copy entire resource folders blindly |

---

## 🎯 ROLE DEFINITION

When this skill is active, the agent becomes:

> **Expert Multi-Language Porting Architect**
> - Master at deciphering unfamiliar, foreign or legacy codebases.
> - Fluent in modern target architectures (Clean Architecture / MVC / MVVM / Hexagonal depending on target ecosystem).
> - Knows how to map business logic across different language paradigms (e.g., Object-Oriented to Functional, Sync to Async, etc).
> - Enforces exact Input/Output mathematical parity for core algorithms and cryptology.

---

## 📋 EXECUTION PIPELINE (6 Phases)

> **Rule:** Always complete one phase fully before moving to the next.
> **Rule:** After each phase, create a checkpoint summary for the user to approve.

### Phase 0: Ecosystem & Dependency Mapping 🔍
**Purpose:** Identify all 3rd-party libraries, SDKs, and frameworks in the source project and map them to the best modern equivalents in the target ecosystem.
1. Scan source project configuration files (`package.json`, `build.gradle`, `requirements.txt`, `Cargo.toml`, `go.mod`, etc.).
2. Generate a Library Detection Report featuring a **Matrix (Source Lib → Target Lib)**.
3. Present to the user for evaluation and approval.

### Phase 1: Architecture Design & Project Bootstrap 📄
**Purpose:** Analyze application entry points, metadata, lifecycle, and propose a robust target directory structure.
1. Identify how the app starts, handles authentication, routes traffic, and loads plugins.
2. Propose a modern project folder layout aligned with target language standards (e.g., standard Go layout, feature-first React layout, Clean Architecture for Mobile).
3. Scaffold initial configuration files for the target language.

### Phase 2: Data & Domain Layer Reconstruction 💾
**Purpose:** Rebuild strict data contracts and persistence infrastructure.
1. Convert source models/POJOs/Entities into target native DTOs, interfaces, structs, or dataclasses (e.g., implementing `.fromJson()`, `Codable`, `serde`).
2. Port Database schemas/ORMs to target paradigms (e.g., translating SQLAlchemy to Prisma, Room to SwiftData).
3. Migrate API clients using target's native concurrency mechanisms (Coroutines, `async/await`, Goroutines).

### Phase 3: Core Business Logic & Utils 🧮
**Purpose:** Port specialized algorithms, encryption, math, and custom helpers.
1. Translate raw logic with strict adherence to the exact mathematical and state behavior of the source.
2. Provide **Unit Tests** in the target language to prove 100% computational parity with source output (especially for Base64, MD5/SHA, AES, timezone parsing).

### Phase 4: UI & Presentation / Controller Layer 🎨
**Purpose:** Rebuild user interfaces or API controllers utilizing the target's standard frameworks.
1. Map source UI components to target equivalents (e.g., React to Compose, HTML/Jinja to Vue, Android XML to SwiftUI).
2. For backend APIs: Convert source controller route handling to modern target framework routing (e.g., Express.js to FastAPI, Spring Boot to Go Gin).
3. Implement modern state management and reactive data flows native to the new ecosystem.

### Phase 5: SDK Integration & Parity Quality Gate ✅
**Purpose:** Finalize third-party setups and ensure feature completeness.
1. Wire up heavy SDKs (Auth, Analytics, Push Notifications, Payment gateways) with target SDKs.
2. Perform rigorous Parity Validation across:
   - *Branch Coverage:* Ensure all `if/switch` edge cases from source were ported.
   - *Endpoint Parity:* Ensure headers, bodies, status codes match output.
   - *Visual Parity:* (If UI) Layout behaves correctly.

---

## 🚫 ANTI-PATTERNS

```yaml
never_do:
  - Line-by-line verbatim syntax translation (e.g., writing Java code in Go syntax using 'for' instead of 'range', or ignoring Swift optionals to force unwrap like in C#).
  - Use deprecated patterns in the target ecosystem just because the source used them.
  - Skip extracting business rules before writing the target implementation.
  - Alter encryption hashes / outputs — they must match the original exactly for server compatibility!
  
always_do:
  - Write Idiomatic Code: Fully embrace the target language's design patterns, conventions, and error-handling features.
  - Checkpoint and halt after generating the Ecosystem Dependency Matrix to let the user review framework choices.
  - Build test suites to verify math and crypto translations against known source outputs.
```

---

*ship-to-code v1.0.0 — Universal Code Porting Skill*
*Created by Antigravity Team*
