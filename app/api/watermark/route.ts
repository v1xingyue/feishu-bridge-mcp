import { authOptions } from "@/auth";
import { isAllowedOpenId, sessionOpenId } from "@/lib/auth";
import { handleRpc } from "@/lib/mcp";
import { getServerSession } from "next-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ error: "请先登录飞书" }, { status: 401 });
  if (!isAllowedOpenId(sessionOpenId(session))) return Response.json({ error: "当前飞书账号没有操作权限" }, { status: 403 });

  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "add_image_watermark", arguments: await request.json().catch(() => ({})) },
  }) as { result?: { content?: { type: string; data?: string; mimeType?: string; text?: string }[]; isError?: boolean } };
  const content = response.result?.content || [];
  if (response.result?.isError) return Response.json({ error: content[0]?.text || "水印处理失败" }, { status: 400 });
  const image = content.find((item) => item.type === "image");
  if (!image?.data || !image.mimeType) return Response.json({ error: "MCP 未返回图片" }, { status: 502 });
  return Response.json({ data: image.data, mimeType: image.mimeType, details: content.find((item) => item.type === "text")?.text });
}
