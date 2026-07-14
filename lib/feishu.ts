const FEISHU_BASE = "https://open.feishu.cn/open-apis";

let tokenCache: { value: string; expiresAt: number } | undefined;

function credentials() {
  const appId = process.env.FEISHU_APP_ID || process.env.FEISHU_APP_KEY;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID（或 FEISHU_APP_KEY）和 FEISHU_APP_SECRET");
  return { appId, appSecret };
}

async function tenantToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const { appId, appSecret } = credentials();
  const response = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.msg || "飞书身份验证失败");
  tokenCache = { value: body.tenant_access_token, expiresAt: Date.now() + (body.expire - 300) * 1000 };
  return tokenCache.value;
}

async function feishu<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${FEISHU_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await tenantToken()}`, "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(feishuErrorMessage(body, response.status));
  return body.data as T;
}

export function feishuErrorMessage(body: { msg?: string; error?: { permission_violations?: { subject?: string; help_url?: string }[] } }, status: number) {
  const violations = body.error?.permission_violations || [];
  const permissions = [...new Set(violations.map((item) => item.subject).filter(Boolean))];
  const matched = body.msg?.match(/\[([^\]]+)]/)?.[1].split(/[,，]\s*/).filter(Boolean) || [];
  const required = permissions.length ? permissions : matched;
  const appId = process.env.FEISHU_APP_ID || process.env.FEISHU_APP_KEY;
  const permissionUrl = violations.find((item) => item.help_url)?.help_url || (appId && required.length ? `https://open.feishu.cn/app/${encodeURIComponent(appId)}/auth?q=${encodeURIComponent(required.join(","))}&op_from=openapi` : "");
  return [body.msg || `飞书请求失败 (${status})`, required.length && `需要权限：${required.join("、")}`, permissionUrl && `申请权限：${permissionUrl}`].filter(Boolean).join("\n");
}

export type DocumentItem = {
  token: string;
  name: string;
  type: string;
  url?: string;
  modified_time?: string;
  owner_id?: string;
};

export type CalendarItem = {
  calendar_id: string;
  summary: string;
  description?: string;
  permissions?: string;
  color?: number;
  role?: string;
  type?: string;
};

export type CalendarInput = { summary: string; description?: string; permissions?: "private" | "show_only_free_busy" | "public" };
export type ArticleInput = { title: string; content?: string; folder_token?: string; public_share?: boolean; full_access_open_id?: string };

export type EventItem = {
  event_id: string;
  summary: string;
  description?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  status?: string;
  app_link?: string;
};

export type EventInput = { summary: string; description?: string; start_time?: string; end_time?: string; timezone?: string };

export async function listDocuments(pageSize = 50) {
  const data = await feishu<{ files?: DocumentItem[]; has_more?: boolean; page_token?: string }>(
    `/drive/v1/files?page_size=${Math.min(Math.max(pageSize, 1), 200)}`,
  );
  return { items: data.files || [], hasMore: !!data.has_more, pageToken: data.page_token };
}

export async function listCalendars(pageSize = 50, pageToken?: string) {
  const query = new URLSearchParams({ page_size: String(Math.min(Math.max(pageSize, 1), 50)) });
  if (pageToken) query.set("page_token", pageToken);
  const data = await feishu<{ calendar_list?: CalendarItem[]; has_more?: boolean; page_token?: string }>(
    `/calendar/v4/calendars?${query}`,
  );
  return { items: data.calendar_list || [], hasMore: !!data.has_more, pageToken: data.page_token };
}

export async function ensureTeamCalendar() {
  let pageToken: string | undefined;
  do {
    const page = await listCalendars(50, pageToken);
    const calendar = findTeamCalendar(page.items);
    if (calendar) return teamCalendarResult(calendar, false);
    pageToken = page.pageToken;
    if (!page.hasMore) break;
  } while (pageToken);
  const { calendar } = await createCalendar({ summary: "团队共享日历", permissions: "public" });
  return teamCalendarResult(calendar, true);
}

export function findTeamCalendar(items: CalendarItem[]) {
  return items.find((calendar) => (calendar.summary === "团队共享日历" || calendar.summary === "团队日历") && calendar.type === "shared" && (calendar.permissions === "public" || calendar.permissions === "show_only_free_busy"));
}

function teamCalendarResult(calendar: CalendarItem, created: boolean) {
  return {
    calendar,
    created,
    subscription: {
      calendar_id: calendar.calendar_id,
      method: `在飞书日历左侧点击「＋」→「订阅日历」，搜索“${calendar.summary}”`,
    },
  };
}

export function createCalendar(input: CalendarInput) {
  return feishu<{ calendar: CalendarItem }>("/calendar/v4/calendars", { method: "POST", body: JSON.stringify({ summary: required(input.summary?.trim(), "summary"), description: input.description?.trim() || "", permissions: input.permissions || "private" }) });
}

export function updateCalendar(calendarId: string, input: CalendarInput) {
  return feishu<{ calendar: CalendarItem }>(`/calendar/v4/calendars/${pathPart(calendarId, "calendar_id")}`, { method: "PATCH", body: JSON.stringify({ summary: required(input.summary?.trim(), "summary"), description: input.description?.trim() || "", permissions: input.permissions || "private" }) });
}

export function deleteCalendar(calendarId: string) {
  return feishu<Record<string, never>>(`/calendar/v4/calendars/${pathPart(calendarId, "calendar_id")}`, { method: "DELETE" });
}

