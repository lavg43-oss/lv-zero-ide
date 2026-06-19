# lv-zero — Autonomous System Architect

> **Open-source Node.js orchestrator powered by DeepSeek API.**  
> Agent-First, Zero Friction. Autonomous System Architect with Electron GUI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](package.json)
[![Electron](https://img.shields.io/badge/Electron-33%2B-47848F?logo=electron)](package.json)

---

## Features

### 🤖 Multi-Provider LLM Support
- **DeepSeek** (primary) — Flash for speed, Pro for reasoning
- **OpenAI-compatible** — Any OpenAI-compatible API (OpenRouter, NVIDIA, etc.)
- **Local models** — Ollama, LM Studio, vLLM, llama.cpp
- **Gemini** — Google Gemini 2.5 Flash (free tier)
- **Automatic fallback** — Circuit breaker + retry chain across providers

### 🧠 Smart Agent Loop
- Streaming responses with real-time reasoning display
- Tool-call repair pipeline (flatten, scavenge, truncation, storm dedup)
- Cache-first prefix stability (Reasonix-inspired)
- Emergency escalation: Flash → Gemini distillation → Pro
- Logical loop detection with auto-recovery

### 🛠️ 40+ Built-in Skills
| Category | Skills |
|----------|--------|
| **Code** | `apply_diff`, `write_to_file`, `file_manager`, `code_mapper`, `code_outline`, `repo_mapper` |
| **Browser** | `browser_automation`, `web_navigator` |
| **QA** | `qa`, `cross_review`, `design_review` |
| **Security** | `security_audit`, `prompt_security`, `verification_gate` |
| **Database** | `db_explorer`, `supabase_connect`, `supabase_sql`, `pg_query` |
| **Research** | `deep_research`, `internet_search` |
| **Documentation** | `documentation`, `build_quarto_deck`, `build_slidev_deck` |
| **System** | `shell_executor`, `sys_inspector`, `model_manager`, `slash_handler` |
| **AI** | `image_generation`, `graphify_explorer`, `graphify_knowledge` |

### 🔌 MCP (Model Context Protocol) Integration
- **60+ preconfigured MCP servers** in registry
- **MCP Client** — Connect to any MCP server (HTTP+SSE, stdio, Streamable HTTP)
- **MCP Server** — Expose lv-zero skills as MCP tools for external AI agents
- **Auto-reconnect** with exponential backoff
- **Health monitoring** with per-server status

### 🔒 Security & Reliability
- **Secret Storage** — AES-256-GCM encrypted credential vault (Electron safeStorage fallback)
- **Prompt Security** — 30+ injection patterns, homoglyph detection, output sanitization
- **Rate Limiting** — Token bucket with named buckets (API, MCP, search)
- **Circuit Breaker** — Prevents cascade failures across providers
- **Crash Recovery** — Auto-detect stale state, restore context
- **Auto-healing** — Periodic health checks with self-repair

### 📋 Sprint Pipeline
```
Think → Plan → Build → Review → Test → Ship → Reflect
```
Connected sprint cycle with artifact passing between stages. Each stage produces artifacts consumed by downstream stages.

### 🖥️ Electron Desktop App
- Native window with Monaco Editor integration
- Real-time streaming of agent reasoning and responses
- Terminal bridge for shell commands
- File explorer with reactive updates
- Settings persistence across sessions

---

## Quick Start

### Prerequisites
- **Node.js** >= 18
- **npm** >= 9
- **API key** from [DeepSeek Platform](https://platform.deepseek.com/api_keys)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/lv-zero.git
cd lv-zero

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your DEEPSEEK_API_KEY

# Run in CLI mode
npm start

# Or run with Electron GUI
npm run electron
```

### First Run

On first launch, lv-zero will:
1. Prompt for your DeepSeek API key (or use the one in `.env`)
2. Load all built-in skills
3. Initialize the MCP server on port 3001
4. Present the agent interface

Type any task in natural language:
```
/plan "Design a REST API for user authentication"
/code "Implement the user registration endpoint"
/debug "Fix the login error"
/sprint "Build a complete user management system"
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes* | — | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com/v1` | API base URL |
| `DEEPSEEK_MODEL` | No | `deepseek-chat` | Default model |
| `LLM_API_KEY` | No | — | Alternative API key (OpenAI-compatible) |
| `LLM_BASE_URL` | No | — | Alternative base URL |
| `LLM_MODEL` | No | — | Alternative model name |
| `MCP_ENABLED_SERVERS` | No | — | Comma-separated MCP server IDs |
| `MAX_TOOL_ITERATIONS` | No | `50` | Max agent loop iterations |
| `TELEMETRY_OPT_OUT` | No | — | Set to `true` to disable telemetry |

*\* Not required if using a local model via `LOCAL_API_URL`*

### MCP Servers

Activate MCP servers by listing their IDs in `MCP_ENABLED_SERVERS`:

```bash
MCP_ENABLED_SERVERS=git,github,docker,postgres,slack
```

See [`.env.example`](.env.example) for the full list of 60+ available servers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    lv-zero Orchestrator                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ LLM      │ │ MCP      │ │ MCP      │ │ Prompt       │  │
│  │ Client   │ │ Client   │ │ Server   │ │ Security     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Secret   │ │ Rate     │ │ Circuit  │ │ State        │  │
│  │ Storage  │ │ Limiter  │ │ Breaker  │ │ Manager      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Skills   │ │ Modes    │ │ Workflows│ │ Telemetry    │  │
│  │ (40+)    │ │ (5)      │ │ (8)      │ │ (opt-in)     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    Electron Shell                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Main     │ │ Renderer │ │ Preload  │ │ Terminal     │  │
│  │ Process  │ │ (UI)     │ │ (Bridge) │ │ Bridge       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Modules

| Module | Path | Description |
|--------|------|-------------|
| Orchestrator | `src/core/orchestrator.js` | Main agent loop, skill execution, mode management |
| LLM Client | `src/core/llm_client.js` | Multi-provider LLM abstraction with fallback |
| MCP Client | `src/mcp_client.js` | MCP protocol client (3 transport modes) |
| MCP Server | `src/mcp_server.js` | Expose skills as MCP tools |
| MCP Registry | `src/mcp_registry.js` | 60+ preconfigured MCP servers |
| Secret Storage | `src/secret_storage.js` | Encrypted credential vault |
| Prompt Security | `src/prompt_security.js` | Injection detection and sanitization |
| Rate Limiter | `src/rate_limiter.js` | Token bucket rate limiting |
| Browser Daemon | `src/browser/daemon.js` | Long-lived Chromium automation |
| Security Scanner | `src/security/scanner.js` | OWASP + secret + dependency scanning |
| Sprint Pipeline | `src/workflows/sprint/pipeline.js` | Connected sprint cycle |
| Skill Loader | `skills/loader/skill_md_loader.js` | Markdown-defined skill support |

---

## Development

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

### Project Structure

```
lv-zero/
├── src/                    # Core source code
│   ├── core/               # Orchestrator, LLM client, providers
│   │   ├── providers/      # LLM provider implementations
│   │   └── memory/         # Memory and state management
│   ├── browser/            # Browser automation daemon
│   ├── security/           # Security scanning engine
│   ├── workflows/          # Workflow system
│   │   ├── lifecycle/      # Standard workflows (/plan, /code, etc.)
│   │   └── sprint/         # Sprint pipeline (7 stages)
│   ├── modes/              # Mode system (architect, code, debug, etc.)
│   ├── telemetry/          # Opt-in usage telemetry
│   ├── mcp_client.js       # MCP protocol client
│   ├── mcp_server.js       # MCP protocol server
│   ├── mcp_registry.js     # MCP server registry
│   ├── mcp_config_manager.js # MCP configuration manager
│   ├── secret_storage.js   # Encrypted credential vault
│   ├── prompt_security.js  # Prompt injection protection
│   ├── rate_limiter.js     # Token bucket rate limiter
│   └── main.cjs            # Electron main process
├── skills/                 # Built-in skills (40+)
│   ├── loader/             # Skill loading infrastructure
│   ├── antigravity/        # Process skills (SKILL.md format)
│   └── review/             # Example Markdown skill
├── ui/                     # Electron renderer (HTML/CSS/JS)
├── tests/                  # Test suite
│   ├── unit/               # Unit tests
│   └── integration/        # Integration tests
├── plans/                  # Development plans (gitignored)
├── .env.example            # Environment template
├── ETHOS.md                # Builder principles
└── package.json
```

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute.

---

## Acknowledgments

- **[gstack](https://github.com/garrytan/gstack)** by Garry Tan — Inspired the sprint pipeline, skill-as-markdown pattern, browser automation daemon, security audit, and cross-model review features
- **[DeepSeek](https://deepseek.com)** — Primary LLM provider
- **[Anthropic](https://anthropic.com)** — Model Context Protocol specification
