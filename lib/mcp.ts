import { createArticle, createCalendar, createCalendarEvent, deleteArticle, deleteCalendar, deleteCalendarEvent, ensureTeamCalendar, getArticle, listCalendarEvents, listCalendars, listDocuments, updateArticle, updateCalendar, updateCalendarEvent } from "./feishu.ts";
import { tools } from "./mcp-tools.ts";
import { addTextWatermark } from "./watermark.ts";
import packageJson from "../package.json" with { type: "json" };

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const error = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function handleRpc(request: RpcRequest) {
  if (request.jsonrpc !== "2.0" || !request.method) return error(request.id, -32600, "Invalid Request");
  if (request.method === "initialize") {
    return ok(request.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "workspace-data", version: packageJson.version },
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
    else if (name === "add_image_watermark") {
      const image = await addTextWatermark({ image_base64: requiredArg(args, "image_base64"), text: requiredArg(args, "text"), position: stringArg(args.position), font_size: numberArg(args.font_size) });
      return ok(request.id, { content: [{ type: "image", data: image.data, mimeType: image.mimeType }, { type: "text", text: `${image.width}x${image.height} · fontSize=${image.fontSize} · ${image.renderer}${image.debug ? ` · ${image.debug}` : ""}` }] });
    }
    else if (name === "list_calendars") data = await listCalendars();
    else if (name === "get_team_calendar") data = await ensureTeamCalendar();
    else if (name === "get_current_time_and_team_calendar") data = { timestamp: Math.floor(Date.now() / 1000), system_version: packageJson.version, commit_hash: process.env.VERCEL_GIT_COMMIT_SHA || null, deployed_at: process.env.DEPLOYED_AT || null, team_calendar: await ensureTeamCalendar() };
    else if (name === "list_calendar_events") {
      data = await listCalendarEvents(await calendarId(args), stringArg(args.start_time), stringArg(args.end_time));
    } else if (name === "create_calendar_event") data = await createCalendarEvent(await calendarId(args), eventArgs(args, false));
    else if (name === "update_calendar_event") data = await updateCalendarEvent(await calendarId(args), requiredArg(args, "event_id"), eventArgs(args, true));
    else if (name === "delete_calendar_event") data = await deleteCalendarEvent(await calendarId(args), requiredArg(args, "event_id"));
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

function numberArg(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function requiredArg(args: Record<string, unknown>, name: string) {
  const value = stringArg(args[name]);
  if (!value) throw new Error(`${name} 不能为空`);
  return value;
}

async function calendarId(args: Record<string, unknown>) {
  return stringArg(args.calendar_id) || (await ensureTeamCalendar()).calendar.calendar_id;
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

function calendarArgs(args: Record<string, unknown>) {
  return { summary: requiredArg(args, "summary"), description: stringArg(args.description), permissions: (stringArg(args.permissions) || "private") as "private" | "show_only_free_busy" | "public" };
}

function articleArgs(args: Record<string, unknown>) {
  return { title: requiredArg(args, "title"), content: stringArg(args.content), folder_token: stringArg(args.folder_token) };
}
