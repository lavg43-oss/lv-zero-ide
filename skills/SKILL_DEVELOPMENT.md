# Skill Development Guide

This guide explains how to create, test, and maintain skills for lv-zero. Skills are the building blocks that give the AI agent its capabilities — each skill is a self-contained function the agent can invoke.

---

## Table of Contents

- [Skill Structure](#skill-structure)
- [Template](#template)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [Testing Your Skill](#testing-your-skill)
- [Submitting Your Skill](#submitting-your-skill)

---

## Skill Structure

Every skill is a JavaScript file in the [`skills/`](../skills/) directory that exports a default object with the following properties:

| Property      | Type     | Required | Description                                                |
|---------------|----------|----------|------------------------------------------------------------|
| `name`        | `string` | ✅       | Unique skill name (snake_case, lowercase)                  |
| `description` | `string` | ✅       | Clear description of what the skill does                   |
| `parameters`  | `object` | ✅       | [JSON Schema](https://json-schema.org/) defining parameters |
| `handler`     | `async function` | ✅ | Async function that executes the skill logic               |

### `name`

- Must be unique across all skills
- Use `snake_case` (e.g., `my_awesome_skill`)
- Should be descriptive but concise

### `description`

- Written for the AI model, not for humans
- Clearly state what the skill does, when to use it, and any side effects
- Keep it under 200 characters if possible

### `parameters`

A [JSON Schema](http://json-schema.org/) object defining the skill's input parameters:

```js
parameters: {
  type: "object",
  properties: {
    param1: {
      type: "string",
      description: "Description of param1",
    },
    param2: {
      type: "number",
      description: "Description of param2",
      default: 42,
    },
  },
  required: ["param1"],
}
```

Supported types: `string`, `number`, `integer`, `boolean`, `array`, `object`

### `handler`

An async function that receives the validated parameters and returns a result:

```js
handler: async ({ param1, param2 }) => {
  // Implementation
  return { success: true, data: result };
};
```

The return value can be any JSON-serializable value. It will be sent back to the AI model as the tool call result.

---

## Template

Use this template as a starting point for new skills:

```js
/**
 * my_skill.js — Description of what this skill does
 *
 * This skill is auto-discovered by lv-zero's skill loader.
 * Add JSDoc comments to explain complex logic.
 */

// ── Imports ─────────────────────────────────────────────────────────────────
// Import only what you need. Prefer standard Node.js modules when possible.
import fs from "fs";
import path from "path";

// ── Constants ───────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT = 30000;

// ── Skill Definition ────────────────────────────────────────────────────────
export default {
  name: "my_skill",
  description: "Performs a specific task. Use this when you need to accomplish X.",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "The input to process.",
      },
      options: {
        type: "object",
        description: "Optional configuration.",
        properties: {
          verbose: {
            type: "boolean",
            description: "Enable verbose output.",
            default: false,
          },
          timeout: {
            type: "number",
            description: "Operation timeout in milliseconds.",
            default: DEFAULT_TIMEOUT,
          },
        },
      },
    },
    required: ["input"],
  },
  handler: async ({ input, options = {} }) => {
    const { verbose = false, timeout = DEFAULT_TIMEOUT } = options;

    try {
      // ── Progress Reporting ──────────────────────────────────────────────
      // Use console.error for progress messages (they don't interfere with
      // the return value but are visible in the agent's logs).
      console.error(`[my_skill] Processing input: ${input}`);

      // ── Validation ──────────────────────────────────────────────────────
      if (!input || typeof input !== "string") {
        throw new Error("Input must be a non-empty string");
      }

      // ── Core Logic ──────────────────────────────────────────────────────
      const result = await processInput(input, { verbose, timeout });

      // ── Return ──────────────────────────────────────────────────────────
      return {
        success: true,
        data: result,
        meta: {
          processedAt: new Date().toISOString(),
          inputLength: input.length,
        },
      };
    } catch (error) {
      console.error(`[my_skill] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Process the input with the given options.
 * @param {string} input - The input string to process
 * @param {object} options - Processing options
 * @returns {Promise<string>} The processed result
 */
async function processInput(input, options) {
  // Your implementation here
  return `Processed: ${input}`;
}
```

---

## Best Practices

### Error Handling

- Always wrap your handler logic in a try/catch block
- Return structured error objects, never throw uncaught exceptions
- Use meaningful error messages that help the AI model understand what went wrong
- Validate parameters at the start of the handler

```js
// Good
handler: async ({ path }) => {
  try {
    if (!path) throw new Error("Path parameter is required");
    const content = await fs.promises.readFile(path, "utf-8");
    return { success: true, content };
  } catch (error) {
    return { success: false, error: `Failed to read file: ${error.message}` };
  }
};
```

### Progress Reporting

- Use `console.error()` for progress messages — these are captured by the orchestrator but don't interfere with the return value
- Report progress for long-running operations
- Keep progress messages concise

```js
console.error(`[my_skill] Step 1 of 3: Validating input...`);
// ... do work ...
console.error(`[my_skill] Step 2 of 3: Processing data...`);
// ... do work ...
console.error(`[my_skill] Step 3 of 3: Finalizing...`);
```

### Parameter Validation

- Validate all required parameters at the start of the handler
- Provide sensible defaults for optional parameters
- Use JSON Schema constraints (e.g., `minLength`, `maximum`, `enum`) in the parameters definition

```js
parameters: {
  type: "object",
  properties: {
    email: {
      type: "string",
      description: "Valid email address",
      pattern: "^[\\w.-]+@[\\w.-]+\\.\\w+$",
    },
    count: {
      type: "integer",
      description: "Number of results",
      minimum: 1,
      maximum: 100,
      default: 10,
    },
  },
  required: ["email"],
},
```

### Return Format

- Always return a JSON-serializable object
- Include a `success` boolean for easy checking
- Include meaningful `data` or `error` fields
- Add `meta` with metadata when helpful (timestamps, counts, etc.)

```js
// Success
{ success: true, data: { items: [...], total: 42 } }

// Error
{ success: false, error: "File not found: /path/to/file" }
```

### Performance

- Avoid blocking the event loop — use async I/O
- Set reasonable timeouts for external operations
- Clean up resources (file handles, connections) in a `finally` block
- Cache expensive computations when appropriate

### Security

- Never expose API keys or secrets in skill output
- Validate file paths to prevent directory traversal
- Sanitize any user-provided input before using it in shell commands
- Use the project's permission system for sensitive operations

---

## Examples

### Simple Skill (Hello World)

```js
// skills/hello_world.js
export default {
  name: "hello_world",
  description: "A simple greeting skill. Returns a personalized greeting message.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name to greet.",
      },
    },
    required: ["name"],
  },
  handler: async ({ name }) => {
    return {
      success: true,
      message: `Hello, ${name}! Welcome to lv-zero.`,
    };
  },
};
```

### Skill with Parameters

```js
// skills/calculator.js
export default {
  name: "calculator",
  description: "Performs basic arithmetic operations on two numbers.",
  parameters: {
    type: "object",
    properties: {
      a: {
        type: "number",
        description: "First operand.",
      },
      b: {
        type: "number",
        description: "Second operand.",
      },
      operation: {
        type: "string",
        description: "Arithmetic operation.",
        enum: ["add", "subtract", "multiply", "divide"],
      },
    },
    required: ["a", "b", "operation"],
  },
  handler: async ({ a, b, operation }) => {
    const operations = {
      add: (x, y) => x + y,
      subtract: (x, y) => x - y,
      multiply: (x, y) => x * y,
      divide: (x, y) => (y === 0 ? NaN : x / y),
    };

    const result = operations[operation](a, b);

    if (operation === "divide" && b === 0) {
      return { success: false, error: "Division by zero is not allowed" };
    }

    return {
      success: true,
      data: { operation, a, b, result },
    };
  },
};
```

### Skill That Calls Other Skills

```js
// skills/analyze_and_report.js
export default {
  name: "analyze_and_report",
  description: "Analyzes a file and generates a summary report.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Path to the file to analyze.",
      },
    },
    required: ["filePath"],
  },
  handler: async ({ filePath }, context) => {
    // Skills can access other skills via the context parameter
    const fileManager = context.skills?.find(s => s.name === "file_manager");
    if (!fileManager) {
      return { success: false, error: "file_manager skill not available" };
    }

    // Read the file using the file_manager skill
    const readResult = await fileManager.handler({
      action: "read",
      path: filePath,
    });

    if (!readResult.success) {
      return readResult;
    }

    // Generate report
    const lines = readResult.content.split("\n");
    return {
      success: true,
      data: {
        filePath,
        lineCount: lines.length,
        charCount: readResult.content.length,
        preview: lines.slice(0, 5).join("\n"),
      },
    };
  },
};
```

### Skill with MCP Integration

```js
// skills/github_status.js
export default {
  name: "github_status",
  description: "Checks the status of a GitHub repository using the GitHub MCP server.",
  parameters: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "Repository owner (user or organization).",
      },
      repo: {
        type: "string",
        description: "Repository name.",
      },
    },
    required: ["owner", "repo"],
  },
  handler: async ({ owner, repo }) => {
    // This skill expects the GitHub MCP server to be enabled.
    // The MCP client handles the actual communication.
    return {
      success: true,
      message: `To check ${owner}/${repo}, enable the 'github' MCP server in your .env file.`,
      hint: "Add 'github' to MCP_ENABLED_SERVERS in .env",
    };
  },
};
```

---

## Testing Your Skill

1. **Manual testing**: Start lv-zero and ask the agent to use your skill
2. **Unit testing**: Create a test file in [`tests/unit/`](../tests/unit/)

```js
// tests/unit/my_skill.test.js
import { describe, it, expect } from "vitest";
import mySkill from "../../skills/my_skill.js";

