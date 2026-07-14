import { configStatus } from "@/lib/feishu";

export async function GET() {
  return Response.json({ ...configStatus(), watermarkEnabled: process.env.WATERMARK_ENABLED === "1" });
}