export async function createArticle(input: ArticleInput) {
  const data = await feishu<{ document?: { document_id?: string; title?: string } }>("/docx/v1/documents", { method: "POST", body: JSON.stringify({ title: required(input.title?.trim(), "title"), folder_token: input.folder_token || undefined }) });
  const documentId = required(data.document?.document_id, "document_id");
  if (input.content?.trim()) await createArticleText(documentId, input.content);
  if (input.full_access_open_id) await feishu(`/drive/v1/permissions/${pathPart(documentId, "document_id")}/members?type=docx&need_notification=false`, { method: "POST", body: JSON.stringify({ member_type: "openid", member_id: input.full_access_open_id, perm: "full_access" }) });
  if (input.public_share) await feishu(`/drive/v2/permissions/${pathPart(documentId, "document_id")}/public?type=docx`, { method: "PATCH", body: JSON.stringify({ external_access: true, link_share_entity: "anyone_readable" }) });
  return { document: data.document, content: input.content || "" };
}

export async function getArticle(documentId: string) {
  const id = pathPart(documentId, "document_id");
  const [meta, raw] = await Promise.all([
    feishu<{ document?: { document_id?: string; title?: string; revision_id?: number } }>(`/docx/v1/documents/${id}`),
    feishu<{ content?: string }>(`/docx/v1/documents/${id}/raw_content`),
  ]);
  return { document: meta.document, content: raw.content || "" };
}

export async function updateArticle(documentId: string, input: ArticleInput) {
  const id = pathPart(documentId, "document_id");
  if (input.title !== undefined) await updateArticleBlock(id, id, required(input.title.trim(), "title"));
  if (input.content !== undefined) {
    const blocks = await feishu<{ items?: { block_id?: string; block_type?: number }[] }>(`/docx/v1/documents/${id}/blocks?page_size=500`);
    const textBlock = blocks.items?.find((block) => block.block_type === 2 && block.block_id !== documentId)?.block_id;
    if (textBlock) await updateArticleBlock(id, pathPart(textBlock, "block_id"), input.content);
    else if (input.content) await createArticleText(documentId, input.content);
  }
  return getArticle(documentId);
}

export function deleteArticle(documentId: string) {
  return feishu<Record<string, never>>(`/drive/v1/files/${pathPart(documentId, "document_id")}?type=docx`, { method: "DELETE" });
}

export function articleTextBlock(content: string) {
  return { block_type: 2, text: { elements: [{ text_run: { content } }] } };
}

function createArticleText(documentId: string, content: string) {
  const id = pathPart(documentId, "document_id");
  return feishu(`/docx/v1/documents/${id}/blocks/${id}/children`, { method: "POST", body: JSON.stringify({ children: [articleTextBlock(content)], index: 0 }) });
}

function updateArticleBlock(documentId: string, blockId: string, content: string) {
  return feishu(`/docx/v1/documents/${documentId}/blocks/${blockId}`, { method: "PATCH", body: JSON.stringify({ update_text_elements: { elements: [{ text_run: { content } }] } }) });
}

export async function listCalendarEvents(calendarId: string, startTime?: string, endTime?: string) {
  if (!calendarId) throw new Error("calendar_id 不能为空");
  const query = new URLSearchParams({ page_size: "50" });
  if (startTime) query.set("start_time", startTime);
  if (endTime) query.set("end_time", endTime);
  const data = await feishu<{ items?: EventItem[]; has_more?: boolean; page_token?: string }>(
    `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
  );
  return { items: visibleEvents(data.items || []), hasMore: !!data.has_more, pageToken: data.page_token };
}

export function visibleEvents(items: EventItem[]) {
  return items.filter((event) => event.status !== "cancelled");
}

export async function createCalendarEvent(calendarId: string, input: EventInput) {
  return feishu<{ event: EventItem }>(`/calendar/v4/calendars/${pathPart(calendarId, "calendar_id")}/events`, {
    method: "POST",
    body: JSON.stringify(createEventBody(input)),
  });
}

export async function updateCalendarEvent(calendarId: string, eventId: string, input: EventInput) {
  return feishu<{ event: EventItem }>(`/calendar/v4/calendars/${pathPart(calendarId, "calendar_id")}/events/${pathPart(eventId, "event_id")}`, {
    method: "PATCH",
    body: JSON.stringify(eventBody(input)),
  });
}

export async function deleteCalendarEvent(calendarId: string, eventId: string) {
  return feishu<Record<string, never>>(`/calendar/v4/calendars/${pathPart(calendarId, "calendar_id")}/events/${pathPart(eventId, "event_id")}`, { method: "DELETE" });
}

function eventBody(input: EventInput) {
  const summary = required(input.summary?.trim(), "summary");
  const start = required(input.start_time, "start_time");
  const end = required(input.end_time, "end_time");
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end) || Number(end) <= Number(start)) throw new Error("开始和结束时间必须是有效的 Unix 秒时间戳，且结束时间晚于开始时间");
  const timezone = input.timezone || "Asia/Shanghai";
  return { summary, description: input.description?.trim() || "", start_time: { timestamp: start, timezone }, end_time: { timestamp: end, timezone } };
}

export function createEventBody(input: EventInput, now = Math.floor(Date.now() / 1000)) {
  const start = input.start_time || String(now + 3600);
  const end = input.end_time || String(Number(start) + 7200);
  return eventBody({ ...input, start_time: start, end_time: end });
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} 不能为空`);
  return value;
}

function pathPart(value: string | undefined, name: string) { return encodeURIComponent(required(value, name)); }

export function oauthProfile(profile: { open_id: string; name?: string; en_name?: string; email?: string; enterprise_email?: string; avatar_url?: string }) {
  return { id: profile.open_id, name: profile.name || profile.en_name || "飞书用户", email: profile.enterprise_email || profile.email || null, image: profile.avatar_url || null };
}

export function configStatus() {
  return {
    feishuConfigured: !!((process.env.FEISHU_APP_ID || process.env.FEISHU_APP_KEY) && process.env.FEISHU_APP_SECRET),
  };
}
