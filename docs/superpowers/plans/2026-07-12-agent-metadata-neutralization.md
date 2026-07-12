# Agent-facing MCP Metadata Neutralization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Feishu branding from every MCP datum and connection snippet exposed to agents.

**Architecture:** Keep the upstream Feishu integration unchanged. Rename only the public MCP identifiers and neutralize descriptions, fallback errors, generated server keys, and agent handoff copy at their existing definitions.

**Tech Stack:** TypeScript, Next.js, Node test runner

## Global Constraints

- No compatibility aliases for `feishu_*` tools.
- OAuth, upstream API code, environment variables, and workspace administration copy remain unchanged.
- Add no dependencies or abstractions.

---

### Task 1: Neutralize agent-facing data

**Files:**
- Modify: `lib/mcp.test.ts`
- Modify: `lib/mcp.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: existing JSON-RPC `handleRpc(request)` interface.
- Produces: neutral tool names (`list_documents`, `list_calendars`, `list_calendar_events`, calendar/event/article CRUD names) and `serverInfo.name = "workspace-data"`.

- [ ] **Step 1: Write the failing test**

Add assertions that serialized `initialize` and `tools/list` responses contain neither `/feishu/i` nor `飞书`, that `list_documents` exists, and that no tool name starts with `feishu_`. Update the event validation call to `create_calendar_event`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because current server metadata and tools contain `feishu` / `飞书`.

- [ ] **Step 3: Write minimal implementation**

In `lib/mcp.ts`, remove `feishu_` from tool definitions and dispatch names, use neutral descriptions, change the server name to `workspace-data`, and change the generic fallback to `上游服务请求失败`.

In `app/page.tsx`, update `TOOL_GROUPS`, generated MCP/OpenClaw keys to `workspace_data`, and agent handoff text to neutral data-domain wording.

- [ ] **Step 4: Run verification**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: Next.js production build succeeds.

Run: `rg -n -i 'feishu|飞书' lib/mcp.ts`
Expected: only the private implementation import path may match.
