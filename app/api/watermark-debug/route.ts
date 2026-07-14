import { authOptions } from "../../../auth.ts";
import { isAdminOpenId, sessionOpenId } from "../../../lib/auth.ts";
import { addTextWatermark } from "../../../lib/watermark.ts";
import { isWatermarkDebugEnabled, setWatermarkDebugEnabled } from "../../../lib/watermark-debug-state.ts";
import { getServerSession } from "next-auth";
import sharp from "sharp";

export const runtime = "nodejs";

// GET: Returns a sample watermarked image if debug mode is enabled
export async function GET(request: Request) {
  const isEnabled = await isWatermarkDebugEnabled();
  
  const { searchParams } = new URL(request.url);
  if (searchParams.has("status")) {
    return Response.json({ enabled: isEnabled });
  }

  if (!isEnabled) {
    return Response.json(
      { error: "水印调试接口当前已关闭。管理员可以在后台的「MCP 接入」页面打开此开关。" },
      { status: 403 }
    );
  }

  const text = searchParams.get("text") || "水印调试 CN Test 123";
  const fontSize = Number(searchParams.get("fontSize")) || 48;
  const position = searchParams.get("position") || "center";
  const opacity = Number(searchParams.get("opacity")) || 0.8;

  try {
    // Create a 800x600 solid blue image to apply the watermark on
    const source = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: "blue"
      }
    }).png().toBuffer();

    const result = await addTextWatermark({
      image_base64: source.toString("base64"),
      text,
      font_size: fontSize,
      position,
      opacity
    });

    const imageBuffer = Buffer.from(result.data, "base64");
    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "生成水印失败" },
      { status: 500 }
    );
  }
}

// POST: Toggles the debug mode (Admin only)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "请先登录飞书" }, { status: 401 });
  }

  const openId = sessionOpenId(session);
  if (!isAdminOpenId(openId)) {
    return Response.json({ error: "只有管理员可以切换水印调试接口的状态" }, { status: 403 });
  }

  try {
    const { enabled } = (await request.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return Response.json({ error: "参数 enabled 必须为布尔值" }, { status: 400 });
    }

    await setWatermarkDebugEnabled(enabled);
    return Response.json({ enabled, message: enabled ? "水印调试接口已开启" : "水印调试接口已关闭" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "状态切换失败" },
      { status: 500 }
    );
  }
}
