---
name: telegram-notify
description: Send Telegram notifications via AWKit CLI (Bot API). Use when tasks complete, deploys finish, or user requests Telegram alerts.
triggers:
  - keywords: ["telegram", "tg", "notify", "gửi telegram", "báo telegram", "thông báo"]
  - events: ["deploy_complete", "task_complete", "user_request"]
priority: low
---

# Telegram Notify Skill

Send messages to Telegram groups/topics via `awkit tg` CLI command (Bot API, zero MCP needed).

## When to Use

- User explicitly asks to send a Telegram message
- After deploy/release completion (if user has configured notifications)
- Task completion summaries when user requests

## Prerequisites

User must have run `awkit tg setup` first. If not configured, guide them:

```bash
awkit tg setup
# Prompts: Bot Token → Chat ID → Topic ID (optional)
```

## Commands

```bash
# Send plain text
awkit tg send "message here"

# Send to specific chat
awkit tg send --chat -100xxx "message"

# Send to specific forum topic
awkit tg send --topic 123 "message"

# Markdown formatting
awkit tg send --parse-mode md "**bold** _italic_ `code`"

# HTML formatting
awkit tg send --parse-mode html "<b>bold</b> <i>italic</i>"

# Combine flags
awkit tg send --chat -100xxx --topic 456 --parse-mode md "**Done!**"
```

## AI Usage Rules

1. **NEVER send without user consent** — always confirm before sending
2. **Keep messages concise** — summarize, don't dump full logs
3. **Use Markdown** for formatted messages (`--parse-mode md`)
4. **Config location**: `~/.gemini/antigravity/.tg_config.json`
5. If `awkit tg send` returns error about config, tell user to run `awkit tg setup`
6. **Per-Project Automation**: AWKit CLI automatically reads `.project-identity` > `automation.telegram` to override `chatId`/`topicId` per project, or completely skip sending if `enabled: false`.
