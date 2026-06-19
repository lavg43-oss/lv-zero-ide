/**
 * mcp_registry.js — Preconfigured MCP Server Registry (June 2026)
 *
 * A curated list of the most popular and useful MCP servers as of June 2026.
 * Users can enable/disable them via .env (MCP_ENABLED_SERVERS)
 * or via the Settings UI in the Electron renderer.
 *
 * Each entry includes:
 *   id          – Unique identifier (used in .env to enable/disable)
 *   name        – Human-readable name
 *   description – What the server provides
 *   type        – Transport type: "stdio" (local process) or "http-sse" (remote)
 *   command     – npm/npx command to run the server (for stdio type)
 *   args        – Arguments for the command
 *   url         – Default endpoint URL (for http-sse type)
 *   homepage    – Project URL for documentation
 *   category    – Functional category
 *   enabled     – Default enabled state (false = opt-in)
 *   env         – Environment variables the server needs (key → description)
 *   auth        – Auth configuration if applicable
 */

const MCP_REGISTRY = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 🗄️  Databases & Storage
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "supabase",
    name: "Supabase",
    description: "Full CRUD, SQL queries, schema introspection, and Row-Level Security for Supabase projects.",
    type: "stdio",
    command: "npx",
    args: ["@supabase/mcp-server-supabase"],
    homepage: "https://supabase.com/docs/guides/platform/mcp",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      SUPABASE_URL: "Your Supabase project URL (https://xxx.supabase.co)",
      SUPABASE_SERVICE_KEY: "Your Supabase service_role key",
    },
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Direct PostgreSQL database introspection, query execution, schema management, and migration support.",
    type: "stdio",
    command: "npx",
    args: ["@anthropic/mcp-server-postgres"],
    homepage: "https://github.com/anthropics/mcp-server-postgres",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      DATABASE_URL: "PostgreSQL connection string (postgresql://user:pass@host:5432/db)",
    },
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Browse, query, and manage SQLite databases with schema visualization and migration support.",
    type: "stdio",
    command: "npx",
    args: ["@anthropic/mcp-server-sqlite"],
    homepage: "https://github.com/anthropics/mcp-server-sqlite",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      SQLITE_DB_PATH: "Path to your SQLite database file",
    },
  },
  {
    id: "redis",
    name: "Redis",
    description: "Interact with Redis databases: key-value operations, pub/sub, cache management, and cluster monitoring.",
    type: "stdio",
    command: "npx",
    args: ["@redis/mcp-server-redis"],
    homepage: "https://github.com/redis/mcp-server-redis",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      REDIS_URL: "Redis connection URL (redis://localhost:6379)",
    },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description: "MongoDB database operations: CRUD, aggregation pipelines, indexes, and schema analysis.",
    type: "stdio",
    command: "npx",
    args: ["@mongodb/mcp-server-mongodb"],
    homepage: "https://github.com/mongodb/mcp-server-mongodb",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      MONGODB_URI: "MongoDB connection string (mongodb://user:pass@host:27017/db)",
    },
  },
  {
    id: "mysql",
    name: "MySQL",
    description: "MySQL/MariaDB database operations: queries, schema management, and performance analysis.",
    type: "stdio",
    command: "npx",
    args: ["@mysql/mcp-server-mysql"],
    homepage: "https://github.com/mysql/mcp-server-mysql",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      MYSQL_URL: "MySQL connection string (mysql://user:pass@host:3306/db)",
    },
  },
  {
    id: "dynamodb",
    name: "DynamoDB",
    description: "AWS DynamoDB operations: table management, queries, scans, and capacity planning.",
    type: "stdio",
    command: "npx",
    args: ["@aws/mcp-server-dynamodb"],
    homepage: "https://github.com/awslabs/mcp-server-dynamodb",
    category: "🗄️ Databases & Storage",
    enabled: false,
    env: {
      AWS_REGION: "AWS region (e.g., us-east-1)",
      AWS_ACCESS_KEY_ID: "AWS access key",
      AWS_SECRET_ACCESS_KEY: "AWS secret key",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ☁️  Cloud Platforms & DevOps
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Manage Cloudflare DNS, Workers, KV, R2, D1, Queues, and AI Gateway via the Cloudflare API.",
    type: "stdio",
    command: "npx",
    args: ["@cloudflare/mcp-server-cloudflare"],
    homepage: "https://github.com/cloudflare/mcp-server-cloudflare",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      CLOUDFLARE_API_TOKEN: "Cloudflare API token with appropriate permissions",
      CLOUDFLARE_ACCOUNT_ID: "Your Cloudflare account ID",
    },
  },
  {
    id: "aws",
    name: "AWS",
    description: "Full AWS management: EC2, S3, Lambda, IAM, CloudFormation, ECS, RDS, and 200+ services.",
    type: "stdio",
    command: "npx",
    args: ["@aws/mcp-server-aws"],
    homepage: "https://github.com/awslabs/mcp-server-aws",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      AWS_ACCESS_KEY_ID: "AWS access key ID",
      AWS_SECRET_ACCESS_KEY: "AWS secret access key",
      AWS_REGION: "Default AWS region (e.g., us-east-1)",
      AWS_SESSION_TOKEN: "Optional: AWS session token for temporary credentials",
    },
  },
  {
    id: "gcp",
    name: "Google Cloud",
    description: "Manage GCP resources: Compute Engine, GKE, Cloud Storage, Cloud Run, IAM, BigQuery, and more.",
    type: "stdio",
    command: "npx",
    args: ["@google/mcp-server-gcp"],
    homepage: "https://github.com/GoogleCloudPlatform/mcp-server-gcp",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      GOOGLE_APPLICATION_CREDENTIALS: "Path to GCP service account JSON key file",
      GCP_PROJECT_ID: "Your GCP project ID",
    },
  },
  {
    id: "azure",
    name: "Azure",
    description: "Manage Azure resources: VMs, App Services, Blob Storage, Functions, AKS, CosmosDB, and more.",
    type: "stdio",
    command: "npx",
    args: ["@azure/mcp-server-azure"],
    homepage: "https://github.com/Azure/mcp-server-azure",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      AZURE_SUBSCRIPTION_ID: "Your Azure subscription ID",
      AZURE_TENANT_ID: "Your Azure tenant ID",
      AZURE_CLIENT_ID: "Service principal client ID",
      AZURE_CLIENT_SECRET: "Service principal client secret",
    },
  },
  {
    id: "docker",
    name: "Docker",
    description: "Manage Docker containers, images, volumes, networks, and Compose stacks. Supports Docker Compose v2.",
    type: "stdio",
    command: "npx",
    args: ["@docker/mcp-server-docker"],
    homepage: "https://github.com/docker/mcp-server-docker",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Manage Kubernetes clusters: pods, deployments, services, configmaps, secrets, Helm charts, and monitoring.",
    type: "stdio",
    command: "npx",
    args: ["@kubernetes/mcp-server-kubernetes"],
    homepage: "https://github.com/kubernetes-sigs/mcp-server-kubernetes",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      KUBECONFIG: "Path to kubeconfig file (default: ~/.kube/config)",
    },
  },
  {
    id: "terraform",
    name: "Terraform / OpenTofu",
    description: "Plan, apply, and manage Terraform/OpenTofu infrastructure as code. Supports state management and module registry.",
    type: "stdio",
    command: "npx",
    args: ["@hashicorp/mcp-server-terraform"],
    homepage: "https://github.com/hashicorp/mcp-server-terraform",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      TERRAFORM_WORKSPACE: "Terraform workspace (default: default)",
    },
  },
  {
    id: "pulumi",
    name: "Pulumi",
    description: "Manage Pulumi infrastructure as code: stacks, resources, state, and preview/update operations.",
    type: "stdio",
    command: "npx",
    args: ["@pulumi/mcp-server-pulumi"],
    homepage: "https://github.com/pulumi/mcp-server-pulumi",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      PULUMI_ACCESS_TOKEN: "Pulumi access token",
    },
  },
  {
    id: "github_actions",
    name: "GitHub Actions",
    description: "Manage GitHub Actions workflows, runners, CI/CD pipelines, artifacts, and deployment environments.",
    type: "stdio",
    command: "npx",
    args: ["@github/mcp-server-actions"],
    homepage: "https://github.com/github/mcp-server-actions",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      GITHUB_TOKEN: "GitHub personal access token with actions:write scope",
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Manage Vercel deployments, projects, domains, environment variables, and team settings.",
    type: "stdio",
    command: "npx",
    args: ["@vercel/mcp-server-vercel"],
    homepage: "https://github.com/vercel/mcp-server-vercel",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      VERCEL_TOKEN: "Vercel API token",
      VERCEL_TEAM_ID: "Optional: Vercel team ID",
    },
  },
  {
    id: "netlify",
    name: "Netlify",
    description: "Manage Netlify sites, deployments, functions, forms, identity, and split testing.",
    type: "stdio",
    command: "npx",
    args: ["@netlify/mcp-server-netlify"],
    homepage: "https://github.com/netlify/mcp-server-netlify",
    category: "☁️ Cloud Platforms & DevOps",
    enabled: false,
    env: {
      NETLIFY_AUTH_TOKEN: "Netlify personal access token",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 Development Tools
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "git",
    name: "Git",
    description: "Full Git operations: commit, branch, merge, rebase, log, diff, stash, blame, and status. Built-in, no external server needed.",
    type: "stdio",
    command: "npx",
    args: ["@git/mcp-server-git"],
    homepage: "https://github.com/git/git-mcp-server",
    category: "🔧 Development Tools",
    enabled: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Full GitHub API: repositories, issues, pull requests, code reviews, search, projects, and releases.",
    type: "stdio",
    command: "npx",
    args: ["@github/mcp-server-github"],
    homepage: "https://github.com/github/mcp-server",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      GITHUB_TOKEN: "GitHub personal access token with repo and issues scopes",
    },
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "GitLab API: projects, merge requests, CI/CD pipelines, repository management, and issue tracking.",
    type: "stdio",
    command: "npx",
    args: ["@gitlab/mcp-server-gitlab"],
    homepage: "https://github.com/gitlab/mcp-server-gitlab",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      GITLAB_TOKEN: "GitLab personal access token",
      GITLAB_URL: "GitLab instance URL (default: https://gitlab.com)",
    },
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    description: "Bitbucket API: repositories, pull requests, pipelines, workspace management, and code insights.",
    type: "stdio",
    command: "npx",
    args: ["@atlassian/mcp-server-bitbucket"],
    homepage: "https://github.com/atlassian/mcp-server-bitbucket",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      BITBUCKET_USERNAME: "Bitbucket username",
      BITBUCKET_APP_PASSWORD: "Bitbucket app password",
    },
  },
  {
    id: "jira",
    name: "Jira",
    description: "Jira issue tracking: create, update, search issues, manage sprints, epics, and project configuration.",
    type: "stdio",
    command: "npx",
    args: ["@atlassian/mcp-server-jira"],
    homepage: "https://github.com/atlassian/mcp-server-jira",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      JIRA_URL: "Your Jira instance URL (https://your-domain.atlassian.net)",
      JIRA_EMAIL: "Your Jira account email",
      JIRA_API_TOKEN: "Jira API token",
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Linear issue tracking: create, update, search issues, manage projects, cycles, and roadmaps.",
    type: "stdio",
    command: "npx",
    args: ["@linear/mcp-server-linear"],
    homepage: "https://github.com/linear/mcp-server-linear",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      LINEAR_API_KEY: "Linear API key (Settings → API)",
    },
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Error tracking and performance monitoring: issues, events, releases, spans, and metrics.",
    type: "stdio",
    command: "npx",
    args: ["@sentry/mcp-server-sentry"],
    homepage: "https://github.com/sentry/mcp-server-sentry",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      SENTRY_AUTH_TOKEN: "Sentry auth token (Settings → Developer Settings)",
      SENTRY_ORG: "Your Sentry organization slug",
    },
  },
  {
    id: "sonarqube",
    name: "SonarQube / SonarCloud",
    description: "Code quality analysis: issues, metrics, quality gates, security hotspots, and coverage analysis.",
    type: "stdio",
    command: "npx",
    args: ["@sonarsource/mcp-server-sonarqube"],
    homepage: "https://github.com/sonarsource/mcp-server-sonarqube",
    category: "🔧 Development Tools",
    enabled: false,
    env: {
      SONAR_TOKEN: "SonarQube/SonarCloud authentication token",
      SONAR_URL: "SonarQube server URL (default: https://sonarcloud.io)",
    },
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Browser automation: navigate, click, fill forms, take screenshots, run tests, and generate PDFs.",
    type: "stdio",
    command: "npx",
    args: ["@playwright/mcp-server-playwright"],
    homepage: "https://github.com/microsoft/playwright-mcp",
    category: "🔧 Development Tools",
    enabled: false,
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Headless Chrome/Chromium automation: web scraping, PDF generation, screenshot capture, and testing.",
    type: "stdio",
    command: "npx",
    args: ["@puppeteer/mcp-server-puppeteer"],
    homepage: "https://github.com/puppeteer/mcp-server-puppeteer",
    category: "🔧 Development Tools",
    enabled: false,
  },
  {
    id: "eslint",
    name: "ESLint",
    description: "Lint JavaScript/TypeScript code, auto-fix issues, and enforce code style rules.",
    type: "stdio",
    command: "npx",
    args: ["@eslint/mcp-server-eslint"],
    homepage: "https://github.com/eslint/mcp-server-eslint",
    category: "🔧 Development Tools",
    enabled: false,
  },
  {
    id: "prettier",
    name: "Prettier",
    description: "Format code according to Prettier rules, check formatting, and generate diffs.",
    type: "stdio",
    command: "npx",
    args: ["@prettier/mcp-server-prettier"],
    homepage: "https://github.com/prettier/mcp-server-prettier",
    category: "🔧 Development Tools",
    enabled: false,
  },
  {
    id: "jest",
    name: "Jest / Vitest",
    description: "Run tests, view results, debug failures, and manage test configuration.",
    type: "stdio",
    command: "npx",
    args: ["@jest/mcp-server-jest"],
    homepage: "https://github.com/jestjs/mcp-server-jest",
    category: "🔧 Development Tools",
    enabled: false,
  },
  {
    id: "cypress",
    name: "Cypress",
    description: "End-to-end testing: run tests, view results, manage test artifacts, and debug failures.",
    type: "stdio",
    command: "npx",
    args: ["@cypress/mcp-server-cypress"],
    homepage: "https://github.com/cypress-io/mcp-server-cypress",
    category: "🔧 Development Tools",
    enabled: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🤖 AI & Machine Learning
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "openai",
    name: "OpenAI",
    description: "Access OpenAI models: GPT-4o, GPT-4.1, o3, embeddings, image generation (DALL-E 3), text-to-speech, and assistants API.",
    type: "stdio",
    command: "npx",
    args: ["@openai/mcp-server-openai"],
    homepage: "https://github.com/openai/mcp-server-openai",
    category: "🤖 AI & Machine Learning",
    enabled: false,
    env: {
      OPENAI_API_KEY: "OpenAI API key",
    },
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    description: "Access Claude models (Claude 4 Opus, Sonnet, Haiku) via Anthropic API for advanced reasoning and analysis.",
    type: "stdio",
    command: "npx",
    args: ["@anthropic/mcp-server-anthropic"],
    homepage: "https://github.com/anthropics/mcp-server-anthropic",
    category: "🤖 AI & Machine Learning",
    enabled: false,
    env: {
      ANTHROPIC_API_KEY: "Anthropic API key",
    },
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Access Hugging Face models, datasets, Spaces, and Inference API for text, image, audio, and video.",
    type: "stdio",
    command: "npx",
    args: ["@huggingface/mcp-server-huggingface"],
    homepage: "https://github.com/huggingface/mcp-server-huggingface",
    category: "🤖 AI & Machine Learning",
    enabled: false,
    env: {
      HF_TOKEN: "Hugging Face API token",
    },
  },
  {
    id: "replicate",
    name: "Replicate",
    description: "Run open-source ML models via Replicate API: image generation, LLMs, audio processing, video generation.",
    type: "stdio",
    command: "npx",
    args: ["@replicate/mcp-server-replicate"],
    homepage: "https://github.com/replicate/mcp-server-replicate",
    category: "🤖 AI & Machine Learning",
    enabled: false,
    env: {
      REPLICATE_API_TOKEN: "Replicate API token",
    },
  },
  {
    id: "together",
    name: "Together AI",
    description: "Access 200+ open-source models via Together AI API: Llama 4, DeepSeek V3, Qwen 3, Mistral, and more.",
    type: "stdio",
    command: "npx",
    args: ["@together/mcp-server-together"],
    homepage: "https://github.com/together-ai/mcp-server-together",
    category: "🤖 AI & Machine Learning",
    enabled: false,
    env: {
      TOGETHER_API_KEY: "Together AI API key",
    },
  },
  {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference via Groq LPU: Llama 4, Mixtral, Gemma 3, and other open models at token speeds.",
    type: "stdio",
    command: "npx",
    args: ["@groq/mcp-server-groq"],
    homepage: "https://github.com/groq/mcp-server-groq",
    category: "🤖 AI & Machine Learning",
    enabled: false,
    env: {
      GROQ_API_KEY: "Groq API key",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 Analytics & Monitoring
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "grafana",
    name: "Grafana",
    description: "Query dashboards, alerts, and metrics from Grafana and Prometheus data sources. Create and manage dashboards.",
    type: "stdio",
    command: "npx",
    args: ["@grafana/mcp-server-grafana"],
    homepage: "https://github.com/grafana/mcp-server-grafana",
    category: "📊 Analytics & Monitoring",
    enabled: false,
    env: {
      GRAFANA_URL: "Grafana instance URL (default: http://localhost:3000)",
      GRAFANA_API_KEY: "Grafana service account token",
    },
  },
  {
    id: "datadog",
    name: "Datadog",
    description: "Monitor infrastructure, APM, logs, and create dashboards in Datadog. Query metrics and manage monitors.",
    type: "stdio",
    command: "npx",
    args: ["@datadog/mcp-server-datadog"],
    homepage: "https://github.com/DataDog/mcp-server-datadog",
    category: "📊 Analytics & Monitoring",
    enabled: false,
    env: {
      DATADOG_API_KEY: "Datadog API key",
      DATADOG_APP_KEY: "Datadog application key",
      DATADOG_SITE: "Datadog site (default: datadoghq.com)",
    },
  },
  {
    id: "newrelic",
    name: "New Relic",
    description: "Application performance monitoring: NRQL queries, alerts, dashboards, errors, and distributed tracing.",
    type: "stdio",
    command: "npx",
    args: ["@newrelic/mcp-server-newrelic"],
    homepage: "https://github.com/newrelic/mcp-server-newrelic",
    category: "📊 Analytics & Monitoring",
    enabled: false,
    env: {
      NEW_RELIC_API_KEY: "New Relic API key (INGEST - LICENSE)",
      NEW_RELIC_ACCOUNT_ID: "Your New Relic account ID",
    },
  },
  {
    id: "elastic",
    name: "Elasticsearch",
    description: "Search and analyze Elasticsearch indices, manage mappings, run aggregations, and monitor cluster health.",
    type: "stdio",
    command: "npx",
    args: ["@elastic/mcp-server-elasticsearch"],
    homepage: "https://github.com/elastic/mcp-server-elasticsearch",
    category: "📊 Analytics & Monitoring",
    enabled: false,
    env: {
      ELASTICSEARCH_URL: "Elasticsearch endpoint URL",
      ELASTICSEARCH_API_KEY: "Elasticsearch API key",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 📝 Productivity & Collaboration
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, search channels, manage users, create channels, and integrate with Slack workspaces.",
    type: "stdio",
    command: "npx",
    args: ["@slack/mcp-server-slack"],
    homepage: "https://github.com/slack/mcp-server-slack",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      SLACK_BOT_TOKEN: "Slack bot token (xoxb-...)",
      SLACK_TEAM_ID: "Your Slack team/workspace ID",
    },
  },
  {
    id: "discord",
    name: "Discord",
    description: "Send messages, manage channels, moderate servers, and interact with Discord communities.",
    type: "stdio",
    command: "npx",
    args: ["@discord/mcp-server-discord"],
    homepage: "https://github.com/discord/mcp-server-discord",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      DISCORD_BOT_TOKEN: "Discord bot token",
    },
  },
  {
    id: "notion",
    name: "Notion",
    description: "Create, read, update, and search Notion pages, databases, blocks, and comments.",
    type: "stdio",
    command: "npx",
    args: ["@notionhq/mcp-server-notion"],
    homepage: "https://github.com/notionhq/mcp-server-notion",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      NOTION_API_KEY: "Notion integration token (Internal Integration Secret)",
    },
  },
  {
    id: "confluence",
    name: "Confluence",
    description: "Create and edit Confluence pages, search content, manage spaces, and collaborate on documentation.",
    type: "stdio",
    command: "npx",
    args: ["@atlassian/mcp-server-confluence"],
    homepage: "https://github.com/atlassian/mcp-server-confluence",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      CONFLUENCE_URL: "Your Confluence instance URL",
      CONFLUENCE_API_TOKEN: "Confluence API token",
    },
  },
  {
    id: "trello",
    name: "Trello",
    description: "Manage Trello boards, lists, cards, checklists, labels, and automate workflow tracking.",
    type: "stdio",
    command: "npx",
    args: ["@trello/mcp-server-trello"],
    homepage: "https://github.com/trello/mcp-server-trello",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      TRELLO_API_KEY: "Trello API key",
      TRELLO_TOKEN: "Trello API token",
    },
  },
  {
    id: "asana",
    name: "Asana",
    description: "Manage Asana projects, tasks, sections, dependencies, portfolios, and team workflows.",
    type: "stdio",
    command: "npx",
    args: ["@asana/mcp-server-asana"],
    homepage: "https://github.com/asana/mcp-server-asana",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      ASANA_ACCESS_TOKEN: "Asana personal access token",
    },
  },
  {
    id: "monday",
    name: "Monday.com",
    description: "Manage Monday.com boards, items, columns, workspaces, and automations.",
    type: "stdio",
    command: "npx",
    args: ["@monday/mcp-server-monday"],
    homepage: "https://github.com/mondaycom/mcp-server-monday",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      MONDAY_API_KEY: "Monday.com API key",
    },
  },
  {
    id: "figma",
    name: "Figma",
    description: "Access Figma designs, components, styles, variables, and export assets. Read-only design system access.",
    type: "stdio",
    command: "npx",
    args: ["@figma/mcp-server-figma"],
    homepage: "https://github.com/figma/mcp-server-figma",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      FIGMA_ACCESS_TOKEN: "Figma personal access token",
    },
  },
  {
    id: "google_workspace",
    name: "Google Workspace (All Services)",
    description: "Complete Google Workspace integration: Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet, Chat, Forms, YouTube, Tasks, and Contacts. Single OAuth setup for all services.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID from Google Cloud Console",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_PROJECT_ID: "Your Google Cloud Project ID",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token for persistent access",
    },
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Access and manage Google Drive files, folders, sharing permissions, and search.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp", "--services", "drive"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token",
    },
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Manage Google Calendar events, schedules, reminders, and availability.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp", "--services", "calendar"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token",
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send, read, search, and manage Gmail messages, labels, filters, and drafts.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp", "--services", "gmail"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token",
    },
  },
  {
    id: "google_docs",
    name: "Google Docs",
    description: "Create, read, edit, and manage Google Docs documents with full formatting support.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp", "--services", "docs"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token",
    },
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    description: "Create, read, edit, and manage Google Sheets spreadsheets with cell formatting, formulas, and charts.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp", "--services", "sheets"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token",
    },
  },
  {
    id: "google_slides",
    name: "Google Slides (PPT)",
    description: "Create, read, edit, and manage Google Slides presentations with slides, text, images, and formatting. Perfect for creating PPT-like presentations.",
    type: "stdio",
    command: "npx",
    args: ["-y", "@pegasusheavy/google-mcp", "--services", "slides"],
    homepage: "https://github.com/pegasusheavy/google-mcp",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      GOOGLE_CLIENT_ID: "Google OAuth 2.0 Client ID",
      GOOGLE_CLIENT_SECRET: "Google OAuth 2.0 Client Secret",
      GOOGLE_REFRESH_TOKEN: "OAuth refresh token",
    },
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    description: "Send, read, and manage Outlook emails, calendar events, contacts, and tasks.",
    type: "stdio",
    command: "npx",
    args: ["@microsoft/mcp-server-outlook"],
    homepage: "https://github.com/microsoft/mcp-server-outlook",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      OUTLOOK_CLIENT_ID: "Azure AD app client ID",
      OUTLOOK_CLIENT_SECRET: "Azure AD app client secret",
      OUTLOOK_TENANT_ID: "Azure AD tenant ID",
    },
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Send messages, manage channels, schedule meetings, and collaborate in Microsoft Teams.",
    type: "stdio",
    command: "npx",
    args: ["@microsoft/mcp-server-teams"],
    homepage: "https://github.com/microsoft/mcp-server-teams",
    category: "📝 Productivity & Collaboration",
    enabled: false,
    env: {
      TEAMS_CLIENT_ID: "Azure AD app client ID",
      TEAMS_CLIENT_SECRET: "Azure AD app client secret",
      TEAMS_TENANT_ID: "Azure AD tenant ID",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 Web & Content
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "web_scraper",
    name: "Web Scraper",
    description: "Scrape and extract structured data from websites with CSS selector and XPath support. Returns clean markdown.",
    type: "stdio",
    command: "npx",
    args: ["@anthropic/mcp-server-web-scraper"],
    homepage: "https://github.com/anthropics/mcp-server-web-scraper",
    category: "🌐 Web & Content",
    enabled: false,
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Search videos, get transcripts, channel info, video metadata, and manage playlists.",
    type: "stdio",
    command: "npx",
    args: ["@youtube/mcp-server-youtube"],
    homepage: "https://github.com/yt-dlp/mcp-server-youtube",
    category: "🌐 Web & Content",
    enabled: false,
    env: {
      YOUTUBE_API_KEY: "YouTube Data API v3 key",
    },
  },
  {
    id: "medium",
    name: "Medium",
    description: "Create, edit, publish, and manage stories on Medium publications.",
    type: "stdio",
    command: "npx",
    args: ["@medium/mcp-server-medium"],
    homepage: "https://github.com/medium/mcp-server-medium",
    category: "🌐 Web & Content",
    enabled: false,
    env: {
      MEDIUM_API_KEY: "Medium integration token",
    },
  },
  {
    id: "wordpress",
    name: "WordPress",
    description: "Manage WordPress sites: posts, pages, media, comments, plugins, and users.",
    type: "stdio",
    command: "npx",
    args: ["@wordpress/mcp-server-wordpress"],
    homepage: "https://github.com/wordpress/mcp-server-wordpress",
    category: "🌐 Web & Content",
    enabled: false,
    env: {
      WORDPRESS_URL: "Your WordPress site URL",
      WORDPRESS_APP_PASSWORD: "WordPress application password",
    },
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Manage Stripe payments: products, prices, customers, invoices, subscriptions, and webhooks.",
    type: "stdio",
    command: "npx",
    args: ["@stripe/mcp-server-stripe"],
    homepage: "https://github.com/stripe/mcp-server-stripe",
    category: "🌐 Web & Content",
    enabled: false,
    env: {
      STRIPE_SECRET_KEY: "Stripe secret key (sk_...)",
      STRIPE_WEBHOOK_SECRET: "Optional: Stripe webhook signing secret",
    },
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "Manage Shopify store: products, orders, customers, inventory, and analytics.",
    type: "stdio",
    command: "npx",
    args: ["@shopify/mcp-server-shopify"],
    homepage: "https://github.com/shopify/mcp-server-shopify",
    category: "🌐 Web & Content",
    enabled: false,
    env: {
      SHOPIFY_STORE_URL: "Your Shopify store URL (https://your-store.myshopify.com)",
      SHOPIFY_ACCESS_TOKEN: "Shopify admin API access token",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 Security
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "snyk",
    name: "Snyk",
    description: "Security scanning: find vulnerabilities in dependencies, containers, Kubernetes, and IaC.",
    type: "stdio",
    command: "npx",
    args: ["@snyk/mcp-server-snyk"],
    homepage: "https://github.com/snyk/mcp-server-snyk",
    category: "🔒 Security",
    enabled: false,
    env: {
      SNYK_TOKEN: "Snyk API token",
    },
  },
  {
    id: "trivy",
    name: "Trivy",
    description: "Vulnerability scanner for containers, filesystems, Git repositories, and Kubernetes.",
    type: "stdio",
    command: "npx",
    args: ["@aquasecurity/mcp-server-trivy"],
    homepage: "https://github.com/aquasecurity/mcp-server-trivy",
    category: "🔒 Security",
    enabled: false,
  },
  {
    id: "dependabot",
    name: "Dependabot",
    description: "Manage Dependabot alerts, security updates, and dependency version bumps across repositories.",
    type: "stdio",
    command: "npx",
    args: ["@github/mcp-server-dependabot"],
    homepage: "https://github.com/github/mcp-server-dependabot",
    category: "🔒 Security",
    enabled: false,
    env: {
      GITHUB_TOKEN: "GitHub token with security_events read/write scope",
    },
  },
  {
    id: "semgrep",
    name: "Semgrep",
    description: "Static analysis security scanning: find bugs, vulnerabilities, and enforce coding standards.",
    type: "stdio",
    command: "npx",
    args: ["@semgrep/mcp-server-semgrep"],
    homepage: "https://github.com/semgrep/mcp-server-semgrep",
    category: "🔒 Security",
    enabled: false,
  },
];

/**
 * Get the list of enabled MCP servers based on the MCP_ENABLED_SERVERS env var.
 * Format: comma-separated list of server IDs.
 * Example: MCP_ENABLED_SERVERS=git,github,docker,postgres
 *
 * If the env var is not set, only servers with enabled: true are returned.
 */
function getEnabledMCPServers() {
  const envEnabled = process.env.MCP_ENABLED_SERVERS;
  if (envEnabled) {
    const enabledIds = envEnabled.split(",").map((s) => s.trim().toLowerCase());
    return MCP_REGISTRY.filter((s) => enabledIds.includes(s.id));
  }

  // Default: only servers marked as enabled: true
  return MCP_REGISTRY.filter((s) => s.enabled);
}

/**
 * Get a specific MCP server config by ID.
 */
function getMCPServerById(id) {
  return MCP_REGISTRY.find((s) => s.id === id) || null;
}

/**
 * Get all MCP server IDs (for validation).
 */
function getAllMCPServerIds() {
  return MCP_REGISTRY.map((s) => s.id);
}

module.exports = {
  MCP_REGISTRY,
  getEnabledMCPServers,
  getMCPServerById,
  getAllMCPServerIds,
};
