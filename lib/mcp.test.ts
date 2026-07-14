import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { authorized, isAdminOpenId, isAllowedOpenId, mcpTokenTtl, signMcpToken, soleAdminOpenId, verifyMcpToken } from "./auth.ts";
import { handleRpc } from "./mcp.ts";
import { articleTextBlock, configStatus, createEventBody, feishuErrorMessage, findTeamCalendar, visibleEvents } from "./feishu.ts";

async function withWatermark<T>(action: () => Promise<T>) {
  process.env.WATERMARK_ENABLED = "1";
  try { return await action(); }
  finally { delete process.env.WATERMARK_ENABLED; }
}

test("MCP initialize and tools/list expose the server tools", async () => {
  const initialized = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal((initialized as { result: { serverInfo: { name: string } } }).result.serverInfo.name, "workspace-data");
  const listed = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (listed as { result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, { description?: string; default?: unknown; enum?: readonly string[]; maxLength?: number }> } }[] } }).result.tools;
  assert.equal(tools.length, 16);
  assert.ok(tools.some(({ name }) => name === "list_documents"));
  assert.ok(tools.some(({ name }) => name === "get_team_calendar"));
  assert.ok(tools.some(({ name }) => name === "get_current_time_and_team_calendar"));
  assert.ok(tools.every(({ name }) => !name.startsWith("feishu_")));
  assert.ok(tools.every((tool) => tool.description && Object.values(tool.inputSchema.properties).every((property) => property.description)));
  assert.ok(!tools.some(({ name }) => name === "add_image_watermark"));
  assert.doesNotMatch(JSON.stringify({ initialized, listed }), /feishu|飞书/i);
});

test("watermark tool is exposed only when the feature is enabled", async () => withWatermark(async () => {
  const listed = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (listed as { result: { tools: { name: string; inputSchema: { properties: Record<string, { default?: unknown; enum?: readonly string[]; maxLength?: number }> } }[] } }).result.tools;
  const watermark = tools.find(({ name }) => name === "add_image_watermark");
  assert.equal(tools.length, 17);
  assert.equal(watermark?.inputSchema.properties.position.default, "bottom-right");
  assert.deepEqual(watermark?.inputSchema.properties.position.enum, ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"]);
  assert.equal(watermark?.inputSchema.properties.text.maxLength, 40);
}));

test("current time tool returns time, deployment and team calendar details", async () => {
  const originalFetch = globalThis.fetch;
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret";
  process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
  process.env.DEPLOYED_AT = "2026-07-14T08:00:00.000Z";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    if (url.includes("/calendar/v4/calendars?")) return Response.json({ code: 0, data: { calendar_list: [{ calendar_id: "team", summary: "团队共享日历", type: "shared", permissions: "public" }] } });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const before = Math.floor(Date.now() / 1000);
    const response = await handleRpc({ jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "get_current_time_and_team_calendar", arguments: {} } });
    const text = (response as { result: { content: { text: string }[] } }).result.content[0].text;
    const data = JSON.parse(text);
    assert.ok(data.timestamp >= before && data.timestamp <= Math.floor(Date.now() / 1000));
    assert.equal(data.system_version, "0.1.0");
    assert.equal(data.commit_hash, "abc123");
    assert.equal(data.deployed_at, "2026-07-14T08:00:00.000Z");
    assert.equal(data.team_calendar.calendar.calendar_id, "team");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.DEPLOYED_AT;
  }
});

test("image watermark calls are rejected while the feature is disabled", async () => {
  const response = await handleRpc({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "add_image_watermark", arguments: {} } });
  assert.equal((response as { result: { isError: boolean } }).result.isError, true);
  assert.match(JSON.stringify(response), /暂未启用/);
});

test("image watermark tool returns an MCP image with Chinese text when enabled", async () => withWatermark(async () => {
  const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: "blue" } }).png().toBuffer();
  const response = await handleRpc({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "add_image_watermark", arguments: { image_base64: source.toString("base64"), text: "中文水印" } } });
  const content = (response as { result: { content: { type: string; data?: string; mimeType?: string }[] } }).result.content;
  assert.equal(content[0].type, "image");
  assert.equal(content[0].mimeType, "image/webp");
  assert.notDeepEqual(Buffer.from(content[0].data!, "base64"), source);
  assert.match(JSON.stringify(content), /fontSize=16 · sharp-pango-v1/);
}));

test("watermark debug details are opt-in", async () => withWatermark(async () => {
  process.env.WATERMARK_DEBUG = "1";
  try {
    const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: "blue" } }).png().toBuffer();
    const response = await handleRpc({ jsonrpc: "2.0", id: 24, method: "tools/call", params: { name: "add_image_watermark", arguments: { image_base64: source.toString("base64"), text: "中文" } } });
    assert.match(JSON.stringify(response), /darwin\/arm64 · fontSize=16|linux\/[^ ]+ · fontSize=16/);
  } finally {
    delete process.env.WATERMARK_DEBUG;
  }
}));

