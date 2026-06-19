# Contributing to lv-zero

First off, thank you for considering contributing to lv-zero! 🎉 We welcome contributions from everyone, whether you're fixing a bug, adding a feature, improving documentation, or creating a new skill.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Conventions](#commit-message-conventions)
- [Pull Request Process](#pull-request-process)
- [Skill Development Guide](#skill-development-guide)
- [MCP Server Contribution Guide](#mcp-server-contribution-guide)
- [Documentation Guidelines](#documentation-guidelines)

---

## Code of Conduct

This project is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

---

## Getting Started

1. **Fork the repository** — Click the Fork button on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/your-username/lv-zero.git
   cd lv-zero
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/luisavg/lv-zero.git
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

---

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Git**

### Install Dependencies

```bash
npm install
```

### Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your API keys. See [`.env.example`](.env.example) for all available options.

### Run in Development Mode

```bash
# CLI mode
npm start

# Electron IDE
npm run start:app
```

### Run Tests

```bash
# Run all tests
npm test

# Watch mode (re-runs on changes)
npm run test:watch
```

---

## Project Structure

```
lv-zero/
├── src/                          # Core application source
│   ├── entry.mjs                 # Electron ESM entry point
│   ├── main.cjs                  # Electron main process (CJS)
│   ├── main.js                   # Electron main process (ESM, alternative)
│   ├── preload.js                # IPC bridge (contextBridge)
│   ├── index.js                  # CLI entry point
│   ├── orchestrator.js           # Core AI agent engine
│   ├── mcp_client.js             # MCP protocol client
│   ├── mcp_registry.js           # Preconfigured MCP server registry
│   ├── mcp_config_manager.js     # MCP configuration management
│   ├── mcp_server.js             # MCP server wrapper
│   ├── context_manager.js        # Conversation memory management
│   ├── state_manager.js          # Session state persistence
│   ├── tool_call_repair.js       # Tool argument repair pipeline
│   ├── cache_first_loop.js       # Prefix-stable API caching
│   ├── system_prompt.js          # System prompt generation
│   ├── terminal_bridge.js        # Terminal IPC bridge
│   ├── file_bridge.js            # File system IPC bridge
│   ├── prompt_security.js        # Prompt injection protection
│   ├── rate_limiter.js           # API rate limiting
│   ├── secret_storage.js         # Secure credential storage
│   ├── settings_store.js         # User settings persistence
│   ├── shell_utils.js            # Shell utility functions
│   ├── core/                     # Core modules
│   │   ├── orchestrator.js       # Agent orchestration loop
│   │   ├── llm_client.js         # LLM API client abstraction
│   │   ├── circuit_breaker.js    # Circuit breaker for API calls
│   │   ├── context_manager.js    # Context window management
│   │   ├── state_manager.js      # State persistence
│   │   ├── tool_call_repair.js   # Tool call repair pipeline
│   │   ├── cache_first_loop.js   # Cache-first API strategy
│   │   ├── errors.js             # Error types and handling
│   │   ├── memory/               # Memory subsystem
│   │   └── providers/            # LLM provider implementations
│   ├── integrations/             # External service integrations
│   │   ├── cloudflare/
│   │   ├── nodered/
│   │   ├── supabase/
│   │   └── trello/
│   ├── modes/                    # Mode system
│   │   ├── mode_controller.js
│   │   ├── mode_registry.js
│   │   └── prompts/              # Mode-specific system prompts
│   └── workflows/                # Workflow definitions
│       ├── loader.js
│       ├── registry.json
│       └── lifecycle/            # Lifecycle workflow prompts
├── skills/                       # Built-in skills (40+)
│   ├── README.md                 # Skills documentation
│   └── data/                     # Skill data files
├── ui/                           # Electron renderer
│   ├── index.html                # Main HTML
│   ├── renderer.js               # IDE controller
│   └── styles.css                # IDE styles
├── tests/                        # Test files
│   ├── unit/                     # Unit tests
│   └── integration/              # Integration tests
├── .env.example                  # Environment template
├── package.json
└── README.md
```

---

## Coding Standards

### JavaScript/Node.js

- **Language**: ES Modules (`import`/`export`) — the project uses `"type": "module"` in `package.json`
- **Style**: We follow a consistent style enforced by ESLint and Prettier
- **Naming**:
  - `camelCase` for variables, functions, and methods
  - `PascalCase` for classes and constructor functions
  - `UPPER_SNAKE_CASE` for constants
  - `kebab-case` for filenames
- **Async**: Use `async`/`await` over raw promises
- **Error handling**: Always use try/catch blocks; prefer custom error types from [`src/core/errors.js`](src/core/errors.js)
- **Comments**: Use JSDoc for exported functions and complex logic

### ESLint + Prettier

We recommend using ESLint and Prettier for consistent formatting:

```bash
# Install (if not already present)
npm install --save-dev eslint prettier

# Check for issues
npx eslint src/

# Format code
npx prettier --write src/
```

Configuration files:
- ESLint: `.eslintrc.json` (or inline in `package.json`)
- Prettier: `.prettierrc`

### General Guidelines

- Keep functions small and focused (single responsibility)
- Use descriptive variable names — avoid abbreviations
- Prefer `const` over `let`; never use `var`
- Use template literals over string concatenation
- Add early returns to reduce nesting
- Export constants and utilities at the top of files

---

## Testing Guidelines

### Test Framework

We use [Vitest](https://vitest.dev/) for testing.

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Run specific test file
npx vitest run tests/unit/mcp_registry.test.js

# Run with coverage
npx vitest run --coverage
```

### Writing Tests

- Place unit tests in [`tests/unit/`](tests/unit/)
- Place integration tests in [`tests/integration/`](tests/integration/)
- Name test files with the pattern `*.test.js`
- Use descriptive test names that explain the expected behavior
- Mock external services (API calls, databases) to avoid network dependencies

Example test structure:

```js
import { describe, it, expect } from "vitest";
import { myFunction } from "../../src/my-module.js";

describe("myFunction", () => {
  it("should return the expected result when given valid input", () => {
    const result = myFunction({ key: "value" });
    expect(result).toEqual({ success: true });
  });

  it("should throw when given invalid input", () => {
    expect(() => myFunction(null)).toThrow("Invalid input");
  });
});
```

---

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Usage                                      |
|------------|--------------------------------------------|
| `feat`     | A new feature                              |
| `fix`      | A bug fix                                  |
| `docs`     | Documentation changes                      |
| `style`    | Code style changes (formatting, etc.)      |
| `refactor` | Code refactoring without feature changes   |
| `test`     | Adding or updating tests                   |
| `chore`    | Build process, dependencies, tooling       |
| `perf`     | Performance improvements                   |
| `ci`       | CI/CD configuration changes                |

### Examples

```
feat(skills): add new database explorer skill
fix(orchestrator): handle null tool call arguments
docs(readme): update quick start instructions
test(mcp): add integration tests for registry
```

---

## Pull Request Process

### PR Template

```markdown
## Description

Please include a summary of the change and which issue is fixed.

Fixes #(issue)

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to break)
- [ ] Documentation update
- [ ] Test addition/update

## Checklist

- [ ] My code follows the project's coding standards
- [ ] I have added tests that prove my fix/feature works
- [ ] All existing tests pass (`npm test`)
- [ ] My changes generate no new warnings
- [ ] I have updated the documentation accordingly
- [ ] I have added/updated JSDoc comments where appropriate
- [ ] My commits follow the Conventional Commits format

## Additional Context

Add any other context about the PR here.
```

### Steps

1. **Ensure tests pass** — Run `npm test` locally
2. **Update documentation** — If your change affects public APIs or behavior
3. **Write a clear PR description** — Explain what and why
4. **Link related issues** — Use GitHub keywords (`Fixes #123`, `Closes #456`)
5. **Request review** — Tag maintainers or relevant contributors
6. **Address feedback** — Make requested changes and push to your branch
7. **Squash commits** — Before merging, squash into meaningful commits

---

## Skill Development Guide

lv-zero's skill system allows you to extend the agent's capabilities. See the full guide at [`skills/SKILL_DEVELOPMENT.md`](skills/SKILL_DEVELOPMENT.md).

### Quick Start

Create a new file in the [`skills/`](skills/) directory:

```js
// skills/my_skill.js
export default {
  name: "my_skill",
  description: "What my skill does.",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "Input parameter" },
    },
    required: ["input"],
  },
  handler: async ({ input }) => {
    // Your implementation here
    return { result: `Processed: ${input}` };
  },
};
```

Skills are auto-discovered on startup. For dynamic creation, use the `skill_factory` skill.

---

## MCP Server Contribution Guide

lv-zero includes 60+ preconfigured MCP servers. See the full guide at [`MCP_CONTRIBUTION.md`](MCP_CONTRIBUTION.md).

### Quick Start

To add a new MCP server to the registry, edit [`src/mcp_registry.js`](src/mcp_registry.js) and add an entry following the existing format:

```js
{
  id: "my-server",
  name: "My Server",
  description: "What this server provides.",
  type: "stdio",
  command: "npx",
  args: ["@my-org/mcp-server"],
  homepage: "https://github.com/my-org/mcp-server",
  category: "🔧 Development",
  enabled: false,
  env: {
    MY_API_KEY: "Description of this environment variable",
  },
}
```

---

## Documentation Guidelines

- Use **clear, concise language** — avoid jargon where possible
- Write in **English** (all project documentation is in English)
- Use **relative links** for internal references (they work on GitHub)
- Include **code examples** where helpful
- Use **fenced code blocks** with language identifiers
- Keep line length under 100 characters where practical
- Use **descriptive headings** with proper nesting (no skipping levels)
- Add **table of contents** for documents longer than a few sections

---

## Getting Help

- Open a [GitHub Discussion](https://github.com/luisavg/lv-zero/discussions)
- Check existing [Issues](https://github.com/luisavg/lv-zero/issues)
- Review the [README](README.md) for general usage

Thank you for contributing to lv-zero! 🚀
