import { authOptions } from "@/auth";
import { isAdminOpenId, mcpTokenTtl, sessionOpenId, signMcpToken } from "@/lib/auth";
import { getServerSession } from "next-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ error: "请先登录飞书" }, { status: 401 });
  const openId = sessionOpenId(session);
  if (!isAdminOpenId(openId)) return Response.json({ error: `当前飞书账号：${session.user.name || "未知用户"}（${openId || "未获取 open_id，请退出后重新登录"}）；只有管理员可以生成 MCP Token` }, { status: 403 });
  const ttl = mcpTokenTtl((await request.json().catch(() => ({})) as { days?: unknown }).days ?? 30);
  if (!ttl) return Response.json({ error: "有效期只能选择 30、180 或 360 天" }, { status: 400 });
  try {
    const token = signMcpToken(openId!, ttl);
    return Response.json({ token, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "JWT 生成失败" }, { status: 500 });
  }
}
