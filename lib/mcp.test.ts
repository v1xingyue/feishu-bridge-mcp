import assert from "node:assert/strict";
import test from "node:test";
import { authorized, isAdminOpenId, isAllowedOpenId, mcpTokenTtl, signMcpToken, verifyMcpToken } from "./auth.ts";
import { handleRpc } from "./mcp.ts";
import { articleTextBlock, createEventBody, feishuErrorMessage, findTeamCalendar, visibleEvents } from "./feishu.ts";

test("MCP initialize and tools/list expose the server tools", async () => {
  const initialized = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal((initialized as { result: { serverInfo: { name: string } } }).result.serverInfo.name, "workspace-data");
  const listed = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (listed as { result: { tools: { name: string }[] } }).result.tools;
  assert.equal(tools.length, 14);
  assert.ok(tools.some(({ name }) => name === "list_documents"));
  assert.ok(tools.some(({ name }) => name === "get_team_calendar"));
  assert.ok(tools.every(({ name }) => !name.startsWith("feishu_")));
  assert.doesNotMatch(JSON.stringify({ initialized, listed }), /feishu|飞书/i);
});

test("calendar tools expose today's Shanghai date for relative-time requests", async () => {
  const listed = await handleRpc({ jsonrpc: "2.0", id: 20, method: "tools/list" });
  const tools = (listed as { result: { tools: { name: string; description: string }[] } }).result.tools;
  const createEvent = tools.find(({ name }) => name === "create_calendar_event");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  assert.match(createEvent?.description || "", new RegExp(today));
});

test("MCP rejects unknown methods", async () => {
  const response = await handleRpc({ jsonrpc: "2.0", id: 3, method: "missing" });
  assert.equal((response as { error: { code: number } }).error.code, -32601);
});

test("MCP validates event times before calling the upstream service", async () => {
  const response = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_calendar_event", arguments: { calendar_id: "cal", summary: "测试", start_time: "200", end_time: "100" } } });
  assert.equal((response as { result: { isError: boolean } }).result.isError, true);
});

test("MCP JWT verifies signature and expiration", () => {
  process.env.MCP_JWT_SECRET = "test-secret-with-at-least-thirty-two-characters";
  process.env.FEISHU_ADMIN_OPEN_IDS = "ou_test";
  const token = signMcpToken("ou_test");
  assert.equal(verifyMcpToken(token), true);
  assert.equal(authorized(new Request("https://example.com", { headers: { authorization: `Bearer ${token}` } })), true);
  process.env.FEISHU_ADMIN_OPEN_IDS = "ou_other";
  assert.equal(authorized(new Request("https://example.com", { headers: { authorization: `Bearer ${token}` } })), false);
  assert.equal(verifyMcpToken(`${token}x`), false);
  assert.equal(verifyMcpToken(signMcpToken("ou_test", -1)), false);
  delete process.env.MCP_JWT_SECRET;
  delete process.env.FEISHU_ADMIN_OPEN_IDS;
});

test("open_id lists separate readers and admins", () => {
  process.env.FEISHU_ALLOWED_OPEN_IDS = "ou_reader, ou_reader2";
  process.env.FEISHU_ADMIN_OPEN_IDS = "ou_admin";
  assert.equal(isAllowedOpenId("ou_reader2"), true);
  assert.equal(isAllowedOpenId("ou_admin"), true);
  assert.equal(isAdminOpenId("ou_reader"), false);
  assert.equal(isAllowedOpenId("ou_unknown"), false);
  delete process.env.FEISHU_ALLOWED_OPEN_IDS;
  delete process.env.FEISHU_ADMIN_OPEN_IDS;
});

test("MCP JWT lifetime only accepts configured day options", () => {
  assert.equal(mcpTokenTtl(30), 30 * 86400);
  assert.equal(mcpTokenTtl(180), 180 * 86400);
  assert.equal(mcpTokenTtl(360), 360 * 86400);
  assert.equal(mcpTokenTtl(365), 0);
});

test("Feishu OAuth profile maps to a NextAuth user", async () => {
  const { oauthProfile } = await import("./feishu.ts");
  assert.deepEqual(oauthProfile({ open_id: "ou_1", name: "测试用户", avatar_url: "https://example.com/a.png" }), { id: "ou_1", name: "测试用户", email: null, image: "https://example.com/a.png" });
});

test("created events default to now +1h through now +3h", () => {
  const body = createEventBody({ summary: "默认时间" }, 1000);
  assert.deepEqual(body.start_time, { timestamp: "4600", timezone: "Asia/Shanghai" });
  assert.deepEqual(body.end_time, { timestamp: "11800", timezone: "Asia/Shanghai" });
});

test("cancelled events are hidden from calendar lists", () => {
  assert.deepEqual(visibleEvents([
    { event_id: "active", summary: "active", status: "confirmed" },
    { event_id: "cancelled", summary: "cancelled", status: "cancelled" },
  ]), [{ event_id: "active", summary: "active", status: "confirmed" }]);
});

test("team calendar must be shared and subscribable", () => {
  const team = { calendar_id: "team", summary: "团队共享日历", type: "shared", permissions: "public" };
  assert.equal(findTeamCalendar([
    { ...team, calendar_id: "primary", type: "primary" },
    { ...team, calendar_id: "private", permissions: "private" },
    team,
  ]), team);
});

test("calendar event tools default to the team calendar", async () => {
  const listed = await handleRpc({ jsonrpc: "2.0", id: 21, method: "tools/list" });
  const tools = (listed as { result: { tools: { name: string; inputSchema: { required?: readonly string[] } }[] } }).result.tools;
  for (const name of ["list_calendar_events", "create_calendar_event", "update_calendar_event", "delete_calendar_event"]) {
    assert.ok(!tools.find((tool) => tool.name === name)?.inputSchema.required?.includes("calendar_id"));
  }
});

test("article body becomes one plain-text docx block", () => {
  assert.deepEqual(articleTextBlock("正文"), { block_type: 2, text: { elements: [{ text_run: { content: "正文" } }] } });
});

test("Feishu permission errors list scopes and an application link", () => {
  process.env.FEISHU_APP_ID = "cli_test";
  const message = feishuErrorMessage({ msg: "Access denied [drive:drive:readonly, docx:document]" }, 403);
  assert.match(message, /需要权限：drive:drive:readonly、docx:document/);
  assert.match(message, /https:\/\/open\.feishu\.cn\/app\/cli_test\/auth\?q=/);
  delete process.env.FEISHU_APP_ID;
});
