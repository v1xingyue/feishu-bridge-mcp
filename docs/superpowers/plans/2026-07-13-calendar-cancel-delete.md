# Calendar Cancel/Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide all cancelled Feishu events from every list while exposing both cancel and delete entry points.

**Architecture:** Filter events once in `lib/feishu.ts`, the shared source used by the page API and MCP. Reuse the existing Feishu DELETE request for both operations; add only an MCP alias and a second UI action.

**Tech Stack:** TypeScript, Node test runner, Next.js 15, React 19

## Global Constraints

- Do not add a database or npm dependency.
- Both cancel and delete call the same Feishu DELETE endpoint.
- All `status: "cancelled"` events are omitted from list results.

---

### Task 1: Filter cancelled events at the shared boundary

**Files:**
- Modify: `lib/feishu.ts`
- Test: `lib/mcp.test.ts`

**Interfaces:**
- Produces: `visibleEvents(items: EventItem[]): EventItem[]`
- Consumed by: `listCalendarEvents()`

- [ ] **Step 1: Write the failing test**

Import `visibleEvents` and assert that a confirmed event remains while a cancelled event is removed.

```ts
assert.deepEqual(visibleEvents([
  { event_id: "active", summary: "active", status: "confirmed" },
  { event_id: "gone", summary: "gone", status: "cancelled" },
]), [{ event_id: "active", summary: "active", status: "confirmed" }]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="cancelled events"`

Expected: FAIL because `visibleEvents` is not exported.

- [ ] **Step 3: Implement the shared filter**

```ts
export function visibleEvents(items: EventItem[]) {
  return items.filter((event) => event.status !== "cancelled");
}
```

Use `visibleEvents(data.items || [])` in `listCalendarEvents()`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --test-name-pattern="cancelled events"`

Expected: one passing test.

### Task 2: Expose cancel and delete entry points

**Files:**
- Modify: `lib/mcp.ts`
- Modify: `lib/mcp.test.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: existing `deleteCalendarEvent(calendarId, eventId)`
- Produces: MCP tool `cancel_calendar_event`; UI actions “取消” and “删除”

- [ ] **Step 1: Write the failing MCP tool test**

Update the tools-list assertion to expect 14 tools and assert both names exist.

```ts
assert.equal(tools.length, 14);
assert.ok(tools.some(({ name }) => name === "cancel_calendar_event"));
assert.ok(tools.some(({ name }) => name === "delete_calendar_event"));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="tools/list"`

Expected: FAIL because only 13 tools exist.

- [ ] **Step 3: Add the MCP alias and UI action**

Add `cancel_calendar_event` beside `delete_calendar_event`, dispatch both names to `deleteCalendarEvent`, and describe that Feishu marks the event cancelled. Change `removeEvent` to accept the action label and render both buttons against that shared function.

- [ ] **Step 4: Verify the complete change**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: Next.js production build succeeds.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/feishu.ts lib/mcp.ts lib/mcp.test.ts app/page.tsx
git commit -m "fix: hide cancelled calendar events"
```