test("watermark validates the reference API limits", async () => withWatermark(async () => {
  const source = await sharp({ create: { width: 320, height: 200, channels: 3, background: "blue" } }).png().toBuffer();
  const baseArguments = { image_base64: source.toString("base64"), text: "水印" };

  const invalidPosition = await handleRpc({ jsonrpc: "2.0", id: 25, method: "tools/call", params: { name: "add_image_watermark", arguments: { ...baseArguments, position: "southeast" } } });
  assert.equal((invalidPosition as { result: { isError: boolean } }).result.isError, true);
  assert.match(JSON.stringify(invalidPosition), /水印位置无效/);

  const longText = await handleRpc({ jsonrpc: "2.0", id: 26, method: "tools/call", params: { name: "add_image_watermark", arguments: { ...baseArguments, text: "水".repeat(41) } } });
  assert.equal((longText as { result: { isError: boolean } }).result.isError, true);
  assert.match(JSON.stringify(longText), /不能超过 40 个字符/);
}));

test("watermark normalizes EXIF orientation and accepts markup characters as text", async () => withWatermark(async () => {
  const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: "blue" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const response = await handleRpc({ jsonrpc: "2.0", id: 27, method: "tools/call", params: { name: "add_image_watermark", arguments: { image_base64: source.toString("base64"), text: "A&B <中文>", position: "top-center" } } });
  const content = (response as { result: { content: { type: string; data?: string; mimeType?: string; text?: string }[] } }).result.content;
  assert.equal(content[0].mimeType, "image/webp");
  assert.match(content[1].text || "", /^80x120 ·/);
  assert.deepEqual(await sharp(Buffer.from(content[0].data!, "base64")).metadata().then(({ width, height, format }) => ({ width, height, format })), { width: 80, height: 120, format: "webp" });
}));

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
  assert.equal(soleAdminOpenId(), "ou_admin");
  process.env.FEISHU_ADMIN_OPEN_IDS = "ou_admin ou_admin2";
  assert.equal(soleAdminOpenId(), undefined);
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

test("set_article_full_access_user grants full access to an existing article", async () => {
  const originalFetch = globalThis.fetch;
  let permissionBody: unknown;
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    if (url.includes("/drive/v1/permissions/doc_1/members?type=docx")) { permissionBody = JSON.parse(String(init?.body)); return Response.json({ code: 0, data: {} }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await handleRpc({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "set_article_full_access_user", arguments: { document_id: "doc_1", open_id: "ou_editor" } } });
    assert.equal((response as { result: { isError?: boolean } }).result.isError, undefined);
    assert.deepEqual(permissionBody, { member_type: "openid", member_id: "ou_editor", perm: "full_access" });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  }
});

test("create_article defaults to public read-only sharing", async () => {
  const originalFetch = globalThis.fetch;
  let publicShareRequest: { url: string; init?: RequestInit } | undefined;
  let fullAccessRequest: { url: string; init?: RequestInit } | undefined;
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "secret";
  process.env.FEISHU_ADMIN_OPEN_IDS = "ou_admin";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    if (url.endsWith("/docx/v1/documents")) return Response.json({ code: 0, data: { document: { document_id: "doc_1", title: "公开文章" } } });
    if (url.includes("/drive/v1/permissions/doc_1/members?type=docx")) { fullAccessRequest = { url, init }; return Response.json({ code: 0, data: {} }); }
    if (url.includes("/drive/v2/permissions/doc_1/public?type=docx")) { publicShareRequest = { url, init }; return Response.json({ code: 0, data: {} }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await handleRpc({ jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "create_article", arguments: { title: "公开文章" } } });
    assert.equal((response as { result: { isError?: boolean } }).result.isError, undefined);
    assert.equal(fullAccessRequest?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(fullAccessRequest?.init?.body)), { member_type: "openid", member_id: "ou_admin", perm: "full_access" });
    assert.equal(publicShareRequest?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(publicShareRequest?.init?.body)), { external_access: true, link_share_entity: "anyone_readable" });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_ADMIN_OPEN_IDS;
  }
});

test("Feishu permission errors list scopes and an application link", () => {
  process.env.FEISHU_APP_ID = "cli_test";
  const message = feishuErrorMessage({ msg: "Access denied [drive:drive:readonly, docx:document]" }, 403);
  assert.match(message, /需要权限：drive:drive:readonly、docx:document/);
  assert.match(message, /https:\/\/open\.feishu\.cn\/app\/cli_test\/auth\?q=/);
  delete process.env.FEISHU_APP_ID;
});

test("config status reports features without exposing environment values", () => {
  process.env.FEISHU_APP_ID = "cli_secret";
  process.env.FEISHU_APP_SECRET = "app_secret";
  process.env.MCP_JWT_SECRET = "jwt_secret";
  process.env.FEISHU_ADMIN_OPEN_IDS = "ou_admin";
  try {
    const status = configStatus();
    assert.equal(status.feishuConfigured, true);
    assert.equal(status.mcpEnabled, true);
    assert.doesNotMatch(JSON.stringify(status), /cli_secret|app_secret|jwt_secret|ou_admin/);
  } finally {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.MCP_JWT_SECRET;
    delete process.env.FEISHU_ADMIN_OPEN_IDS;
  }
});
