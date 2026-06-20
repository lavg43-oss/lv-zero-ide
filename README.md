# lv-zero — Autonomous System Architect (Nivel Cero)

> **Glass-box AI: Construye software mientras aprendes cómo funciona.**
> Sin conocimientos de programación. 100% lenguaje natural. Open Source.

> **⚠️ IMPORTANTE:** lv-zero es una herramienta de ASISTENCIA. Todo el código generado por IA
> debe ser revisado antes de usarse en producción. Los autores no se hacen responsables por
> el uso que se le dé al software. Ver [Términos de Uso](TERMS.md) y [Licencia MIT](LICENSE).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](package.json)
[![Electron](https://img.shields.io/badge/Electron-33%2B-47848F?logo=electron)](package.json)
[![GitHub](https://img.shields.io/badge/GitHub-lvg43--oss%2Flv--zero--ide-blue?logo=github)](https://github.com/lavg43-oss/lv-zero-ide)

---

## 🎯 ¿Qué es lv-zero?

**lv-zero** es un asistente de IA que construye software con solo describírselo en lenguaje natural.

A diferencia de Bolt.new, Lovable o v0 que **esconden el código**, lv-zero usa **Glass-box AI**:
- 👀 **Ves el código** mientras el agente lo escribe en el editor Monaco
- 🎓 **Comentarios didácticos** que explican QUÉ y POR QUÉ en español
- 🌐 **Live Preview** para ver tu app funcionando en tiempo real
- 🚀 **Publicación 1-click** a Cloudflare Pages (GRATIS)
- 🗺️ **Grafo visual** del proyecto para entender cómo se conectan los archivos

---

## ✨ Características Principales

### 🧠 Glass-box AI (Nivel Cero)
- **Comentarios didácticos** — El agente explica el código mientras lo escribe, en español
- **Streaming de pensamiento** — Ves el razonamiento del agente en lenguaje humano
- **Discovery Phase** — Si tu idea es vaga, el agente te hace preguntas para entenderte
- **Onboarding interactivo** — Pantalla de bienvenida con comandos de ejemplo

### 🌐 Live Preview + Publicación
- **Live Preview** — Servidor de desarrollo local con detección automática de frameworks (Vite, Next.js, Astro, SvelteKit, Angular, Node.js, Python, HTML estático)
- **Publicación 1-click** — Cloudflare Pages (500 builds/mes, ancho de banda ilimitado, GRATIS)

### 📋 Sprint Pipeline
```
Discovery → Think → Plan → Build → Review → Test → Ship → Reflect
```
Ciclo completo de desarrollo con artefactos entre etapas.

### 🔌 Google Workspace MCP (GRATIS)
Conecta y manipula:
- 📧 **Gmail** — Enviar, leer, buscar correos
- 📅 **Google Calendar** — Gestionar eventos
- 📁 **Google Drive** — Archivos y carpetas
- 📝 **Google Docs** — Crear y editar documentos
- 📊 **Google Sheets** — Hojas de cálculo, promedios, dashboards
- 📽️ **Google Slides** — Presentaciones (PPT)
- 💬 **Google Meet, Chat, Forms, YouTube, Tasks, Contacts**

### 📂 Multi-Folder Workspace
Trabaja con múltiples carpetas en un solo proyecto (estilo Antigravity IDE 2.0).

### 🤖 Multi-Provider LLM
- **DeepSeek** (principal) — Flash para velocidad, Pro para razonamiento
- **OpenAI-compatible** — OpenRouter, NVIDIA, etc.
- **Modelos locales** — Ollama, LM Studio, vLLM
- **Gemini** — Google Gemini 2.5 Flash (gratuito)
- **Fallback automático** — Circuit breaker + cadena de reintentos

### 🛠️ 40+ Skills Integradas
| Categoría | Skills |
|-----------|--------|
| **Código** | `apply_diff`, `write_to_file`, `file_manager`, `code_mapper`, `repo_mapper` |
| **Navegador** | `browser_automation`, `web_navigator` |
| **QA** | `qa`, `cross_review`, `design_review` |
| **Seguridad** | `security_audit`, `prompt_security`, `verification_gate` |
| **Base de Datos** | `db_explorer`, `supabase_connect`, `supabase_sql`, `pg_query` |
| **Investigación** | `deep_research`, `internet_search` |
| **Documentación** | `documentation`, `build_quarto_deck`, `build_slidev_deck` |
| **Sistema** | `shell_executor`, `sys_inspector`, `model_manager` |
| **IA** | `image_generation`, `graphify_explorer`, `graphify_knowledge` |
| **Cloud** | `cloudflare_publish` — Publicación 1-click |

### 🔌 MCP Registry (60+ Servidores)
Bases de datos, Cloud, DevOps, AI/ML, Monitoreo, Productividad, Web, Seguridad — todos preconfigurados.

---

## 🚀 Quick Start

### Prerrequisitos
- **Node.js** >= 18
- **npm** >= 9

### Instalación

```bash
# Clonar el repositorio
git clone https://github.com/lavg43-oss/lv-zero-ide.git
cd lv-zero-ide

# Instalar dependencias
npm install

# ¡A crear!
npm start
```

### Primer Uso
Al ejecutar `npm start` por primera vez, verás una pantalla de bienvenida que te pedirá:
1. **API Key de DeepSeek** (gratis en https://platform.deepseek.com/api_keys)
2. **Comandos de ejemplo** para empezar

O puedes configurar tu `.env`:
```bash
cp .env.example .env
# Edita .env y agrega tu DEEPSEEK_API_KEY
```

### Ejemplos de uso
Solo escribe en el chat:
```
🌐 "Crea una página web personal con mi foto y nombre"
📱 "Hazme un clon de Facebook"
📊 "Crea una presentación en Google Slides sobre mi proyecto"
📈 "Saca los promedios de este Excel y haz un dashboard"
📧 "Envíame un correo con los resultados"
🚀 "Publica mi app en Cloudflare Pages"
```

---

## 🏗️ Arquitectura

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
│  │ Skills   │ │ Modes    │ │ Workflows│ │ Workspace    │  │
│  │ (40+)    │ │ (5)      │ │ (8)      │ │ Manager      │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Preview  │ │ Graph    │ │ Discovery│ │ Cloudflare   │  │
│  │ Server   │ │ Renderer │ │ Agent    │ │ Publisher    │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    Electron Shell                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Main     │ │ Renderer │ │ Preload  │ │ Terminal     │  │
│  │ Process  │ │ (UI)     │ │ (Bridge) │ │ Bridge       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Módulos Clave

| Módulo | Ruta | Descripción |
|--------|------|-------------|
| Orchestrator | `src/core/orchestrator.js` | Loop principal del agente |
| LLM Client | `src/core/llm_client.js` | Multi-provider con fallback |
| MCP Client | `src/mcp_client.js` | Cliente MCP (3 modos de transporte) |
| MCP Registry | `src/mcp_registry.js` | 60+ servidores MCP preconfigurados |
| Workspace Manager | `src/workspace_manager.js` | Multi-folder workspace |
| Preview Server | `src/preview_server.js` | Live Preview con detección de frameworks |
| Graph Renderer | `src/graph_renderer.js` | Grafo visual del proyecto |
| Discovery Agent | `src/workflows/discovery/discovery_agent.js` | Entrevista para prompts vagos |
| Sprint Pipeline | `src/workflows/sprint/pipeline.js` | Ciclo completo de desarrollo |
| Secret Storage | `src/secret_storage.js` | Bóveda de credenciales encriptada |

---

## 📁 Estructura del Proyecto

```
lv-zero-ide/
├── src/                          # Código fuente
│   ├── core/                     # Orchestrator, LLM, providers
│   │   ├── providers/            # Implementaciones de LLM
│   │   └── memory/               # Memoria y estado
│   ├── workflows/                # Sistema de workflows
│   │   ├── discovery/            # Discovery Agent (entrevista)
│   │   ├── lifecycle/            # Workflows estándar
│   │   └── sprint/               # Pipeline de 7 etapas
│   ├── modes/                    # Sistema de modos
│   ├── integrations/             # Bridges (Cloudflare, Supabase, etc.)
│   ├── mcp_client.js             # Cliente MCP
│   ├── mcp_registry.js           # Registry de servidores MCP
│   ├── mcp_config_manager.js     # Gestor de configuración MCP
│   ├── preview_server.js         # Servidor de Live Preview
│   ├── graph_renderer.js         # Renderizador de grafo visual
│   ├── workspace_manager.js      # Gestor de workspaces multi-carpeta
│   ├── secret_storage.js         # Bóveda de credenciales
│   ├── prompt_security.js        # Protección contra inyección
│   ├── rate_limiter.js           # Rate limiting
│   └── main.js                   # Proceso principal Electron
├── skills/                       # Skills integradas (40+)
│   ├── cloudflare_publish.js     # Publicación 1-click Cloudflare
│   ├── loader/                   # Infraestructura de carga
│   └── antigravity/              # Skills de proceso
├── ui/                           # Interfaz de Electron
│   ├── index.html                # UI principal
│   ├── renderer.js               # Controlador de UI
│   └── styles.css                # Estilos
├── plans/                        # Planes de desarrollo (gitignored)
├── mcp_servers.json              # Configuración de servidores MCP
├── .lv-zero-workspace.json       # Configuración de workspace multi-carpeta
├── .env.example                  # Template de entorno
└── package.json
```

---

## ⚙️ Configuración

### Variables de Entorno

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Sí* | — | API Key de DeepSeek |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com/v1` | URL base de la API |
| `DEEPSEEK_MODEL` | No | `deepseek-chat` | Modelo por defecto |
| `MCP_ENABLED_SERVERS` | No | — | IDs de servidores MCP activos |
| `MAX_TOOL_ITERATIONS` | No | `50` | Iteraciones máximas del agente |
| `CLOUDFLARE_API_TOKEN` | No | — | Token para Cloudflare Pages |
| `CLOUDFLARE_ACCOUNT_ID` | No | — | Account ID de Cloudflare |

*\* No requerida si usas modelo local via `LOCAL_API_URL`*

### Google Workspace MCP
Para usar Gmail, Drive, Docs, Sheets y Slides:
1. Crea un proyecto en https://console.cloud.google.com
2. Habilita las APIs necesarias
3. Crea credenciales OAuth 2.0
4. Ejecuta: `npx -y @pegasusheavy/google-mcp --auth`
5. Agrega las credenciales a `mcp_servers.json`

### Cloudflare Pages
Para publicar en 1 click:
1. Crea un token en https://dash.cloudflare.com/profile/api-tokens
2. Agrega `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` a tu `.env`
3. Usa el botón 🚀 Publicar en la UI

---

## 🧪 Testing

```bash
# Ejecutar todas las pruebas
npm test

# Modo watch
npm run test:watch
```

---

## 📜 Licencia

[MIT](LICENSE) — Libre de usar, modificar y distribuir.

---

## 🙏 Agradecimientos

- **[DeepSeek](https://deepseek.com)** — Proveedor LLM principal
- **[Anthropic](https://anthropic.com)** — Especificación del Model Context Protocol
- **[Pegasus Heavy](https://github.com/pegasusheavy/google-mcp)** — MCP de Google Workspace
- **[Cloudflare](https://cloudflare.com)** — Pages (publicación gratuita)
