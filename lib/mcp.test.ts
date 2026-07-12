import assert from "node:assert/strict";
import test from "node:test";
import { authorized, isAdminOpenId, isAllowedOpenId, mcpTokenTtl, signMcpToken, verifyMcpToken } from "./auth.ts";
import { handleRpc } from "./mcp.ts";
import { articleTextBlock, createEventBody, feishuErrorMessage } from "./feishu.ts";

test("MCP initialize and tools/list expose the server tools", async () => {
  const initialized = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal((initialized as { result: { serverInfo: { name: string } } }).result.serverInfo.name, "vercel-feishu-mcp");
  const listed = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal((listed as { result: { tools: unknown[] } }).result.tools.length, 13);
});

test("MCP rejects unknown methods", async () => {
  const response = await handleRpc({ jsonrpc: "2.0", id: 3, method: "missing" });
  assert.equal((response as { error: { code: number } }).error.code, -32601);
});

test("MCP validates event times before calling Feishu", async () => {
  const response = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "feishu_create_calendar_event", arguments: { calendar_id: "cal", summary: "测试", start_time: "200", end_time: "100" } } });
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
