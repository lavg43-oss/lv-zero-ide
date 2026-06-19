# Adding an MCP Server to the Registry

lv-zero includes a curated registry of 60+ preconfigured MCP (Model Context Protocol) servers. This guide explains how to add a new server to the registry so users can enable it with a single toggle.

---

## Table of Contents

- [Registry Location](#registry-location)
- [Entry Format](#entry-format)
- [Requirements](#requirements)
- [Submission Process](#submission-process)
- [Best Practices](#best-practices)
- [Examples](#examples)

---

## Registry Location

The MCP registry is defined in [`src/mcp_registry.js`](src/mcp_registry.js). It exports an array of server configuration objects:

```js
const MCP_REGISTRY = [
  // ... server entries ...
];

export default MCP_REGISTRY;
```

---

## Entry Format

Each entry in the registry is an object with the following fields:

| Field         | Type      | Required     | Description                                                |
|---------------|-----------|--------------|------------------------------------------------------------|
| `id`          | `string`  | ✅           | Unique identifier (used in `.env` to enable/disable)       |
| `name`        | `string`  | ✅           | Human-readable name                                        |
| `description` | `string`  | ✅           | What the server provides (one sentence)                    |
| `type`        | `string`  | ✅           | Transport type: `"stdio"` or `"http-sse"`                  |
| `command`     | `string`  | for `stdio`  | npm/npx command to run the server                          |
| `args`        | `string[]`| for `stdio`  | Arguments for the command                                  |
| `url`         | `string`  | for `http-sse` | Default endpoint URL for remote servers                  |
| `homepage`    | `string`  | ✅           | Project URL for documentation                              |
| `category`    | `string`  | ✅           | Functional category (see [Categories](#categories))        |
| `enabled`     | `boolean` | ✅           | Default enabled state (`false` = opt-in)                   |
| `env`         | `object`  | optional     | Environment variables the server needs                     |
| `auth`        | `object`  | optional     | Auth configuration if applicable                           |

### Categories

Use one of these category labels:

| Category Label             | Description                          |
|----------------------------|--------------------------------------|
| `🗄️ Databases & Storage`   | Databases, caches, file storage      |
| `☁️ Cloud Platforms`       | Cloud providers, DevOps, containers  |
| `🔧 Development`           | Git, CI/CD, code quality, testing    |
| `🤖 AI / ML`               | AI models, ML platforms              |
| `📊 Monitoring & Analytics`| Observability, logging, analytics    |
| `📝 Productivity`          | Communication, project management    |
| `🌐 Web & Content`         | Web scraping, CMS, e-commerce        |
| `🔒 Security`              | Vulnerability scanning, secrets      |

### `type` Field

- **`"stdio"`** — The server runs as a local child process via `npx`. Requires `command` and `args`.
- **`"http-sse"`** — The server is accessed via a remote HTTP endpoint with Server-Sent Events. Requires `url`.

### `env` Field

An object mapping environment variable names to their descriptions:

```js
env: {
  MY_API_KEY: "Description of what this key is for and where to get it",
  MY_OPTIONAL_CONFIG: "Optional configuration (default: value)",
}
```

### `auth` Field

Optional authentication configuration:

```js
auth: {
  type: "api-key",       // "api-key" | "oauth" | "bearer-token"
  key: "MY_API_KEY",     // Environment variable name for the credential
  instructions: "How to obtain the API key or token",
}
```

---

## Requirements

Before submitting a new MCP server entry, ensure it meets these criteria:

### Must Have

- ✅ **Published npm package** or **public API** — The server must be installable via `npx` or accessible via a public URL
- ✅ **Actively maintained** — The project should have recent commits and responsive maintainers
- ✅ **Clear documentation** — The server must have a README or docs site explaining its usage
- ✅ **Specified environment variables** — All required configuration must be documented in the entry's `env` field

### Should Have

- ✅ **MIT or Apache 2.0 license** — Permissive licenses are preferred
- ✅ **Stable API** — Avoid servers with frequent breaking changes
- ✅ **Security best practices** — No hardcoded secrets, proper input validation

### Should Not

- ❌ Be a wrapper around a proprietary service without public access
- ❌ Require paid subscriptions beyond standard API usage fees
- ❌ Duplicate an existing entry in the registry

---

## Submission Process

### Step 1: Fork the Repository

```bash
git clone https://github.com/your-username/lv-zero.git
cd lv-zero
git remote add upstream https://github.com/luisavg/lv-zero.git
git checkout -b add-mcp-server/my-server-name
```

### Step 2: Add Your Entry

Edit [`src/mcp_registry.js`](src/mcp_registry.js) and add your server entry to the appropriate category section. Follow the existing formatting and alphabetical order within categories.

### Step 3: Verify the Entry

Ensure your entry:

1. Has a unique `id` that doesn't conflict with existing entries
2. Uses the correct category label
3. Has `enabled: false` (all new entries are opt-in by default)
4. Includes all required fields
5. Has clear, descriptive text for the `description` and `env` fields

### Step 4: Test Locally

Add your server's ID to `MCP_ENABLED_SERVERS` in `.env` and start lv-zero:

```bash
MCP_ENABLED_SERVERS=your-server-id npm start
```

Verify the server loads correctly and the agent can discover it.

### Step 5: Submit a Pull Request

1. Commit your changes with a descriptive message:
   ```bash
   git add src/mcp_registry.js
   git commit -m "feat(mcp): add My Server to the registry"
   ```
2. Push to your fork:
   ```bash
   git push origin add-mcp-server/my-server-name
   ```
3. Open a Pull Request on GitHub using the [PR template](CONTRIBUTING.md#pr-template)

---

## Best Practices

### Writing a Good Description

The description is shown to users in the Settings UI and in the `.env.example` comments. Make it clear and actionable:

```js
// Good
description: "Full CRUD, SQL queries, schema introspection, and Row-Level Security for Supabase projects.",

// Too vague
description: "Supabase integration.",
```

### Organizing Environment Variables

List required variables first, then optional ones. Include where to obtain each value:

```js
env: {
  // Required
  SUPABASE_URL: "Your Supabase project URL (https://xxx.supabase.co)",
  SUPABASE_SERVICE_KEY: "Your Supabase service_role key (found in Project Settings → API)",

  // Optional
  SUPABASE_POOL_SIZE: "Connection pool size (default: 10)",
}
```

### Choosing the Right Category

Place your server in the most specific category. If it spans multiple categories, choose the primary one:

- A database server → `🗄️ Databases & Storage`
- A CI/CD tool → `🔧 Development`
- A monitoring tool → `📊 Monitoring & Analytics`

### Keeping Entries Up to Date

If you maintain a server in the registry, please submit PRs to update:

- The `command` or `args` when the npm package changes
- The `description` when new features are added
- The `homepage` URL if the project moves

---

## Examples

### stdio Server (npm package)

```js
{
  id: "example-server",
  name: "Example Server",
  description: "Provides example functionality for demonstration purposes.",
  type: "stdio",
  command: "npx",
  args: ["@example/mcp-server"],
  homepage: "https://github.com/example/mcp-server",
  category: "🔧 Development",
  enabled: false,
  env: {
    EXAMPLE_API_KEY: "Your Example API key (get it at https://example.com/api-keys)",
    EXAMPLE_ENDPOINT: "Custom API endpoint (default: https://api.example.com/v1)",
  },
}
```

### http-sse Server (remote API)

```js
{
  id: "example-remote",
  name: "Example Remote",
  description: "Remote API for example services with SSE streaming.",
  type: "http-sse",
  url: "https://api.example.com/mcp/sse",
  homepage: "https://docs.example.com/mcp",
  category: "🤖 AI / ML",
  enabled: false,
  env: {
    EXAMPLE_API_KEY: "Your Example API key",
  },
  auth: {
    type: "bearer-token",
    key: "EXAMPLE_API_KEY",
    instructions: "Generate a token at https://example.com/settings/tokens",
  },
}
```

---

## Getting Help

- Open a [GitHub Discussion](https://github.com/luisavg/lv-zero/discussions) for questions
- Check existing [Issues](https://github.com/luisavg/lv-zero/issues) for known problems
- Review the [MCP specification](https://modelcontextprotocol.io/) for protocol details

Thank you for contributing to the lv-zero MCP ecosystem! 🚀
