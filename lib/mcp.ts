import { createArticle, createCalendar, createCalendarEvent, deleteArticle, deleteCalendar, deleteCalendarEvent, ensureTeamCalendar, getArticle, listCalendarEvents, listCalendars, listDocuments, updateArticle, updateCalendar, updateCalendarEvent } from "./feishu.ts";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export const tools = [
  {
    name: "list_documents",
    description: "列出工作空间根目录中的文档、表格和文件",
    inputSchema: { type: "object", properties: { page_size: { type: "integer", minimum: 1, maximum: 200, default: 50 } } },
  },
  {
    name: "list_calendars",
    description: "列出当前连接可访问的日历",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ensure_team_calendar",
    description: "确保存在可供成员订阅的公开共享团队日历；存在则直接返回，否则创建后返回",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_calendar_events",
    description: "列出指定日历中的日程",
    inputSchema: {
      type: "object",
      required: ["calendar_id"],
      properties: {
        calendar_id: { type: "string" },
        start_time: { type: "string", description: "Unix 秒时间戳" },
        end_time: { type: "string", description: "Unix 秒时间戳" },
      },
    },
  },
  {
    name: "create_calendar_event",
    get description() { return `在指定日历中创建日程。当前上海日期是 ${new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date())}；“今天”、“明天”等相对日期必须以此为准换算，不得使用过去年份。`; },
    inputSchema: eventInputSchema(false),
  },
  {
    name: "update_calendar_event",
    description: "编辑指定日程",
    inputSchema: eventInputSchema(true),
  },
  {
    name: "delete_calendar_event",
    description: "删除指定日程",
    inputSchema: { type: "object", required: ["calendar_id", "event_id"], properties: { calendar_id: { type: "string" }, event_id: { type: "string" } } },
  },
  { name: "create_calendar", description: "创建共享日历", inputSchema: calendarSchema(false) },
  { name: "update_calendar", description: "修改共享日历", inputSchema: calendarSchema(true) },
  { name: "delete_calendar", description: "删除共享日历", inputSchema: { type: "object", required: ["calendar_id"], properties: { calendar_id: { type: "string" } } } },
  { name: "create_article", description: "创建文档文章", inputSchema: articleSchema(false) },
  { name: "get_article", description: "读取文章标题和纯文本正文", inputSchema: { type: "object", required: ["document_id"], properties: { document_id: { type: "string" } } } },
  { name: "update_article", description: "修改文章标题和纯文本正文", inputSchema: articleSchema(true) },
  { name: "delete_article", description: "删除文章", inputSchema: { type: "object", required: ["document_id"], properties: { document_id: { type: "string" } } } },
] as const;

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const error = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function handleRpc(request: RpcRequest) {
  if (request.jsonrpc !== "2.0" || !request.method) return error(request.id, -32600, "Invalid Request");
  if (request.method === "initialize") {
    return ok(request.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "workspace-data", version: "0.1.0" },
    });
  }
  if (request.method === "notifications/initialized") return null;
  if (request.method === "ping") return ok(request.id, {});
  if (request.method === "tools/list") return ok(request.id, { tools });
  if (request.method !== "tools/call") return error(request.id, -32601, "Method not found");

  const name = request.params?.name;
  const args = (request.params?.arguments || {}) as Record<string, unknown>;
  try {
    let data: unknown;
    if (name === "list_documents") data = await listDocuments(Number(args.page_size) || 50);
    else if (name === "list_calendars") data = await listCalendars();
    else if (name === "ensure_team_calendar") data = await ensureTeamCalendar();
    else if (name === "list_calendar_events") {
      if (typeof args.calendar_id !== "string" || !args.calendar_id) throw new Error("calendar_id 不能为空");
      data = await listCalendarEvents(args.calendar_id, stringArg(args.start_time), stringArg(args.end_time));
    } else if (name === "create_calendar_event") data = await createCalendarEvent(requiredArg(args, "calendar_id"), eventArgs(args, false));
    else if (name === "update_calendar_event") data = await updateCalendarEvent(requiredArg(args, "calendar_id"), requiredArg(args, "event_id"), eventArgs(args, true));
    else if (name === "delete_calendar_event") data = await deleteCalendarEvent(requiredArg(args, "calendar_id"), requiredArg(args, "event_id"));
    else if (name === "create_calendar") data = await createCalendar(calendarArgs(args));
    else if (name === "update_calendar") data = await updateCalendar(requiredArg(args, "calendar_id"), calendarArgs(args));
    else if (name === "delete_calendar") data = await deleteCalendar(requiredArg(args, "calendar_id"));
    else if (name === "create_article") data = await createArticle(articleArgs(args));
    else if (name === "get_article") data = await getArticle(requiredArg(args, "document_id"));
    else if (name === "update_article") data = await updateArticle(requiredArg(args, "document_id"), articleArgs(args));
    else if (name === "delete_article") data = await deleteArticle(requiredArg(args, "document_id"));
    else return error(request.id, -32602, `未知工具: ${String(name)}`);
    return ok(request.id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
  } catch (cause) {
    return ok(request.id, {
      content: [{ type: "text", text: cause instanceof Error ? cause.message : "上游服务请求失败" }],
      isError: true,
    });
  }
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requiredArg(args: Record<string, unknown>, name: string) {
  const value = stringArg(args[name]);
  if (!value) throw new Error(`${name} 不能为空`);
  return value;
}

function eventArgs(args: Record<string, unknown>, requireTimes: boolean) {
  return {
    summary: requiredArg(args, "summary"),
    description: stringArg(args.description),
    start_time: requireTimes ? requiredArg(args, "start_time") : stringArg(args.start_time),
    end_time: requireTimes ? requiredArg(args, "end_time") : stringArg(args.end_time),
    timezone: stringArg(args.timezone),
  };
}

function eventInputSchema(editing: boolean) {
  return {
    type: "object",
    required: editing ? ["calendar_id", "event_id", "summary", "start_time", "end_time"] : ["calendar_id", "summary"],
    properties: {
      calendar_id: { type: "string" },
      ...(editing ? { event_id: { type: "string" } } : {}),
      summary: { type: "string" },
      description: { type: "string" },
      start_time: { type: "string", description: editing ? "Unix 秒时间戳" : "可选；默认当前时间后 1 小时" },
      end_time: { type: "string", description: editing ? "Unix 秒时间戳" : "可选；默认开始时间后 2 小时" },
      timezone: { type: "string", default: "Asia/Shanghai" },
    },
  };
}

function calendarArgs(args: Record<string, unknown>) {
  return { summary: requiredArg(args, "summary"), description: stringArg(args.description), permissions: (stringArg(args.permissions) || "private") as "private" | "show_only_free_busy" | "public" };
}

function calendarSchema(editing: boolean) {
  return { type: "object", required: editing ? ["calendar_id", "summary"] : ["summary"], properties: { ...(editing ? { calendar_id: { type: "string" } } : {}), summary: { type: "string" }, description: { type: "string" }, permissions: { type: "string", enum: ["private", "show_only_free_busy", "public"], default: "private" } } };
}

function articleArgs(args: Record<string, unknown>) {
  return { title: requiredArg(args, "title"), content: stringArg(args.content), folder_token: stringArg(args.folder_token) };
}

function articleSchema(editing: boolean) {
  return { type: "object", required: editing ? ["document_id", "title"] : ["title"], properties: { ...(editing ? { document_id: { type: "string" } } : {}), title: { type: "string" }, content: { type: "string", description: "纯文本正文" }, folder_token: { type: "string", description: "可选目标文件夹 token" } } };
}
