# Init Workflow — Spec-First Pipeline

> **Purpose:** Initialize a new project with a complete spec-first foundation
> **Steps:** 5 (Environment → Context → Skeleton → Spec → Handover)
> **Based on:** Antigravity `/init` workflow v5.0
> **Status:** Non-blocking — project creation succeeds regardless of pipeline outcome

---

## Step 1: Environment Check

Verify that the development environment has the required tools and versions.

### Checks performed:
- **Node.js** — Check `node --version`, must be >= 18
- **npm** — Check `npm --version`, must be >= 8
- **Git** — Check `git --version`, must be installed
- **Python** (optional) — Check `python --version`, warn if < 3.8 or missing

### Output:
```json
{
  "step": "environment",
  "ok": true,
  "checks": {
    "node": { "ok": true, "version": "22.14.0" },
    "npm": { "ok": true, "version": "10.9.2" },
    "git": { "ok": true, "version": "2.47.0" },
    "python": { "ok": false, "version": null, "optional": true }
  }
}
```

---

## Step 2: Context Awareness

Scan the existing project directory to detect structure, languages, and frameworks.

### Detection:
- **package.json** → Node.js project, detect dependencies and frameworks
- **requirements.txt** → Python project
- **Dockerfile** → Containerized project
- **Makefile** → Build system
- **.gitignore** → Git configuration
- **README.md** → Existing documentation
- **Source directories** → `src/`, `lib/`, `app/`, `client/`, `server/`

### Output:
```json
{
  "step": "context",
  "ok": true,
  "detected": {
    "hasPackageJson": true,
    "hasRequirementsTxt": false,
    "hasDockerfile": false,
    "hasMakefile": false,
    "hasGitignore": true,
    "hasReadme": false,
    "frameworks": ["electron", "express"],
    "languages": ["javascript"],
    "srcDirs": ["src/", "ui/"]
  }
}
```

---

## Step 3: Project Skeleton

Ensure the project has the required lv-zero directory structure.

### Directories to create:
- `.lv-zero/` — If not already present (created by `project:new`)
- `.lv-zero/config.json` — Project identity (created by Phase 1)
- `mapa-del-proyecto/` — Project map directory (created by `project:new`)

### Verification:
- All required directories exist
- At least a minimal `.lv-zero/config.json` is present
- Create any missing structure without overwriting existing files

---

## Step 4: Spec Generation

Generate the 4 core specification files from project identity and context.

### Files generated:

| File | Purpose | Template |
|------|---------|----------|
| `PROJECT.md` | Project overview, vision, tech stack | Identity + Context |
| `REQUIREMENTS.md` | Functional and non-functional requirements | Identity type |
| `ROADMAP.md` | Phased development plan (MVP → Polish) | Identity stage |
| `TECH-SPEC.md` | Architecture, components, data flow | Identity + Context |

### Generation rules:
- Each file is generated independently (failure of one doesn't block others)
- Content is based on the project identity config (type, stage, languages, frameworks)
- Context awareness data enriches the templates
- Files are written to the project root

---

## Step 5: Handover Report

Generate a summary of what was created and next steps.

### Report content:
```json
{
  "step": "handover",
  "ok": true,
  "generated": ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "TECH-SPEC.md"],
  "skipped": [],
  "errors": [],
  "summary": "4/4 spec files generated successfully",
  "nextSteps": [
    "Review and customize PROJECT.md with your project vision",
    "Fill in specific requirements in REQUIREMENTS.md",
    "Adjust milestones in ROADMAP.md to match your timeline",
    "Refine TECH-SPEC.md with detailed architecture decisions"
  ]
}
```

---

## Pipeline Result

After all 5 steps, the pipeline returns:

```json
{
  "status": "ok",
  "steps": [
    { "name": "environment", "ok": true, "details": { ... } },
    { "name": "context", "ok": true, "details": { ... } },
    { "name": "skeleton", "ok": true, "details": { ... } },
    { "name": "spec", "ok": true, "details": { "generated": [...] } },
    { "name": "handover", "ok": true, "details": { ... } }
  ]
}
```

If some steps fail, the status is `"partial"` and the report includes error details. Project creation is never blocked by pipeline failures.
