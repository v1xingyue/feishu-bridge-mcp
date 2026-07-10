import { authOptions } from "@/auth";
import { ArticleInput, CalendarInput, createArticle, createCalendar, createCalendarEvent, deleteArticle, deleteCalendar, deleteCalendarEvent, EventInput, getArticle, listCalendarEvents, listCalendars, listDocuments, updateArticle, updateCalendar, updateCalendarEvent } from "@/lib/feishu";
import { getServerSession } from "next-auth";
import { isAdminOpenId, isAllowedOpenId, sessionOpenId } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = await requireAccess();
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  try {
    const type = query.get("type");
    if (type === "documents") return Response.json(await listDocuments());
    if (type === "calendars") return Response.json(await listCalendars());
    if (type === "events") return Response.json(await listCalendarEvents(query.get("calendarId") || ""));
    if (type === "article") return Response.json(await getArticle(query.get("documentId") || ""));
    return Response.json({ error: "未知内容类型" }, { status: 400 });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "飞书请求失败" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  return mutate(request, async (body) => {
    if (body.resource === "calendar") return createCalendar(body);
    if (body.resource === "article") return createArticle(body);
    return createCalendarEvent(body.calendarId, body);
  });
}

export async function PATCH(request: Request) {
  return mutate(request, async (body) => {
    if (body.resource === "calendar") return updateCalendar(body.calendarId, body);
    if (body.resource === "article") return updateArticle(body.documentId, body);
    return updateCalendarEvent(body.calendarId, body.eventId, body);
  });
}

export async function DELETE(request: Request) {
  return mutate(request, async (body) => {
    if (body.resource === "calendar") return deleteCalendar(body.calendarId);
    if (body.resource === "article") return deleteArticle(body.documentId);
    return deleteCalendarEvent(body.calendarId, body.eventId);
  });
}

type Mutation = EventInput & CalendarInput & ArticleInput & { resource?: "calendar" | "article"; calendarId: string; eventId: string; documentId: string };

async function mutate(request: Request, action: (body: Mutation) => Promise<unknown>) {
  const denied = await requireAccess(true);
  if (denied) return denied;
  try {
    return Response.json(await action(await request.json() as Mutation));
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "飞书请求失败" }, { status: 400 });
  }
}

async function requireAccess(admin = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ error: "请先登录飞书" }, { status: 401 });
  const openId = sessionOpenId(session);
  if (!(admin ? isAdminOpenId(openId) : isAllowedOpenId(openId))) return Response.json({ error: `当前飞书账号：${session.user.name || "未知用户"}（${openId || "未获取 open_id，请退出后重新登录"}）没有操作权限` }, { status: 403 });
  return null;
}