describe("my_skill", () => {
  it("should export the required fields", () => {
    expect(mySkill).toHaveProperty("name");
    expect(mySkill).toHaveProperty("description");
    expect(mySkill).toHaveProperty("parameters");
    expect(mySkill).toHaveProperty("handler");
  });

  it("should process valid input", async () => {
    const result = await mySkill.handler({ input: "test" });
    expect(result.success).toBe(true);
  });

  it("should reject invalid input", async () => {
    const result = await mySkill.handler({ input: "" });
    expect(result.success).toBe(false);
    expect(result).toHaveProperty("error");
  });
});
```

Run tests with:

```bash
npm test
```

---

## Submitting Your Skill

1. Create your skill file in [`skills/`](../skills/)
2. Add tests in [`tests/unit/`](../tests/unit/)
3. Update [`skills/README.md`](../skills/README.md) if your skill is a significant addition
4. Submit a pull request following the [contributing guidelines](../CONTRIBUTING.md)

---

## Additional Resources

- [Skill Factory](../skills/skill_factory.js) — Dynamically create skills from conversation
- [Skill Bridge](../skills/skill_bridge.js) — Bridge to external skill libraries
- [Skills README](../skills/README.md) — Overview of all built-in skills
- [JSON Schema Reference](https://json-schema.org/understanding-json-schema/)
