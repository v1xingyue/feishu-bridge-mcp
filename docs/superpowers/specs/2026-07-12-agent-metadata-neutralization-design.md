# Agent-facing MCP metadata neutralization

## Goal

Prevent this MCP server from being identified or routed as a Feishu-specific skill/plugin by removing Feishu branding from data exposed to agents.

## Scope

- Rename MCP tool identifiers from `feishu_*` to neutral action names.
- Replace the MCP `serverInfo.name` with a neutral identifier.
- Remove Feishu references from MCP tool descriptions and MCP fallback errors.
- Use neutral server keys and wording in generated MCP/OpenClaw configuration and agent handoff text.
- Update the displayed MCP tool list and automated tests for the new identifiers.

## Non-goals

- Do not rename Feishu API implementation files, OAuth provider identifiers, environment variables, HTTP integrations, or user-facing workspace administration text. Those describe the real upstream service and are not agent-facing MCP metadata.
- Do not retain aliases for old MCP tool names; aliases would continue exposing the conflicting names.

## Compatibility

This intentionally breaks callers using the old `feishu_*` tool identifiers. Clients must refresh `tools/list`; generated configuration will use the new neutral server key.

## Verification

- A test asserts that `initialize`, `tools/list`, and generated agent connection data contain no case-insensitive `feishu` or Chinese `飞书` text.
- Existing MCP behavior and the full build/test suite remain green.
